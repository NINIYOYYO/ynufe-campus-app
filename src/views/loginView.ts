import { YnufeClient } from '../api/client';
import { YnufeSession } from '../stores/sessionStore';
import { AutoLogin } from '../services/autoLogin';
import { SessionCookieManager } from '../services/cookieManager';
import { NotificationManager } from '../services/notificationManager';
import { encodeInp } from '../utils/crypto';
import { CaptchaOCR } from '../utils/captchaOcr';
import { showToast, showLoading, toggleModal, updateSyncStatus, resetRenderFingerprints } from '../utils/uiFeedback';

/**
 * 登录弹窗与认证交互视图控制器
 */
export class LoginView {
    private static lastCaptchaUrl: string | null = null;
    private static readonly MAX_LOGIN_RETRIES = 3;

    /**
     * 自动装填并预填登录弹窗中的账号和密码，并后台自动拉取与 OCR 识别验证码。
     */
    static prefillLoginForm(): void {
        const userEl = document.getElementById("username") as HTMLInputElement | null;
        const passEl = document.getElementById("password") as HTMLInputElement | null;
        const rememberEl = document.getElementById("remember-me") as HTMLInputElement | null;

        const savedUser = YnufeSession.getUsername();
        const savedPass = YnufeSession.getPassword();
        const savedRemember = YnufeSession.getRememberMe();

        if (userEl && savedUser) userEl.value = savedUser;
        if (passEl && savedPass) passEl.value = savedPass;
        if (rememberEl) rememberEl.checked = savedRemember || !!savedPass;

        // 异步后台拉取验证码并自动 OCR 识别填入
        this.refreshCaptchaAndAutoFill().catch((e) => {
            console.warn("[LoginView] Auto OCR prefill error:", e);
        });

        if (userEl && !savedUser) {
            setTimeout(() => userEl.focus(), 300);
        } else if (passEl && !savedPass) {
            setTimeout(() => passEl.focus(), 300);
        }
    }

    /**
     * 刷新验证码图片并自动调用本地 OCR 引擎识别填入输入框。
     *
     * Returns:
     *     Promise<string>: 识别出的 4 位验证码字符（若识别失败则返回空字符串）。
     */
    static async refreshCaptchaAndAutoFill(): Promise<string> {
        const captchaImg = document.getElementById("captcha-img") as HTMLImageElement | null;
        const captchaEl = document.getElementById("captcha") as HTMLInputElement | null;

        if (captchaImg) {
            captchaImg.style.opacity = "0.5";
        }
        if (captchaEl && !captchaEl.value) {
            captchaEl.placeholder = "识别中...";
        }

        try {
            const blob = await YnufeClient.getCaptchaBlob();
            if (this.lastCaptchaUrl) {
                URL.revokeObjectURL(this.lastCaptchaUrl);
            }
            const objectUrl = URL.createObjectURL(blob);
            this.lastCaptchaUrl = objectUrl;

            if (captchaImg) {
                captchaImg.src = objectUrl;
                captchaImg.style.opacity = "1";
            }

            // 执行本地 0.8ms 极速 OCR 识别
            const recognized = await CaptchaOCR.recognize(blob);
            if (captchaEl) {
                captchaEl.value = recognized;
                captchaEl.placeholder = "请输入验证码";
            }
            return recognized;
        } catch (e) {
            console.error("[LoginView] Failed to refresh or recognize captcha blob:", e);
            if (captchaImg) captchaImg.style.opacity = "1";
            if (captchaEl) captchaEl.placeholder = "请输入验证码";
            return "";
        }
    }

    /**
     * 刷新并加载验证码图片二进制 Blob（兼容旧接口调用）。
     */
    static async refreshCaptchaImg(): Promise<void> {
        await this.refreshCaptchaAndAutoFill();
    }

    /**
     * 处理登录表单提交事件，包含前端凭据加密、最多 3 次验证码自动重试与状态校验。
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
        const remember = rememberEl?.checked || false;

        if (!user || !pass) {
            if (msgDiv) msgDiv.innerText = "请输入完整的学号与密码！";
            return;
        }

        showLoading(true, "正在安全登录并同步数据...");
        if (msgDiv) msgDiv.innerText = "";

        const key1 = encodeInp(user);
        const key2 = encodeInp(pass);
        const encoded = `${key1}%%%${key2}`;

        for (let attempt = 1; attempt <= this.MAX_LOGIN_RETRIES; attempt++) {
            try {
                let currentCaptcha = captchaEl?.value.trim() || "";

                // 若验证码输入框为空，则自动执行一次极速 OCR 填入
                if (!currentCaptcha) {
                    currentCaptcha = await this.refreshCaptchaAndAutoFill();
                }

                if (attempt > 1) {
                    showLoading(true, `验证码重试中 (${attempt}/${this.MAX_LOGIN_RETRIES})...`);
                }

                const loginHtml = await YnufeClient.postForm("/jsxsd/xk/LoginToXkLdap", {
                    userAccount: user,
                    userPassword: "",
                    RANDOMCODE: currentCaptcha,
                    encoded
                });

                // 1. 账号密码错误（直接熔断，不重试）
                if (loginHtml.includes("用户名或密码错误") || loginHtml.includes("账号或密码不正确") || loginHtml.includes("密码错误")) {
                    showLoading(false);
                    if (msgDiv) msgDiv.innerText = "学号或密码有误，请仔细核对！";
                    await this.refreshCaptchaAndAutoFill();
                    return;
                }

                // 2. 验证码错误（最多自动重试 3 次）
                if (loginHtml.includes("验证码错误") || loginHtml.includes("验证码已过期")) {
                    console.warn(`[LoginView] Captcha mismatch on attempt ${attempt}/${this.MAX_LOGIN_RETRIES}.`);
                    if (attempt < this.MAX_LOGIN_RETRIES) {
                        // 换图并重新自动 OCR
                        await this.refreshCaptchaAndAutoFill();
                        continue;
                    } else {
                        // 3 次机会全部耗尽，优雅降级让用户手动输入
                        showLoading(false);
                        if (msgDiv) msgDiv.innerText = "验证码自动重试超限，请手动核对并输入验证码！";
                        if (captchaEl) {
                            captchaEl.value = "";
                            captchaEl.focus();
                        }
                        return;
                    }
                }

                // 3. 正向验证 Session 有效性
                const verified = await AutoLogin.verifySession();
                if (!verified) {
                    if (attempt < this.MAX_LOGIN_RETRIES) {
                        await this.refreshCaptchaAndAutoFill();
                        continue;
                    }
                    showLoading(false);
                    if (msgDiv) msgDiv.innerText = "登录未成功，请检查账号密码和验证码后重试！";
                    await this.refreshCaptchaAndAutoFill();
                    return;
                }

                // 登录成功：持久化凭据并同步数据
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
                    if (msgDiv) msgDiv.innerText = "同步教务网数据异常，请点击右上角重试！";
                    await this.refreshCaptchaAndAutoFill();
                }
                return;

            } catch (err) {
                console.error(`[LoginView] Login attempt ${attempt} error:`, err);
                if (attempt === this.MAX_LOGIN_RETRIES) {
                    showLoading(false);
                    if (msgDiv) msgDiv.innerText = "网络连接超时，请确认手机已连接校园网！";
                    await this.refreshCaptchaAndAutoFill();
                    return;
                }
            }
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
            YnufeSession.clearCredentials();
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
        document.getElementById("captcha-img")?.addEventListener("click", () => this.refreshCaptchaAndAutoFill());
        document.getElementById("btn-logout")?.addEventListener("click", () => this.handleLogout(onLogout));
    }
}
