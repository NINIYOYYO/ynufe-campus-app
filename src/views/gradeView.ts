import { YnufeClient, SessionExpiredError } from '../api/client';
import { GradeParser } from '../parsers/gradeParser';
import { GradeSummary, GradeItem } from '../types/grade';
import { StorageKeys } from '../config/storageKeys';
import { CacheService } from '../services/cacheService';
import { NotificationManager } from '../services/notificationManager';
import { CustomSelect } from '../components/customSelect';
import { BottomSheet } from '../components/bottomSheet';
import { escapeHtml } from '../utils/escapeHtml';
import { isSameAsRendered, playEntrance, showToast } from '../utils/uiFeedback';
import { withViewLoading, renderEmptyState } from '../utils/viewHelper';

/**
 * 成绩与平时成绩构成视图控制器
 */
export class GradeView {
    public static globalGrades: GradeItem[] = [];

    /**
     * 拉取并解析期末成绩。
     *
     * Args:
     *     silent (boolean): 是否静默拉取。
     *
     * Returns:
     *     Promise<boolean>: 是否成功。
     */
    static async loadFinalGradesData(silent: boolean = false): Promise<boolean> {
        const result = await withViewLoading({
            silent,
            loadingText: "正在获取最新成绩与GPA...",
            moduleName: "成绩"
        }, async () => {
            const html = await YnufeClient.getHtml("/jsxsd/kscj/cjcx_list?xsfs=all");
            const summary = GradeParser.parseGrades(html);
            this.detectNewGrades(summary);
            this.renderGradesData(summary);
            CacheService.set(StorageKeys.GRADES_CACHE, summary);
            return true;
        });

        return result ?? false;
    }

