import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_FILE = join(HERE, '.reminder_scheduler_bundle.mjs');

// 使用 esbuild 编译真实的 TypeScript 生产模块
await build({
    entryPoints: [join(ROOT, 'src', 'services', 'reminderScheduler.ts')],
    outfile: OUT_FILE,
    format: 'esm',
    bundle: true,
    platform: 'node',
});

const { ReminderScheduler } = await import(pathToFileURL(OUT_FILE).href);

console.log('=== 开始运行 ReminderScheduler 算法测试 (真实生产模块) ===');

try {
    // 1. 测试跨周计算
    const refDate = new Date(2026, 8, 16, 10, 0, 0); // 2026-09-16 (周三)
    const week1Monday = ReminderScheduler.computeWeek1Monday(refDate, 3);
    assert.strictEqual(week1Monday.getFullYear(), 2026);
    assert.strictEqual(week1Monday.getMonth(), 7); // 8月 (0-indexed 7)
    assert.strictEqual(week1Monday.getDate(), 31); // 2026-08-31 是第 1 周周一
    console.log('[PASS] 用例 1: 第 1 周周一推算准确');

    // 2. 测试考试时间解析
    const examDt1 = ReminderScheduler.parseExamStart('2026-07-30 09:00-11:00');
    assert.ok(examDt1 instanceof Date);
    assert.strictEqual(examDt1.getFullYear(), 2026);
    assert.strictEqual(examDt1.getMonth(), 6); // 7月 (0-indexed 6)
    assert.strictEqual(examDt1.getDate(), 30);
    assert.strictEqual(examDt1.getHours(), 9);
    assert.strictEqual(examDt1.getMinutes(), 0);
    console.log('[PASS] 用例 2: 考试时间文本准确解析为 Date 实例');

    // 3. 测试上课提醒去重与未来 14 天排程
    const mockTimetable = {
        currentWeek: 3,
        courses: [
            {
                name: '高等数学',
                room: '汇文201',
                teacher: '张老师',
                day: 3, // 周三
                slot: 1, // 第 1 节 (session 1: 08:00)
                session: 1,
                activeWeeks: [3, 4, 5],
            },
            // 重复的小节（同一大节第二小节）
            {
                name: '高等数学',
                room: '汇文201',
                teacher: '张老师',
                day: 3, // 周三
                slot: 2,
                session: 1,
                activeWeeks: [3, 4, 5],
            }
        ]
    };

    const reminders = ReminderScheduler.computeTimetableReminders(mockTimetable, {
        now: new Date(2026, 8, 14, 8, 0, 0), // 2026-09-14 (第 3 周周一早晨)
        leadMinutes: 15,
        daysAhead: 14,
    });

    assert.strictEqual(reminders.length, 2, '未来 14 天内应恰好排程第 3 周周三与第 4 周周三两次课程，且同大节第二小节已被成功去重');
    assert.ok(reminders[0].title.includes('高等数学'));
    assert.strictEqual(reminders[0].classAt.getHours(), 8);
    assert.strictEqual(reminders[0].fireAt.getHours(), 7);
    assert.strictEqual(reminders[0].fireAt.getMinutes(), 45);
    console.log('[PASS] 用例 3: 跨周上课提醒排程与去重逻辑全部准确');

    // 4. 测试考试提醒计算（考前前一天 21:00 与考前 1 小时）
    const mockExams = [
        {
            courseName: '概率论与数理统计',
            date: '2026-09-20 14:30-16:30',
            location: '汇文302',
            seatNo: '18'
        }
    ];

    const examNotices = ReminderScheduler.computeExamReminders(mockExams, {
        now: new Date(2026, 8, 14, 8, 0, 0),
    });
    assert.strictEqual(examNotices.length, 2);
    assert.ok(examNotices[0].title.includes('明天考试'));
    assert.ok(examNotices[1].title.includes('1 小时后考试'));
    console.log('[PASS] 用例 4: 考前前夕与考前 1 小时双重考试提醒计算准确');

    // 5. 测试第 11-14 节（第 6-7 大节）晚间课程提醒计算
    const eveningCourses = {
        currentWeek: 3,
        courses: [
            {
                name: '移动应用实训A',
                day: 1,
                slot: 11,
                session: 6,
                activeWeeks: [3],
                room: '实训中心101',
                teacher: '王老师'
            },
            {
                name: '移动应用实训B',
                day: 1,
                slot: 13,
                session: 7,
                activeWeeks: [3],
                room: '实训中心102',
                teacher: '赵老师'
            }
        ]
    };

    const eveningReminders = ReminderScheduler.computeTimetableReminders(eveningCourses, {
        now: new Date(2026, 8, 14, 8, 0, 0),
        leadMinutes: 15,
        daysAhead: 7,
    });
    assert.strictEqual(eveningReminders.length, 2, '第 11-14 节晚课应成功计算出排程提醒');
    assert.strictEqual(eveningReminders[0].classAt.getHours(), 20);
    assert.strictEqual(eveningReminders[0].classAt.getMinutes(), 50);
    assert.strictEqual(eveningReminders[1].classAt.getHours(), 22);
    assert.strictEqual(eveningReminders[1].classAt.getMinutes(), 30);
    console.log('[PASS] 用例 5: 第 11-14 节 (6-7大节) 晚间课程排程时间准确无误');

    // 6. 测试仅凭 week1MondayIso 排程（契约冲突修复验证，无需 currentWeek）
    const isoTimetable = {
        week1MondayIso: "2026-08-31T00:00:00.000Z",
        courses: [
            {
                name: '现代金融学',
                day: 3,
                slot: 1,
                session: 1,
                activeWeeks: [3],
                room: '汇新501',
                teacher: '钱老师'
            }
        ]
    };
    const isoReminders = ReminderScheduler.computeTimetableReminders(isoTimetable, {
        now: new Date(2026, 8, 14, 8, 0, 0),
        leadMinutes: 15,
        daysAhead: 7,
    });
    assert.strictEqual(isoReminders.length, 1, '在未提供 currentWeek 仅提供 week1MondayIso 时必须成功排程');
    assert.strictEqual(isoReminders[0].course.name, '现代金融学');
    console.log('[PASS] 用例 6: week1MondayIso 独立排程契约测试通过');

    // 7. 测试全周课程提醒计算 (1-25 周全覆盖)
    const fullTermCourse = {
        currentWeek: 3,
        courses: [
            {
                name: '形势与政策',
                day: 2,
                slot: 3,
                session: 2,
                activeWeeks: Array.from({ length: 25 }, (_, i) => i + 1),
                room: '汇文大礼堂',
                teacher: '刘老师'
            }
        ]
    };
    const fullTermReminders = ReminderScheduler.computeTimetableReminders(fullTermCourse, {
        now: new Date(2026, 8, 14, 8, 0, 0),
        leadMinutes: 15,
        daysAhead: 14,
    });
    assert.strictEqual(fullTermReminders.length, 2, '全周课程未来 14 天内应正常排程第 3 周与第 4 周两次');
    console.log('[PASS] 用例 7: 全周课程提醒正常生成排程');

    // 8. 测试非法/越界教学周防御性熔断
    const invalidWeekCourse = {
        currentWeek: -1,
        courses: [
            {
                name: '形势与政策',
                day: 2,
                slot: 3,
                session: 2,
                activeWeeks: [1, 2, 3],
                room: '汇文大礼堂',
                teacher: '刘老师'
            }
        ]
    };
    const invalidReminders = ReminderScheduler.computeTimetableReminders(invalidWeekCourse, {
        now: new Date(2026, 8, 14, 8, 0, 0),
        leadMinutes: 15,
    });
    assert.strictEqual(invalidReminders.length, 0, '非法负数周次应安全熔断返回空列表');
    console.log('[PASS] 用例 8: 非法教学周次防御性拦截测试通过');

    // 9. 测试考试提醒时间升序严格排列与 idOffset 连续性
    const multipleExams = [
        { courseName: '后期考试B', date: '2026-10-15 14:00-16:00', room: '二教101' },
        { courseName: '早期考试A', date: '2026-09-20 09:00-11:00', room: '一教201' },
    ];
    const examReminders = ReminderScheduler.computeExamReminders(multipleExams, {
        now: new Date(2026, 8, 15, 8, 0, 0),
    });
    assert.ok(examReminders.length >= 2, '应成功生成至少两场考试的提醒');
    for (let i = 0; i < examReminders.length - 1; i++) {
        assert.ok(examReminders[i].fireAt.getTime() <= examReminders[i + 1].fireAt.getTime(), '考试提醒必须按触发时间严格升序排列');
        assert.strictEqual(examReminders[i].idOffset, i, 'idOffset 必须按升序重编号');
    }
    console.log('[PASS] 用例 9: 考试提醒严格升序排列与 idOffset 连续性测试通过');

    console.log('==========================================');
    console.log('  ReminderScheduler 全部测试用例实测通过！');
    console.log('==========================================');
} finally {
    try { rmSync(OUT_FILE); } catch {}
}
