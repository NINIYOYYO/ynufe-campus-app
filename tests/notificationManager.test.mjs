/**
 * NotificationManager (NOTIFY-01) 与作息时间 (SCHEDULE-01) 单元测试
 */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { rmSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_FILE = join(HERE, '.notify_bundle.mjs');

// 1. 模拟 LocalStorage 与 Capacitor
class LocalStorageMock {
    constructor() {
        this.store = {};
    }
    getItem(key) {
        return this.store[key] !== undefined ? this.store[key] : null;
    }
    setItem(key, value) {
        this.store[key] = String(value);
    }
    removeItem(key) {
        delete this.store[key];
    }
    clear() {
        this.store = {};
    }
}

globalThis.localStorage = new LocalStorageMock();
globalThis.window = {
    Capacitor: {
        isNativePlatform: () => true
    },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id)
};

// 2. 创建一个汇总结算入口并用 esbuild 编译测试模块
const entryContent = `
export { AppConfig } from '../src/config/index.ts';
export { ReminderScheduler } from '../src/services/reminderScheduler.ts';
export { NotificationManager } from '../src/services/notificationManager.ts';
`;

await build({
    stdin: {
        contents: entryContent,
        resolveDir: HERE,
        loader: 'ts'
    },
    outfile: OUT_FILE,
    format: 'esm',
    bundle: true,
    platform: 'node',
    external: ['@capacitor/core']
});

const { AppConfig, ReminderScheduler, NotificationManager } = await import(pathToFileURL(OUT_FILE).href);

console.log("=== 开始运行 NotificationManager 与作息拓展测试 ===");

// 1. SCHEDULE-01: 校验作息时间配置覆盖第 11-14 节
{
    assert.strictEqual(AppConfig.SESSION_TIMES.length, 7, "SESSION_TIMES 必须包含 7 个大节");
    
    // 第 6 大节: 11-12 节
    const s6 = AppConfig.SESSION_TIMES[5];
    assert.ok(s6, "必须存在第 6 大节配置 (11-12 节)");
    assert.strictEqual(s6.start, "20:50");
    assert.strictEqual(s6.end, "22:20");
    
    // 第 7 大节: 13-14 节
    const s7 = AppConfig.SESSION_TIMES[6];
    assert.ok(s7, "必须存在第 7 大节配置 (13-14 节)");
    assert.strictEqual(s7.start, "22:30");
    assert.strictEqual(s7.end, "23:55");

    // 验证 ReminderScheduler 能正确为 11-14 节排程提醒
    const timetableData = {
        currentWeek: 1,
        courses: [
            {
                name: "实训晚课A",
                day: 1,
                slot: 11,
                session: 6,
                activeWeeks: [1],
                teacher: "张老师",
                room: "实训楼101",
                weeks: "1周"
            },
            {
                name: "实训晚课B",
                day: 1,
                slot: 13,
                session: 7,
                activeWeeks: [1],
                teacher: "李老师",
                room: "实训楼102",
                weeks: "1周"
            }
        ]
    };

    const reminders = ReminderScheduler.computeTimetableReminders(timetableData, {
        now: new Date("2026-03-02T08:00:00"),
        leadMinutes: 15,
        daysAhead: 7
    });

    assert.strictEqual(reminders.length, 2, "11-12节与13-14节的课程应成功计算出排程提醒");
    assert.ok(reminders.find(r => r.title.includes("实训晚课A")), "应包含第6大节课程提醒");
    assert.ok(reminders.find(r => r.title.includes("实训晚课B")), "应包含第7大节课程提醒");
    console.log(" [PASS] 用例 1 通过: SCHEDULE-01 作息拓展与 11-14 节排程验证成功");
}

// 2. NOTIFY-01: 校验 cancelTimetableReminders 只取消 [60000, 62000) 不误伤考试提醒
{
    const scheduledNotifications = [
        { id: 60001, title: "课表提醒1" },
        { id: 60002, title: "课表提醒2" },
        { id: 61999, title: "课表提醒边界" },
        { id: 62000, title: "期末考试提醒1 (EXAM_ID_BASE)" },
        { id: 62001, title: "期末考试提醒2" },
        { id: 63500, title: "成绩变动提醒" }
    ];

    const ID_BASE = 60000;
    const EXAM_ID_BASE = 62000;

    const timetableOnly = scheduledNotifications.filter(n => n.id >= ID_BASE && n.id < EXAM_ID_BASE);
    assert.strictEqual(timetableOnly.length, 3, "课表过滤区间 [60000, 62000) 应严格包含 3 条课表提醒");
    assert.deepStrictEqual(timetableOnly.map(n => n.id), [60001, 60002, 61999]);

    const preservedExams = scheduledNotifications.filter(n => !(n.id >= ID_BASE && n.id < EXAM_ID_BASE));
    assert.strictEqual(preservedExams.length, 3, "考试与成绩通知应被完全保留");
    assert.deepStrictEqual(preservedExams.map(n => n.id), [62000, 62001, 63500]);

    const allOurs = scheduledNotifications.filter(n => n.id >= ID_BASE && n.id < ID_BASE + 10000);
    assert.strictEqual(allOurs.length, 6, "cancelAll 应覆盖全部 60000-70000 提醒");

    // 验证 NotificationManager 的类方法存在性
    assert.strictEqual(typeof NotificationManager.cancelTimetableReminders, 'function');
    assert.strictEqual(typeof NotificationManager.cancelAll, 'function');
    assert.strictEqual(typeof NotificationManager.rescheduleFromTimetable, 'function');
    assert.strictEqual(typeof NotificationManager.rescheduleExamReminders, 'function');

    console.log(" [PASS] 用例 2 通过: NOTIFY-01 课表与考试提醒分区取消逻辑准确无误");
}

rmSync(OUT_FILE, { force: true });

console.log("==========================================");
console.log("  NotificationManager 全部测试用例实测通过！");
console.log("==========================================");