    /**
     * 成绩变动检测：对比本地已记录的"已出成绩课程集合"，发现新公布的成绩时弹窗提醒。
     *
     * Args:
     *     summary (GradeSummary): 最新解析出的成绩概览。
     */
    static detectNewGrades(summary: GradeSummary): void {
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
                showToast(`新成绩公布：${g.courseName} ${g.score}`, "success");
                NotificationManager.notifyGradeUpdate(`新成绩公布`, `${g.courseName}：${g.score}（绩点 ${g.gpa}）`);
            } else {
                showToast(`有 ${freshly.length} 门课程公布了新成绩`, "success");
                const names = freshly.slice(0, 3).map(g => g.courseName).join("、");
                NotificationManager.notifyGradeUpdate(`${freshly.length} 门新成绩公布`, names + (freshly.length > 3 ? " 等" : ""));
            }
        } catch (e) {
            console.error("[YnufeUI] detectNewGrades error:", e);
        }
    }

    /**
     * 渲染成绩大卡、SVG 环形进度条及成绩过滤下拉框。
     *
     * Args:
     *     summary (GradeSummary): 成绩概览。
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

        if (container.childElementCount > 0 &&
            isSameAsRendered("grades", { selectSem, searchText, filtered })) {
            return;
        }

        if (filtered.length === 0) {
            renderEmptyState(container, "未查询到匹配成绩");
            return;
        }

        container.innerHTML = "";
        filtered.forEach(g => {
            const scoreNum = parseFloat(g.score);
            const FAIL_KEYWORDS = ["不合格", "不及格", "缺考", "作弊", "取消资格", "差"];
            const isFail = FAIL_KEYWORDS.includes(g.score.trim()) || (!isNaN(scoreNum) && scoreNum < 60);

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
            card.addEventListener("click", () => this.showGradeDetail(g));
            container.appendChild(card);
        });
        playEntrance(container);
    }

    /**
     * 弹窗展示单门课程成绩详情及成绩构成。
     *
     * Args:
     *     g (GradeItem): 被点击的成绩条目。
     */
    static async showGradeDetail(g: GradeItem): Promise<void> {
        const scoreNum = parseFloat(g.score);
        const isFail = g.score === "不合格" || (!isNaN(scoreNum) && scoreNum < 60);

        const row = (label: string, value?: string): string =>
            value && value !== "-" && value.trim()
                ? `<div class="detail-row"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`
                : "";

        BottomSheet.show(g.courseName, g.category || "课程", `
            <div class="grade-detail-hero">
                <div class="grade-detail-score ${isFail ? "fail" : ""}">${escapeHtml(g.score)}</div>
                <div class="grade-detail-sub">绩点 ${escapeHtml(g.gpa)} · 学分 ${escapeHtml(g.credit)}</div>
            </div>
            <div class="detail-rows">
                ${row("开课学期", g.semester)}
                ${row("课程编号", g.courseId)}
                ${row("总学时", g.hours)}
                ${row("考核方式", g.assessMode)}
                ${row("考试性质", g.examNature)}
                ${row("课程性质", g.courseNature)}
                ${row("分组名", g.groupName)}
            </div>
            <div id="grade-detail-components">
                ${g.detailUrl ? `<div class="ann-detail-hint">正在加载成绩构成…</div>` : ""}
            </div>
        `);

        if (!g.detailUrl) return;
        const slot = document.getElementById("grade-detail-components");
        if (!slot) return;

        try {
            const [html] = await Promise.all([
                YnufeClient.getHtml(g.detailUrl),
                BottomSheet.settled()
            ]);
            const detail = GradeParser.parseScoreDetail(html);

            if (detail.components.length === 0) {
                await BottomSheet.morphHeight(() => { slot.innerHTML = ""; });
                return;
            }

            const bars = detail.components.map(c => {
                const pct = Math.max(0, Math.min(100, parseFloat(c.ratio) || 0));
                const val = Math.max(0, Math.min(100, parseFloat(c.score) || 0));
                const note = c.ratio ? `按占比折合 ${(val * pct / 100).toFixed(1)} 分` : "";
                return `
                    <div class="score-part">
                        <div class="score-part-head">
                            <span>${escapeHtml(c.label)}</span>
                            ${c.ratio ? `<em>占 ${escapeHtml(c.ratio)}</em>` : ""}
                            <b>${escapeHtml(c.score)}</b>
                        </div>
                        <div class="score-bar"><i style="width:${val}%"></i></div>
                        ${note ? `<div class="score-part-note">${escapeHtml(note)}</div>` : ""}
                    </div>`;
            }).join("");

            await BottomSheet.morphHeight(() => {
                slot.innerHTML = `
                    <div class="sheet-swap-in">
                        <div class="detail-section-title">平时成绩与构成明细</div>
                        ${bars}
                        ${detail.total ? `<div class="score-total"><span>总成绩</span><b>${escapeHtml(detail.total)}</b></div>` : ""}
                    </div>`;
            });
        } catch (e) {
            await BottomSheet.settled();
            const reason = e instanceof SessionExpiredError ? "登录已过期" : "成绩构成加载失败";
            await BottomSheet.morphHeight(() => {
                slot.innerHTML = `<div class="ann-detail-hint">${escapeHtml(reason)}</div>`;
            });
        }
    }

    /**
     * 拉取并渲染社会等级考试成绩。
     *
     * Args:
     *     silent (boolean): 是否静默拉取。
     */
    static async loadLevelGradesData(silent: boolean = false): Promise<void> {
        await withViewLoading({
            silent,
            loadingText: "正在查询等级考试成绩...",
            moduleName: "等级考试成绩"
        }, async () => {
            const container = document.getElementById("level-grades-list");
            const html = await YnufeClient.getHtml("/jsxsd/kscj/djkscj_list");
            const list = GradeParser.parseLevelGrades(html);
            CacheService.set(StorageKeys.LEVEL_GRADES_CACHE, list);

            if (container) {
                if (list.length === 0) {
                    renderEmptyState(container, "暂无社会考试等级成绩记录");
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
                    playEntrance(container);
                }
            }
        });
    }
}
