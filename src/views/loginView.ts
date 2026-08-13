import { YnufeClient } from '../api/client';
import { YnufeSession } from '../stores/sessionStore';
import { AutoLogin } from '../services/autoLogin';
import { SessionCookieManager } from '../services/cookieManager';
import { NotificationManager } from '../services/notificationManager';
import { encodeInp } from '../utils/crypto';
import { showToast, showLoading, toggleModal, updateSyncStatus, resetRenderFingerprints } from '../utils/uiFeedback';

/**
 * 登录弹窗与认证交互视图控制器
 */
export class LoginView {
    private static lastCaptchaUrl: string | null = null;

    /**
     * 自动装填并预填登录弹窗中的账号和密码，直接聚焦验证码输入框。
     */
    static prefillLoginForm(): void {
        const userEl = document.getElementById("username") as HTMLInputElement | null;
        const passEl = document.getElementById("password") as HTMLInputElement | null;
        const rememberEl = document.getElementById("remember-me") as HTMLInputElement | null;
        const captchaEl = document.getElementById("captcha") as HTMLInputElement | null;

        const savedUser = YnufeSession.getUsername();
        const savedPass = YnufeSession.getPassword();
        const savedRemember = YnufeSession.getRememberMe();

        if (userEl && savedUser) userEl.value = savedUser;
        if (passEl && savedPass) passEl.value = savedPass;
        if (rememberEl) rememberEl.checked = savedRemember || !!savedPass;
        if (captchaEl) {
            captchaEl.value = "";
            setTimeout(() => captchaEl.focus(), 300);
        }
    }

    /**
     * 刷新并加载验证码图片二进制 Blob，释放旧 ObjectURL 避免内存泄漏。
     */
    static async refreshCaptchaImg(): Promise<void> {
        const captchaImg = document.getElementById("captcha-img") as HTMLImageElement | null;
        if (!captchaImg) return;
        try {
            captchaImg.style.opacity = "0.5";
            const blob = await YnufeClient.getCaptchaBlob();
            if (this.lastCaptchaUrl) {
                URL.revokeObjectURL(this.lastCaptchaUrl);
            }
            const objectUrl = URL.createObjectURL(blob);
            this.lastCaptchaUrl = objectUrl;
            captchaImg.src = objectUrl;
            captchaImg.style.opacity = "1";
        } catch (e) {
            console.error("[LoginView] Failed to refresh captcha blob:", e);
            captchaImg.style.opacity = "1";
        }
    }

    /**
     * 处理登录表单提交事件，进行前端凭据加密与身份校验。
     *
     * Args:
     *     e (Event): 表单提交事件。
     *     onSuccess (Function): 登录成功后的回调函数。
     */
    static async handleLogin(e: Event, onSuccess?: () => Promise<boolean>): Promise<void> {
        e.preventDefault();
        const userEl = document.getElementById("username") as HTMLInputElement | null;
        const passEl = document.getElementById("password") as HTMLInputElement | null;
        const captchaEl = document.getElementById("captcha") as HTMLInputElement | null;
        const rememberEl = document.getElementById("remember-me") as HTMLInputElement | null;
        const msgDiv = document.getElementById("login-msg");

        const user = userEl?.value.trim() || "";
        const pass = passEl?.value.trim() || "";
        const captcha = captchaEl?.value.trim() || "";
        const remember = rememberEl?.checked || false;

        if (!user || !pass || !captcha) {
            if (msgDiv) msgDiv.innerText = "请输入完整的信息及验证码！";
            return;
        }

        showLoading(true, "正在安全登录并同步数据...");
        if (msgDiv) msgDiv.innerText = "";

        try {
            const key1 = encodeInp(user);
            const key2 = encodeInp(pass);
            const encoded = `${key1}%%%${key2}`;

            const loginHtml = await YnufeClient.postForm("/jsxsd/xk/LoginToXkLdap", {
                userAccount: user,
                userPassword: "",
                RANDOMCODE: captcha,
                encoded
            });

            if (loginHtml.includes("验证码错误") || loginHtml.includes("验证码已过期")) {
                showLoading(false);
                if (msgDiv) msgDiv.innerText = "验证码错误或过期，请重新输入！";
                this.refreshCaptchaImg();
                return;
            }

            if (loginHtml.includes("用户名或密码错误") || loginHtml.includes("账号或密码不正确") || loginHtml.includes("密码错误")) {
                showLoading(false);
                if (msgDiv) msgDiv.innerText = "账号或密码有误，请核对！";
                this.refreshCaptchaImg();
                return;
            }

            const verified = await AutoLogin.verifySession();
            if (!verified) {
                showLoading(false);
                if (msgDiv) msgDiv.innerText = "登录未成功，请检查账号密码和验证码后重试！";
                this.refreshCaptchaImg();
                return;
            }

            YnufeSession.saveCredentials(user, pass, remember);
            YnufeSession.setHasSession(true);

            await SessionCookieManager.captureAndPersist();
            await SessionCookieManager.restoreCookies();

            resetRenderFingerprints();

            let dataLoaded = true;
            if (onSuccess) {
                dataLoaded = await onSuccess();
            }
            showLoading(false);

            if (dataLoaded) {
                updateSyncStatus("online", "数据已最新");
                toggleModal("login-overlay", false);
                showToast("登录成功，数据已同步", "success");
            } else {
                if (msgDiv) msgDiv.innerText = "同步教务网数据异常，请重试！";
                this.refreshCaptchaImg();
            }
        } catch (err) {
            showLoading(false);
            console.error("[LoginView] Login request error:", err);
            if (msgDiv) msgDiv.innerText = "网络超时，请确认手机已连接校园网！";
            this.refreshCaptchaImg();
        }
    }

    /**
     * 处理退出登录并清理凭据与缓存。
     *
     * Args:
     *     onLogout (Function, optional): 退出清理后的回调。
     */
    static handleLogout(onLogout?: () => void): void {
        if (confirm("确定要退出登录并清除会话与缓存吗？")) {
            NotificationManager.cancelAll();
            YnufeSession.clearSession();
            if (onLogout) onLogout();
            window.location.reload();
        }
    }

    /**
     * 绑定登录弹窗与退出按钮事件。
     *
     * Args:
     *     onLoginSuccess (Function): 登录成功回调。
     *     onLogout (Function): 退出登录回调。
     */
    static bindEvents(onLoginSuccess?: () => Promise<boolean>, onLogout?: () => void): void {
        document.getElementById("login-form")?.addEventListener("submit", (e) => this.handleLogin(e, onLoginSuccess));
        document.getElementById("captcha-img")?.addEventListener("click", () => this.refreshCaptchaImg());
        document.getElementById("btn-logout")?.addEventListener("click", () => this.handleLogout(onLogout));
    }
}
