import './styles/app.css';
import { YnufeClient, SessionExpiredError } from './api/client';
import { YnufeSession } from './stores/sessionStore';
import { ProfileParser } from './parsers/profileParser';
import { TimetableParser } from './parsers/timetableParser';
import { TimetableView } from './views/timetableView';
import { GradeParser } from './parsers/gradeParser';
import { GradeView } from './views/gradeView';
import { ExamParser } from './parsers/examParser';
import { ExamView } from './views/examView';
import { AnnouncementParser } from './parsers/announcementParser';
import { AnnouncementView } from './views/announcementView';
import { ServiceParser } from './parsers/serviceParser';
import { ServiceView } from './views/serviceView';
import { SyncStatusTag, SyncStatusState } from './components/syncStatusTag';
import { BottomSheet } from './components/bottomSheet';
import { WallpaperManager } from './components/wallpaperManager';
import { CustomSelect } from './components/customSelect';
import { ThemeCustomizer } from './components/themeCustomizer';
import { AutoLogin } from './services/autoLogin';
import { NotificationManager } from './services/notificationManager';
import { SessionCookieManager } from './services/cookieManager';
import { AppConfig } from './config';
import { encodeInp } from './utils/crypto';
import { escapeHtml } from './utils/escapeHtml';
import { ParseError } from './utils/tableUtils';
import { UserProfile } from './types/profile';
import { CourseItem, TimetableData } from './types/timetable';
import { GradeItem, GradeSummary } from './types/grade';
import { ExamItem } from './types/exam';
import { AnnouncementItem } from './types/announcement';

/**
 * YnufeUI: App 应用业务总指挥控制引擎
 * 职责：调度网络通信、数据解析、界面渲染、Tab 路由、后台心跳保活、
 * 会话自动续期（持久化登录）、上课提醒排程与用户交互控制。
 */
export class YnufeUI {
    public static isSilentSync = false;
    private static heartbeatIntervalId: any = null;
    private static globalTimetable: CourseItem[] = [];
    private static globalGrades: GradeItem[] = [];
    private static currentTimetableData: TimetableData | null = null;
    /** 会话恢复中标记 + 冷却时间，防止自动续期风暴 */
    private static recovering = false;
    private static lastRecoverAt = 0;
    /** 首次 ""（默认学期）加载时记录的当前学期 ID，用于防止旧学期数据污染缓存 */
    private static KEY_CURRENT_SEMESTER = "ynufe_current_semester_id";
    /** 当前教学周缓存键（课表页不提供该信息，需从首页框架解析后持久化） */
    private static KEY_CURRENT_WEEK = "ynufe_current_teaching_week";
    /** 当前教学周；undefined 表示假期或未能获取 */
    private static currentTeachingWeek: number | undefined = undefined;
    /** 上一次同步是否因会话失效而失败（用于区分"网络问题"与"需要重新登录"） */
    private static sessionInvalid = false;

    /** 供模块级启动流程读取的只读视图。 */
    static get isSessionInvalid(): boolean {
        return this.sessionInvalid;
    }

    /** 各区块最近一次渲染的数据指纹，用于跳过内容未变化的重复渲染 */
    private static renderFingerprints: Record<string, string> = {};

    /**
     * 判断某区块的数据是否与上一次渲染完全相同。
     *
     * 启动时同一块内容会被渲染两次：先用本地缓存秒开，静默同步完成后再用
     * 服务器数据渲染一遍。由于渲染方式是清空 innerHTML 后重新插入节点，
     * 而入场动画绑定在元素插入上，用户就会看到骨牌动效播两遍——两次渲染
     * 间隔越接近动画时长，观感越像"抖了一下"，这也是它表现为"有概率"的原因。
     * 绝大多数情况下两次数据完全一致，直接跳过第二次渲染即可。
     *
     * Args:
     *     key (string): 区块标识。
     *     data (unknown): 本次待渲染的数据。
     *
     * Returns:
     *     boolean: true 表示与上次一致、可以跳过本次渲染。
     */
    private static isSameAsRendered(key: string, data: unknown): boolean {
        let fingerprint: string;
        try {
            fingerprint = JSON.stringify(data);
        } catch {
            return false; // 无法序列化时保守起见照常渲染
        }
        if (this.renderFingerprints[key] === fingerprint) return true;
        this.renderFingerprints[key] = fingerprint;
        return false;
    }

    /** 退出登录或切换账号时清空指纹，避免下一位用户的首次渲染被误跳过。 */
    static resetRenderFingerprints(): void {
        this.renderFingerprints = {};
    }

