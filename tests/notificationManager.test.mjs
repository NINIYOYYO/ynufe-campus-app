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

// 2. NOTIFY-01: 深度穿透验证 cancelTimetableReminders 与 cancelAll 插件调用
{
    class MockLocalNotificationsPlugin {
        constructor() {
            this.pending = [];
            this.cancelled = [];
            this.scheduled = [];
            this.permissionsGranted = true;
        }

        async requestPermissions() {
            return { display: this.permissionsGranted ? 'granted' : 'denied' };
        }

        async getPending() {
            return { notifications: [...this.pending] };
        }

        async cancel(options) {
            this.cancelled.push(...options.notifications);
            const toCancelIds = new Set(options.notifications.map(n => n.id));
            this.pending = this.pending.filter(n => !toCancelIds.has(n.id));
        }

        async schedule(options) {
            this.scheduled.push(...options.notifications);
            this.pending.push(...options.notifications.map(n => ({ id: n.id, schedule: n.schedule })));
            return {};
        }
    }

    const mockPlugin = new MockLocalNotificationsPlugin();
    NotificationManager.setPluginForTest(mockPlugin);

    // 初始状态包含课表提醒、考试提醒及成绩通知
    mockPlugin.pending = [
        { id: 60001, title: "课表提醒1" },
        { id: 60002, title: "课表提醒2" },
        { id: 61999, title: "课表提醒边界" },
        { id: 62000, title: "期末考试提醒1 (EXAM_ID_BASE)" },
        { id: 62001, title: "期末考试提醒2" },
        { id: 63500, title: "成绩变动提醒" }
    ];

    // 2.1 真实调用 cancelTimetableReminders()
    await NotificationManager.cancelTimetableReminders();

    // 断言：cancel 接收到的通知 ID 严格仅限于 [60000, 62000)
    assert.strictEqual(mockPlugin.cancelled.length, 3, "应该恰好取消 3 条课表提醒");
    assert.deepStrictEqual(mockPlugin.cancelled.map(n => n.id), [60001, 60002, 61999]);

    // 断言：pending 队列中，考试提醒 (62000, 62001) 与成绩提醒 (63500) 完好无损保留
    assert.strictEqual(mockPlugin.pending.length, 3, "pending 队列中考试与成绩提醒必须保留");
    assert.deepStrictEqual(mockPlugin.pending.map(n => n.id), [62000, 62001, 63500]);

    // 2.2 真实调用 cancelAll()
    mockPlugin.cancelled = [];
    await NotificationManager.cancelAll();

    assert.strictEqual(mockPlugin.cancelled.length, 3, "cancelAll 应取消剩余的 62000-70000 提醒");
    assert.deepStrictEqual(mockPlugin.cancelled.map(n => n.id), [62000, 62001, 63500]);
    assert.strictEqual(mockPlugin.pending.length, 0, "cancelAll 执行后 pending 队列应彻底清空");

    // 2.3 异常边界测试：getPending 返回空或 null 结构时健壮性测试
    mockPlugin.pending = [
        { id: undefined },
        { id: "invalid-id" },
        { id: 60005, title: "有效ID" }
    ];
    mockPlugin.cancelled = [];
    await NotificationManager.cancelTimetableReminders();
    assert.strictEqual(mockPlugin.cancelled.length, 1, "异常/非法ID应被安全过滤，仅取消有效 60005");
    assert.strictEqual(mockPlugin.cancelled[0].id, 60005);

    // 2.4 测试 rescheduleExamReminders 独立 ID 分区
    localStorage.setItem("ynufe_notify_enabled", "true");
    mockPlugin.pending = [{ id: 62000, title: "旧考试提醒" }];
    mockPlugin.cancelled = [];
    mockPlugin.scheduled = [];

    const examCount = await NotificationManager.rescheduleExamReminders([
        {
            courseName: "离散数学",
            time: "2026-06-20 09:00-11:00",
            location: "博学楼201",
            seat: "15"
        }
    ]);
    assert.strictEqual(mockPlugin.cancelled.length, 1, "排程考试应清除旧考试提醒");
    assert.strictEqual(mockPlugin.cancelled[0].id, 62000);

    // 重置测试注入
    NotificationManager.setPluginForTest(null);

    console.log(" [PASS] 用例 2 通过: NOTIFY-01 课表与考试提醒分区取消逻辑深层穿透测试成功");
}

rmSync(OUT_FILE, { force: true });

console.log("==========================================");
console.log("  NotificationManager 全部测试用例实测通过！");
console.log("==========================================");
