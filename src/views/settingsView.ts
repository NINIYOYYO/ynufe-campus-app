import { NotificationManager } from '../services/notificationManager';
import { ThemeCustomizer } from '../components/themeCustomizer';
import { WallpaperManager } from '../components/wallpaperManager';
import { YnufeSession } from '../stores/sessionStore';
import { TimetableData } from '../types/timetable';
import { showToast } from '../utils/uiFeedback';

/**
 * 主题外观、壁纸个性化及上课提醒设置抽屉视图控制器
 */
export class SettingsView {
    /**
     * 打开或关闭壁纸与个性化设置抽屉 (ID: settings-sheet)。
     *
     * Args:
     *     show (boolean): 是否显示。
     */
    static toggleSettingsSheet(show: boolean): void {
        this.toggleSheetById("settings-sheet", "settings-overlay", show);
    }

    /**
     * 打开或关闭上课提醒设置抽屉 (ID: notify-sheet)。
     *
     * Args:
     *     show (boolean): 是否显示。
     */
    static toggleNotifySheet(show: boolean): void {
        this.toggleSheetById("notify-sheet", "notify-overlay", show);
        if (show) this.refreshNotifyStatusText();
    }

    /**
     * 通用底部抽屉显隐控制。
     *
     * Args:
     *     sheetId (string): 抽屉容器 DOM ID。
     *     overlayId (string): 遮罩层 DOM ID。
     *     show (boolean): 是否显示。
     */
    static toggleSheetById(sheetId: string, overlayId: string, show: boolean): void {
        const sheet = document.getElementById(sheetId);
        if (!sheet) return;

        if (show) {
            sheet.style.display = "block";
            sheet.style.transform = "";
            void sheet.offsetHeight; // 触发回流重绘
            sheet.classList.add("active");
        } else {
            sheet.classList.remove("active");
            window.setTimeout(() => {
                if (!sheet.classList.contains("active")) {
                    sheet.style.display = "none";
                    sheet.style.transform = "";
                }
            }, 300);
        }
    }

    /**
     * 初始化主题模式 (深色/浅色) 及按钮高亮。
     */
    static initTheme(): void {
        const savedTheme = localStorage.getItem("ynufe_theme") || "dark";
        this.setThemeMode(savedTheme as "dark" | "light");
    }

    /**
     * 设置并持久化主题模式。
     *
     * Args:
     *     mode ("dark" | "light"): 主题模式。
     */
    static setThemeMode(mode: "dark" | "light"): void {
        const body = document.body;
        if (mode === "light") {
            body.classList.remove("theme-dark");
            body.classList.add("theme-light");
        } else {
            body.classList.remove("theme-light");
            body.classList.add("theme-dark");
        }
        localStorage.setItem("ynufe_theme", mode);
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
    static async refreshNotifyStatusText(): Promise<void> {
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
    static bindNotifyEvents(): void {
        const btnNotify = document.getElementById("btn-notify");
        if (btnNotify) {
            btnNotify.addEventListener("click", () => this.toggleNotifySheet(true));
        }
        const notifyOverlay = document.getElementById("notify-overlay");
        if (notifyOverlay) {
            notifyOverlay.addEventListener("click", () => this.toggleNotifySheet(false));
        }

        const toggle = document.getElementById("notify-enabled-toggle") as HTMLInputElement | null;
        const leadSelect = document.getElementById("select-notify-lead") as HTMLSelectElement | null;
        if (toggle) toggle.checked = NotificationManager.isEnabled();
        if (leadSelect) leadSelect.value = String(NotificationManager.getLeadMinutes());

        if (toggle) {
            toggle.addEventListener("change", async () => {
                const wantEnabled = toggle.checked;
                const ok = await NotificationManager.setEnabled(wantEnabled);
                if (wantEnabled && !ok) {
                    toggle.checked = false;
                    showToast("未获得系统通知权限，请在手机设置中允许通知", "warn");
                    this.refreshNotifyStatusText();
                    return;
                }
                if (wantEnabled) {
                    const data = YnufeSession.getCache<TimetableData>("ynufe_cached_timetable_data");
                    const count = await NotificationManager.rescheduleFromTimetable(data);
                    if (count === -1) {
                        showToast("当前不在教学周内（或未获取到教学周），暂无法排程提醒", "warn");
                    } else if (count === 0) {
                        showToast("提醒已开启，未来两周暂无待提醒课程", "info");
                    } else {
                        showToast(`提醒已开启，已排 ${count} 条上课提醒`, "success");
                    }
                } else {
                    showToast("上课提醒已关闭", "info");
                }
                this.refreshNotifyStatusText();
            });
        }

        if (leadSelect) {
            leadSelect.addEventListener("change", async () => {
                const minutes = parseInt(leadSelect.value, 10) || 15;
                NotificationManager.setLeadMinutes(minutes);
                if (NotificationManager.isEnabled()) {
                    const data = YnufeSession.getCache<TimetableData>("ynufe_cached_timetable_data");
                    const count = await NotificationManager.rescheduleFromTimetable(data);
                    if (count > 0) {
                        showToast(`已改为提前 ${minutes} 分钟提醒（${count} 条已重排）`, "success");
                    }
                }
                this.refreshNotifyStatusText();
            });
        }
    }
}
