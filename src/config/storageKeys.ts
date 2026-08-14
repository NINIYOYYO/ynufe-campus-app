/**
 * 全站 LocalStorage 存储键名强类型定义。
 *
 * 集中管理所有本地持久化键名，避免魔法字符串与命名冲突。
 */
export const StorageKeys = {
    // 1. 会话与安全凭据
    SAVED_JSESSIONID: "ynufe_saved_jsessionid",
    HAS_SESSION: "ynufe_has_session",
    USERNAME: "ynufe_username",
    PASSWORD: "ynufe_password",
    REMEMBER: "ynufe_remember",
    USER_PROFILE: "ynufe_user_profile",
    DEVICE_KEY: "ynufe_device_key",

    // 2. 业务数据缓存
    TIMETABLE_CACHE: "ynufe_timetable_cache",
    GRADES_CACHE: "ynufe_grades_cache",
    LEVEL_GRADES_CACHE: "ynufe_level_grades_cache",
    EXAMS_CACHE: "ynufe_exams_cache",
    CLASSROOM_TESTS_CACHE: "ynufe_classroom_tests_cache",
    PRACTICE_THESIS_CACHE: "ynufe_practice_thesis_cache",
    ANNOUNCEMENTS_CACHE: "ynufe_announcements_cache",
    CURRENT_TEACHING_WEEK: "ynufe_current_teaching_week",

    // 3. 主题与壁纸外观
    THEME_MODE: "ynufe_theme",
    STYLE_PRESET: "ynufe_style_preset",
    ACCENT_HEX: "ynufe_accent_hex",
    ACCENT_RGB: "ynufe_accent_rgb",
    TEXT_COLOR: "ynufe_text_color",
    BG_COLOR: "ynufe_bg_color",
    WALLPAPER_PRESET: "ynufe_wallpaper_preset",
    WALLPAPER_COLOR: "ynufe_wallpaper_color",
    CUSTOM_WALLPAPER: "ynufe_custom_wallpaper",
    WALLPAPER_BLUR: "ynufe_wallpaper_blur",
    WALLPAPER_MASK_OPACITY: "ynufe_wallpaper_mask_opacity",
    WALLPAPER_TRANSFORM: "ynufe_wallpaper_transform",

    // 4. 上课与考试通知提醒
    NOTIFY_ENABLED: "ynufe_notify_enabled",
    NOTIFY_LEAD_MIN: "ynufe_notify_lead_min",
} as const;

export type StorageKey = typeof StorageKeys[keyof typeof StorageKeys];
