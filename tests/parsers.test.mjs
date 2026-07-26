/**
 * 解析器回归测试：用教务网真实响应验证各 parser 的输出。
 *
 * 现有的 test_suite.py 只做结构冒烟（文件在不在、DOM ID 有没有），
 * 无法发现"列下标错位""端点用错"这类静默错误——本项目已出现过 9 个此类 BUG。
 * 这里的每条断言都对应一个真实修复过的 BUG，用于防止回归。
 *
 * 运行：npm run test:parsers   （需先 npm run capture:fixtures 生成 fixture）
 */
import { build } from 'esbuild';
import { DOMParser } from 'linkedom';
import { existsSync, readFileSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const FIXTURES = join(HERE, 'fixtures');
const TMP = join(HERE, '.build');

if (!existsSync(join(FIXTURES, 'profile.html'))) {
    console.error('未找到 fixture，请先运行：npm run capture:fixtures');
    console.error(`（期望目录：${FIXTURES}）`);
    process.exit(1);
}

// parser 依赖浏览器的 DOMParser，这里用 linkedom 提供等价实现
globalThis.DOMParser = DOMParser;

const PARSERS = ['profileParser', 'timetableParser', 'gradeParser', 'examParser',
                 'announcementParser', 'serviceParser'];

// splitting 让 tableUtils 成为共享 chunk，否则各 bundle 会各自内联一份 ParseError，
// 导致 instanceof 判定失败。
await build({
    entryPoints: [
        ...PARSERS.map(p => join(ROOT, 'src', 'parsers', `${p}.ts`)),
        join(ROOT, 'src', 'utils', 'tableUtils.ts'),
    ],
    outdir: TMP,
    outbase: join(ROOT, 'src'),
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'node',
    outExtension: { '.js': '.mjs' },
    logLevel: 'error',
});

const mod = {};
for (const p of PARSERS) {
    Object.assign(mod, await import(`file://${join(TMP, 'parsers', `${p}.mjs`)}`));
}
const { ProfileParser, TimetableParser, GradeParser, ExamParser,
        AnnouncementParser, ServiceParser } = mod;
const { ParseError } = await import(`file://${join(TMP, 'utils', 'tableUtils.mjs')}`);

const read = n => readFileSync(join(FIXTURES, `${n}.html`), 'utf-8');

let passed = 0;
const failures = [];

/**
 * 断言相等。
 *
 * Args:
 *     label (string): 用例名称。
 *     actual (any): 实际值。
 *     expected (any): 期望值。
 */
function eq(label, actual, expected) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) {
        passed++;
        console.log(`  ✓ ${label}`);
    } else {
        failures.push(`${label}\n      期望: ${e}\n      实际: ${a}`);
        console.log(`  ✗ ${label}  期望 ${e}，实际 ${a}`);
    }
}

/**
 * 断言为真。
 */
function ok(label, cond, detail = '') {
    if (cond) {
        passed++;
        console.log(`  ✓ ${label}`);
    } else {
        failures.push(`${label} ${detail}`);
        console.log(`  ✗ ${label} ${detail}`);
    }
}

/**
 * 断言调用会抛出 ParseError（用于验证"结构变化"能被识别）。
 */
function throwsParseError(label, fn) {
    try {
        fn();
        failures.push(`${label}（未抛出 ParseError）`);
        console.log(`  ✗ ${label}（未抛出 ParseError）`);
    } catch (e) {
        if (e instanceof ParseError) {
            passed++;
            console.log(`  ✓ ${label}`);
        } else {
            failures.push(`${label}（抛出的是 ${e.name}）`);
            console.log(`  ✗ ${label}（抛出的是 ${e.name}）`);
        }
    }
}

const section = t => console.log(`\n${t}`);

// ── 学籍信息 ────────────────────────────────────────────────
section('个人信息');
const profile = ProfileParser.parseProfile(read('profile'));
ok('姓名可解析', profile.name && profile.name !== '未登录', `得到 ${profile.name}`);
ok('学号为 12 位', /^\d{12}$/.test(profile.studentId), `得到 ${profile.studentId}`);
ok('院系非空', profile.dept !== '-');
ok('专业非空', profile.major !== '-');
ok('班级非空', profile.className !== '-');

