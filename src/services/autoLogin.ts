import { YnufeClient } from '../api/client';
import { YnufeSession } from '../stores/sessionStore';
import { encodeInp } from '../utils/crypto';
import { ProfileParser } from '../parsers/profileParser';
import { SessionCookieManager } from './cookieManager';

/**
 * AutoLogin: 持久化登录 / 会话自动续期服务
 *
 * 目标：App 被杀掉或长时间未打开导致教务会话过期后，尽最大可能
 * 用本地保存的凭据自动重新登录。
 */
export class AutoLogin {
    /** 防止并发重复续期 */
    private static inFlight: Promise<boolean> | null = null;

    /**
     * 尝试静默自动重新登录。
     *
     * Returns:
     *     Promise<boolean>: true 表示会话已恢复，可以直接重新拉取数据。
     */
    static attempt(): Promise<boolean> {
        if (this.inFlight) return this.inFlight;
        this.inFlight = this.doAttempt().finally(() => { this.inFlight = null; });
        return this.inFlight;
    }

    private static async doAttempt(): Promise<boolean> {
        // 0. 先探测现有 Cookie 会话是否其实还活着
        if (await this.verifySession()) {
            console.log("[AutoLogin] Existing cookie session still valid, no relogin needed.");
            YnufeSession.setHasSession(true);
            return true;
        }

        const user = YnufeSession.getUsername();
        const pass = YnufeSession.getPassword();
        if (!user || !pass) {
            console.log("[AutoLogin] No saved credentials, cannot auto relogin.");
            return false;
        }

        try {
            console.log("[AutoLogin] Attempting silent relogin...");
            const encoded = `${encodeInp(user)}%%%${encodeInp(pass)}`;
            await YnufeClient.postForm("/jsxsd/xk/LoginToXkLdap", {
                userAccount: user,
                userPassword: "",
                RANDOMCODE: "",
                encoded
            });

            const verified = await this.verifySession();
            if (verified) {
                console.log("[AutoLogin] Silent relogin SUCCESS. Session restored.");
                YnufeSession.setHasSession(true);
                return true;
            }
            console.warn("[AutoLogin] Silent relogin rejected by server.");
            return false;
        } catch (err) {
            console.warn("[AutoLogin] Silent relogin failed:", err);
            return false;
        }
    }

    /**
     * 正向验证当前会话：必须真的能解析出学籍信息才算有效。
     *
     * Returns:
     *     Promise<boolean>: 仅当页面中解析出有效学籍姓名时为 true。
     */
    static async verifySession(): Promise<boolean> {
        try {
            const html = await YnufeClient.getHtml("/jsxsd/framework/xsMain_new.jsp?t1=1");
            const profile = ProfileParser.parseProfile(html);
            const isValid = !!profile.name && profile.name !== "未登录";
            if (isValid) {
                // 确定为有效已登录 Session，锁死保存最新 JSESSIONID
                await SessionCookieManager.captureAndPersist(true);
            }
            return isValid;
        } catch {
            return false;
        }
    }
}