    /**
     * 让容器的子项播一次入场级联动效（.stagger-in，见 app.css）。
     *
     * 动效类播完即移除：display:none 切回 block 会重启 CSS 动画，类若常驻，
     * 每次切 Tab 都会重播一遍。移除时机用 animationend 去抖，而不能用固定
     * 定时器——容器可能在隐藏的 Tab 里渲染，动画要等首次显示才开始跑，
     * 定时器会在用户看到之前就把类摘掉。
     *
     * Args:
     *     container (HTMLElement | null): 刚完成子项渲染的列表容器。
     */
    private static playEntrance(container: HTMLElement | null): void {
        if (!container) return;

        // 清理上一轮渲染残留的监听与类，保证本轮从干净状态重新触发
        (container as any)._staggerCleanup?.();
        void container.offsetWidth; // 强制 reflow，使"移除后重加"对未被替换的子项也能重启动画
        container.classList.add("stagger-in");

        let timer: number | undefined;
        const cleanup = () => {
            if (timer !== undefined) window.clearTimeout(timer);
            container.removeEventListener("animationend", onEnd);
            container.classList.remove("stagger-in");
            delete (container as any)._staggerCleanup;
        };
        const onEnd = () => {
            // 每个子项结束都会触发一次，等 150ms 内不再有新的结束事件才收尾
            if (timer !== undefined) window.clearTimeout(timer);
            timer = window.setTimeout(cleanup, 150);
        };
        (container as any)._staggerCleanup = cleanup;
        container.addEventListener("animationend", onEnd);
    }

    /**
     * 统一处理各业务模块的加载异常。
     *
     * 关键在于把三种情况区分开：会话过期（静默，由续期流程接管）、
     * 页面结构变化（ParseError，必须让用户看见，绝不能伪装成"暂无数据"）、
     * 以及普通网络异常。
     *
     * Args:
     *     moduleName (string): 出错模块的中文名，用于提示文案。
     *     e (unknown): 捕获到的异常。
     */
    private static handleLoadError(moduleName: string, e: unknown): void {
        if (e instanceof SessionExpiredError) return;

        if (e instanceof ParseError) {
            console.error(`[YnufeUI] ${moduleName} 解析失败:`, e);
            this.showToast(`${moduleName}解析异常，可能是教务系统改版`, "error");
            return;
        }
        console.error(`[YnufeUI] ${moduleName} 加载失败:`, e);
    }

    /**
     * 初始化全局业务引擎、界面事件绑定、心跳保活及各管理组件。
     */
    static init(): void {
        YnufeSession.migratePlaintextCredentials();
        SessionCookieManager.restoreCookies().catch(() => {});
        this.bindEvents();
        this.bindSubTabEvents();
        this.bindNotifyEvents();
        this.initQueryWeekOptions();
        BottomSheet.init();
        WallpaperManager.init();
        CustomSelect.enhanceAll();
        ThemeCustomizer.init();
        this.initTheme();

        if (YnufeSession.getHasSession()) {
            this.startHeartbeat();
        }

        // 页面回到前台时补一次心跳，切后台时强行刷盘内存 Cookie 并暂停心跳
        document.addEventListener("visibilitychange", () => {
            if (document.hidden) {
                this.stopHeartbeat();
                SessionCookieManager.captureAndPersist().catch(() => {});
                const cap = (window as any).Capacitor;
                if (cap?.Plugins?.CapacitorCookies?.flushCookies) {
                    cap.Plugins.CapacitorCookies.flushCookies().catch(() => {});
                }
            } else if (YnufeSession.getHasSession()) {
                this.startHeartbeat();
            }
        });

        window.addEventListener("ynufe-session-expired", () => this.onSessionExpired());

        // 预设风格主题切换后，让壁纸自适应色按新的深浅模式重算
        window.addEventListener("ynufe-theme-preset-applied", (e: any) => {
            const mode = e?.detail?.mode || "dark";
            WallpaperManager.applyAdaptiveWallpaperColor(mode);
        });
    }

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
     * 会话过期统一恢复入口：先尝试静默自动续期（持久化登录核心），
     * 实在不行才弹出登录框让用户补一个验证码。
     */
    static onSessionExpired(): void {
        if (this.recovering) return;
        const now = Date.now();
        if (now - this.lastRecoverAt < 30000) return; // 30s 冷却
        this.recovering = true;
        this.lastRecoverAt = now;
        this.stopHeartbeat();
        this.updateSyncStatus("syncing", "会话续期中...");

        AutoLogin.attempt().then(async (ok) => {
            this.recovering = false;
            if (ok) {
                this.startHeartbeat();
                this.showToast("登录已自动续期", "success");
                // 会话恢复后静默重拉数据
                const success = await this.loadHomeBusinessData();
                this.updateSyncStatus(success ? "online" : "offline", success ? "数据已最新" : "未同步 · 点击刷新");
            } else {
                this.updateSyncStatus("offline", "登录已过期");
                if (!this.isSilentSync) {
                    this.showToast("自动续期未成功，请输入验证码完成登录", "warn");
                    this.prefillLoginForm();
                    this.toggleModal("login-overlay", true);
                    this.refreshCaptchaImg();
                }
            }
        });
    }

