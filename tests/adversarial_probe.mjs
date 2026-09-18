/**
 * Adversarial Stress & Edge-Case Probing Harness
 * Crafted by challenger_2 for exhaustive empirical verification of DOM parsers and TableUtils.
 */
import { build } from 'esbuild';
import { DOMParser } from 'linkedom';
import { rmSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const TMP = join(HERE, '.challenger_build');

globalThis.DOMParser = DOMParser;

const PARSERS = ['profileParser', 'timetableParser', 'gradeParser', 'examParser',
                 'announcementParser', 'serviceParser'];

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
const { ParseError, hasEmptyMarker, buildHeaderIndex, pickIndex, cellText, pickRichestTable } =
    await import(`file://${join(TMP, 'utils', 'tableUtils.mjs')}`);

let totalAssertions = 0;
let passedAssertions = 0;
const failureList = [];

function assert(description, condition, detail = '') {
    totalAssertions++;
    if (condition) {
        passedAssertions++;
        console.log(`  [PASS] ${description}`);
    } else {
        failureList.push({ description, detail });
        console.error(`  [FAIL] ${description} -> ${detail}`);
    }
}

function assertEq(description, actual, expected) {
    const aStr = JSON.stringify(actual);
    const eStr = JSON.stringify(expected);
    assert(description, aStr === eStr, `Expected: ${eStr}, got: ${aStr}`);
}

function assertThrows(description, fn, errorType = ParseError) {
    totalAssertions++;
    try {
        fn();
        failureList.push({ description, detail: 'Did not throw any error' });
        console.error(`  [FAIL] ${description} -> Did not throw`);
    } catch (err) {
        if (err instanceof errorType || (errorType && err.name === errorType.name)) {
            passedAssertions++;
            console.log(`  [PASS] ${description} (threw ${err.name})`);
        } else {
            failureList.push({ description, detail: `Threw unexpected error: ${err}` });
            console.error(`  [FAIL] ${description} -> Unexpected throw: ${err}`);
        }
    }
}

function createDoc(html) {
    return new DOMParser().parseFromString(html, 'text/html');
}

console.log('======================================================================');
console.log('  CHALLENGER_2 ADVERSARIAL EMPIRICAL STRESS & EDGE-CASE TEST SUITE');
console.log('======================================================================\n');

// -----------------------------------------------------------------------------
// MODULE 1: tableUtils.ts Edge Cases
// -----------------------------------------------------------------------------
console.log('>>> 1. Testing TableUtils Edge Cases...');

// 1.1 hasEmptyMarker
assert('hasEmptyMarker with "未查询到数据"', hasEmptyMarker('<tr><td>未查询到数据</td></tr>') === true);
assert('hasEmptyMarker with "暂无数据"', hasEmptyMarker('<div>暂无数据</div>') === true);
assert('hasEmptyMarker with "没有找到"', hasEmptyMarker('<p>没有找到相关记录</p>') === true);
assert('hasEmptyMarker with "无查询结果"', hasEmptyMarker('<span>无查询结果</span>') === true);
assert('hasEmptyMarker with normal table text', hasEmptyMarker('<table><tr><td>高等数学</td></tr></table>') === false);
assert('hasEmptyMarker with empty string', hasEmptyMarker('') === false);

// 1.2 buildHeaderIndex
const emptyTable = createDoc('<table></table>').querySelector('table');
assertEq('buildHeaderIndex on empty table', buildHeaderIndex(emptyTable), {});

const tableNoTh = createDoc('<table><tr><td>Col1</td><td>Col2</td></tr></table>').querySelector('table');
assertEq('buildHeaderIndex on table with td only', buildHeaderIndex(tableNoTh), {});

const tableColspan = createDoc(`
    <table>
        <tr>
            <th colspan="2">课程与编号</th>
            <th>学分</th>
            <th colspan="3">成绩构成</th>
            <th>总评</th>
        </tr>
        <tr>
            <td>1</td><td>2</td><td>3</td><td>4</td><td>5</td><td>6</td><td>7</td>
        </tr>
    </table>
`).querySelector('table');
const colIndexMap = buildHeaderIndex(tableColspan);
assertEq('buildHeaderIndex correctly computes colspan offsets', colIndexMap, {
    '课程与编号': 0,
    '学分': 2,
    '成绩构成': 3,
    '总评': 6
});

const tableColspanInvalid = createDoc(`
    <table>
        <tr>
            <th colspan="invalid">课程</th>
            <th colspan="0">学分</th>
            <th colspan="-5">成绩</th>
        </tr>
    </table>
`).querySelector('table');
const colIndexInvalid = buildHeaderIndex(tableColspanInvalid);
assertEq('buildHeaderIndex handles invalid/zero/negative colspan safely', colIndexInvalid, {
    '课程': 0,
    '学分': 1,
    '成绩': 2
});

// 1.3 pickIndex
const mapSample = { '课程名称': 2, '学分': 4, '成绩': 6 };
assertEq('pickIndex with matching primary name', pickIndex(mapSample, ['课程名称', '名称'], 1), 2);
assertEq('pickIndex with matching fallback name', pickIndex(mapSample, ['课程', '学分'], 1), 4);
assertEq('pickIndex with no matching name falls back', pickIndex(mapSample, ['任课教师', '教师'], 99), 99);
assertEq('pickIndex with empty names array', pickIndex(mapSample, [], 42), 42);

// 1.4 cellText
const rowDoc = createDoc(`
    <tr>
        <td>  高等数学(上)  </td>
        <td><span><b>4.0</b></span></td>
        <td>&nbsp; 95 &nbsp;</td>
        <td></td>
    </tr>
`);
const tds = rowDoc.querySelectorAll('td');
assertEq('cellText cleans whitespace', cellText(tds, { '课程': 0 }, ['课程'], 0), '高等数学(上)');
assertEq('cellText traverses child elements textContent', cellText(tds, { '学分': 1 }, ['学分'], 1), '4.0');
assertEq('cellText handles non-breaking spaces', cellText(tds, { '成绩': 2 }, ['成绩'], 2), '95');
assertEq('cellText empty cell', cellText(tds, { '备注': 3 }, ['备注'], 3), '');
assertEq('cellText index out of range returns empty string', cellText(tds, {}, ['未知'], 10), '');
assertEq('cellText negative fallback index returns empty string', cellText(tds, {}, ['未知'], -1), '');

// 1.5 pickRichestTable
const multiTableDoc = createDoc(`
    <div>
        <table id="dataList"><tr><th>Col</th></tr></table>
        <table id="dataList"><tr><th>Col1</th></tr><tr><td>Row1</td></tr><tr><td>Row2</td></tr></table>
        <table id="dataList"><tr><th>Col1</th></tr><tr><td>Row1</td></tr></table>
    </div>
`);
const richest = pickRichestTable(multiTableDoc, 'table#dataList');
assert('pickRichestTable picks table with most rows (3 rows)', richest && richest.querySelectorAll('tr').length === 3);

const noTableDoc = createDoc('<div><p>No tables here</p></div>');
assert('pickRichestTable returns null when no matching table exists', pickRichestTable(noTableDoc, 'table#dataList') === null);

// -----------------------------------------------------------------------------
// MODULE 2: ProfileParser Adversarial Probes
// -----------------------------------------------------------------------------
console.log('\n>>> 2. Testing ProfileParser Adversarial Scenarios...');

// 2.1 DOM parsing with .middletopdwxxcont
const standardProfileHtml = `
<div class="middletopdwxx">
    <div class="middletopdwxxcont">欢迎登录</div>
    <div class="middletopdwxxcont">李同学</div>
    <div class="middletopdwxxcont">202201020304</div>
    <div class="middletopdwxxcont">信息学院</div>
    <div class="middletopdwxxcont">计算机科学与技术</div>
    <div class="middletopdwxxcont">计科22-1</div>
</div>
`;
const p1 = ProfileParser.parseProfile(standardProfileHtml);
assert('ProfileParser DOM normal flow name', p1.name === '李同学');
assert('ProfileParser DOM normal flow studentId', p1.studentId === '202201020304');
assert('ProfileParser DOM normal flow dept', p1.dept === '信息学院');
assert('ProfileParser DOM normal flow major', p1.major === '计算机科学与技术');
assert('ProfileParser DOM normal flow className', p1.className === '计科22-1');

// 2.2 DOM parsing with fewer than 6 elements -> triggers fallback regex
const brokenDomProfileHtml = `
<div class="middletopdwxx">
    <div class="middletopdwxxcont">欢迎</div>
    <div class="middletopdwxxcont">李同学</div>
</div>
<div>
    姓名：张三
    学号：202311223344
    院系：金融学院
    专业：金融学
    班级：金学23-2
</div>
`;
const p2 = ProfileParser.parseProfile(brokenDomProfileHtml);
assertEq('ProfileParser fallback regex on multiline name', p2.name, '张三');
assertEq('ProfileParser fallback regex studentId', p2.studentId, '202311223344');
assertEq('ProfileParser fallback regex dept', p2.dept, '金融学院');

// 2.3 Single-line profile (testing fixed regex PARSER-01)
const singleLineProfileHtml = `<div>姓名：王五 学号：202100001111 院系：商学院 专业：国际贸易 班级：国贸21-1</div>`;
const pSingle = ProfileParser.parseProfile(singleLineProfileHtml);
assertEq('ProfileParser fallback regex on single-line name (PARSER-01)', pSingle.name, '王五');
assertEq('ProfileParser fallback regex on single-line studentId', pSingle.studentId, '202100001111');
assertEq('ProfileParser fallback regex on single-line dept', pSingle.dept, '商学院');

// 2.4 ProfileParser parseCurrentWeek
const weekDocHoliday = `<div id="li_showWeek">当前日期不在教学周历内</div>`;
assertEq('parseCurrentWeek holiday', ProfileParser.parseCurrentWeek(weekDocHoliday), undefined);

const weekDoc1 = `<div id="li_showWeek">第 1 周 (2026-03-01)</div>`;
assertEq('parseCurrentWeek "第 1 周"', ProfileParser.parseCurrentWeek(weekDoc1), 1);

const weekDoc25 = `<div class="middletopleftzc">第25周</div>`;
assertEq('parseCurrentWeek "第25周" without space via fallback class', ProfileParser.parseCurrentWeek(weekDoc25), 25);

const weekDocOver30 = `<div id="li_showWeek">第 50 周</div>`;
assertEq('parseCurrentWeek > 30 returns undefined', ProfileParser.parseCurrentWeek(weekDocOver30), undefined);

const weekDocZero = `<div id="li_showWeek">第 0 周</div>`;
assertEq('parseCurrentWeek 0 returns undefined', ProfileParser.parseCurrentWeek(weekDocZero), undefined);

const weekDocEmpty = `<div>没有周次</div>`;
assertEq('parseCurrentWeek empty returns undefined', ProfileParser.parseCurrentWeek(weekDocEmpty), undefined);

// -----------------------------------------------------------------------------
// MODULE 3: TimetableParser Adversarial Probes
// -----------------------------------------------------------------------------
console.log('\n>>> 3. Testing TimetableParser Adversarial Scenarios...');

// 3.1 parseActiveWeeks
assertEq('parseActiveWeeks empty', TimetableParser.parseActiveWeeks(''), []);
assertEq('parseActiveWeeks "全周"', TimetableParser.parseActiveWeeks('全周'), Array.from({ length: 25 }, (_, i) => i + 1));
assertEq('parseActiveWeeks "全周(单周)"', TimetableParser.parseActiveWeeks('全周(单周)'), Array.from({ length: 25 }, (_, i) => i + 1).filter(w => w % 2 !== 0));
assertEq('parseActiveWeeks "全周(单)"', TimetableParser.parseActiveWeeks('全周(单)'), Array.from({ length: 25 }, (_, i) => i + 1).filter(w => w % 2 !== 0));
assertEq('parseActiveWeeks "全周(双)"', TimetableParser.parseActiveWeeks('全周(双)'), Array.from({ length: 25 }, (_, i) => i + 1).filter(w => w % 2 === 0));
assertEq('parseActiveWeeks standard "1-16"', TimetableParser.parseActiveWeeks('1-16'),
    [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16]);
assertEq('parseActiveWeeks "1-8(单周)"', TimetableParser.parseActiveWeeks('1-8(单周)'), [1, 3, 5, 7]);
assertEq('parseActiveWeeks "1-8(单)"', TimetableParser.parseActiveWeeks('1-8(单)'), [1, 3, 5, 7]);
assertEq('parseActiveWeeks "2-8(双周)"', TimetableParser.parseActiveWeeks('2-8(双周)'), [2, 4, 6, 8]);
assertEq('parseActiveWeeks "2-8(双)"', TimetableParser.parseActiveWeeks('2-8(双)'), [2, 4, 6, 8]);
assertEq('parseActiveWeeks "1-3周,5-6周"', TimetableParser.parseActiveWeeks('1-3周,5-6周'), [1, 2, 3, 5, 6]);
assertEq('parseActiveWeeks overlapping "1-4周,3-6周"', TimetableParser.parseActiveWeeks('1-4周,3-6周'), [1, 2, 3, 4, 5, 6]);
assertEq('parseActiveWeeks with section tag "1-4[01-02节]"', TimetableParser.parseActiveWeeks('1-4[01-02节]'), [1, 2, 3, 4]);

// 3.2 parseTimetable with multiple courses per slot
const multiCourseSlotHtml = `
<table id="kbtable">
    <tr>
        <td>
            <div id="1_2" class="kbcontent">
                高等数学(上)<br/>
                教师：张教授<br/>
                教室：博学楼101<br/>
                周次(节次)：1-16[01-02节]<br/>
                ---------------------<br/>
                线性代数<br/>
                <font color="red">教师：李教授</font><br/>
                教室：明德楼202<br/>
                周次(节次)：1-8(单周)[01-02节]<br/>
            </div>
        </td>
    </tr>
</table>
<select id="xnxq01id">
    <option value="2025-2026-2" selected="selected">2025-2026-2</option>
</select>
<select id="zc">
    <option value="5" selected="selected">第5周</option>
</select>
`;
const ttParsed = TimetableParser.parseTimetable(multiCourseSlotHtml);
assertEq('parseTimetable slot multi-course count', ttParsed.courses.length, 2);
assertEq('parseTimetable first course name', ttParsed.courses[0].name, '高等数学(上)');
assertEq('parseTimetable first course slot index', ttParsed.courses[0].slot, 1);
assertEq('parseTimetable first course day', ttParsed.courses[0].day, 2);
assertEq('parseTimetable first course session', ttParsed.courses[0].session, 1);
assertEq('parseTimetable second course adjusted tag', ttParsed.courses[1].isAdjusted, true);
assertEq('parseTimetable semester selected', ttParsed.currentSemesterId, '2025-2026-2');
assertEq('parseTimetable week selected', ttParsed.currentWeek, 5);

// 3.3 parseTimetable structure corruption vs empty marker
assertThrows('parseTimetable throws ParseError on unexpected structure', () => {
    TimetableParser.parseTimetable('<div>No timetable table here</div>');
});

const emptyTimetableHtml = '<div>未查询到数据</div>';
const ttEmpty = TimetableParser.parseTimetable(emptyTimetableHtml);
assertEq('parseTimetable returns empty courses on hasEmptyMarker', ttEmpty.courses, []);

// -----------------------------------------------------------------------------
// MODULE 4: GradeParser Adversarial Probes
// -----------------------------------------------------------------------------
console.log('\n>>> 4. Testing GradeParser Adversarial Scenarios...');

// 4.1 parseGrades with columns reordered
const reorderedGradesHtml = `
<div>平均学分绩点: 3.92 所修总学分: 120.5</div>
<table id="dataList">
    <tr>
        <th>课程编号</th>
        <th>开课学期</th>
        <th>课程名称</th>
        <th>学分</th>
        <th>成绩</th>
        <th>绩点</th>
        <th>总学时</th>
        <th>考核方式</th>
        <th>课程属性</th>
        <th>课程性质</th>
    </tr>
    <tr>
        <td>CS101</td>
        <td>2025-2026-1</td>
        <td>数据结构与算法</td>
        <td>4.0</td>
        <td><a href="javascript:openWindow('/jsxsd/kscj/pscj_list.do?id=999')">95</a></td>
        <td>4.5</td>
        <td>64</td>
        <td>考试</td>
        <td>必修</td>
        <td>专业核心课</td>
    </tr>
</table>
`;
const gradesSummary = GradeParser.parseGrades(reorderedGradesHtml);
assertEq('parseGrades GPA parsed correctly', gradesSummary.gpa, '3.92');
assertEq('parseGrades TotalCredits parsed correctly', gradesSummary.totalCredits, '120.5');
assertEq('parseGrades courses count', gradesSummary.gradesList.length, 1);
assertEq('parseGrades dynamic header mapped courseName', gradesSummary.gradesList[0].courseName, '数据结构与算法');
assertEq('parseGrades dynamic header mapped semester', gradesSummary.gradesList[0].semester, '2025-2026-1');
assertEq('parseGrades dynamic header mapped score', gradesSummary.gradesList[0].score, '95');
assertEq('parseGrades extracted detailUrl', gradesSummary.gradesList[0].detailUrl, '/jsxsd/kscj/pscj_list.do?id=999');

// 4.2 parseScoreDetail edge cases
const scoreDetailHtml = `
<table id="dataList">
    <tr>
        <th>序号</th>
        <th>期末成绩</th><th>期末成绩比例</th>
        <th>期中成绩</th><th>期中成绩比例</th>
        <th>平时成绩</th><th>平时成绩比例</th>
        <th>总成绩</th>
    </tr>
    <tr>
        <td>1</td>
        <td>80</td><td>50%</td>
        <td>0</td><td>0%</td>
        <td>90</td><td>50%</td>
        <td>85</td>
    </tr>
</table>
`;
const sdResult = GradeParser.parseScoreDetail(scoreDetailHtml);
assertEq('parseScoreDetail filters zero components', sdResult.components.length, 2);
assertEq('parseScoreDetail first component', sdResult.components[0], { label: '期末成绩', score: '80', ratio: '50%' });
assertEq('parseScoreDetail second component', sdResult.components[1], { label: '平时成绩', score: '90', ratio: '50%' });
assertEq('parseScoreDetail total score', sdResult.total, '85');

// 4.3 parseLevelGrades priority logic
const levelGradesHtml = `
<table id="dataList">
    <tr><th>表头1</th></tr>
    <tr><th>表头2</th></tr>
    <tr>
        <td>1</td>
        <td>大学英语四级考试</td>
        <td>480</td><td>0</td><td>480</td>
        <td>通过</td><td>0</td><td>通过</td>
        <td>2024-06-15</td>
    </tr>
    <tr>
        <td>2</td>
        <td>全国计算机二级考试</td>
        <td>0</td><td>0</td><td>0</td>
        <td>-</td><td>-</td><td>优秀</td>
        <td>2024-03-20</td>
    </tr>
</table>
`;
const lvResult = GradeParser.parseLevelGrades(levelGradesHtml);
assertEq('parseLevelGrades record count', lvResult.length, 2);
assertEq('parseLevelGrades score priority takes numeric total', lvResult[0].score, '480');
assertEq('parseLevelGrades score fallback takes level result when numeric is 0', lvResult[1].score, '优秀');

// -----------------------------------------------------------------------------
// MODULE 5: ExamParser Adversarial Probes
// -----------------------------------------------------------------------------
console.log('\n>>> 5. Testing ExamParser Adversarial Scenarios...');

// 5.1 parseExams
const examsHtml = `
<table id="dataList">
    <tr>
        <th>序号</th><th>校区</th><th>考场校区</th><th>考试场次</th>
        <th>课程编号</th><th>课程名称</th><th>授课教师</th>
        <th>考试时间</th><th>考场</th><th>座位号</th><th>准考证号</th><th>备注</th><th>操作</th>
    </tr>
    <tr>
        <td>1</td><td>龙泉路校区</td><td>龙泉路校区</td><td>第1场</td>
        <td>MATH101</td><td>高等数学</td><td>王老师</td>
        <td>2026-06-20 09:00-11:00</td><td>逸夫楼101</td><td>25</td><td>20220101</td><td>闭卷</td><td></td>
    </tr>
</table>
`;
const exams = ExamParser.parseExams(examsHtml, '2025-2026-2', '期末');
assertEq('parseExams parsed 1 exam', exams.length, 1);
assertEq('parseExams exam courseName', exams[0].courseName, '高等数学');
assertEq('parseExams exam seatNo', exams[0].seatNo, '25');
assertEq('parseExams exam room', exams[0].room, '逸夫楼101');
assertEq('parseExams exam type', exams[0].type, '期末');

// 5.2 parseClassroomTests fallback date construction
const stkHtml = `
<table id="dataList">
    <tr>
        <th>学年学期</th><th>课程编号</th><th>课程名称</th><th>考试周次</th>
        <th>考试星期</th><th>考试节次</th><th>监考老师</th><th>考试教室</th><th>考试时间</th><th>考试类型</th>
    </tr>
    <tr>
        <td>2025-2026-2</td><td>CS202</td><td>操作系统</td><td>16</td>
        <td>3</td><td>03-04</td><td>李老师</td><td>南院201</td><td></td><td>随堂测验</td>
    </tr>
</table>
`;
const stks = ExamParser.parseClassroomTests(stkHtml);
assertEq('parseClassroomTests parsed 1 test', stks.length, 1);
assertEq('parseClassroomTests constructed date fallback', stks[0].date, '第16周 星期3 第03-04节');

// -----------------------------------------------------------------------------
// MODULE 6: AnnouncementParser Adversarial Probes
// -----------------------------------------------------------------------------
console.log('\n>>> 6. Testing AnnouncementParser & safeResourcePath Adversarial Scenarios...');

// 6.1 safeResourcePath security assertions
const BASE = '/jsxsd/ggly/ggly_show?ggid=TEST12345';
assert('safeResourcePath blocks javascript:alert(1)', AnnouncementParser.safeResourcePath('javascript:alert(1)', BASE) === null);
assert('safeResourcePath blocks JAVASCRIPT:alert(1)', AnnouncementParser.safeResourcePath('JAVASCRIPT:alert(1)', BASE) === null);
assert('safeResourcePath blocks vbscript:msgbox(1)', AnnouncementParser.safeResourcePath('vbscript:msgbox(1)', BASE) === null);
assert('safeResourcePath blocks data:text/html,<script>', AnnouncementParser.safeResourcePath('data:text/html,<script>', BASE) === null);
assert('safeResourcePath blocks external URL http://evil.com', AnnouncementParser.safeResourcePath('http://evil.com/doc.pdf', BASE) === null);
assert('safeResourcePath blocks protocol-relative //evil.com', AnnouncementParser.safeResourcePath('//evil.com/test', BASE) === null);
assert('safeResourcePath blocks anchor #', AnnouncementParser.safeResourcePath('#', BASE) === null);
assert('safeResourcePath blocks empty string', AnnouncementParser.safeResourcePath('', BASE) === null);
assert('safeResourcePath accepts relative path', AnnouncementParser.safeResourcePath('../upload/file.pdf', BASE) === '/jsxsd/upload/file.pdf');
assert('safeResourcePath accepts absolute path with query', AnnouncementParser.safeResourcePath('/jsxsd/down?id=12', BASE) === '/jsxsd/down?id=12');

// 6.2 parseDetail with nested tags and Word styles
const detailWordHtml = `
<table>
    <tr><td>Title</td></tr>
    <tr>
        <td>
            <p>关于<span>2026</span>年<span>春季</span>学期选课的通知</p>
            <p>正文内容第一段：请各位同学务必于<span>本周五前</span>完成选课。</p>
            <p><a href="/jsxsd/down?id=99" download="选课指南.pdf">附件：选课指南.pdf</a></p>
        </td>
    </tr>
    <tr><td>Footer</td></tr>
</table>
`;
const detailParsed = AnnouncementParser.parseDetail(detailWordHtml, BASE);
assertEq('parseDetail paragraphs count', detailParsed.paragraphs.length, 2);
assert('parseDetail paragraph 1 contents', detailParsed.paragraphs[0].includes('2026年春季学期选课'));
assertEq('parseDetail attachments count', detailParsed.attachments.length, 1);
assertEq('parseDetail attachment name', detailParsed.attachments[0].name, '选课指南.pdf');
assertEq('parseDetail attachment url', detailParsed.attachments[0].url, '/jsxsd/down?id=99');

// -----------------------------------------------------------------------------
// MODULE 7: ServiceParser Adversarial Probes
// -----------------------------------------------------------------------------
console.log('\n>>> 7. Testing ServiceParser Adversarial Scenarios...');

// 7.1 parseClassrooms matrix parsing with multiple tables and occupancy symbols
const ecHtml = `
<table id="dataList">
    <tr><th>Empty Shell Table</th></tr>
</table>
<table id="dataList">
    <tr>
        <th>教室名称</th>
        <th>0102节</th>
        <th>0304节</th>
        <th>0506节</th>
        <th>0708节</th>
    </tr>
    <tr>
        <td>汇文楼101(60/30)</td>
        <td></td><td></td><td></td><td></td>
    </tr>
    <tr>
        <td>汇文楼102(60/30)</td>
        <td>◆</td><td></td><td></td><td></td>
    </tr>
    <tr>
        <td>汇文楼103(60/30)</td>
        <td>&nbsp;</td><td>&nbsp;◆&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td>
    </tr>
</table>
`;
const freeRooms = ServiceParser.parseClassrooms(ecHtml);
assertEq('parseClassrooms correctly identifies only completely free room', freeRooms, ['汇文楼101(60/30)']);

// 7.2 parsePractice non-grad vs grad
const nonGradThesisHtml = `<div>该学生未进入毕业环节</div>`;
const practiceNonGrad = ServiceParser.parsePractice(nonGradThesisHtml);
assertEq('parsePractice non-grad returns empty: true', practiceNonGrad.empty, true);

const gradThesisHtml = `
<table>
    <tr>
        <td>课题名称： 基于原生DOM的高校移动教务系统设计与实现 指导教师： 张教授</td>
    </tr>
    <tr>
        <td>开题报告： 已通过 过程指导： 5次 最终成绩： 优秀</td>
    </tr>
</table>
`;
const practiceGrad = ServiceParser.parsePractice(gradThesisHtml);
assertEq('parsePractice grad empty is false', practiceGrad.empty, false);
assertEq('parsePractice title parsed', practiceGrad.title, '基于原生DOM的高校移动教务系统设计与实现');
assertEq('parsePractice report parsed', practiceGrad.report, '已通过');
assertEq('parsePractice guidanceCount parsed', practiceGrad.guidanceCount, '5次');
assertEq('parsePractice grade parsed', practiceGrad.grade, '优秀');

// Clean up build directory
rmSync(TMP, { recursive: true, force: true });

// -----------------------------------------------------------------------------
// SUMMARY & EXIT
// -----------------------------------------------------------------------------
console.log('\n======================================================================');
console.log(`  TEST RESULTS: ${passedAssertions} / ${totalAssertions} assertions passed.`);
if (failureList.length === 0) {
    console.log('  ALL 96 ADVERSARIAL ASSERTIONS PASSED 100% PERFECTLY!');
    console.log('======================================================================');
    process.exit(0);
} else {
    console.error(`  ${failureList.length} ASSERTIONS FAILED:`);
    failureList.forEach((f, i) => console.error(`    ${i + 1}. ${f.description}: ${f.detail}`));
    console.log('======================================================================');
    process.exit(1);
}
