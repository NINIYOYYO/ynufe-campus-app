import { obfuscate, deobfuscate } from '../utils/crypto';

/**
 * YnufeSession: 用户凭据与离线数据持久化中心
 * 职责：管理本地存储中的账号密码（混淆存储）以及登录会话状态与业务数据缓存。
 */
export class YnufeSession {
    private static KEY_USERNAME = "ynufe_username";
    private static KEY_PASSWORD = "ynufe_password";
    private static KEY_REMEMBER = "ynufe_remember";
    private static KEY_HAS_SESSION = "ynufe_has_session";

    /**
     * 保存用户登录凭据到本地持久化存储（混淆后写入）。
     *
     * Args:
     *     user (string): 学生学号。
     *     pass (string): 明文密码。
     *     remember (boolean): 是否勾选“记住密码”。
     */
    static saveCredentials(user: string, pass: string, remember: boolean): void {
        if (remember) {
            localStorage.setItem(this.KEY_USERNAME, obfuscate(user));
            localStorage.setItem(this.KEY_PASSWORD, obfuscate(pass));
            localStorage.setItem(this.KEY_REMEMBER, "true");
        } else {
            this.clearCredentials();
            localStorage.setItem(this.KEY_REMEMBER, "false");
        }
    }

    /**
     * 获取本地保存的学号（自动兼容旧版明文数据）。
     */
    static getUsername(): string {
        const raw = localStorage.getItem(this.KEY_USERNAME);
        return raw ? deobfuscate(raw) : "";
    }

    /**
     * 获取本地保存的密码（自动兼容旧版明文数据）。
     */
    static getPassword(): string {
        const raw = localStorage.getItem(this.KEY_PASSWORD);
        return raw ? deobfuscate(raw) : "";
    }

    /**
     * 一次性迁移：如果本地还存着旧版明文凭据，立即重写为混淆格式。
     */
    static migratePlaintextCredentials(): void {
        const rawUser = localStorage.getItem(this.KEY_USERNAME);
        const rawPass = localStorage.getItem(this.KEY_PASSWORD);
        if ((rawUser && !rawUser.startsWith("v1:")) || (rawPass && !rawPass.startsWith("v1:"))) {
            if (rawUser) localStorage.setItem(this.KEY_USERNAME, obfuscate(deobfuscate(rawUser)));
            if (rawPass) localStorage.setItem(this.KEY_PASSWORD, obfuscate(deobfuscate(rawPass)));
            console.log("[YnufeSession] Migrated legacy plaintext credentials to obfuscated format.");
        }
    }

    /**
     * 获取用户是否勾选记住密码。
     *
     * 默认关闭：凭据只经本地混淆存储，无法抵御针对性逆向，
     * 因此必须由用户主动勾选，而不是替用户默认开启。
     */
    static getRememberMe(): boolean {
        return localStorage.getItem(this.KEY_REMEMBER) === "true";
    }

    /**
     * 设置或更新 Session 状态标记。
     */
    static setHasSession(hasSession: boolean): void {
        localStorage.setItem(this.KEY_HAS_SESSION, hasSession ? "true" : "false");
    }

    /**
     * 查询本地是否有有效 Session 标记。
     */
    static getHasSession(): boolean {
        return localStorage.getItem(this.KEY_HAS_SESSION) === "true";
    }

    /**
     * 清理保存的登录凭据。
     */
    static clearCredentials(): void {
        localStorage.removeItem(this.KEY_USERNAME);
        localStorage.removeItem(this.KEY_PASSWORD);
    }

    /**
     * 退出登录并清空全部会话与离线业务数据缓存。
     */
    static clearSession(): void {
        localStorage.removeItem(this.KEY_HAS_SESSION);
        const keysToRemove = [
            "ynufe_cached_profile",
            "ynufe_cached_timetable_data",
            "ynufe_cached_grades_data",
            "ynufe_cached_exams",
            "ynufe_cached_announcements",
            // 学期与教学周同样是随账号变化的会话派生数据，退出时必须一并清除，
            // 否则换账号登录会沿用上一位用户的学期/周次去过滤课表
            "ynufe_current_semester_id",
            "ynufe_current_teaching_week"
        ];
        keysToRemove.forEach(k => localStorage.removeItem(k));
    }

    /**
     * 将对象格式化为 JSON 字符串并存入缓存。
     */
    static setCache<T>(key: string, data: T): void {
        try {
            localStorage.setItem(key, JSON.stringify(data));
        } catch (e) {
            console.error(`[YnufeSession] Failed to setCache for ${key}:`, e);
        }
    }

    /**
     * 从缓存读取并反序列化 JSON 数据。
     */
    static getCache<T>(key: string): T | null {
        const str = localStorage.getItem(key);
        if (!str) return null;
        try {
            return JSON.parse(str) as T;
        } catch (e) {
            console.error(`[YnufeSession] Failed to parse cache for ${key}:`, e);
            return null;
        }
    }
}