    /**
     * 轻量级 Toast 提示（替代生硬的 alert 弹窗）。
     *
     * Args:
     *     msg (string): 提示文本。
     *     type ("success" | "warn" | "error" | "info"): 样式类型。
     */
    static showToast(msg: string, type: "success" | "warn" | "error" | "info" = "info"): void {
        let container = document.getElementById("toast-container");
        if (!container) {
            container = document.createElement("div");
            container.id = "toast-container";
            document.body.appendChild(container);
        }
        const toast = document.createElement("div");
        toast.className = `app-toast toast-${type}`;
        toast.textContent = msg;
        container.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add("show"));
        setTimeout(() => {
            toast.classList.remove("show");
            setTimeout(() => toast.remove(), 400);
        }, 3200);
    }

    /**
     * 启动后台心跳保活请求，维持教务网 Tomcat 会话活跃状态。
     */
    static startHeartbeat(): void {
        if (this.heartbeatIntervalId) {
            clearInterval(this.heartbeatIntervalId);
        }

        this.heartbeatIntervalId = setInterval(async () => {
            if (!YnufeSession.getHasSession() || document.hidden) {
                return;
            }
            try {
                await YnufeClient.getHtml("/jsxsd/framework/xsMain.jsp");
            } catch (err) {
                // SessionExpiredError 已由全局事件统一处理，这里只记录
                console.warn("[Keep-Alive] 心跳保活检测失败:", err);
            }
        }, AppConfig.HEARTBEAT_INTERVAL_MS);
    }

    /**
     * 停止后台心跳定时器。
     */
    static stopHeartbeat(): void {
        if (this.heartbeatIntervalId) {
            clearInterval(this.heartbeatIntervalId);
            this.heartbeatIntervalId = null;
        }
    }

    /**
     * 自动装填空教室查询表单中的周次下拉框 (#query-zc, 1-20周)。
     */
    private static initQueryWeekOptions(): void {
        const selectZc = document.getElementById("query-zc") as HTMLSelectElement | null;
        if (selectZc) {
            selectZc.innerHTML = "";
            for (let i = 1; i <= 20; i++) {
                const opt = document.createElement("option");
                opt.value = i.toString();
                opt.innerText = `第${i}周`;
                selectZc.appendChild(opt);
            }
        }
    }

    /**
     * 显示或隐藏模态弹窗/遮罩层。
     */
    static toggleModal(modalId: string, show: boolean): void {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = show ? "flex" : "none";
            if (show) modal.classList.add("active");
            else modal.classList.remove("active");
        }
    }

    /**
     * 更新顶部同步指示状态微标签。
     */
    static updateSyncStatus(status: SyncStatusState, text: string): void {
        SyncStatusTag.update(status, text);
    }

    /**
     * 控制全局 Loading 加载遮罩的显隐及提示文字。
     */
    static showLoading(show: boolean, msg: string = "加载中..."): void {
        const loadingOverlay = document.getElementById("loading-spinner");
        const pEl = loadingOverlay ? loadingOverlay.querySelector("p") : null;
        if (pEl) pEl.innerText = msg;
        if (loadingOverlay) {
            loadingOverlay.style.display = show ? "flex" : "none";
            if (show) loadingOverlay.classList.add("active");
            else loadingOverlay.classList.remove("active");
        }
    }

    /** 上一次验证码的 ObjectURL，刷新时释放，防止内存泄漏 */
    private static lastCaptchaUrl: string | null = null;

    /**
     * 刷新并加载验证码图片二进制 Blob。
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
            console.error("[YnufeUI] Failed to refresh captcha blob:", e);
            captchaImg.style.opacity = "1";
        }
    }

    /**
     * 从本地 LocalStorage 读取并还原离线缓存业务数据。
     *
     * Returns:
     *     boolean: 是否成功加载了有效缓存。
     */
    static loadCachedData(): boolean {
        let hasData = false;
        try {
            const cachedProfile = YnufeSession.getCache<UserProfile>("ynufe_cached_profile");
            if (cachedProfile && cachedProfile.name && cachedProfile.name !== "未登录") {
                this.renderProfile(cachedProfile);
                hasData = true;
            }

            const cachedTimetable = YnufeSession.getCache<TimetableData>("ynufe_cached_timetable_data");
            if (cachedTimetable && Array.isArray(cachedTimetable.courses) && cachedTimetable.courses.length > 0) {
                this.renderTimetableData(cachedTimetable);
                hasData = true;
            }

            const cachedGrades = YnufeSession.getCache<GradeSummary>("ynufe_cached_grades_data");
            if (cachedGrades && Array.isArray(cachedGrades.gradesList) && cachedGrades.gradesList.length > 0) {
                this.renderGradesData(cachedGrades);
                hasData = true;
            }

            const cachedExams = YnufeSession.getCache<ExamItem[]>("ynufe_cached_exams");
            if (Array.isArray(cachedExams) && cachedExams.length > 0) {
                this.renderExamsList(cachedExams);
            }

            const cachedAnnouncements = YnufeSession.getCache<AnnouncementItem[]>("ynufe_cached_announcements");
            if (Array.isArray(cachedAnnouncements) && cachedAnnouncements.length > 0) {
                this.renderAnnouncementsList(cachedAnnouncements);
            }
        } catch (e) {
            console.error("[YnufeUI] Error loading cached data:", e);
        }
        return hasData;
    }

    /**
     * 渲染个人信息与问候语区域。
     */
    private static renderProfile(profile: UserProfile): void {
        const nameEl = document.getElementById("user-name-display");
        const deptEl = document.getElementById("profile-dept");
        const majorEl = document.getElementById("profile-major");
        const classEl = document.getElementById("profile-class");
        const idEl = document.getElementById("profile-id");

        if (nameEl) nameEl.innerText = profile.name || "未登录";
        if (deptEl) deptEl.innerText = profile.dept || "-";
        if (majorEl) majorEl.innerText = profile.major || "-";
        if (classEl) classEl.innerText = profile.className || "-";
        if (idEl) idEl.innerText = profile.studentId || "-";

        const hr = new Date().getHours();
        const greetingEl = document.getElementById("time-greeting");
        if (greetingEl) greetingEl.innerText = hr < 12 ? "早上好," : (hr < 18 ? "下午好," : "晚上好,");

        const dateStrEl = document.getElementById("today-date-str");
        if (dateStrEl) dateStrEl.innerText = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
    }

    /**
     * 处理登录表单提交事件，进行前端凭据加密与身份校验。
     */
    static async handleLogin(e: Event): Promise<void> {
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

        this.showLoading(true, "正在安全登录并同步数据...");
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

            // 精确识别失败原因（不再用宽泛的 includes("错误")，避免误判）
            if (loginHtml.includes("验证码错误") || loginHtml.includes("验证码已过期")) {
                this.showLoading(false);
                if (msgDiv) msgDiv.innerText = "验证码错误或过期，请重新输入！";
                this.refreshCaptchaImg();
                return;
            }

            if (loginHtml.includes("用户名或密码错误") || loginHtml.includes("账号或密码不正确") || loginHtml.includes("密码错误")) {
                this.showLoading(false);
                if (msgDiv) msgDiv.innerText = "账号或密码有误，请核对！";
                this.refreshCaptchaImg();
                return;
            }

            // 正向验证：登录是否真正生效（比"没检测到错误关键词"可靠得多）
            const verified = await AutoLogin.verifySession();
            if (!verified) {
                this.showLoading(false);
                if (msgDiv) msgDiv.innerText = "登录未成功，请检查账号密码和验证码后重试！";
                this.refreshCaptchaImg();
                return;
            }

            YnufeSession.saveCredentials(user, pass, remember);
            YnufeSession.setHasSession(true);
            this.startHeartbeat();

            // 登录验证成功后，第一时间强制捕获并写入最新生成的 JSESSIONID 凭据
            await SessionCookieManager.captureAndPersist();
            await SessionCookieManager.restoreCookies();

            // 登录不重载页面，换账号时必须清掉上一位用户的渲染指纹
            this.resetRenderFingerprints();

            const profileLoaded = await this.loadHomeBusinessData();
            this.showLoading(false);

            if (profileLoaded) {
                this.updateSyncStatus("online", "数据已最新");
                this.toggleModal("login-overlay", false);
                this.showToast("登录成功，数据已同步", "success");
            } else {
                if (msgDiv) msgDiv.innerText = "同步教务网数据异常，请重试！";
                this.refreshCaptchaImg();
            }
        } catch (err) {
            this.showLoading(false);
            console.error("[YnufeUI] Login request error:", err);
            if (msgDiv) msgDiv.innerText = "网络超时，请确认手机已连接校园网！";
            this.refreshCaptchaImg();
        }
    }

    /**
     * 处理退出登录并清理凭据与缓存。
     */
    static handleLogout(): void {
        if (confirm("确定要退出登录并清除会话与缓存吗？")) {
            this.stopHeartbeat();
            NotificationManager.cancelAll();
            YnufeSession.clearSession();
            window.location.reload();
        }
    }

    /**
     * 切换 SPA 底部导航 Tab 视图。
     */
    static switchTab(targetTabId: string): void {
        const tabs = document.querySelectorAll(".tab-content");
        tabs.forEach(tab => tab.classList.remove("active"));

        const navs = document.querySelectorAll(".bottom-nav .nav-item");
        navs.forEach(nav => nav.classList.remove("active"));

        const targetTab = document.getElementById(targetTabId);
        if (targetTab) targetTab.classList.add("active");

        const targetNav = document.querySelector(`.bottom-nav .nav-item[data-target="${targetTabId}"]`);
        if (targetNav) targetNav.classList.add("active");
    }

    /**
     * 针对各 Tab 加载对应的业务数据。
     */
    static async loadTabBusinessData(tabId: string): Promise<void> {
        if (tabId === "tab-timetable") {
            await this.reloadTimetableFromServer("", true);
        } else if (tabId === "tab-grades") {
            await this.loadFinalGradesData(true);
        } else if (tabId === "tab-exams-xk") {
            await this.loadExamsData(true);
        }
    }

    /**
     * 拉取并解析首页全套核心业务数据。
     *
     * Returns:
     *     Promise<boolean>: 是否同步成功（个人信息为硬性成功条件；
     *     会话过期或网络失败时返回 false，且绝不会用坏数据覆盖缓存）。
     */
    static async loadHomeBusinessData(): Promise<boolean> {
        try {
            const mainHtml = await YnufeClient.getHtml("/jsxsd/framework/xsMain_new.jsp?t1=1");
            const profile = ProfileParser.parseProfile(mainHtml);

            // 解析出"未登录"说明页面结构不对/会话异常，不渲染不缓存。
            //
            // 注意：教务网在会话失效时并不总是跳登录页——实测无会话访问 xsMain_new.jsp
            // 拿到的是一个 1022 字节的「404错误」页，不含 sys/login.jsp / LoginToXkLdap
            // 等任何标记，checkSessionTimeout 无法识别。但"请求成功却解析不出学籍"
            // 本身即等价于会话无效，故在此补触发续期流程；否则用户会一直卡在旧缓存上，
            // 点刷新还只能得到"请检查网络"的误导提示。
            if (!profile.name || profile.name === "未登录") {
                console.warn("[YnufeUI] 未解析出学籍信息，判定为会话失效，触发续期流程");
                this.sessionInvalid = true;
                window.dispatchEvent(new CustomEvent("ynufe-session-expired"));
                return false;
            }

            this.sessionInvalid = false;
            this.renderProfile(profile);
            YnufeSession.setCache("ynufe_cached_profile", profile);

            // 课表页无法提供"当前教学周"，只能从首页框架取，供今日课程与上课提醒使用
            this.currentTeachingWeek = ProfileParser.parseCurrentWeek(mainHtml);
            TimetableView.currentTeachingWeek = this.currentTeachingWeek ?? null;
            if (this.currentTeachingWeek) {
                localStorage.setItem(this.KEY_CURRENT_WEEK, String(this.currentTeachingWeek));
            } else {
                localStorage.removeItem(this.KEY_CURRENT_WEEK);
            }

            const results = await Promise.all([
                this.reloadTimetableFromServer("", true),
                this.loadFinalGradesData(true),
                this.loadAnnouncementsData(),
                this.loadExamsData(true)
            ]);

            // 考试倒计时由 renderExamsList 内部统一触发，此处不再重复渲染一遍

            // 任一子模块失败不影响整体（各自保留旧缓存），但都失败时报告异常
            return results.some(r => r !== false);
        } catch (err) {
            this.handleLoadError("首页数据", err);
            return false;
        }
    }

    /**
     * 从服务器拉取指定学期或当前学期的课程表数据。
     */
    static async reloadTimetableFromServer(semesterId: string = "", silent: boolean = false): Promise<boolean> {
        return TimetableView.reloadTimetableFromServer(semesterId, silent);
    }

    /**
     * 渲染课程表核心组件 (填充下拉框、今日课表及 5x5 网格课表)。
     */
    static renderTimetableData(data: TimetableData, semesterId: string = ""): void {
        TimetableView.renderTimetableData(data, semesterId);
    }

    /**
     * 根据周次筛选条件及去重逻辑，渲染 5x5 课表网格单元格。
     */
    static reloadTimetableGrid(): void {
        TimetableView.reloadTimetableGrid();
    }

    /**
     * 渲染首页"今日课程"列表。
     */
    static renderTodayCoursesList(courses: CourseItem[]): void {
        TimetableView.renderTodayCoursesList(courses);
    }

    /**
     * 在 BottomSheet 弹窗中展示单门课程的详细信息。
     */
    static showCourseDetail(course: CourseItem): void {
        TimetableView.showCourseDetail(course);
    }

    /**
     * 拉取并解析期末成绩。
     */
    static async loadFinalGradesData(silent: boolean = false): Promise<boolean> {
        return GradeView.loadFinalGradesData(silent);
    }

    /**
     * 渲染成绩大卡、SVG 环形进度条及成绩过滤下拉框。
     */
    static renderGradesData(summary: GradeSummary): void {
        GradeView.renderGradesData(summary);
    }

    /**
     * 根据当前学期下拉框及搜索输入框过滤并渲染成绩卡片列表。
     */
    static filterGrades(): void {
        GradeView.filterGrades();
    }

    /**
     * 在抽屉中展示单门课程的完整信息与成绩构成。
     */
    static async showGradeDetail(g: GradeItem): Promise<void> {
        return GradeView.showGradeDetail(g);
    }

    /**
     * 拉取并渲染社会等级考试成绩。
     */
    static async loadLevelGradesData(silent: boolean = false): Promise<void> {
        return GradeView.loadLevelGradesData(silent);
    }

    /**
     * 拉取并渲染期末排考列表。
     */
    /**
     * 拉取并渲染期末排考列表。
     */
    static async loadExamsData(silent: boolean = false): Promise<void> {
        return ExamView.loadExamsData(silent);
    }

    /**
     * 渲染排考列表卡片。
     */
    static renderExamsList(list: ExamItem[]): void {
        ExamView.renderExamsList(list);
    }

    /**
     * 渲染首页"考试倒计时"卡片。
     */
    static renderExamCountdown(exams: ExamItem[]): void {
        ExamView.renderExamCountdown(exams);
    }

    /**
     * 拉取并渲染随堂考试数据。
     */
    static async loadClassroomTestsData(silent: boolean = false): Promise<void> {
        return ExamView.loadClassroomTestsData(silent);
    }



    /**
     * 拉取并渲染教务网最新公告通知。
     *
     * Returns:
     *     Promise<boolean>: 是否成功。
     */
    /**
     * 拉取最新公告列表并渲染。
     */
    static async loadAnnouncementsData(): Promise<boolean> {
        return AnnouncementView.loadAnnouncementsData();
    }

    /**
     * 渲染公告通知列表前 5 条卡片。
     */
    static renderAnnouncementsList(list: AnnouncementItem[]): void {
        AnnouncementView.renderAnnouncementsList(list);
    }

    /**
     * 在 BottomSheet 中弹窗展示公告详情。
     */
    static async showAnnouncementDetail(ann: AnnouncementItem): Promise<void> {
        return AnnouncementView.showAnnouncementDetail(ann);
    }

    /**
     * 下载公告附件。
     */
    static async downloadAttachment(url: string, name: string): Promise<void> {
        return AnnouncementView.downloadAttachment(url, name);
    }

    /**
     * 拉取并渲染选课中心活动。
     */
    static async loadXkCenterData(silent: boolean = false): Promise<void> {
        return ServiceView.loadXkCenterData(silent);
    }

    /**
     * 拉取并更新毕业设计与实习信息。
     */
    static async loadPracticeThesisData(silent: boolean = false): Promise<void> {
        return ServiceView.loadPracticeThesisData(silent);
    }

    /**
     * 处理空教室查询表单提交。
     */
    static async handleClassroomQuery(e: Event): Promise<void> {
        return ServiceView.handleClassroomQuery(e);
    }

    /**
     * 打开或关闭壁纸与个性化设置抽屉 (ID: settings-sheet)。
     */
    static toggleSettingsSheet(show: boolean): void {
        this.toggleSheetById("settings-sheet", "settings-overlay", show);
    }

    /**
     * 打开或关闭上课提醒设置抽屉 (ID: notify-sheet)。
     */
    static toggleNotifySheet(show: boolean): void {
        this.toggleSheetById("notify-sheet", "notify-overlay", show);
        if (show) this.refreshNotifyStatusText();
    }

    /**
     * 通用底部抽屉显隐控制。
     */
    private static toggleSheetById(sheetId: string, overlayId: string, show: boolean): void {
        const sheet = document.getElementById(sheetId);
        const overlay = document.getElementById(overlayId);

        if (sheet) {
            if (show) {
                sheet.style.transform = "translateY(0)";
                sheet.style.display = "flex";
                sheet.classList.add("active");
            } else {
                sheet.style.transform = "translateY(100%)";
                sheet.classList.remove("active");
                setTimeout(() => { sheet.style.display = "none"; }, 300);
            }
        }
        if (overlay) {
            if (show) {
                overlay.style.display = "block";
                overlay.classList.add("active");
            } else {
                overlay.classList.remove("active");
                setTimeout(() => { overlay.style.display = "none"; }, 300);
            }
        }
    }

    /**
     * 初始化主题模式 (深色/浅色) 及按钮高亮。
     */
    private static initTheme(): void {
        const savedTheme = localStorage.getItem("ynufe_theme") || "dark";
        this.setThemeMode(savedTheme as "dark" | "light");
    }

    /**
     * 设置并持久化主题模式。
     */
    private static setThemeMode(mode: "dark" | "light"): void {
        const body = document.body;
        if (mode === "light") {
            body.classList.remove("theme-dark");
            body.classList.add("theme-light");
        } else {
            body.classList.remove("theme-light");
            body.classList.add("theme-dark");
        }
        localStorage.setItem("ynufe_theme", mode);
        // 风格预设把背景以内联 !important 写在 body 上，仅换 class 不会清掉它。
        // 例如「云瓷白」定死白底，切到暗色后文字转为近白色，就会白底白字。
        ThemeCustomizer.dropConflictingColors(mode);
        WallpaperManager.applyAdaptiveWallpaperColor(mode);

        const btns = document.querySelectorAll(".theme-btn");
        btns.forEach(btn => {
            if (btn.getAttribute("data-theme") === mode) btn.classList.add("active");
            else btn.classList.remove("active");
        });
    }

    /**
     * 刷新提醒设置面板中的状态说明文字。
     */
    private static async refreshNotifyStatusText(): Promise<void> {
        const statusEl = document.getElementById("notify-status-text");
        if (!statusEl) return;
        if (!NotificationManager.isEnabled()) {
            statusEl.innerText = "上课提醒未开启";
            return;
        }
        const pendingText = await NotificationManager.getNextPendingText();
        statusEl.innerText = pendingText || `已开启，将提前 ${NotificationManager.getLeadMinutes()} 分钟提醒`;
    }

    /**
     * 绑定上课提醒设置面板的事件。
     */
    private static bindNotifyEvents(): void {
        // 铃铛入口
        const btnNotify = document.getElementById("btn-notify");
        if (btnNotify) {
            btnNotify.addEventListener("click", () => this.toggleNotifySheet(true));
        }
        const notifyOverlay = document.getElementById("notify-overlay");
        if (notifyOverlay) {
            notifyOverlay.addEventListener("click", () => this.toggleNotifySheet(false));
        }

        // 初始化控件状态
        const toggle = document.getElementById("notify-enabled-toggle") as HTMLInputElement | null;
        const leadSelect = document.getElementById("select-notify-lead") as HTMLSelectElement | null;
        if (toggle) toggle.checked = NotificationManager.isEnabled();
        if (leadSelect) leadSelect.value = String(NotificationManager.getLeadMinutes());

        // 开关切换
        if (toggle) {
            toggle.addEventListener("change", async () => {
                const wantEnabled = toggle.checked;
                const ok = await NotificationManager.setEnabled(wantEnabled);
                if (wantEnabled && !ok) {
                    toggle.checked = false;
                    this.showToast("未获得系统通知权限，请在手机设置中允许通知", "warn");
                    this.refreshNotifyStatusText();
                    return;
                }
                if (wantEnabled) {
                    const data = this.currentTimetableData || YnufeSession.getCache<TimetableData>("ynufe_cached_timetable_data");
                    const count = await NotificationManager.rescheduleFromTimetable(data);
                    if (count === -1) {
                        this.showToast("当前不在教学周内（或未获取到教学周），暂无法排程提醒", "warn");
                    } else if (count === 0) {
                        this.showToast("提醒已开启，未来两周暂无待提醒课程", "info");
                    } else {
                        this.showToast(`提醒已开启，已排 ${count} 条上课提醒`, "success");
                    }
                } else {
                    this.showToast("上课提醒已关闭", "info");
                }
                this.refreshNotifyStatusText();
            });
        }

        // 提前分钟数切换
        if (leadSelect) {
            leadSelect.addEventListener("change", async () => {
                const minutes = parseInt(leadSelect.value, 10) || 15;
                NotificationManager.setLeadMinutes(minutes);
                if (NotificationManager.isEnabled()) {
                    const data = this.currentTimetableData || YnufeSession.getCache<TimetableData>("ynufe_cached_timetable_data");
                    const count = await NotificationManager.rescheduleFromTimetable(data);
                    if (count > 0) {
                        this.showToast(`已改为提前 ${minutes} 分钟提醒（${count} 条已重排）`, "success");
                    }
                }
                this.refreshNotifyStatusText();
            });
        }
    }

    /**
     * 绑定子 Tab 切换页签。
     */
    private static bindSubTabEvents(): void {
        const subTabBtns = document.querySelectorAll(".sub-tab-item");
        subTabBtns.forEach(btn => {
            btn.addEventListener("click", () => {
                const parentBar = btn.closest(".sub-tab-bar") || btn.parentElement;
                if (parentBar) {
                    parentBar.querySelectorAll(".sub-tab-item").forEach(b => b.classList.remove("active"));
                }
                btn.classList.add("active");

                const targetSubId = btn.getAttribute("data-sub");
                if (targetSubId) {
                    const parentSection = btn.closest("section");
                    if (parentSection) {
                        parentSection.querySelectorAll(".sub-tab-content").forEach(c => c.classList.remove("active"));
                    }
                    const targetSubContent = document.getElementById(targetSubId);
                    if (targetSubContent) targetSubContent.classList.add("active");

                    if (targetSubId === "sub-grades-level") {
                        this.loadLevelGradesData();
                    } else if (targetSubId === "sub-exams-class") {
                        this.loadClassroomTestsData();
                    } else if (targetSubId === "sub-xk-center") {
                        this.loadXkCenterData();
                    } else if (targetSubId === "sub-practice-thesis") {
                        this.loadPracticeThesisData();
                    }
                }
            });
        });
    }

    /**
     * 全局 DOM 事件处理函数与筛选联动绑定。
     */
    private static bindEvents(): void {
        document.getElementById("login-form")?.addEventListener("submit", (e) => this.handleLogin(e));
        document.getElementById("captcha-img")?.addEventListener("click", () => this.refreshCaptchaImg());
        document.getElementById("btn-logout")?.addEventListener("click", () => this.handleLogout());

        const syncTag = document.getElementById("sync-status-tag");
        if (syncTag) {
            syncTag.addEventListener("click", async () => {
                this.updateSyncStatus("syncing", "刷新中...");
                const success = await this.loadHomeBusinessData();
                if (success) {
                    this.updateSyncStatus("online", "数据已最新");
                } else if (this.sessionInvalid) {
                    // 会话已失效：直接给出登录入口，而不是反复提示"检查网络"。
                    // 启动时若命中缓存分支，登录框是被跳过的，这里是用户唯一的重新登录途径。
                    this.updateSyncStatus("offline", "登录已过期 · 点击登录");
                    this.toggleModal("login-overlay", true);
                    this.refreshCaptchaImg();
                } else {
                    this.updateSyncStatus("offline", "未同步 · 点击刷新");
                    // 失败时若非会话问题（会话问题由 onSessionExpired 处理），提示网络
                    if (!this.recovering) {
                        this.showToast("同步失败，请检查网络后重试", "warn");
                    }
                }
            });
        }

        // 底部 5 大 Tab 路由切换
        const navItems = document.querySelectorAll(".bottom-nav .nav-item");
        navItems.forEach(item => {
            item.addEventListener("click", () => {
                const targetTab = item.getAttribute("data-target");
                if (targetTab) {
                    this.switchTab(targetTab);
                    this.loadTabBusinessData(targetTab);
                }
            });
        });

        // 课表学期下拉框绑定 (正确 ID: select-semester)
        const selectSemester = document.getElementById("select-semester");
        if (selectSemester) {
            selectSemester.addEventListener("change", (e) => {
                const val = (e.target as HTMLSelectElement).value;
                this.reloadTimetableFromServer(val);
            });
        }

        // 课表周次下拉框绑定 (正确 ID: select-week)
        const selectWeek = document.getElementById("select-week");
        if (selectWeek) {
            selectWeek.addEventListener("change", () => {
                this.reloadTimetableGrid();
                this.renderTodayCoursesList(TimetableView.globalTimetable);
            });
        }

        // 成绩筛选与搜索联动
        const selectGradeSem = document.getElementById("select-grade-semester");
        const inputGradeSearch = document.getElementById("input-grade-search");
        if (selectGradeSem) selectGradeSem.addEventListener("change", () => this.filterGrades());
        if (inputGradeSearch) inputGradeSearch.addEventListener("input", () => this.filterGrades());

        // 考试安排筛选
        const selectExamSem = document.getElementById("select-exam-semester");
        const selectExamType = document.getElementById("select-exam-type");
        if (selectExamSem) selectExamSem.addEventListener("change", () => this.loadExamsData());
        if (selectExamType) selectExamType.addEventListener("change", () => this.loadExamsData());

        // 空教室查询表单
        const classroomForm = document.getElementById("classroom-query-form");
        if (classroomForm) classroomForm.addEventListener("submit", (e) => this.handleClassroomQuery(e));

        // 设置抽屉打开与关闭
        const btnSettings = document.getElementById("btn-settings");
        if (btnSettings) {
            btnSettings.addEventListener("click", () => this.toggleSettingsSheet(true));
        }

        const settingsOverlay = document.getElementById("settings-overlay");
        if (settingsOverlay) {
            settingsOverlay.addEventListener("click", () => this.toggleSettingsSheet(false));
        }

        // 主题切换按钮
        document.querySelectorAll(".theme-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                const themeName = btn.getAttribute("data-theme") as "dark" | "light" || "dark";
                this.setThemeMode(themeName);
            });
        });
    }
}

