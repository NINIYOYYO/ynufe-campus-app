import { YnufeClient } from '../api/client';
import { ExamParser } from '../parsers/examParser';
import { ExamItem, ClassroomTestItem } from '../types/exam';
import { StorageKeys } from '../config/storageKeys';
import { CacheService } from '../services/cacheService';
import { NotificationManager } from '../services/notificationManager';
import { AppConfig } from '../config';
import { escapeHtml } from '../utils/escapeHtml';
import { isSameAsRendered, playEntrance } from '../utils/uiFeedback';
import { withViewLoading, renderEmptyState } from '../utils/viewHelper';

/**
 * 期末排考、随堂测试与考试倒计时视图控制器
 */
export class ExamView {
    private static KEY_CURRENT_SEMESTER = "ynufe_current_semester_id";
    private static activeExamsSeq = 0;
    private static activeTestsSeq = 0;

    /**
     * 拉取并渲染期末排考列表。
     *
     * Args:
     *     silent (boolean): 是否静默拉取。
     */
    static async loadExamsData(silent: boolean = false): Promise<void> {
        const currentSeq = ++this.activeExamsSeq;
        const typeSelect = document.getElementById("select-exam-type") as HTMLSelectElement | null;
        const selectSem = (document.getElementById("select-exam-semester") as HTMLSelectElement | null)?.value || "";
        const selectType = typeSelect?.value || "3";
        const typeLabel = typeSelect?.selectedOptions?.[0]?.textContent?.trim()
            || { "1": "期初", "2": "期中", "3": "期末" }[selectType]
            || "";

        await withViewLoading({
            silent,
            loadingText: "正在查询考试安排...",
            moduleName: "考试安排"
        }, async () => {
            const html = await YnufeClient.postForm("/jsxsd/xsks/xsksap_list", {
                xnxqid: selectSem,
                xqlb: selectType,
                xqlbmc: typeLabel
            });
            if (currentSeq !== this.activeExamsSeq) {
                console.warn(`[ExamView] 丢弃已过期的慢排考响应 (seq ${currentSeq} vs latest ${this.activeExamsSeq})`);
                return;
            }
            const list = ExamParser.parseExams(html, selectSem, typeLabel);
            this.renderExamsList(list);
            CacheService.set(StorageKeys.EXAMS_CACHE, list);
        });
    }

    /**
     * 渲染排考列表卡片。
     *
     * Args:
     *     list (ExamItem[]): 考试列表。
     */
    static renderExamsList(list: ExamItem[]): void {
        const container = document.getElementById("exams-term-list");
        if (!container) return;
        if (container.childElementCount > 0 && isSameAsRendered("exams", list)) return;
        container.innerHTML = "";

        if (!Array.isArray(list) || list.length === 0) {
            renderEmptyState(container, "本学期该类型考试暂无排考数据");
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
        playEntrance(container);

        this.renderExamCountdown(list);
        NotificationManager.rescheduleExamReminders(list).catch(() => {});
    }

    /**
     * 渲染首页"考试倒计时"卡片：按开考时间取最近的 3 场未来考试。
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
        playEntrance(container);
    }

    /**
     * 拉取并渲染随堂考试数据。
     *
     * Args:
     *     silent (boolean): 是否静默拉取。
     */
    static async loadClassroomTestsData(silent: boolean = false): Promise<void> {
        const currentSeq = ++this.activeTestsSeq;
        await withViewLoading({
            silent,
            loadingText: "正在拉取随堂考试...",
            moduleName: "随堂考试"
        }, async () => {
            const container = document.getElementById("exams-class-list");
            const semester = (document.getElementById("select-exam-semester") as HTMLSelectElement | null)?.value
                || localStorage.getItem(this.KEY_CURRENT_SEMESTER)
                || AppConfig.getDefaultSemesterId();
            const html = await YnufeClient.postForm("/jsxsd/xsks/xsstk_list", {
                xnxqid: semester,
                xqlb: "",
                xqlbmc: ""
            });
            if (currentSeq !== this.activeTestsSeq) {
                console.warn(`[ExamView] 丢弃已过期的慢随堂考试响应 (seq ${currentSeq} vs latest ${this.activeTestsSeq})`);
                return;
            }
            const list = ExamParser.parseClassroomTests(html);
            CacheService.set(StorageKeys.CLASSROOM_TESTS_CACHE, list);

            if (container) {
                if (list.length === 0) {
                    renderEmptyState(container, "暂无随堂考试记录");
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
                    playEntrance(container);
                }
            }
        });
    }
}