// BUG: 课表页周次下拉默认停在"(全部)"且无 selected，教学周只能从首页框架取；
// 此前 currentWeek 恒为 undefined，导致上课提醒完全无法排程、今日课程永远为空。
section('当前教学周（曾导致上课提醒完全失效）');
const rawProfile = read('profile');
eq('假期页面应返回 undefined', ProfileParser.parseCurrentWeek(rawProfile), undefined);
eq('"第 12 周" 应解析为 12',
   ProfileParser.parseCurrentWeek(rawProfile.replace('当前日期不在教学周历内', '第 12 周')), 12);
eq('"第3周"（无空格）应解析为 3',
   ProfileParser.parseCurrentWeek(rawProfile.replace('当前日期不在教学周历内', '第3周')), 3);

// ── 课表 ────────────────────────────────────────────────────
section('课表');
const tt = TimetableParser.parseTimetable(read('timetable'));
ok('解析出课程', tt.courses.length > 0, `得到 ${tt.courses.length} 条`);
ok('学期 ID 形如 YYYY-YYYY-N', /^\d{4}-\d{4}-\d$/.test(tt.currentSemesterId || ''),
   `得到 ${tt.currentSemesterId}`);
ok('每条课程都有教室与教师',
   tt.courses.every(c => c.room && c.teacher));
ok('每条课程都解析出了生效周次',
   tt.courses.every(c => Array.isArray(c.activeWeeks) && c.activeWeeks.length > 0));
// BUG: 红色字体是调课标记(O/P)，此前被误当作"选修/必修"；且页面同时存在单双引号两种写法
ok('调课标记能被识别（单双引号都要覆盖）',
   tt.courses.some(c => c.isAdjusted), '未识别出任何调课课程');

// ── 成绩 ────────────────────────────────────────────────────
section('期末成绩');
const g = GradeParser.parseGrades(read('grades'));
ok('GPA 非零', parseFloat(g.gpa) > 0, `得到 ${g.gpa}`);
ok('总学分非零', parseFloat(g.totalCredits) > 0, `得到 ${g.totalCredits}`);
ok('解析出成绩明细', g.gradesList.length > 0, `得到 ${g.coursesCount} 门`);
ok('课程名与学期均非空',
   g.gradesList.every(x => x.courseName && x.semester));

// BUG: 此前按 [序号,学期,考试号,名称,日期,成绩] 取列，而真实表头是
// [序号, 考级课程(等级), 分数类(笔试/机试/总成绩), 等级类(笔试/机试/总成绩), 考级时间]，
// 导致四级 470 分被显示成 0。
section('等级考试成绩（曾整体列错位）');
const lv = GradeParser.parseLevelGrades(read('level_grades'));
ok('解析出等级考试记录', lv.length > 0, `得到 ${lv.length} 条`);
ok('成绩是有效分数而非 0/空',
   lv.every(x => x.score && x.score !== '0' && x.score !== '-'),
   JSON.stringify(lv.map(x => x.score)));
ok('考试日期是 YYYY-MM-DD',
   lv.every(x => /^\d{4}-\d{2}-\d{2}$/.test(x.date)),
   JSON.stringify(lv.map(x => x.date)));
ok('课程名含"考试"字样', lv.every(x => x.name.includes('考试')));

// BUG: 日期此前取的是"类别"列，显示成"学生类别"；链接在"操作"列的 openWindow(...) 里
section('公告（曾把"类别"当成日期）');
const anns = AnnouncementParser.parseAnnouncements(read('announcements'));
ok('解析出公告', anns.length > 0, `得到 ${anns.length} 条`);
ok('日期是时间戳格式而非"学生类别"',
   anns.every(a => /^\d{4}-\d{2}-\d{2}/.test(a.date)),
   JSON.stringify(anns.slice(0, 2).map(a => a.date)));
ok('能提取出公告详情链接',
   anns.every(a => a.url && a.url.includes('/jsxsd/')),
   JSON.stringify(anns.slice(0, 2).map(a => a.url)));

// BUG: 端点用错(xsksap_query 只是表单页) + 参数名用错(kslkid 应为 xqlb) + 列映射错
section('排考 / 随堂考（无数据时应安全返回空列表）');
eq('排考无数据不报错', ExamParser.parseExams(read('exams_list'), '2025-2026-2', '期末'), []);
eq('随堂考无数据不报错', ExamParser.parseClassroomTests(read('stk_list')), []);

