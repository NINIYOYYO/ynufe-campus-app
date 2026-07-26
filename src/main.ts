import { YnufeClient, SessionExpiredError } from './api/client';
import { YnufeSession } from './stores/sessionStore';
import { ProfileParser } from './parsers/profileParser';
import { TimetableParser } from './parsers/timetableParser';
import { GradeParser } from './parsers/gradeParser';
import { ExamParser } from './parsers/examParser';
import { AnnouncementParser } from './parsers/announcementParser';
import { ServiceParser } from './parsers/serviceParser';
import { SyncStatusTag, SyncStatusState } from './components/syncStatusTag';
import { BottomSheet } from './components/bottomSheet';
import { WallpaperManager } from './components/wallpaperManager';
import { CustomSelect } from './components/customSelect';
import { ThemeCustomizer } from './components/themeCustomizer';
import { AutoLogin } from './services/autoLogin';
import { NotificationManager } from './services/notificationManager';
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

        // 页面回到前台时补一次心跳，后台时暂停（省电 + 避免被系统冻结的无效请求）
        document.addEventListener("visibilitychange", () => {
            if (document.hidden) {
                this.stopHeartbeat();
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
     *
     * Args:
     *     semesterId (string, optional): 学期 ID，空串表示服务器默认（当前）学期。
     *     silent (boolean, optional): 是否静默刷新。
     *
     * Returns:
     *     Promise<boolean>: 是否成功。
     */
    static async reloadTimetableFromServer(semesterId: string = "", silent: boolean = false): Promise<boolean> {
        if (!silent) this.showLoading(true, "正在同步课程表...");
        try {
            const endpoint = semesterId ? `/jsxsd/xskb/xskb_list.do?xnxq01id=${encodeURIComponent(semesterId)}` : "/jsxsd/xskb/xskb_list.do";
            const html = await YnufeClient.getHtml(endpoint);
            const data = TimetableParser.parseTimetable(html);

            // 课表页周次下拉默认为"(全部)"，解析不出当前周，用首页框架取到的教学周补齐
            if (data && !data.currentWeek) {
                const fallbackWeek = this.currentTeachingWeek
                    ?? (parseInt(localStorage.getItem(this.KEY_CURRENT_WEEK) || "", 10) || undefined);
                if (fallbackWeek && !isNaN(fallbackWeek)) {
                    data.currentWeek = fallbackWeek;
                }
            }

            if (data) {
                this.renderTimetableData(data, semesterId);

                // 只有"当前学期"的数据才允许写缓存，防止翻看旧学期后污染首页
                const currentSemId = semesterId === ""
                    ? data.currentSemesterId
                    : (localStorage.getItem(this.KEY_CURRENT_SEMESTER) || "");
                if (semesterId === "" && data.currentSemesterId) {
                    localStorage.setItem(this.KEY_CURRENT_SEMESTER, data.currentSemesterId);
                }
                const isCurrentSemester = semesterId === "" || (currentSemId !== "" && semesterId === currentSemId);
                if (isCurrentSemester && data.courses.length >= 0) {
                    YnufeSession.setCache("ynufe_cached_timetable_data", data);
                    // 课表更新后重排上课提醒
                    NotificationManager.rescheduleFromTimetable(data).catch(() => {});
                }
                return true;
            }
            return false;
        } catch (err) {
            this.handleLoadError("课表", err);
            return false;
        } finally {
            if (!silent) this.showLoading(false);
        }
    }

    /**
     * 渲染课程表核心组件 (填充下拉框、今日课表及 5x5 网格课表)。
     */
    static renderTimetableData(data: TimetableData, semesterId: string = ""): void {
        if (!data) return;
        this.currentTimetableData = data;
        this.globalTimetable = data.courses || [];

        // 填充学期下拉列表 (正确 ID: select-semester)
        if (!semesterId) {
            const semSelect = document.getElementById("select-semester") as HTMLSelectElement | null;
            if (semSelect && Array.isArray(data.semesters) && data.semesters.length > 0) {
                semSelect.innerHTML = "";
                data.semesters.forEach(s => {
                    const opt = document.createElement("option");
                    opt.value = s.value;
                    opt.innerText = s.text;
                    if (s.selected || s.value === data.currentSemesterId) opt.selected = true;
                    semSelect.appendChild(opt);
                });
            }
        }

        // 填充筛选周次下拉列表
        const weekSelect = document.getElementById("select-week") as HTMLSelectElement | null;
        if (weekSelect && Array.isArray(data.weeks)) {
            weekSelect.innerHTML = '<option value="">全部周</option>';
            data.weeks.forEach(wk => {
                const opt = document.createElement("option");
                opt.value = wk.val;
                opt.innerText = wk.txt;
                if (data.currentWeek && String(data.currentWeek) === wk.val) {
                    opt.selected = true;
                }
                weekSelect.appendChild(opt);
            });
        }

        // 更新首页教学周徽章
        const weekBadge = document.getElementById("home-week-badge");
        if (weekBadge) {
            if (data.currentWeek) {
                weekBadge.innerText = `第 ${data.currentWeek} 教学周`;
                weekBadge.style.display = "inline-block";
            } else {
                weekBadge.style.display = "none";
            }
        }

        // 渲染首页今日课程卡片
        this.renderTodayCoursesList(this.globalTimetable);

        // 渲染完整课表网格
        this.reloadTimetableGrid();

        // 自动增强全页面 Select 下拉控件
        CustomSelect.enhanceAll();
    }

    /**
     * 根据周次筛选条件及去重逻辑，渲染 5x5 课表网格单元格。
     */
    static reloadTimetableGrid(): void {
        const weekSelect = document.getElementById("select-week") as HTMLSelectElement | null;
        const weekVal = weekSelect ? weekSelect.value : "";

        // 1. 清空原槽位
        const slots = document.querySelectorAll(".grid-course-slot");
        slots.forEach(slot => slot.innerHTML = "");

        // 2. 根据周次过滤
        let filtered = this.globalTimetable;
        if (weekVal) {
            const wkNum = parseInt(weekVal, 10);
            filtered = this.globalTimetable.filter(c => c.activeWeeks && c.activeWeeks.includes(wkNum));
        }

        // 3. 槽位内去重：同一 (day, session) 内课程名称和教室一致时只保留 1 张卡片
        const seen = new Set<string>();
        const uniqueCourses: CourseItem[] = [];

        filtered.forEach(c => {
            const session = c.session || Math.ceil(c.slot / 2);
            const key = `${c.day}-${session}-${c.name}-${c.room}`;
            if (!seen.has(key)) {
                seen.add(key);
                uniqueCourses.push(c);
            }
        });

        // 4. 渲染去重后的美化卡片
        const colorOptions = ["blue", "pink", "cyan", "purple"];
        uniqueCourses.forEach(c => {
            const session = c.session || Math.ceil(c.slot / 2);
            const slotEl = document.querySelector(`.grid-course-slot[data-day="${c.day}"][data-session="${session}"]`);
            if (slotEl) {
                let hash = 0;
                for (let i = 0; i < c.name.length; i++) {
                    hash = c.name.charCodeAt(i) + ((hash << 5) - hash);
                }
                const assignedColor = colorOptions[Math.abs(hash) % colorOptions.length];

                const card = document.createElement("div");
                card.className = `grid-course-card ${assignedColor}`;
                card.innerHTML = `
                    <div class="grid-course-name">${escapeHtml(c.name)}</div>
                    <div class="grid-course-room">${escapeHtml(c.room)}</div>
                `;
                card.addEventListener("click", (e) => {
                    e.stopPropagation();
                    this.showCourseDetail(c);
                });
                slotEl.appendChild(card);
            }
        });
    }

    /**
     * 渲染首页"今日课程"列表。
     * 按当前教学周过滤；同一门课同一天上多个大节时，每个大节独立成卡
     * （修复旧版按课程名去重导致下午/晚上的课被吞掉的问题）。
     */
    private static renderTodayCoursesList(courses: CourseItem[]): void {
        const container = document.getElementById("today-courses-list");
        if (!container) return;
        container.innerHTML = "";

        const jsDay = new Date().getDay();
        const currentDay = jsDay === 0 ? 7 : jsDay;

        // 1. 确定当前生效教学周
        const weekSelect = document.getElementById("select-week") as HTMLSelectElement | null;
        let selectedWeek: number | null = weekSelect && weekSelect.value ? parseInt(weekSelect.value, 10) : null;
        if ((selectedWeek === null || isNaN(selectedWeek)) && this.currentTimetableData?.currentWeek) {
            selectedWeek = this.currentTimetableData.currentWeek;
        }

        // 2. 按星期及有效周次精确过滤
        const todayCourses = courses.filter(c => {
            if (c.day !== currentDay) return false;
            if (selectedWeek !== null && !isNaN(selectedWeek)) {
                if (Array.isArray(c.activeWeeks) && c.activeWeeks.length > 0) {
                    return c.activeWeeks.includes(selectedWeek);
                }
                return false;
            }
            return false;
        }).sort((a, b) => a.slot - b.slot);

        // 3. 去重仅针对"完全相同的大节"（同名同教室同一大节的多周次重复条目），
        //    不同大节的同一门课全部保留展示
        const seenSlots = new Set<string>();
        const dedupedCourses: CourseItem[] = [];
        todayCourses.forEach(c => {
            const session = c.session || Math.ceil(c.slot / 2);
            const slotKey = `${session}-${c.name}-${c.room}`;
            if (!seenSlots.has(slotKey)) {
                seenSlots.add(slotKey);
                dedupedCourses.push(c);
            }
        });

        if (dedupedCourses.length === 0) {
            // 教学周未知时，"今天没有课"是误导性的（很可能只是处于假期或未同步）
            const weekUnknown = selectedWeek === null || isNaN(selectedWeek);
            const tip = weekUnknown
                ? "当前不在教学周内，或尚未获取到教学周信息"
                : "今天没有课，享受你的空闲时间吧";
            container.innerHTML = `
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1"></path><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"></path><line x1="6" y1="2" x2="6" y2="4"></line><line x1="10" y1="2" x2="10" y2="4"></line><line x1="14" y1="2" x2="14" y2="4"></line></svg>
                    <p>${tip}</p>
                </div>`;
            return;
        }

        dedupedCourses.forEach(c => {
            const sessionIdx = (c.session || Math.ceil(c.slot / 2)) - 1;
            const timeCfg = AppConfig.SESSION_TIMES[sessionIdx];
            const card = document.createElement("div");
            card.className = "course-card-mini glass-card";
            card.innerHTML = `
                <div class="mini-left">
                    <div class="mini-name">${escapeHtml(c.name)}</div>
                    <div class="mini-meta">
                        <span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>${escapeHtml(c.teacher)}</span>
                        <span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect></svg>${escapeHtml(c.weeks)}</span>
                    </div>
                </div>
                <div class="mini-right">
                    <div class="time-badge">${timeCfg ? timeCfg.label : escapeHtml('第' + c.slot + '节')}</div>
                    <div class="room-badge">${escapeHtml(c.room)}</div>
                </div>
            `;
            card.addEventListener("click", () => this.showCourseDetail(c));
            container.appendChild(card);
        });
    }

    /**
     * 在 BottomSheet 弹窗中展示单门课程的详细信息。
     */
    static showCourseDetail(course: CourseItem): void {
        const sessionIdx = (course.session || Math.ceil(course.slot / 2)) - 1;
        const timeCfg = AppConfig.SESSION_TIMES[sessionIdx];
        const sessionLabel = timeCfg
            ? `${timeCfg.label} (${sessionIdx * 2 + 1}-${sessionIdx * 2 + 2}节)`
            : `第 ${course.slot} 节`;
        const rows: Array<{ label: string; value: string; icon: string }> = [
            { label: "上课教室", value: course.room, icon: '<rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect>' },
            { label: "授课教师", value: course.teacher, icon: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle>' },
            { label: "上课周次", value: course.weeks, icon: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line>' },
            { label: "时间范围", value: sessionLabel, icon: '<circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>' },
            { label: "通知单号", value: course.code || '-', icon: '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>' },
        ];
        const content = rows.map(r => `
            <div class="detail-row" style="display:flex; align-items:center; margin-bottom:12px; gap:12px;">
                <div class="detail-icon" style="background:rgba(var(--primary-color-rgb),0.15); border-radius:10px; padding:10px; color:var(--primary-color); display:flex; align-items:center; justify-content:center;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${r.icon}</svg></div>
                <div class="detail-txt-group"><small style="color:var(--text-secondary); font-size:12px; display:block;">${r.label}</small><span style="color:var(--text-primary); font-size:14px; font-weight:600;">${escapeHtml(r.value)}</span></div>
            </div>
        `).join("");
        BottomSheet.show(course.name, course.isAdjusted ? "调课" : "课程", content);
    }

    /**
     * 拉取并解析期末成绩。
     *
     * Returns:
     *     Promise<boolean>: 是否成功。
     */
    static async loadFinalGradesData(silent: boolean = false): Promise<boolean> {
        if (!silent) this.showLoading(true, "正在获取最新成绩与GPA...");
        try {
            const html = await YnufeClient.getHtml("/jsxsd/kscj/cjcx_list?xsfs=all");
            const summary = GradeParser.parseGrades(html);
            this.detectNewGrades(summary);
            this.renderGradesData(summary);
            YnufeSession.setCache("ynufe_cached_grades_data", summary);
            return true;
        } catch (e) {
            this.handleLoadError("成绩", e);
            return false;
        } finally {
            if (!silent) this.showLoading(false);
        }
    }

    /**
     * 成绩变动检测：对比本地已记录的"已出成绩课程集合"，发现新公布的成绩时
     * 弹出 Toast 并（若开启通知）推送本地通知。首次运行只建立基线、不打扰。
     *
     * Args:
     *     summary (GradeSummary): 最新解析出的成绩概览。
     */
    private static detectNewGrades(summary: GradeSummary): void {
        try {
            if (!summary || !Array.isArray(summary.gradesList)) return;

            const isPublished = (g: GradeItem): boolean => {
                const s = (g.score || "").trim();
                if (!s || s === "-" || s === "未出" || s === "无成绩") return false;
                return true;
            };
            const keyOf = (g: GradeItem) => `${g.semester}|${g.courseId || g.courseName}`;

            const publishedNow = summary.gradesList.filter(isPublished);
            const nowKeys = publishedNow.map(keyOf);

            const KEY = "ynufe_graded_keys";
            const prevRaw = localStorage.getItem(KEY);

            // 首次运行：仅建立基线，不提示
            if (prevRaw === null) {
                localStorage.setItem(KEY, JSON.stringify(nowKeys));
                return;
            }

            let prevKeys: string[] = [];
            try { prevKeys = JSON.parse(prevRaw) || []; } catch { prevKeys = []; }
            const prevSet = new Set(prevKeys);

            const freshly = publishedNow.filter(g => !prevSet.has(keyOf(g)));
            localStorage.setItem(KEY, JSON.stringify(nowKeys));

            if (freshly.length === 0) return;

            if (freshly.length === 1) {
                const g = freshly[0];
                this.showToast(`新成绩公布：${g.courseName} ${g.score}`, "success");
                NotificationManager.notifyGradeUpdate(`新成绩公布`, `${g.courseName}：${g.score}（绩点 ${g.gpa}）`);
            } else {
                this.showToast(`有 ${freshly.length} 门课程公布了新成绩`, "success");
                const names = freshly.slice(0, 3).map(g => g.courseName).join("、");
                NotificationManager.notifyGradeUpdate(`${freshly.length} 门新成绩公布`, names + (freshly.length > 3 ? " 等" : ""));
            }
        } catch (e) {
            console.error("[YnufeUI] detectNewGrades error:", e);
        }
    }

    /**
     * 渲染成绩大卡、SVG 环形进度条及成绩过滤下拉框。
     */
    static renderGradesData(summary: GradeSummary): void {
        if (!summary) return;
        this.globalGrades = summary.gradesList || [];

        const gpaVal = document.getElementById("gpa-val");
        const gpaProgress = document.getElementById("gpa-progress-bar");
        const creditVal = document.getElementById("credit-val");
        const creditProgress = document.getElementById("credit-progress-bar");

        const gpaNum = parseFloat(summary.gpa) || 0;
        const creditNum = parseFloat(summary.totalCredits) || 0;

        if (gpaVal) gpaVal.innerText = summary.gpa;
        if (gpaProgress) gpaProgress.setAttribute("stroke-dasharray", `${Math.min((gpaNum / 5.0) * 100, 100).toFixed(1)}, 100`);
        if (creditVal) creditVal.innerText = summary.totalCredits;
        if (creditProgress) creditProgress.setAttribute("stroke-dasharray", `${Math.min((creditNum / 150) * 100, 100).toFixed(1)}, 100`);

        // 填充学期筛选下拉框
        const selectDom = document.getElementById("select-grade-semester") as HTMLSelectElement | null;
        if (selectDom && Array.isArray(summary.semesters)) {
            selectDom.innerHTML = '<option value="">全部学期</option>';

            const selectExamSem = document.getElementById("select-exam-semester") as HTMLSelectElement | null;
            if (selectExamSem) selectExamSem.innerHTML = "";

            summary.semesters.forEach(sem => {
                const opt = document.createElement("option");
                opt.value = sem;
                opt.innerText = sem;
                selectDom.appendChild(opt);

                if (selectExamSem) {
                    const optExam = document.createElement("option");
                    optExam.value = sem;
                    optExam.innerText = sem;
                    selectExamSem.appendChild(optExam);
                }
            });
        }

        CustomSelect.enhanceAll();
        this.filterGrades();
    }

    /**
     * 根据当前学期下拉框及搜索输入框过滤并渲染成绩卡片列表。
     */
    static filterGrades(): void {
        const container = document.getElementById("grades-list");
        if (!container) return;

        const selectSem = (document.getElementById("select-grade-semester") as HTMLSelectElement | null)?.value || "";
        const searchText = (document.getElementById("input-grade-search") as HTMLInputElement | null)?.value.toLowerCase().trim() || "";

        const filtered = this.globalGrades.filter(g => {
            const matchSem = !selectSem || g.semester === selectSem;
            const matchSearch = !searchText || g.courseName.toLowerCase().includes(searchText);
            return matchSem && matchSearch;
        });

        // 指纹要连筛选条件一起算，否则切换学期/搜索时会被误判为「无变化」
        if (container.childElementCount > 0 &&
            this.isSameAsRendered("grades", { selectSem, searchText, filtered })) {
            return;
        }

        if (filtered.length === 0) {
            container.innerHTML = `<div class="empty-state"><p>未查询到匹配成绩</p></div>`;
            return;
        }

        container.innerHTML = "";
        filtered.forEach(g => {
            const scoreNum = parseFloat(g.score);
            const isFail = g.score === "不合格" || (!isNaN(scoreNum) && scoreNum < 60);

            const card = document.createElement("div");
            card.className = "grade-card glass-card";
            card.innerHTML = `
                <div class="grade-left">
                    <div class="grade-name">${escapeHtml(g.courseName)}</div>
                    <div class="grade-meta">
                        <span>学期: ${escapeHtml(g.semester)}</span>
                        <span>学分: ${escapeHtml(g.credit)}</span>
                        <span>性质: ${escapeHtml(g.category || '必修')}</span>
                    </div>
                </div>
                <div class="grade-right">
                    <div class="grade-score ${isFail ? 'fail' : ''}">${escapeHtml(g.score)}</div>
                    <div class="grade-gpa">绩点: ${escapeHtml(g.gpa)}</div>
                </div>
            `;
            container.appendChild(card);
        });
    }

    /**
     * 拉取并渲染社会等级考试成绩。
     */
    static async loadLevelGradesData(silent: boolean = false): Promise<void> {
        if (!silent) this.showLoading(true, "正在查询等级考试成绩...");
        const container = document.getElementById("level-grades-list");
        try {
            const html = await YnufeClient.getHtml("/jsxsd/kscj/djkscj_list");
            const list = GradeParser.parseLevelGrades(html);
            if (container) {
                if (list.length === 0) {
                    container.innerHTML = `<div class="empty-state"><p>暂无社会考试等级成绩记录</p></div>`;
                } else {
                    container.innerHTML = "";
                    list.forEach(item => {
                        const card = document.createElement("div");
                        card.className = "grade-card glass-card";
                        card.innerHTML = `
                            <div class="grade-left">
                                <div class="grade-name">${escapeHtml(item.name)}</div>
                                <div class="grade-meta">
                                    ${item.written && item.written !== "0" ? `<span>笔试: ${escapeHtml(item.written)}</span>` : ""}
                                    ${item.machine && item.machine !== "0" ? `<span>机试: ${escapeHtml(item.machine)}</span>` : ""}
                                    ${item.levelResult ? `<span>等级: ${escapeHtml(item.levelResult)}</span>` : ""}
                                </div>
                            </div>
                            <div class="grade-right">
                                <div class="grade-score" style="color:var(--accent-color);">${escapeHtml(item.score)}</div>
                                <div class="grade-gpa">考试日期: ${escapeHtml(item.date)}</div>
                            </div>
                        `;
                        container.appendChild(card);
                    });
                }
            }
        } catch (e) {
            this.handleLoadError("等级考试成绩", e);
        } finally {
            if (!silent) this.showLoading(false);
        }
    }

    /**
     * 拉取并渲染期末排考列表。
     */
    static async loadExamsData(silent: boolean = false): Promise<void> {
        const typeSelect = document.getElementById("select-exam-type") as HTMLSelectElement | null;
        const selectSem = (document.getElementById("select-exam-semester") as HTMLSelectElement | null)?.value || "";
        const selectType = typeSelect?.value || "3";
        // 教务网要求同时提交类别值与类别名称（xqlbmc），缺一不可
        const typeLabel = typeSelect?.selectedOptions?.[0]?.textContent?.trim()
            || { "1": "期初", "2": "期中", "3": "期末" }[selectType]
            || "";

        if (!silent) this.showLoading(true, "正在查询考试安排...");
        try {
            // 注意：xsksap_query 只是查询表单页，真正返回排考结果的是 xsksap_list
            const html = await YnufeClient.postForm("/jsxsd/xsks/xsksap_list", {
                xnxqid: selectSem,
                xqlb: selectType,
                xqlbmc: typeLabel
            });
            const list = ExamParser.parseExams(html, selectSem, typeLabel);
            this.renderExamsList(list);
            YnufeSession.setCache("ynufe_cached_exams", list);
        } catch (e) {
            this.handleLoadError("考试安排", e);
        } finally {
            if (!silent) this.showLoading(false);
        }
    }

    /**
     * 渲染排考列表卡片。
     */
    static renderExamsList(list: ExamItem[]): void {
        const container = document.getElementById("exams-term-list");
        if (!container) return;
        if (container.childElementCount > 0 && this.isSameAsRendered("exams", list)) return;
        container.innerHTML = "";

        if (!Array.isArray(list) || list.length === 0) {
            container.innerHTML = `<div class="empty-state"><p>本学期该类型考试暂无排考数据</p></div>`;
            return;
        }

        list.forEach(ex => {
            const card = document.createElement("div");
            card.className = "exam-card glass-card";
            card.innerHTML = `
                <div class="exam-title">
                    <span>${escapeHtml(ex.name || ex.courseName)}</span>
                    <span class="exam-badge">${escapeHtml(ex.type || '期末')}</span>
                </div>
                <div class="exam-info-grid">
                    <div class="info-item full-width">
                        <small>考试时间</small>
                        <span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px; vertical-align: middle;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect></svg>${escapeHtml(ex.date || ex.time)}</span>
                    </div>
                    <div class="info-item">
                        <small>考场教室</small>
                        <span class="highlight">${escapeHtml(ex.room || ex.location)}</span>
                    </div>
                    <div class="info-item">
                        <small>座位号</small>
                        <span class="highlight" style="color:var(--primary-color);">第 ${escapeHtml(ex.seatNo || ex.seat)} 号</span>
                    </div>
                </div>
            `;
            container.appendChild(card);
        });

        // 同步刷新首页倒计时并排程考试提醒
        this.renderExamCountdown(list);
        NotificationManager.rescheduleExamReminders(list).catch(() => {});
    }

    /**
     * 渲染首页"考试倒计时"卡片：按开考时间取最近的 3 场未来考试，显示剩余天数。
     *
     * Args:
     *     exams (ExamItem[]): 考试列表。
     */
    static renderExamCountdown(exams: ExamItem[]): void {
        const section = document.getElementById("exam-countdown-section");
        const container = document.getElementById("exam-countdown-list");
        if (!container || !section) return;

        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        const upcoming = (Array.isArray(exams) ? exams : [])
            .map(ex => ({ ex, start: NotificationManager.parseExamStart(ex.date || ex.time || "") }))
            .filter(x => x.start && x.start.getTime() >= now.getTime())
            .sort((a, b) => (a.start as Date).getTime() - (b.start as Date).getTime())
            .slice(0, 3);

        if (upcoming.length === 0) {
            section.style.display = "none";
            container.style.display = "none";
            container.innerHTML = "";
            return;
        }

        section.style.display = "flex";
        container.style.display = "flex";
        container.innerHTML = "";

        upcoming.forEach(({ ex, start }) => {
            const s = start as Date;
            const examDay = new Date(s.getFullYear(), s.getMonth(), s.getDate());
            const days = Math.round((examDay.getTime() - today.getTime()) / 86400000);
            const daysLabel = days === 0 ? "今天" : (days === 1 ? "明天" : `${days}`);
            const showUnit = days > 1;
            const urgent = days <= 3;
            const name = ex.name || ex.courseName || "考试";
            const room = ex.room || ex.location || "待定";
            const timeStr = `${s.getMonth() + 1}月${s.getDate()}日 ${String(s.getHours()).padStart(2, "0")}:${String(s.getMinutes()).padStart(2, "0")}`;

            const card = document.createElement("div");
            card.className = `glass-card countdown-card ${urgent ? "urgent" : ""}`;
            card.innerHTML = `
                <div class="countdown-days">
                    <span class="num">${daysLabel}</span>
                    ${showUnit ? '<span class="unit">天后</span>' : ''}
                </div>
                <div class="countdown-info">
                    <div class="countdown-name">${escapeHtml(name)}</div>
                    <div class="countdown-meta">
                        <span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect></svg>${escapeHtml(timeStr)}</span>
                        <span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4"></path></svg>${escapeHtml(room)}</span>
                    </div>
                </div>
            `;
            container.appendChild(card);
        });
    }

    /**
     * 拉取并渲染随堂考试数据。
     */
    static async loadClassroomTestsData(silent: boolean = false): Promise<void> {
        if (!silent) this.showLoading(true, "正在拉取随堂考试...");
        const container = document.getElementById("exams-class-list");
        try {
            // xsstk_query 仅是查询表单页，随堂考结果需 POST 到 xsstk_list
            const semester = (document.getElementById("select-exam-semester") as HTMLSelectElement | null)?.value
                || localStorage.getItem(this.KEY_CURRENT_SEMESTER)
                || AppConfig.getDefaultSemesterId();
            const html = await YnufeClient.postForm("/jsxsd/xsks/xsstk_list", {
                xnxqid: semester,
                xqlb: "",
                xqlbmc: ""
            });
            const list = ExamParser.parseClassroomTests(html);
            if (container) {
                if (list.length === 0) {
                    container.innerHTML = `<div class="empty-state"><p>暂无随堂考试记录</p></div>`;
                } else {
                    container.innerHTML = "";
                    list.forEach(t => {
                        const card = document.createElement("div");
                        card.className = "exam-card glass-card";
                        card.innerHTML = `
                            <div class="exam-title">
                                <span>${escapeHtml(t.name)}</span>
                                <span class="exam-badge" style="background:rgba(16,185,129,0.15); color:var(--accent-color);">${escapeHtml(t.type)}</span>
                            </div>
                            <div class="exam-info-grid">
                                <div class="info-item full-width">
                                    <small>测试时间</small>
                                    <span>${escapeHtml(t.date)}</span>
                                </div>
                                <div class="info-item full-width">
                                    <small>考场教室/地点</small>
                                    <span class="highlight">${escapeHtml(t.room)}</span>
                                </div>
                            </div>
                        `;
                        container.appendChild(card);
                    });
                }
            }
        } catch (e) {
            this.handleLoadError("随堂考试", e);
        } finally {
            if (!silent) this.showLoading(false);
        }
    }

    /**
     * 拉取并渲染选课中心活动。
     */
    static async loadXkCenterData(silent: boolean = false): Promise<void> {
        if (!silent) this.showLoading(true, "正在拉取选课活动...");
        const container = document.getElementById("xk-activities-list");
        try {
            const html = await YnufeClient.getHtml("/jsxsd/xsxk/xklc_list");
            const list = ServiceParser.parseXkCenter(html);
            if (container) {
                if (list.length === 0) {
                    container.innerHTML = `<div class="empty-state"><p>当前无开放的选课选教活动</p></div>`;
                } else {
                    container.innerHTML = "";
                    list.forEach(act => {
                        const card = document.createElement("div");
                        const isOpen = act.status.includes("进入") || act.status.includes("选课");
                        card.className = "xk-card glass-card";
                        card.innerHTML = `
                            <div class="xk-title">
                                <span>${escapeHtml(act.name)}</span>
                                <span class="xk-badge ${isOpen ? 'active' : ''}">${escapeHtml(act.status)}</span>
                            </div>
                            <div class="xk-info-grid">
                                <div class="info-item full-width">
                                    <small>选课活动性质</small>
                                    <span>${escapeHtml(act.type)}</span>
                                </div>
                                <div class="info-item full-width">
                                    <small>起止时间</small>
                                    <span style="font-size:12px; color:var(--text-secondary);">${escapeHtml(act.timeRange)}</span>
                                </div>
                            </div>
                        `;
                        container.appendChild(card);
                    });
                }
            }
        } catch (e) {
            this.handleLoadError("选课活动", e);
        } finally {
            if (!silent) this.showLoading(false);
        }
    }

    /**
     * 拉取并渲染教务网最新公告通知。
     *
     * Returns:
     *     Promise<boolean>: 是否成功。
     */
    static async loadAnnouncementsData(): Promise<boolean> {
        try {
            const html = await YnufeClient.getHtml("/jsxsd/ggly/ysgg_query");
            const list = AnnouncementParser.parseAnnouncements(html);
            this.renderAnnouncementsList(list);
            YnufeSession.setCache("ynufe_cached_announcements", list);
            return true;
        } catch (e) {
            this.handleLoadError("公告", e);
            return false;
        }
    }

    /**
     * 渲染公告通知列表前 5 条卡片。
     */
    static renderAnnouncementsList(list: AnnouncementItem[]): void {
        const container = document.getElementById("home-announcements-list");
        if (!container) return;
        if (container.childElementCount > 0 && this.isSameAsRendered("announcements", list)) return;
        container.innerHTML = "";

        if (!Array.isArray(list) || list.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path></svg>
                    <p>暂无新公告</p>
                </div>`;
            return;
        }

        list.slice(0, 5).forEach(ann => {
            const card = document.createElement("div");
            card.className = "announce-card glass-card";
            card.innerHTML = `
                <div class="announce-left">
                    <div class="announce-title">${escapeHtml(ann.title)}</div>
                    <div class="announce-date"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px; vertical-align: middle;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect></svg>${escapeHtml(ann.date)}</div>
                </div>
                <div style="color:var(--text-secondary); display:flex; align-items:center;">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
                </div>
            `;
            card.addEventListener("click", () => this.showAnnouncementDetail(ann));
            container.appendChild(card);
        });
    }

    /**
     * 在 BottomSheet 中弹窗展示公告详情。
     */
    static async showAnnouncementDetail(ann: AnnouncementItem): Promise<void> {
        // 标题由抽屉头部承载，正文区不再重复展示；
        // 发布时间降为一行元信息，不再单独占一张卡片。
        BottomSheet.show(ann.title, "通知", `
            <div class="ann-detail-meta">${escapeHtml(ann.date)}</div>
            <div class="ann-detail-body" id="ann-detail-body">
                <div class="ann-detail-hint">正在加载公告正文…</div>
            </div>
        `);

        const body = document.getElementById("ann-detail-body");
        if (!body) return;

        if (!ann.url) {
            body.innerHTML = `<div class="ann-detail-hint">该公告未提供详情链接</div>`;
            return;
        }

        try {
            const html = await YnufeClient.getHtml(ann.url);
            const detail = AnnouncementParser.parseDetail(html, ann.url);

            if (!detail.paragraphs.length && !detail.attachments.length) {
                body.innerHTML = `<div class="ann-detail-hint">未能提取到正文内容</div>`;
                return;
            }

            const paragraphs = detail.paragraphs
                .map(p => `<p>${escapeHtml(p)}</p>`)
                .join("");
            // 附件不用 <a href> 直跳：教务系统对上传目录做了封锁，直连会返回一个
            // 写着「非法访问文件！」的 HTML 页面。改为点击后取回二进制流，
            // 校验确实是文件才触发保存，否则如实告知被限制。
            const attachments = detail.attachments.length
                ? `<div class="ann-detail-files"><small>附件</small>${
                      detail.attachments.map((f, i) =>
                          `<button type="button" class="ann-attach-btn" data-idx="${i}">${escapeHtml(f.name)}</button>`
                      ).join("")
                  }</div>`
                : "";

            body.innerHTML = paragraphs + attachments;

            body.querySelectorAll(".ann-attach-btn").forEach(btn => {
                btn.addEventListener("click", () => {
                    const idx = parseInt(btn.getAttribute("data-idx") || "-1", 10);
                    const file = detail.attachments[idx];
                    if (file) this.downloadAttachment(file.url, file.name);
                });
            });
        } catch (e) {
            const reason = e instanceof SessionExpiredError ? "登录已过期" : "加载失败，请稍后重试";
            body.innerHTML = `<div class="ann-detail-hint">${escapeHtml(reason)}</div>`;
        }
    }

    /**
     * 下载公告附件。
     *
     * 教务系统对 /ewebeditor/uploadfile/ 目录做了封锁：无论是否携带有效会话、
     * Referer 为何值，直接访问都会返回一个 200 的 HTML「出错页面：非法访问文件！」
     * （同目录的 sysimage 图标却能正常取到，说明是针对上传目录的定向限制）。
     * 因此这里先取回内容并判别，确认是真文件才落盘，避免用户点开一个空白错误页。
     *
     * Args:
     *     url (string): 附件的教务网相对路径。
     *     name (string): 保存用的文件名。
     */
    static async downloadAttachment(url: string, name: string): Promise<void> {
        this.showToast(`正在获取「${name}」…`, "info");
        try {
            const { blob, contentType } = await YnufeClient.getBlob(url);

            // 被拦截时返回的是体积很小的 HTML 错误页，而非二进制文件
            if (contentType.includes("text/html") || blob.size < 4096) {
                const head = await blob.slice(0, 4096).text();
                if (head.includes("非法访问文件") || head.includes("出错页面")) {
                    this.showToast("教务系统限制了该附件的直接下载", "warn");
                    return;
                }
            }

            const objectUrl = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = objectUrl;
            a.download = name;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(objectUrl);
            this.showToast(`「${name}」已开始下载`, "success");
        } catch (e) {
            if (e instanceof SessionExpiredError) {
                this.showToast("登录已过期，请重新登录后再试", "warn");
            } else {
                console.error("[YnufeUI] 附件下载失败:", e);
                this.showToast("附件下载失败，请检查网络", "error");
            }
        }
    }

    /**
     * 拉取并更新毕业设计与实习信息。
     */
    static async loadPracticeThesisData(silent: boolean = false): Promise<void> {
        if (!silent) this.showLoading(true, "正在查询毕业设计信息...");
        try {
            const html = await YnufeClient.getHtml("/jsxsd/bysj/xsyxxt.do");
            const info = ServiceParser.parsePractice(html);

            const titleEl = document.getElementById("thesis-title");
            const reportEl = document.getElementById("thesis-report");
            const countEl = document.getElementById("thesis-guidance-count");
            const gradeEl = document.getElementById("thesis-grade");

            if (info.empty) {
                if (titleEl) {
                    titleEl.innerText = info.msg || "未选题";
                    titleEl.style.color = "var(--text-secondary)";
                }
            } else {
                if (titleEl) {
                    titleEl.innerText = info.title || "未选题";
                    titleEl.style.color = "var(--primary-color)";
                }
                if (reportEl) reportEl.innerText = info.report || "未上传";
                if (countEl) countEl.innerText = info.guidanceCount || "0次";
                if (gradeEl) gradeEl.innerText = info.grade || "-";
            }
        } catch (e) {
            this.handleLoadError("毕业设计", e);
            const titleEl = document.getElementById("thesis-title");
            if (titleEl) {
                titleEl.innerText = "暂无毕业环节任务";
                titleEl.style.color = "var(--text-secondary)";
            }
        } finally {
            if (!silent) this.showLoading(false);
        }
    }

    /**
     * 处理空教室查询表单提交。
     */
    static async handleClassroomQuery(e: Event): Promise<void> {
        e.preventDefault();
        const xq = (document.getElementById("query-xq") as HTMLSelectElement | null)?.value || "1";
        const jslx = (document.getElementById("query-jslx") as HTMLSelectElement | null)?.value || "";
        const zc = (document.getElementById("query-zc") as HTMLSelectElement | null)?.value || "1";
        const day = (document.getElementById("query-day") as HTMLSelectElement | null)?.value || "1";
        const jcStart = (document.getElementById("query-jc-start") as HTMLSelectElement | null)?.value || "1";
        const jcEnd = (document.getElementById("query-jc-end") as HTMLSelectElement | null)?.value || "2";

        if (parseInt(jcStart, 10) > parseInt(jcEnd, 10)) {
            this.showToast("开始节次不能大于结束节次！", "warn");
            return;
        }

        this.showLoading(true, "正在智能筛选自习室...");
        const container = document.getElementById("classrooms-result-list");
        const countDom = document.getElementById("classroom-count");
        const currentSemester = (document.getElementById("select-semester") as HTMLSelectElement | null)?.value
            || localStorage.getItem(this.KEY_CURRENT_SEMESTER)
            || AppConfig.getDefaultSemesterId();

        try {
            const responseText = await YnufeClient.postForm("/jsxsd/kbxx/jsjy_query2", {
                typewhere: "jszq",
                xnxqh: currentSemester,
                xqbh: xq,
                jslx,
                zc,
                zc2: zc,
                xq: day,
                xq2: day,
                jc: jcStart,
                jc2: jcEnd,
                kbjcmsid: AppConfig.CLASSROOM_QUERY_KBJCMSID
            });

            const rooms = ServiceParser.parseClassrooms(responseText);
            if (countDom) countDom.innerText = `共${rooms.length}间`;

            if (container) {
                if (rooms.length === 0) {
                    container.innerHTML = `
                        <div class="empty-state">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect></svg>
                            <p>该时段无空闲教室，换个条件查询吧</p>
                        </div>`;
                } else {
                    container.innerHTML = "";
                    rooms.forEach(roomName => {
                        const card = document.createElement("div");
                        card.className = "classroom-card glass-card";
                        card.innerText = roomName;
                        container.appendChild(card);
                    });
                }
            }
        } catch (err) {
            if (err instanceof ParseError) {
                this.handleLoadError("空教室", err);
            } else if (!(err instanceof SessionExpiredError)) {
                console.error("[YnufeUI] Query classrooms error:", err);
                this.showToast("空教室查询网络超时，请检查校园网连接！", "error");
            }
        } finally {
            this.showLoading(false);
        }
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
                this.renderTodayCoursesList(this.globalTimetable);
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
