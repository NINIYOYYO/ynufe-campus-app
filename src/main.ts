import './styles/app.css';
import { YnufeApp } from './core/app';
import { YnufeSession } from './stores/sessionStore';
import { SessionCookieManager } from './services/cookieManager';
import { AutoLogin } from './services/autoLogin';
import { toggleModal, updateSyncStatus, showLoading, showToast } from './utils/uiFeedback';

/**
 * 兼容类别名导出
 */
export const YnufeUI = YnufeApp;

/**
 * 应用主入口引导流程
 */
document.addEventListener("DOMContentLoaded", async () => {
    YnufeApp.init();
    await SessionCookieManager.restoreCookies();

    const savedUser = YnufeSession.getUsername();
    const savedPass = YnufeSession.getPassword();

    const userEl = document.getElementById("username") as HTMLInputElement | null;
    const passEl = document.getElementById("password") as HTMLInputElement | null;
    const rememberEl = document.getElementById("remember-me") as HTMLInputElement | null;

    if (userEl) userEl.value = savedUser;
    if (passEl) passEl.value = savedPass;
    if (rememberEl) rememberEl.checked = YnufeSession.getRememberMe();

    const hasCache = YnufeApp.loadCachedData();

    if (hasCache) {
        // 有缓存：先秒开显示旧数据，后台静默同步
        toggleModal("login-overlay", false);
        setTimeout(async () => {
            YnufeApp.isSilentSync = true;
            updateSyncStatus("syncing", "同步中...");
            const success = await YnufeApp.loadHomeBusinessData();
            if (success) {
                updateSyncStatus("online", "数据已最新");
            } else if (YnufeApp.isSessionInvalid) {
                updateSyncStatus("offline", "登录已过期 · 点击登录");
            } else {
                updateSyncStatus("offline", "未同步 · 点击刷新");
            }
            YnufeApp.isSilentSync = false;
        }, 150);
        return;
    }

    // 无缓存但有保存的凭据：先尝试全自动静默登录（持久化登录）
    if (savedUser && savedPass) {
        toggleModal("login-overlay", false);
        showLoading(true, "正在自动登录...");
        const ok = await AutoLogin.attempt();
        if (ok) {
            YnufeApp.startHeartbeat();
            const success = await YnufeApp.loadHomeBusinessData();
            showLoading(false);
            if (success) {
                updateSyncStatus("online", "数据已最新");
                showToast("已自动登录", "success");
                return;
            }
        }
        showLoading(false);
    }

    // 自动登录不可用/失败：弹出登录框
    toggleModal("login-overlay", true);
    YnufeApp.refreshCaptchaImg();
});
