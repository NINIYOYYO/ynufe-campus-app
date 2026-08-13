import { YnufeClient } from '../api/client';
import { YnufeSession } from '../stores/sessionStore';
import { ProfileParser } from '../parsers/profileParser';
import { UserProfile } from '../types/profile';
import { TimetableData } from '../types/timetable';
import { GradeSummary } from '../types/grade';
import { ExamItem } from '../types/exam';
import { AnnouncementItem } from '../types/announcement';
import { TimetableView } from '../views/timetableView';
import { GradeView } from '../views/gradeView';
import { ExamView } from '../views/examView';
import { AnnouncementView } from '../views/announcementView';
import { ServiceView } from '../views/serviceView';
import { SettingsView } from '../views/settingsView';
import { LoginView } from '../views/loginView';
import { AppRouter } from './router';
import { SyncStatusState } from '../components/syncStatusTag';
import { BottomSheet } from '../components/bottomSheet';
import { WallpaperManager } from '../components/wallpaperManager';
import { CustomSelect } from '../components/customSelect';
import { ThemeCustomizer } from '../components/themeCustomizer';
import { AutoLogin } from '../services/autoLogin';
import { NotificationManager } from '../services/notificationManager';
import { SessionCookieManager } from '../services/cookieManager';
import { AppConfig } from '../config';
import { encodeInp } from '../utils/crypto';
import { showToast, showLoading, toggleModal, updateSyncStatus, resetRenderFingerprints, handleLoadError } from '../utils/uiFeedback';

/**
 * YnufeApp: App 应用业务总指挥控制引擎
 * 职责：调度网络通信、数据解析、界面渲染、Tab 路由、后台心跳保活、
 * 会话自动续期（持久化登录）、上课提醒排程与用户交互控制。
 */
export class YnufeApp {
    public static isSilentSync = false;
    private static heartbeatIntervalId: any = null;
    private static recovering = false;
    private static lastRecoverAt = 0;
    private static KEY_CURRENT_WEEK = "ynufe_current_teaching_week";
    private static currentTeachingWeek: number | undefined = undefined;
    private static sessionInvalid = false;
    private static lastCaptchaUrl: string | null = null;

    /** 供模块级启动流程读取的只读视图。 */
    static get isSessionInvalid(): boolean {
        return this.sessionInvalid;
    }

    /**
     * 初始化全局业务引擎、界面事件绑定、心跳保活及各管理组件。
     */
    static init(): void {
        YnufeSession.migratePlaintextCredentials();
        SessionCookieManager.restoreCookies().catch(() => {});
        this.bindEvents();
        AppRouter.bindSubTabEvents();
        SettingsView.bindNotifyEvents();
        this.initQueryWeekOptions();
        BottomSheet.init();
        WallpaperManager.init();
        CustomSelect.enhanceAll();
        ThemeCustomizer.init();
        SettingsView.initTheme();

        if (YnufeSession.getHasSession()) {
            this.startHeartbeat();
        }

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

        window.addEventListener("ynufe-theme-preset-applied", (e: any) => {
            const mode = e?.detail?.mode || "dark";
            WallpaperManager.applyAdaptiveWallpaperColor(mode);
        });
    }

    /**
     * 会话过期统一恢复入口：先尝试静默自动续期。
     */
    static onSessionExpired(): void {
        if (this.recovering) return;
        const now = Date.now();
        if (now - this.lastRecoverAt < 30000) return;
        this.recovering = true;
        this.lastRecoverAt = now;
        this.stopHeartbeat();
        updateSyncStatus("syncing", "会话续期中...");

        AutoLogin.attempt().then(async (ok) => {
            this.recovering = false;
            if (ok) {
                this.startHeartbeat();
                showToast("登录已自动续期", "success");
                const success = await this.loadHomeBusinessData();
                updateSyncStatus(success ? "online" : "offline", success ? "数据已最新" : "未同步 · 点击刷新");
            } else {
                updateSyncStatus("offline", "登录已过期");
                if (!this.isSilentSync) {
                    showToast("自动续期未成功，请输入验证码完成登录", "warn");
                    LoginView.prefillLoginForm();
                    toggleModal("login-overlay", true);
                    LoginView.refreshCaptchaImg();
                }
            }
        });
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
            console.error("[YnufeApp] Failed to refresh captcha blob:", e);
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
                TimetableView.renderTimetableData(cachedTimetable);
                hasData = true;
            }

            const cachedGrades = YnufeSession.getCache<GradeSummary>("ynufe_cached_grades_data");
            if (cachedGrades && Array.isArray(cachedGrades.gradesList) && cachedGrades.gradesList.length > 0) {
                GradeView.renderGradesData(cachedGrades);
                hasData = true;
            }

            const cachedExams = YnufeSession.getCache<ExamItem[]>("ynufe_cached_exams");
            if (Array.isArray(cachedExams) && cachedExams.length > 0) {
                ExamView.renderExamsList(cachedExams);
            }