// BUG: 此前找 table#Table1（真实页面并不存在），且把矩阵当成列表解析，恒返回空
section('空教室（曾恒为空）');
const total = ServiceParser.parseClassrooms(read('empty_classroom'));
const multi = ServiceParser.parseClassrooms(read('ec_multi'));
const sunday = ServiceParser.parseClassrooms(read('ec_sunday'));
ok('周一 1-2 节能查出空教室', total.length > 0, `得到 ${total.length}`);
ok('教室名形如 "汇新101(50/30)"',
   total.every(r => /\(\d+\/\d+\)/.test(r)), JSON.stringify(total.slice(0, 2)));
// ◆ = 占用：查询跨的节次越多，空闲教室只会更少；周日晚间应几乎全空
ok('节次范围更大时空闲更少（1-4 节 ≤ 1-2 节）', multi.length <= total.length,
   `1-2节=${total.length}, 1-4节=${multi.length}`);
ok('周日晚间空闲最多（判定极性正确）', sunday.length > total.length,
   `周日9-10节=${sunday.length}, 周一1-2节=${total.length}`);

section('毕业设计');
// BUG: 非毕业年级页面仍会渲染空表骨架，此前未识别"未查询到数据"而展示了默认假数据
const practice = ServiceParser.parsePractice(read('thesis'));
ok('非毕业阶段应判为空', practice.empty === true, JSON.stringify(practice));

section('选课中心');
const xk = ServiceParser.parseXkCenter(read('course_select'));
ok('无选课活动时返回空数组', Array.isArray(xk));

// 附件 href 来自第三方 HTML，会被写进 <a>，必须先过白名单
section('公告附件地址白名单（防止把第三方 href 直接写进 <a>）');
const PAGE = '/jsxsd/ggly/ggly_show?ggid=ABC123';
const safe = (h) => AnnouncementParser.safeResourcePath(h, PAGE);
eq('相对路径可解析', safe('../uploadfiles/a.doc'), '/jsxsd/uploadfiles/a.doc');
eq('绝对路径保留查询串', safe('/jsxsd/down?id=9'), '/jsxsd/down?id=9');
eq('本站绝对地址可接受', safe('https://xjwis.ynufe.edu.cn/jsxsd/f.pdf'), '/jsxsd/f.pdf');
eq('javascript 伪协议被拒', safe('javascript:alert(1)'), null);
eq('大小写混写的伪协议同样被拒', safe('JaVaScRiPt:alert(1)'), null);
eq('data 伪协议被拒', safe('data:text/html,<script>'), null);
eq('站外地址被拒', safe('https://evil.example.com/x.exe'), null);
eq('锚点被拒', safe('#top'), null);
eq('空值被拒', safe(''), null);

// 结构变化必须报错，而不是伪装成"暂无数据"——这正是上述 BUG 长期潜伏的原因
section('结构变化检测（防止解析失败伪装成空数据）');
const GARBAGE = '<html><body><table id="dataList"><tr><th>无关表头</th></tr></table></body></html>';
throwsParseError('成绩页结构异常应抛 ParseError', () => GradeParser.parseGrades(GARBAGE));
throwsParseError('等级考试结构异常应抛 ParseError', () => GradeParser.parseLevelGrades(GARBAGE));
throwsParseError('公告结构异常应抛 ParseError', () => AnnouncementParser.parseAnnouncements(GARBAGE));
throwsParseError('排考结构异常应抛 ParseError', () => ExamParser.parseExams(GARBAGE));
throwsParseError('空教室结构异常应抛 ParseError', () => ServiceParser.parseClassrooms(GARBAGE));
ok('但"未查询到数据"是正常空结果，不应报错',
   ExamParser.parseExams(read('exams_list')).length === 0);

rmSync(TMP, { recursive: true, force: true });

console.log('\n' + '='.repeat(58));
if (failures.length === 0) {
    console.log(`  全部通过：${passed} 条断言`);
    console.log('='.repeat(58));
    process.exit(0);
} else {
    console.log(`  ${passed} 条通过，${failures.length} 条失败：`);
    failures.forEach(f => console.log(`   - ${f}`));
    console.log('='.repeat(58));
    process.exit(1);
}
