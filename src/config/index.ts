/**
 * 统一配置导出入口
 */
export * from './storageKeys';
export * from './themePresets';

/**
 * AppConfig: 全局集中配置
 *
 * 集中管理教务网地址、节次作息时间、后台心跳保活间隔、空教室查询参数等。
 */
export const AppConfig = {
    /** 教务系统域名 */
    TARGET_HOST: "https://xjwis.ynufe.edu.cn",

    /** 后台心跳保活间隔（毫秒） */
    HEARTBEAT_INTERVAL_MS: 120000,

    /**
     * 每个大节的上课时间（session 1-5 对应 1-2节 ... 9-10节）。
     * start/end 为 "HH:mm"，用于今日课程展示与上课提醒排程。
     */
    SESSION_TIMES: [
        { label: "08:00-09:30", start: "08:00", end: "09:30" },
        { label: "10:00-11:30", start: "10:00", end: "11:30" },
        { label: "14:30-16:00", start: "14:30", end: "16:00" },
        { label: "16:30-18:00", start: "16:30", end: "18:00" },
        { label: "19:00-20:30", start: "19:00", end: "20:30" },
    ],

    /**
     * 空教室查询用的节次配置模板 ID（强智系统 kbjcmsid）。
     * 注意：这是学校教务配置的一个固定 GUID，若学校重新配置作息表会失效，需要抓包更新。
     */
    CLASSROOM_QUERY_KBJCMSID: "C8B3C60AE20444B499A15ABFA3ECFF9D",

    /**
     * 根据当前日期推算默认学年学期 ID（如 "2025-2026-1"）。
     * 规则：8月-次年1月为第1学期，2月-7月为第2学期。
     *
     * Returns:
     *     string: 学年学期标识符。
     */
    getDefaultSemesterId(): string {
        const now = new Date();
        const y = now.getFullYear();
        const m = now.getMonth() + 1; // 1-12
        if (m >= 8) return `${y}-${y + 1}-1`;
        if (m <= 1) return `${y - 1}-${y}-1`;
        return `${y - 1}-${y}-2`;
    },
};
