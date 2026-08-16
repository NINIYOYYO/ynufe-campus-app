import { YnufeClient } from '../api/client';
import { YnufeSession } from '../stores/sessionStore';
import { encodeInp } from '../utils/crypto';
import { ProfileParser } from '../parsers/profileParser';
import { SessionCookieManager } from './cookieManager';
import { CaptchaOCR } from '../utils/captchaOcr';

/**
 * AutoLogin: 持久化登录 / 会话自动续期服务
 *
 * 目标：App 被杀掉或长时间未打开导致教务会话过期后，尽最大可能
 * 用本地保存的凭据自动重新登录。
 */
export class AutoLogin {
    /** 防止并发重复续期 */
    private static inFlight: Promise<boolean> | null = null;
    private static readonly MAX_RETRIES = 3;

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

    /**
     * 执行静默登录核心流程，包含图形验证码本地 OCR 识别与重试机制。
     *
     * Returns:
     *     Promise<boolean>: 登录是否成功。
     */
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

        for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
            try {
                console.log(`[AutoLogin] Attempting silent relogin (attempt ${attempt}/${this.MAX_RETRIES})...`);

                let captchaCode = "";
                try {
                    const captchaBlob = await YnufeClient.getCaptchaBlob();
                    captchaCode = await CaptchaOCR.recognize(captchaBlob);
                } catch (e) {
                    console.warn("[AutoLogin] Captcha fetch or OCR failed, proceeding with blank code:", e);
                }

                const encoded = `${encodeInp(user)}%%%${encodeInp(pass)}`;
                const loginHtml = await YnufeClient.postForm("/jsxsd/xk/LoginToXkLdap", {
                    userAccount: user,
                    userPassword: "",
                    RANDOMCODE: captchaCode,
                    encoded
                });

                if (loginHtml.includes("用户名或密码错误") || loginHtml.includes("账号或密码不正确") || loginHtml.includes("密码错误")) {
                    console.warn("[AutoLogin] Invalid credentials detected, aborting retry.");
                    return false;
                }

                if (loginHtml.includes("验证码错误") || loginHtml.includes("验证码已过期")) {
                    console.warn(`[AutoLogin] Captcha mismatch on attempt ${attempt}, retrying...`);
                    continue;
                }

                const verified = await this.verifySession();
                if (verified) {
                    console.log("[AutoLogin] Silent relogin SUCCESS. Session restored.");
                    YnufeSession.setHasSession(true);
                    return true;
                }

                console.warn(`[AutoLogin] Session verification failed on attempt ${attempt}.`);
            } catch (err) {
                console.warn(`[AutoLogin] Silent relogin attempt ${attempt} encountered error:`, err);
            }
        }

        console.warn("[AutoLogin] All silent relogin attempts exhausted.");
        return false;
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
