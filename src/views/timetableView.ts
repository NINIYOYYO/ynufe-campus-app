import { YnufeClient } from '../api/client';
import { TimetableParser } from '../parsers/timetableParser';
import { TimetableData, CourseItem } from '../types/timetable';
import { NotificationManager } from '../services/notificationManager';
import { CustomSelect } from '../components/customSelect';
import { BottomSheet } from '../components/bottomSheet';
import { AppConfig, StorageKeys } from '../config';
import { CacheService } from '../services/cacheService';
import { escapeHtml } from '../utils/escapeHtml';
import { playEntrance } from '../utils/uiFeedback';
import { withViewLoading, renderEmptyState } from '../utils/viewHelper';

/**
 * 课表展示、5x5 网格矩阵与今日课程视图控制器
 */
export class TimetableView {
    public static currentTimetableData: TimetableData | null = null;
    public static globalTimetable: CourseItem[] = [];
    public static currentTeachingWeek: number | null = null;

    private static KEY_CURRENT_SEMESTER = "ynufe_current_semester_id";

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
        const result = await withViewLoading({
            silent,
            loadingText: "正在同步课程表...",
            moduleName: "课表"
        }, async () => {
            const endpoint = semesterId
                ? `/jsxsd/xskb/xskb_list.do?xnxq01id=${encodeURIComponent(semesterId)}`
                : "/jsxsd/xskb/xskb_list.do";
            const html = await YnufeClient.getHtml(endpoint);
            const data = TimetableParser.parseTimetable(html);

            // 课表页周次下拉默认为"(全部)"，解析不出当前周，用首页框架取到的教学周补齐
            if (data && !data.currentWeek) {
                const fallbackWeek = this.currentTeachingWeek
                    ?? (CacheService.get<number>(StorageKeys.CURRENT_TEACHING_WEEK) || undefined);
                if (fallbackWeek && !isNaN(fallbackWeek)) {
                    data.currentWeek = fallbackWeek;
                }
            }

            if (data) {
                this.renderTimetableData(data, semesterId);

                const currentSemId = semesterId === ""
                    ? data.currentSemesterId
                    : (localStorage.getItem(this.KEY_CURRENT_SEMESTER) || "");
                if (semesterId === "" && data.currentSemesterId) {
                    localStorage.setItem(this.KEY_CURRENT_SEMESTER, data.currentSemesterId);
                }
                const isCurrentSemester = semesterId === "" || (currentSemId !== "" && semesterId === currentSemId);
                if (isCurrentSemester && data.courses.length >= 0) {
                    CacheService.set(StorageKeys.TIMETABLE_CACHE, data);
                    NotificationManager.rescheduleFromTimetable(data).catch(() => {});
                }
                return true;
            }
            return false;
        });

        return result ?? false;
    }

    /**
     * 渲染课程表核心组件 (填充下拉框、今日课表及 5x5 网格课表)。
     *
     * Args:
     *     data (TimetableData): 课表数据结构。
     *     semesterId (string, optional): 指定学期。
     */
    static renderTimetableData(data: TimetableData, semesterId: string = ""): void {
        if (!data) return;
        this.currentTimetableData = data;
        this.globalTimetable = data.courses || [];

        // 填充学期下拉列表
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

        const gridContainer = document.querySelector<HTMLElement>(".timetable-grid");
        if (gridContainer) {
            playEntrance(gridContainer);
        }
    }

    /**
     * 渲染首页"今日课程"列表。
     * 按当前教学周过滤；同一门课同一天上多个大节时，每个大节独立成卡。
     *
     * Args:
     *     courses (CourseItem[]): 课程列表。
     */
    static renderTodayCoursesList(courses: CourseItem[]): void {
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

        // 3. 去重仅针对完全相同的大节
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
            const weekUnknown = selectedWeek === null || isNaN(selectedWeek);
            const tip = weekUnknown
                ? "当前不在教学周内，或尚未获取到教学周信息"
                : "今天没有课，享受你的空闲时间吧";
            const coffeeSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.4; margin-bottom:10px;"><path d="M18 8h1a4 4 0 0 1 0 8h-1"></path><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"></path><line x1="6" y1="2" x2="6" y2="4"></line><line x1="10" y1="2" x2="10" y2="4"></line><line x1="14" y1="2" x2="14" y2="4"></line></svg>`;
            renderEmptyState(container, tip, coffeeSvg);
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
        playEntrance(container);
    }

    /**
     * 在 BottomSheet 弹窗中展示单门课程的详细信息。
     *
     * Args:
     *     course (CourseItem): 课程对象。
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
}
