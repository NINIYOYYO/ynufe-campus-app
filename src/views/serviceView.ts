import { YnufeClient, SessionExpiredError } from '../api/client';
import { ServiceParser } from '../parsers/serviceParser';
import { AppConfig, StorageKeys } from '../config';
import { CacheService } from '../services/cacheService';
import { escapeHtml } from '../utils/escapeHtml';
import { ParseError } from '../utils/tableUtils';
import { playEntrance, showToast } from '../utils/uiFeedback';
import { withViewLoading, renderEmptyState } from '../utils/viewHelper';

/**
 * 选课中心、毕业设计与自习室查询视图控制器
 */
export class ServiceView {
    private static KEY_CURRENT_SEMESTER = "ynufe_current_semester_id";
    private static activeQuerySeq = 0;

    /**
     * 拉取并渲染选课中心活动。
     *
     * Args:
     *     silent (boolean): 是否静默拉取。
     */
    static async loadXkCenterData(silent: boolean = false): Promise<void> {
        await withViewLoading({
            silent,
            loadingText: "正在拉取选课活动...",
            moduleName: "选课活动"
        }, async () => {
            const container = document.getElementById("xk-activities-list");
            const html = await YnufeClient.getHtml("/jsxsd/xsxk/xklc_list");
            const list = ServiceParser.parseXkCenter(html);
            if (container) {
                if (list.length === 0) {
                    renderEmptyState(container, "当前无开放的选课选教活动");
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
                    playEntrance(container);
                }
            }
        });
    }

    /**
     * 拉取并更新毕业设计与实习信息。
     *
     * Args:
     *     silent (boolean): 是否静默拉取。
     */
    static async loadPracticeThesisData(silent: boolean = false): Promise<void> {
        await withViewLoading({
            silent,
            loadingText: "正在查询毕业设计信息...",
            moduleName: "毕业设计"
        }, async () => {
            const html = await YnufeClient.getHtml("/jsxsd/bysj/xsyxxt.do");
            const info = ServiceParser.parsePractice(html);
            CacheService.set(StorageKeys.PRACTICE_THESIS_CACHE, info);

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
        });
    }

    /**
     * 处理空教室查询表单提交。
     *
     * Args:
     *     e (Event): 表单提交事件。
     */
    static async handleClassroomQuery(e: Event): Promise<void> {
        e.preventDefault();
        const currentSeq = ++this.activeQuerySeq;
        const xq = (document.getElementById("query-xq") as HTMLSelectElement | null)?.value || "1";
        const jslx = (document.getElementById("query-jslx") as HTMLSelectElement | null)?.value || "";
        const zc = (document.getElementById("query-zc") as HTMLSelectElement | null)?.value || "1";
        const day = (document.getElementById("query-day") as HTMLSelectElement | null)?.value || "1";
        const jcStart = (document.getElementById("query-jc-start") as HTMLSelectElement | null)?.value || "1";
        const jcEnd = (document.getElementById("query-jc-end") as HTMLSelectElement | null)?.value || "2";

        if (parseInt(jcStart, 10) > parseInt(jcEnd, 10)) {
            showToast("开始节次不能大于结束节次！", "warn");
            return;
        }

        const container = document.getElementById("classrooms-result-list");
        const countDom = document.getElementById("classroom-count");
        const currentSemester = (document.getElementById("select-semester") as HTMLSelectElement | null)?.value
            || localStorage.getItem(this.KEY_CURRENT_SEMESTER)
            || AppConfig.getDefaultSemesterId();

        await withViewLoading({
            silent: false,
            loadingText: "正在智能筛选自习室...",
            moduleName: "空教室"
        }, async () => {
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

            if (currentSeq !== this.activeQuerySeq) {
                console.warn(`[ServiceView] 丢弃已过期的慢空教室查询响应 (seq ${currentSeq} vs latest ${this.activeQuerySeq})`);
                return;
            }

            const rooms = ServiceParser.parseClassrooms(responseText);
            if (countDom) countDom.innerText = `共${rooms.length}间`;

            if (container) {
                if (rooms.length === 0) {
                    renderEmptyState(container, "该时段无空闲教室，换个条件查询吧");
                } else {
                    container.innerHTML = "";
                    rooms.forEach(roomName => {
                        const card = document.createElement("div");
                        card.className = "classroom-card glass-card";
                        card.innerText = roomName;
                        container.appendChild(card);
                    });
                    playEntrance(container);
                }
            }
        });
    }
}