// 自动入口初始化
document.addEventListener("DOMContentLoaded", async () => {
    YnufeUI.init();
    await SessionCookieManager.restoreCookies();

    const savedUser = YnufeSession.getUsername();
    const savedPass = YnufeSession.getPassword();

    const userEl = document.getElementById("username") as HTMLInputElement | null;
    const passEl = document.getElementById("password") as HTMLInputElement | null;
    const rememberEl = document.getElementById("remember-me") as HTMLInputElement | null;

    if (userEl) userEl.value = savedUser;
    if (passEl) passEl.value = savedPass;
    if (rememberEl) rememberEl.checked = YnufeSession.getRememberMe();

    const hasCache = YnufeUI.loadCachedData();

    if (hasCache) {
        // 有缓存：先秒开显示旧数据，后台静默同步
        YnufeUI.toggleModal("login-overlay", false);
        setTimeout(async () => {
            YnufeUI.isSilentSync = true;
            YnufeUI.updateSyncStatus("syncing", "同步中...");
            const success = await YnufeUI.loadHomeBusinessData();
            if (success) {
                YnufeUI.updateSyncStatus("online", "数据已最新");
            } else if (YnufeUI.isSessionInvalid) {
                // 缓存分支下登录框是被跳过的，必须让状态标签明确指向"重新登录"，
                // 否则用户只会看到旧数据配一个"点击刷新"，怎么点都好不了
                YnufeUI.updateSyncStatus("offline", "登录已过期 · 点击登录");
            } else {
                YnufeUI.updateSyncStatus("offline", "未同步 · 点击刷新");
            }
            YnufeUI.isSilentSync = false;
        }, 150);
        return;
    }

    // 无缓存但有保存的凭据：先尝试全自动静默登录（持久化登录），成功则完全跳过登录框
    if (savedUser && savedPass) {
        YnufeUI.toggleModal("login-overlay", false);
        YnufeUI.showLoading(true, "正在自动登录...");
        const ok = await AutoLogin.attempt();
        if (ok) {
            YnufeUI.startHeartbeat();
            const success = await YnufeUI.loadHomeBusinessData();
            YnufeUI.showLoading(false);
            if (success) {
                YnufeUI.updateSyncStatus("online", "数据已最新");
                YnufeUI.showToast("已自动登录", "success");
                return;
            }
        }
        YnufeUI.showLoading(false);
    }

    // 自动登录不可用/失败：弹出登录框（凭据已预填，只需输验证码）
    YnufeUI.toggleModal("login-overlay", true);
    YnufeUI.refreshCaptchaImg();
});
