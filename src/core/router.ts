import { TimetableView } from '../views/timetableView';
import { GradeView } from '../views/gradeView';
import { ExamView } from '../views/examView';
import { ServiceView } from '../views/serviceView';

/**
 * 底部 5 大 Tab 路由与子页签导航控制器
 */
export class AppRouter {
    /**
     * 切换 SPA 底部导航 Tab 视图。
     *
     * Args:
     *     targetTabId (string): 目标 Tab DOM ID。
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
     *
     * Args:
     *     tabId (string): 目标 Tab DOM ID。
     */
    static async loadTabBusinessData(tabId: string): Promise<void> {
        if (tabId === "tab-timetable") {
            await TimetableView.reloadTimetableFromServer("", true);
        } else if (tabId === "tab-grades") {
            await GradeView.loadFinalGradesData(true);
        } else if (tabId === "tab-exams-xk") {
            await ExamView.loadExamsData(true);
        }
    }

    /**
     * 绑定子 Tab 切换页签事件。
     */
    static bindSubTabEvents(): void {
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
                        GradeView.loadLevelGradesData();
                    } else if (targetSubId === "sub-exams-class") {
                        ExamView.loadClassroomTestsData();
                    } else if (targetSubId === "sub-xk-center") {
                        ServiceView.loadXkCenterData();
                    } else if (targetSubId === "sub-practice-thesis") {
                        ServiceView.loadPracticeThesisData();
                    }
                }
            });
        });
    }
}
