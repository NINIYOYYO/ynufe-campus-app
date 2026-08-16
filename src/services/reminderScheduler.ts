import { AppConfig } from '../config';
import { CourseItem, TimetableData } from '../types/timetable';
import { ExamItem } from '../types/exam';

export interface PlannedNotice {
    fireAt: Date;
    classAt: Date;
    course: CourseItem;
    sessionLabel: string;
    title: string;
    body: string;
}

export interface PlannedExamNotice {
    idOffset: number;
    title: string;
    body: string;
    fireAt: Date;
}

/**
 * ReminderScheduler: 上课与考试提醒排程纯算法计算引擎
 * 职责：纯粹基于当前教学周与时间推算未来上课/考试时间戳，不依赖任何 DOM 或 Native 插件。
 */
export class ReminderScheduler {
    /**
     * 根据当前时间与当前教学周推算第 1 教学周周一的零点 Date。
     *
     * Args:
     *     now (Date): 当前参考时间。
     *     currentTeachingWeek (number): 当前教学周次（1-30）。
     *
     * Returns:
     *     Date: 第 1 教学周周一的零点时间。
     */
    static computeWeek1Monday(now: Date, currentTeachingWeek: number): Date {
        const jsDay = now.getDay() === 0 ? 7 : now.getDay();
        const thisMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (jsDay - 1), 0, 0, 0, 0);
        return new Date(thisMonday.getTime() - (currentTeachingWeek - 1) * 7 * 86400000);
    }

    /**
     * 计算并排程未来 N 天内的全部上课提醒列表。
     *
     * Args:
     *     data (TimetableData): 课表数据（需包含 currentWeek 和 courses）。
     *     options (Object): 排程参数（now, leadMinutes, daysAhead, maxScheduled）。
     *
     * Returns:
     *     PlannedNotice[]: 按触发时间升序排列的上课提醒计划列表。
     */
    static computeTimetableReminders(
        data: TimetableData,
        options: { now?: Date; leadMinutes: number; daysAhead?: number; maxScheduled?: number }
    ): PlannedNotice[] {
        if (!data || !Array.isArray(data.courses) || data.courses.length === 0 || !data.currentWeek) {
            return [];
        }

        const now = options.now || new Date();
        const leadMin = options.leadMinutes;
        const daysAhead = options.daysAhead ?? 14;
        const maxScheduled = options.maxScheduled ?? 60;

        let week1Monday: Date;
        if (data.week1MondayIso) {
            week1Monday = new Date(data.week1MondayIso);
        } else {
            week1Monday = this.computeWeek1Monday(now, data.currentWeek);
        }
        const planned: PlannedNotice[] = [];
        const plannedKeys = new Set<string>();

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

    /**
     * 解析教务考试日期时间文本（如 "2026-07-30 09:00-11:00"）为开考 Date。
     *
     * Args:
     *     text (string): 考试时间文本。
     *
     * Returns:
     *     Date | null: 无法解析时返回 null。
     */
    static parseExamStart(text: string): Date | null {
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

    /**
     * 计算考试提醒（考前一天 21:00 + 考前 1 小时）。
     *
     * Args:
     *     exams (ExamItem[]): 考试项列表。
     *     options (Object): 可选 now 与 maxScheduled 参数。
     *
     * Returns:
     *     PlannedExamNotice[]: 计算好的考试提醒计划列表。
     */
    static computeExamReminders(
        exams: ExamItem[],
        options?: { now?: Date; maxScheduled?: number }
    ): PlannedExamNotice[] {
        if (!Array.isArray(exams) || exams.length === 0) return [];
        const now = options?.now || new Date();
        const maxScheduled = options?.maxScheduled ?? 40;
        const notices: PlannedExamNotice[] = [];
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
