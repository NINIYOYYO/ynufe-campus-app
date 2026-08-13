import { registerPlugin } from '@capacitor/core';
import { ReminderScheduler } from './reminderScheduler';
import { TimetableData } from '../types/timetable';

/* ---- @capacitor/local-notifications 的最小类型与运行时绑定 ----
 * 通过 registerPlugin 直接绑定原生插件（原生实现由 package.json 中的
 * @capacitor/local-notifications 依赖经 `npx cap sync` 装入 Android 工程），
 * JS 侧无需静态依赖插件包，Web 环境下相关调用会被 isNative 分支拦截。 */
interface LocalNotificationDescriptor { id: number; }
interface PendingNotificationSchedule { at?: string | Date; }
interface PendingLocalNotification { id: number; schedule?: PendingNotificationSchedule; }
interface ScheduleNotification {
    id: number;
    title: string;
    body: string;
    schedule: { at: Date; allowWhileIdle?: boolean };
    smallIcon?: string;
}
interface ScheduleOptions { notifications: ScheduleNotification[]; }
interface LocalNotificationsPlugin {
    requestPermissions(): Promise<{ display: string }>;
    schedule(options: ScheduleOptions): Promise<unknown>;
    getPending(): Promise<{ notifications: PendingLocalNotification[] }>;
    cancel(options: { notifications: LocalNotificationDescriptor[] }): Promise<void>;
}
const LocalNotifications = registerPlugin<LocalNotificationsPlugin>('LocalNotifications');

/**
 * NotificationManager: 上课提醒本地通知服务
 *
 * 职责：根据课表数据 + 教务系统的当前教学周，推算未来 14 天内每一节课的
 * 真实上课时间，并按用户设定的“提前 N 分钟”排程手机本地通知。
 * 原生 App 内使用 Capacitor LocalNotifications（App 被杀掉提醒依旧生效）；
 * 浏览器环境自动降级为 Web Notification。
 */
export class NotificationManager {
    private static KEY_ENABLED = "ynufe_notify_enabled";
    private static KEY_LEAD_MIN = "ynufe_notify_lead_min";

    /** 通知 ID 基数：上课提醒统一使用 60000+ 段位，方便整段取消重排 */
    private static ID_BASE = 60000;
    /** 考试提醒 ID 段位（与上课提醒分开，互不干扰） */
    private static EXAM_ID_BASE = 62000;
    /** 最多排程的未来天数 */
    private static DAYS_AHEAD = 14;
    /** 单次最多排程条数（Android 单应用 alarm 数量有限制，留足余量） */
    private static MAX_SCHEDULED = 60;

    private static get isNative(): boolean {
        const cap = (window as any).Capacitor;
        return !!cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform();
    }

    static isEnabled(): boolean {
        return localStorage.getItem(this.KEY_ENABLED) === "true";
    }

    static getLeadMinutes(): number {
        const v = parseInt(localStorage.getItem(this.KEY_LEAD_MIN) || "15", 10);
        return isNaN(v) || v <= 0 ? 15 : v;
    }

    static async setEnabled(enabled: boolean): Promise<boolean> {
        if (enabled) {
            const granted = await this.requestPermission();
            if (!granted) return false;
        }
        localStorage.setItem(this.KEY_ENABLED, enabled ? "true" : "false");
        if (!enabled) await this.cancelAll();
        return true;
    }

    static setLeadMinutes(minutes: number): void {
        localStorage.setItem(this.KEY_LEAD_MIN, String(minutes));
    }

    /**
     * 申请系统通知权限（Android 13+ 需要运行时授权）。
     */
    static async requestPermission(): Promise<boolean> {
        try {
            if (this.isNative) {
                const status = await LocalNotifications.requestPermissions();
                return status.display === "granted";
            }
            if ("Notification" in window) {
                const perm = await Notification.requestPermission();
                return perm === "granted";
            }
            return false;
        } catch (e) {
            console.error("[NotificationManager] requestPermission error:", e);
            return false;
        }
    }

    /**
     * 取消本 App 之前排程的全部课程提醒。
     */
    static async cancelAll(): Promise<void> {
        if (!this.isNative) return;
        try {
            const pending = await LocalNotifications.getPending();
            const ours = pending.notifications.filter(n => n.id >= this.ID_BASE && n.id < this.ID_BASE + 10000);
            if (ours.length > 0) {
                await LocalNotifications.cancel({ notifications: ours.map(n => ({ id: n.id })) });
            }
        } catch (e) {
            console.error("[NotificationManager] cancelAll error:", e);
        }
    }

    /**
     * 立即推送一条通知（用于成绩变动等即时提醒）。不受"上课提醒开关"限制，
     * 但原生端需系统通知权限；未授权时静默跳过（Toast 已在 UI 层兜底）。
     *
     * Args:
     *     title (string): 通知标题。
     *     body (string): 通知正文。
     */
    static async notifyGradeUpdate(title: string, body: string): Promise<void> {
        try {
            if (this.isNative) {
                const perm = await LocalNotifications.requestPermissions();
                if (perm.display !== "granted") return;
                const id = this.EXAM_ID_BASE + 1500 + Math.floor(Math.random() * 400);
                await LocalNotifications.schedule({
                    notifications: [{
                        id,
                        title,
                        body,
                        schedule: { at: new Date(Date.now() + 1500), allowWhileIdle: true },
                        smallIcon: "ic_launcher",
                    }]
                });
            } else if ("Notification" in window && Notification.permission === "granted") {
                new Notification(title, { body });
            }
        } catch (e) {
            console.error("[NotificationManager] notifyGradeUpdate error:", e);
        }
    }

