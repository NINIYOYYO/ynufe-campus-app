import './styles/app.css';
import { YnufeApp } from './core/app';
import { YnufeSession } from './stores/sessionStore';
import { SessionCookieManager } from './services/cookieManager';
import { AppLifecycleManager } from './core/lifecycle';
import { LoginView } from './views/loginView';
import { toggleModal, updateSyncStatus, showLoading } from './utils/uiFeedback';

/**
 * 兼容类别名导出
 */
export const YnufeUI = YnufeApp;

/**
 * 应用主入口引导流程
 */
export async function bootstrapApp(): Promise<void> {
    // 在验证已保存的会话前不展示登录表单，避免重启时闪出登录页。
    toggleModal("login-overlay", false);
    YnufeApp.init();

    const savedUser = YnufeSession.getUsername();
    const savedPass = YnufeSession.getPassword();

    const userEl = document.getElementById("username") as HTMLInputElement | null;
    const rememberEl = document.getElementById("remember-me") as HTMLInputElement | null;

    if (userEl) userEl.value = savedUser;
    if (rememberEl) rememberEl.checked = YnufeSession.getRememberMe();

    const hasCache = YnufeApp.loadCachedData();
    const hasSessionCookie = !!SessionCookieManager.getSavedJsessionId();
    if (!hasSessionCookie && !(savedUser && savedPass)) {
        updateSyncStatus("offline", hasCache ? "登录已过期 · 点击登录" : "请先登录");
        toggleModal("login-overlay", true);
        LoginView.prefillLoginForm();
        return;
    }

    // 缓存只决定是否显示加载遮罩；所有启动路径都等待同一次自动恢复。
    // 网络层会在验证请求前恢复 Cookie，过期时再用保存的密码续期。
    YnufeApp.isSilentSync = hasCache;
    if (!hasCache) showLoading(true, "正在自动登录...");
    try {
        await AppLifecycleManager.recoverSession();
    } finally {
        showLoading(false);
        YnufeApp.isSilentSync = false;
    }
}

document.addEventListener("DOMContentLoaded", () => {
    void bootstrapApp();
});