            const cachedAnnouncements = YnufeSession.getCache<AnnouncementItem[]>("ynufe_cached_announcements");
            if (Array.isArray(cachedAnnouncements) && cachedAnnouncements.length > 0) {
                AnnouncementView.renderAnnouncementsList(cachedAnnouncements);
            }
        } catch (e) {
            console.error("[YnufeApp] Error loading cached data:", e);
        }
        return hasData;
    }

    /**
     * 渲染个人信息与问候语区域。
     *
     * Args:
     *     profile (UserProfile): 学籍与个人信息实体。
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
     * 拉取并解析首页全套核心业务数据。
     *
     * Returns:
     *     Promise<boolean>: 是否同步成功。
     */
    static async loadHomeBusinessData(): Promise<boolean> {
        try {
            const mainHtml = await YnufeClient.getHtml("/jsxsd/framework/xsMain_new.jsp?t1=1");
            const profile = ProfileParser.parseProfile(mainHtml);

            if (!profile.name || profile.name === "未登录") {
                console.warn("[YnufeApp] 未解析出学籍信息，判定为会话失效，触发续期流程");
                this.sessionInvalid = true;
                window.dispatchEvent(new CustomEvent("ynufe-session-expired"));
                return false;
            }

            this.sessionInvalid = false;
            this.renderProfile(profile);
            YnufeSession.setCache("ynufe_cached_profile", profile);

            this.currentTeachingWeek = ProfileParser.parseCurrentWeek(mainHtml);
            TimetableView.currentTeachingWeek = this.currentTeachingWeek ?? null;
            if (this.currentTeachingWeek) {
                localStorage.setItem(this.KEY_CURRENT_WEEK, String(this.currentTeachingWeek));
            } else {
                localStorage.removeItem(this.KEY_CURRENT_WEEK);
            }

            const results = await Promise.all([
                TimetableView.reloadTimetableFromServer("", true),
                GradeView.loadFinalGradesData(true),
                AnnouncementView.loadAnnouncementsData(),
                ExamView.loadExamsData(true)
            ]);

            return results.some(r => r !== false);
        } catch (err) {
            handleLoadError("首页数据", err);
            return false;
        }
    }

    /**
     * 全局 DOM 事件处理函数与筛选联动绑定。
     */
    private static bindEvents(): void {
        LoginView.bindEvents(
            () => this.loadHomeBusinessData(),
            () => this.stopHeartbeat()
        );

        const syncTag = document.getElementById("sync-status-tag");
        if (syncTag) {
            syncTag.addEventListener("click", async () => {
                updateSyncStatus("syncing", "刷新中...");
                const success = await this.loadHomeBusinessData();
                if (success) {
                    updateSyncStatus("online", "数据已最新");
                } else if (this.sessionInvalid) {
                    updateSyncStatus("offline", "登录已过期 · 点击登录");
                    toggleModal("login-overlay", true);
                    LoginView.refreshCaptchaImg();
                } else {
                    updateSyncStatus("offline", "未同步 · 点击刷新");
                    if (!this.recovering) {
                        showToast("同步失败，请检查网络后重试", "warn");
                    }
                }
            });
        }

        const navItems = document.querySelectorAll(".bottom-nav .nav-item");
        navItems.forEach(item => {
            item.addEventListener("click", () => {
                const targetTab = item.getAttribute("data-target");
                if (targetTab) {
                    AppRouter.switchTab(targetTab);
                    AppRouter.loadTabBusinessData(targetTab);
                }
            });
        });

        const selectSemester = document.getElementById("select-semester");
        if (selectSemester) {
            selectSemester.addEventListener("change", (e) => {
                const val = (e.target as HTMLSelectElement).value;
                TimetableView.reloadTimetableFromServer(val);
            });
        }

        const selectWeek = document.getElementById("select-week");
        if (selectWeek) {
            selectWeek.addEventListener("change", () => {
                TimetableView.reloadTimetableGrid();
                TimetableView.renderTodayCoursesList(TimetableView.globalTimetable);
            });
        }

        const selectGradeSem = document.getElementById("select-grade-semester");
        const inputGradeSearch = document.getElementById("input-grade-search");
        if (selectGradeSem) selectGradeSem.addEventListener("change", () => GradeView.filterGrades());
        if (inputGradeSearch) inputGradeSearch.addEventListener("input", () => GradeView.filterGrades());

        const selectExamSem = document.getElementById("select-exam-semester");
        const selectExamType = document.getElementById("select-exam-type");
        if (selectExamSem) selectExamSem.addEventListener("change", () => ExamView.loadExamsData());
        if (selectExamType) selectExamType.addEventListener("change", () => ExamView.loadExamsData());

        const classroomForm = document.getElementById("classroom-query-form");
        if (classroomForm) classroomForm.addEventListener("submit", (e) => ServiceView.handleClassroomQuery(e));

        const btnSettings = document.getElementById("btn-settings");
        if (btnSettings) {
            btnSettings.addEventListener("click", () => SettingsView.toggleSettingsSheet(true));
        }

        const settingsOverlay = document.getElementById("settings-overlay");
        if (settingsOverlay) {
            settingsOverlay.addEventListener("click", () => SettingsView.toggleSettingsSheet(false));
        }

        document.querySelectorAll(".theme-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                const themeName = (btn.getAttribute("data-theme") as "dark" | "light") || "dark";
                SettingsView.setThemeMode(themeName);
            });
        });
    }
}