    /**
     * 解析教务考试日期时间文本（如 "2026-07-30 09:00-11:00"）为开考 Date。
     */
    static parseExamStart(text: string): Date | null {
        return ReminderScheduler.parseExamStart(text);
    }

    /**
     * 根据考试安排排程考试提醒：考前一天 21:00 提醒一次，考前 1 小时再提醒一次。
     * 与上课提醒使用独立 ID 段位，互不覆盖；仅在提醒总开关开启时生效。
     *
     * Args:
     *     exams (Array): 至少包含 name/courseName、date/time、room/location、seatNo/seat 的考试项。
     *
     * Returns:
     *     Promise<number>: 实际排程的考试提醒条数。
     */
    static async rescheduleExamReminders(exams: any[]): Promise<number> {
        if (!this.isEnabled() || !this.isNative) return 0;

        // 先清掉旧的考试提醒
        try {
            const pending = await LocalNotifications.getPending();
            const oldExam = pending.notifications.filter(n => n.id >= this.EXAM_ID_BASE && n.id < this.EXAM_ID_BASE + 2000);
            if (oldExam.length > 0) {
                await LocalNotifications.cancel({ notifications: oldExam.map(n => ({ id: n.id })) });
            }
        } catch (e) {
            console.error("[NotificationManager] clear old exam reminders error:", e);
        }

        const notices = ReminderScheduler.computeExamReminders(exams, { maxScheduled: 40 });
        if (notices.length === 0) return 0;

        try {
            const scheduleNotifications: ScheduleNotification[] = notices.map(n => ({
                id: this.EXAM_ID_BASE + n.idOffset,
                title: n.title,
                body: n.body,
                schedule: { at: n.fireAt, allowWhileIdle: true },
                smallIcon: "ic_launcher",
            }));
            await LocalNotifications.schedule({ notifications: scheduleNotifications });
            console.log(`[NotificationManager] Scheduled ${scheduleNotifications.length} exam reminders.`);
            return scheduleNotifications.length;
        } catch (e) {
            console.error("[NotificationManager] exam schedule error:", e);
            return 0;
        }
    }

    /**
     * 核心：根据课表重排未来两周的全部上课提醒。
     *
     * Args:
     *     data (TimetableData): 结构化课表（需含 currentWeek 才能把周次映射到日期）。
     *
     * Returns:
     *     Promise<number>: 实际排程的提醒条数；-1 表示无法排程（缺当前周信息）。
     */
    static async rescheduleFromTimetable(data: TimetableData | null): Promise<number> {
        if (!this.isEnabled()) return 0;
        if (!data || !Array.isArray(data.courses) || data.courses.length === 0) return 0;
        if (!data.currentWeek) {
            console.warn("[NotificationManager] currentWeek missing, cannot map weeks to dates.");
            return -1;
        }

        const leadMin = this.getLeadMinutes();
        const capped = ReminderScheduler.computeTimetableReminders(data, {
            leadMinutes: leadMin,
            daysAhead: this.DAYS_AHEAD,
            maxScheduled: this.MAX_SCHEDULED,
        });

        if (this.isNative) {
            await this.cancelAll();
            if (capped.length === 0) return 0;
            const schedule: ScheduleOptions = {
                notifications: capped.map((p, idx) => ({
                    id: this.ID_BASE + idx,
                    title: p.title,
                    body: p.body,
                    schedule: { at: p.fireAt, allowWhileIdle: true },
                    smallIcon: "ic_launcher",
                }))
            };
            try {
                await LocalNotifications.schedule(schedule);
                console.log(`[NotificationManager] Scheduled ${capped.length} class reminders (lead ${leadMin} min).`);
                return capped.length;
            } catch (e) {
                console.error("[NotificationManager] schedule error:", e);
                return 0;
            }
        }

        // 浏览器降级：仅在页面存活期间用 setTimeout + Web Notification 提醒最近几条
        let webCount = 0;
        for (const p of capped.slice(0, 10)) {
            const delay = p.fireAt.getTime() - Date.now();
            if (delay > 0 && delay < 12 * 3600000) {
                setTimeout(() => {
                    if ("Notification" in window && Notification.permission === "granted") {
                        new Notification(p.title, { body: p.body });
                    }
                }, delay);
                webCount++;
            }
        }
        return webCount;
    }

    /**
     * 获取下一条即将触发的提醒描述文本（供设置面板展示）。
     */
    static async getNextPendingText(): Promise<string> {
        if (!this.isNative) return "";
        try {
            const pending = await LocalNotifications.getPending();
            const ours = pending.notifications
                .filter(n => n.id >= this.ID_BASE && n.id < this.ID_BASE + 10000)
                .sort((a, b) => (a.schedule?.at ? new Date(a.schedule.at).getTime() : 0) - (b.schedule?.at ? new Date(b.schedule.at).getTime() : 0));
            if (ours.length === 0) return "";
            const next = ours[0];
            const at = next.schedule?.at ? new Date(next.schedule.at) : null;
            const timeStr = at ? `${at.getMonth() + 1}月${at.getDate()}日 ${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}` : "";
            return `已排 ${ours.length} 条提醒，最近一条：${timeStr}`;
        } catch {
            return "";
        }
    }
}
