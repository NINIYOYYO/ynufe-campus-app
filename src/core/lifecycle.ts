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
    private static recoveryPromise: Promise<boolean> | null = null;
    private static lastRecoverAt = 0;
    private static onRefreshNeededCallback: (() => Promise<boolean>) | null = null;
    private static initialized = false;

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
     * 初始化全局生命周期事件监听器（具备防重入幂等保护）。
     */
    static init(): void {
        if (this.initialized) {
            return;
        }
        this.initialized = true;

        if (YnufeSession.getHasSession()) {
            HeartbeatService.start();
        }

        document.addEventListener("visibilitychange", () => {
            if (document.hidden) {
                HeartbeatService.stop();
                SessionCookieManager.captureAndPersist().catch(() => {});
            } else if (YnufeSession.getHasSession() || (YnufeSession.getUsername() && YnufeSession.getPassword())) {
                if (YnufeSession.getHasSession() && !this.recoveryPromise && !AutoLogin.isRunning && !LoginView.isAuthenticating) {
                    // 即使这次会话探测被 30 秒限流，也要恢复后台暂停的心跳。
                    HeartbeatService.start();
                }
                // 回到前台立即验证/恢复，而不是等下一次心跳才发现会话已过期。
                this.handleSessionExpired();
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
     * 重置生命周期管理器初始化状态（主要用于单元测试）。
     */
    static resetForTesting(): void {
        this.initialized = false;
        this.recoveryPromise = null;
        this.lastRecoverAt = 0;
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
        // 认证探测本身也可能返回登录页，不能据此启动另一轮认证。
        if (this.recoveryPromise || AutoLogin.isRunning || LoginView.isAuthenticating) return;
        const now = Date.now();
        if (this.lastRecoverAt && now - this.lastRecoverAt < 30000) return;
        void this.recoverSession();
    }

    /** 启动、前台恢复与显式重试共用同一个恢复任务，成功后只同步一次数据。 */
    static recoverSession(): Promise<boolean> {
        if (this.recoveryPromise) return this.recoveryPromise;
        this.lastRecoverAt = Date.now();
        HeartbeatService.stop();
        updateSyncStatus("syncing", "会话续期中...");
        toggleModal("login-overlay", false);
        this.recoveryPromise = Promise.resolve().then(() => this.performRecovery()).finally(() => {
            this.recoveryPromise = null;
        });
        return this.recoveryPromise;
    }

    private static async performRecovery(): Promise<boolean> {
        let authenticated = false;
        try {
            // 上轮失败后的登录表单可能仍在预填验证码，先结束它再轮换会话。
            await LoginView.waitForPendingCaptcha();
            authenticated = await AutoLogin.attempt();
        } catch (err) {
            console.warn("[AppLifecycle] Automatic login failed:", err);
        }
        if (!authenticated) {
            YnufeSession.setHasSession(false);
            updateSyncStatus("offline", "自动登录未成功 · 点击重试");
            showToast("自动登录未成功，请检查网络或手动登录", "warn");
            LoginView.prefillLoginForm();
            toggleModal("login-overlay", true);
            return false;
        }

        toggleModal("login-overlay", false);
        HeartbeatService.start();
        let refreshed = true;
        try {
            if (this.onRefreshNeededCallback) refreshed = await this.onRefreshNeededCallback();
        } catch (err) {
            console.warn("[AppLifecycle] Session restored but data refresh failed:", err);
            refreshed = false;
        }
        // 数据同步失败不等于登录失败，保留缓存与已经恢复的会话。
        updateSyncStatus(refreshed ? "online" : "offline", refreshed ? "数据已最新" : "未同步 · 点击刷新");
        return true;
    }
}
