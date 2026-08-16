import { YnufeSession } from '../stores/sessionStore';
import { HeartbeatService } from '../services/heartbeatService';
import { SessionCookieManager } from '../services/cookieManager';
import { WallpaperManager } from '../components/wallpaperManager';
import { AutoLogin } from '../services/autoLogin';
import { showToast, toggleModal, updateSyncStatus } from '../utils/uiFeedback';
import { LoginView } from '../views/loginView';

/**
 * AppLifecycleManager: 应用生命周期与全局系统事件管理器
 *
 * 职责：
 * 1. 监听 document.visibilitychange 前后台切换与 Web/Native Cookie 状态持久化同步。
 * 2. 监听 ynufe-session-expired 事件并调度静默自动续期队列（30s 频率限流防抖）。
 * 3. 监听 ynufe-theme-preset-applied 主题变更事件并分发至壁纸自适应调色引擎。
 */
export class AppLifecycleManager {
    private static recovering = false;
    private static lastRecoverAt = 0;
    private static onRefreshNeededCallback: (() => Promise<boolean>) | null = null;

    /**
     * 注册会话恢复成功后的业务数据同步回调。
     *
     * Args:
     *     cb (Function): 异步刷新回调。
     */
    static setRefreshHandler(cb: () => Promise<boolean>): void {
        this.onRefreshNeededCallback = cb;
    }

    /**
     * 初始化全局生命周期事件监听器。
     */
    static init(): void {
        if (YnufeSession.getHasSession()) {
            HeartbeatService.start();
        }

        document.addEventListener("visibilitychange", () => {
            if (document.hidden) {
                HeartbeatService.stop();
                SessionCookieManager.captureAndPersist().catch(() => {});
                const cap = window.Capacitor;
                if (cap?.Plugins?.CapacitorCookies?.flushCookies) {
                    cap.Plugins.CapacitorCookies.flushCookies().catch(() => {});
                }
            } else if (YnufeSession.getHasSession()) {
                HeartbeatService.start();
            }
        });

        window.addEventListener("ynufe-session-expired", () => this.handleSessionExpired());

        window.addEventListener("ynufe-theme-preset-applied", (e: Event) => {
            const customEvt = e as CustomEvent<{ mode?: string }>;
            const mode = customEvt?.detail?.mode || "dark";
            WallpaperManager.applyAdaptiveWallpaperColor(mode);
        });

        this.initBackButtonHandler();
    }

    /**
     * 注册 Android 物理/手势返回键监听：当有展开的抽屉或浮层时优先关闭，否则退回后台/退出。
     */
    private static initBackButtonHandler(): void {
        const cap = window.Capacitor;
        if (!cap?.Plugins?.App?.addListener) return;

        cap.Plugins.App.addListener('backButton', () => {
            // 1. 壁纸调整遮罩
            const wallpaperOverlay = document.getElementById("wallpaper-adjust-overlay");
            if (wallpaperOverlay && wallpaperOverlay.style.display !== "none") {
                const cancelBtn = document.getElementById("btn-cancel-wallpaper-adjust");
                if (cancelBtn) cancelBtn.click();
                else wallpaperOverlay.style.display = "none";
                return;
            }

            // 2. 详情 BottomSheet
            const sheet = document.getElementById("bottom-sheet");
            if (sheet && sheet.classList.contains("active")) {
                const closeBtn = document.getElementById("btn-close-sheet");
                if (closeBtn) closeBtn.click();
                return;
            }

            // 3. 设置抽屉
            const settingsSheet = document.getElementById("settings-sheet");
            if (settingsSheet && settingsSheet.classList.contains("active")) {
                const overlay = document.getElementById("settings-overlay");
                if (overlay) overlay.click();
                return;
            }

            // 4. 提醒抽屉
            const notifySheet = document.getElementById("notify-sheet");
            if (notifySheet && notifySheet.classList.contains("active")) {
                const overlay = document.getElementById("notify-overlay");
                if (overlay) overlay.click();
                return;
            }

            // 5. 若无可关闭的抽屉，调用原生最小化/退出
            if (cap?.Plugins?.App?.exitApp) {
                cap.Plugins.App.exitApp();
            }
        });
    }

    /**
     * 处理会话过期事件（带 30s 防抖锁与自动续期尝试）。
     */
    static handleSessionExpired(): void {
        if (this.recovering) return;
        const now = Date.now();
        if (now - this.lastRecoverAt < 30000) return;
        this.recovering = true;
        this.lastRecoverAt = now;
        HeartbeatService.stop();
        updateSyncStatus("syncing", "会话续期中...");

        AutoLogin.attempt().then(async (ok) => {
            this.recovering = false;
            if (ok) {
                HeartbeatService.start();
                showToast("登录已自动续期", "success");
                if (this.onRefreshNeededCallback) {
                    const success = await this.onRefreshNeededCallback();
                    updateSyncStatus(success ? "online" : "offline", success ? "数据已最新" : "未同步 · 点击刷新");
                }
            } else {
                updateSyncStatus("offline", "登录已过期");
                showToast("自动续期未成功，请输入验证码完成登录", "warn");
                LoginView.prefillLoginForm();
                toggleModal("login-overlay", true);
                LoginView.refreshCaptchaImg();
            }
        });
    }
}
