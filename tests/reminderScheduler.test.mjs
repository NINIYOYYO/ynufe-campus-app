import assert from 'node:assert';

const AppConfig = {
    SESSION_TIMES: [
        { label: "08:00-09:30", start: "08:00", end: "09:30" },
        { label: "10:00-11:30", start: "10:00", end: "11:30" },
        { label: "14:30-16:00", start: "14:30", end: "16:00" },
        { label: "16:30-18:00", start: "16:30", end: "18:00" },
        { label: "19:00-20:30", start: "19:00", end: "20:30" },
    ]
};

class ReminderScheduler {
    static computeWeek1Monday(now, currentTeachingWeek) {
        const jsDay = now.getDay() === 0 ? 7 : now.getDay();
        const thisMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (jsDay - 1), 0, 0, 0, 0);
        return new Date(thisMonday.getTime() - (currentTeachingWeek - 1) * 7 * 86400000);
    }

    static computeTimetableReminders(data, options) {
        if (!data || !Array.isArray(data.courses) || data.courses.length === 0 || !data.currentWeek) {
            return [];
        }

        const now = options.now || new Date();
        const leadMin = options.leadMinutes;
        const daysAhead = options.daysAhead ?? 14;
        const maxScheduled = options.maxScheduled ?? 60;

        const week1Monday = this.computeWeek1Monday(now, data.currentWeek);
        const planned = [];
        const plannedKeys = new Set();

        for (const c of data.courses) {
            if (!Array.isArray(c.activeWeeks) || c.activeWeeks.length === 0) continue;
            const session = c.session || Math.ceil(c.slot / 2);
            const timeCfg = AppConfig.SESSION_TIMES[session - 1];
            if (!timeCfg) continue;
            const [hh, mm] = timeCfg.start.split(":").map(Number);

            for (const wk of c.activeWeeks) {
                const classDate = new Date(week1Monday.getTime() + ((wk - 1) * 7 + (c.day - 1)) * 86400000);
                classDate.setHours(hh, mm, 0, 0);

                const key = `${classDate.getTime()}|${c.name}|${c.room}`;
                if (plannedKeys.has(key)) continue;

                const fireAt = new Date(classDate.getTime() - leadMin * 60000);
                const daysFromNow = (classDate.getTime() - now.getTime()) / 86400000;
                if (fireAt.getTime() > now.getTime() && daysFromNow <= daysAhead) {
                    plannedKeys.add(key);
                    planned.push({
                        fireAt,
                        classAt: classDate,
                        course: c,
                        sessionLabel: timeCfg.label,
                        title: `${leadMin} 分钟后上课：${c.name}`,
                        body: `${timeCfg.label} · ${c.room} · ${c.teacher}`,
                    });
                }
            }
        }

        planned.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime());
        return planned.slice(0, maxScheduled);
    }

    static parseExamStart(text) {
        if (!text) return null;
        const m = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})(?:[^\d]+(\d{1,2}):(\d{2}))?/);
        if (!m) return null;
        const y = parseInt(m[1], 10);
        const mo = parseInt(m[2], 10) - 1;
        const d = parseInt(m[3], 10);
        const hh = m[4] ? parseInt(m[4], 10) : 8;
        const mm = m[5] ? parseInt(m[5], 10) : 0;
        const dt = new Date(y, mo, d, hh, mm, 0, 0);
        return isNaN(dt.getTime()) ? null : dt;
    }

    static computeExamReminders(exams, options) {
        if (!Array.isArray(exams) || exams.length === 0) return [];
        const now = options?.now || new Date();
        const maxScheduled = options?.maxScheduled ?? 40;
        const notices = [];
        let idx = 0;

        for (const ex of exams) {
            const start = this.parseExamStart(ex.date || ex.time || "");
            if (!start || start.getTime() <= now.getTime()) continue;
            const name = ex.name || ex.courseName || "考试";
            const room = ex.room || ex.location || "待定";
            const seat = ex.seatNo || ex.seat || "";
            const timeStr = `${start.getMonth() + 1}月${start.getDate()}日 ${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`;
            const body = `考场 ${room}${seat ? " · 座位 " + seat : ""} · ${timeStr}`;

            const eveBefore = new Date(start.getFullYear(), start.getMonth(), start.getDate() - 1, 21, 0, 0);
            if (eveBefore.getTime() > now.getTime() && idx < maxScheduled) {
                notices.push({
                    idOffset: idx++,
                    title: `明天考试：${name}`,
                    body,
                    fireAt: eveBefore,
                });
            }

            const hourBefore = new Date(start.getTime() - 60 * 60000);
            if (hourBefore.getTime() > now.getTime() && idx < maxScheduled) {
                notices.push({
                    idOffset: idx++,
                    title: `1 小时后考试：${name}`,
                    body,
                    fireAt: hourBefore,
                });
            }
        }
        return notices;
    }
}

console.log('=== 开始运行 ReminderScheduler 算法测试 ===');

// 1. 测试跨周计算
const refDate = new Date(2026, 8, 16, 10, 0, 0); // 2026-09-16 (周三)
const week1Monday = ReminderScheduler.computeWeek1Monday(refDate, 3);
assert.strictEqual(week1Monday.getFullYear(), 2026);
assert.strictEqual(week1Monday.getMonth(), 7); // 8月 (0-indexed 7)
assert.strictEqual(week1Monday.getDate(), 31); // 2026-08-31 是第 1 周周一
console.log('✓ 用例 1 通过: 第 1 周周一推算准确');

// 2. 测试考试时间解析
const examDt1 = ReminderScheduler.parseExamStart('2026-07-30 09:00-11:00');
assert.ok(examDt1 instanceof Date);
assert.strictEqual(examDt1.getFullYear(), 2026);
assert.strictEqual(examDt1.getMonth(), 6); // 7月 (0-indexed 6)
assert.strictEqual(examDt1.getDate(), 30);
assert.strictEqual(examDt1.getHours(), 9);
assert.strictEqual(examDt1.getMinutes(), 0);
console.log('✓ 用例 2 通过: 考试时间文本准确解析为 Date 实例');

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
console.log('✓ 用例 3 通过: 跨周上课提醒排程与去重逻辑全部准确');

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
console.log('✓ 用例 4 通过: 考前前夕与考前 1 小时双重考试提醒计算准确');

console.log('==========================================');
console.log('  ReminderScheduler 全部测试用例实测通过！');
console.log('==========================================');
