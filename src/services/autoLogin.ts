import { YnufeClient } from '../api/client';
import { YnufeSession } from '../stores/sessionStore';
import { encodeInp } from '../utils/crypto';
import { ProfileParser } from '../parsers/profileParser';

/**
 * AutoLogin: 持久化登录 / 会话自动续期服务
 *
 * 目标：App 被杀掉或长时间未打开导致教务会话过期后，尽最大可能
 * 用本地保存的凭据自动重新登录，而不是每次都让用户手输验证码。
 *
 * 流程：
 *   1. 若本地保存了账号密码 → 直接尝试免验证码登录（RANDOMCODE 留空）。
 *      部分强智部署仅在会话中存在验证码记录时才校验，此时可以直接成功。
 *   2. 登录后请求主框架页验证会话是否真正生效。
 *   3. 全部失败 → 返回 false，由 UI 层弹出登录框（账号密码已预填，只需输 4 位验证码）。
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
        // 0. 先探测现有 Cookie 会话是否其实还活着（App 冷启动时常见）
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
            console.log("[AutoLogin] Attempting captcha-free silent relogin...");
            const encoded = `${encodeInp(user)}%%%${encodeInp(pass)}`;
            await YnufeClient.postForm("/jsxsd/xk/LoginToXkLdap", {
                userAccount: user,
                userPassword: "",
                RANDOMCODE: "",
                encoded
            });

            // 用主框架页做“会话是否真正生效”的正向验证
            const verified = await this.verifySession();
            if (verified) {
                console.log("[AutoLogin] Silent relogin SUCCESS. Session restored.");
                YnufeSession.setHasSession(true);
                return true;
            }
            console.warn("[AutoLogin] Silent relogin rejected by server (captcha likely enforced).");
            return false;
        } catch (err) {
            console.warn("[AutoLogin] Silent relogin failed:", err);
            return false;
        }
    }

    /**
     * 正向验证当前会话：必须真的能解析出学籍信息才算有效。
     *
     * 不能用「没抛 SessionExpiredError + 页面体量够大」来判定：教务网在未登录时
     * 并不总是跳登录页——实测直接返回一个 1022 字节的「404错误」页，既不含
     * sys/login.jsp / LoginToXkLdap 等任何标记，长度也超过阈值，于是被误判为
     * 会话有效。调用方据此认为续期成功，转头拉数据又失败，陷入
     * 「续期成功 → 拉取失败 → 再次判定过期」的空转，用户永远等不到登录框。
     *
     * Returns:
     *     Promise<boolean>: 仅当页面中解析出有效学籍姓名时为 true。
     */
    static async verifySession(): Promise<boolean> {
        try {
            const html = await YnufeClient.getHtml("/jsxsd/framework/xsMain_new.jsp?t1=1");
            const profile = ProfileParser.parseProfile(html);
            return !!profile.name && profile.name !== "未登录";
        } catch {
            return false;
        }
    }
}
