import { obfuscate, deobfuscate } from '../utils/crypto';
import { SessionCookieManager } from '../services/cookieManager';
import { StorageKeys } from '../config/storageKeys';
import { CacheService } from '../services/cacheService';

/**
 * YnufeSession: 用户凭据与会话持久化中心
 * 职责：管理本地存储中的账号密码（混淆存储）以及登录会话状态与业务数据缓存。
 */
export class YnufeSession {
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
            localStorage.setItem(StorageKeys.USERNAME, obfuscate(user));
            localStorage.setItem(StorageKeys.PASSWORD, obfuscate(pass));
            localStorage.setItem(StorageKeys.REMEMBER, "true");
        } else {
            this.clearCredentials();
            localStorage.setItem(StorageKeys.REMEMBER, "false");
        }
    }

    /**
     * 获取本地保存的学号（自动兼容旧版明文数据）。
     *
     * Returns:
     *     string: 学号明文。
     */
    static getUsername(): string {
        const raw = localStorage.getItem(StorageKeys.USERNAME);
        return raw ? deobfuscate(raw) : "";
    }

    /**
     * 获取本地保存的密码（自动兼容旧版明文数据）。
     *
     * Returns:
     *     string: 密码明文。
     */
    static getPassword(): string {
        const raw = localStorage.getItem(StorageKeys.PASSWORD);
        return raw ? deobfuscate(raw) : "";
    }

    /**
     * 一次性迁移：如果本地还存着旧版明文凭据，立即重写为混淆格式。
     */
    static migratePlaintextCredentials(): void {
        const rawUser = localStorage.getItem(StorageKeys.USERNAME);
        const rawPass = localStorage.getItem(StorageKeys.PASSWORD);
        if ((rawUser && !rawUser.startsWith("v2:") && !rawUser.startsWith("v1:")) ||
            (rawPass && !rawPass.startsWith("v2:") && !rawPass.startsWith("v1:"))) {
            if (rawUser) localStorage.setItem(StorageKeys.USERNAME, obfuscate(deobfuscate(rawUser)));
            if (rawPass) localStorage.setItem(StorageKeys.PASSWORD, obfuscate(deobfuscate(rawPass)));
            console.log("[YnufeSession] Migrated legacy plaintext credentials to obfuscated format.");
        }
    }

    /**
     * 获取用户是否勾选记住密码。
     *
     * Returns:
     *     boolean: 勾选为 true。
     */
    static getRememberMe(): boolean {
        return localStorage.getItem(StorageKeys.REMEMBER) === "true";
    }

    /**
     * 设置或更新 Session 状态标记。
     *
     * Args:
     *     hasSession (boolean): 会话有效性。
     */
    static setHasSession(hasSession: boolean): void {
        localStorage.setItem(StorageKeys.HAS_SESSION, hasSession ? "true" : "false");
    }

    /**
     * 查询本地是否有有效 Session 标记。
     *
     * Returns:
     *     boolean: 是否已有会话。
     */
    static getHasSession(): boolean {
        return localStorage.getItem(StorageKeys.HAS_SESSION) === "true";
    }

    /**
     * 清理保存的登录凭据（学号、密码与记住密码标记）。
     */
    static clearCredentials(): void {
        localStorage.removeItem(StorageKeys.USERNAME);
        localStorage.removeItem(StorageKeys.PASSWORD);
        localStorage.removeItem(StorageKeys.REMEMBER);
    }

    /**
     * 退出登录并清空全部会话、登录凭据与离线业务数据缓存。
     */
    static clearSession(): void {
        this.clearCredentials();
        localStorage.removeItem(StorageKeys.HAS_SESSION);
        SessionCookieManager.clearCookies();
        const keysToRemove = [
            StorageKeys.USER_PROFILE,
            StorageKeys.TIMETABLE_CACHE,
            StorageKeys.GRADES_CACHE,
            StorageKeys.LEVEL_GRADES_CACHE,
            StorageKeys.EXAMS_CACHE,
            StorageKeys.CLASSROOM_TESTS_CACHE,
            StorageKeys.PRACTICE_THESIS_CACHE,
            StorageKeys.ANNOUNCEMENTS_CACHE,
            StorageKeys.CURRENT_TEACHING_WEEK,
            // 兼容旧版历史键名
            "ynufe_cached_profile",
            "ynufe_cached_timetable_data",
            "ynufe_cached_grades_data",
            "ynufe_cached_exams",
            "ynufe_cached_announcements",
            "ynufe_current_semester_id",
            "ynufe_graded_keys",
        ];
        keysToRemove.forEach(k => CacheService.remove(k));
    }

    /**
     * 将对象写入缓存（代理到 CacheService）。
     *
     * Args:
     *     key (string): 存储键名。
     *     data (T): 待持久化数据。
     */
    static setCache<T>(key: string, data: T): void {
        CacheService.set(key, data);
    }

    /**
     * 从缓存读取数据（代理到 CacheService）。
     *
     * Args:
     *     key (string): 存储键名。
     *
     * Returns:
     *     T | null: 缓存实体。
     */
    static getCache<T>(key: string): T | null {
        return CacheService.get<T>(key);
    }
}
