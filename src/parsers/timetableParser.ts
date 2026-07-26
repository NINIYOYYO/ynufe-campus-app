import { CourseItem, SemesterOption, TimetableData, WeekOption } from '../types/timetable';

/**
 * 云南财经大学强智教务系统课程表 DOM 解析器
 */
export class TimetableParser {
    /**
     * 实例化文档解析器。
     *
     * Args:
     *     htmlStr (string): 课表页面 HTML 源码。
     *
     * Returns:
     *     Document: 转换后的 DOM HTMLDocument 对象。
     */
    private static getDoc(htmlStr: string): Document {
        return new DOMParser().parseFromString(htmlStr, "text/html");
    }

    /**
     * 深度解析课程表 HTML 提取学期列表、周次筛选列表及结构化课程实体。
     *
     * Args:
     *     htmlStr (string): 强智教务网 /jsxsd/xskb/xskb_list.do 响应的 HTML。
     *
     * Returns:
     *     TimetableData: 包含学期、周次及课程数组的结构化数据对象。
     */
    static parseTimetable(htmlStr: string): TimetableData {
        const doc = this.getDoc(htmlStr);

        // 1. 提取可选学期列表
        const semesters: SemesterOption[] = [];
        const semSelect = doc.querySelector("select#xnxq01id, select[name='xnxq01id']");
        if (semSelect) {
            semSelect.querySelectorAll("option").forEach(opt => {
                const val = opt.getAttribute("value") || opt.value;
                if (val) {
                    semesters.push({
                        value: val,
                        text: opt.textContent?.trim() || val,
                        selected: opt.hasAttribute("selected") || opt.selected
                    });
                }
            });
        }

        // 2. 提取周次列表与当前生效周次
        let currentWeek: number | undefined = undefined;
        const weeks: WeekOption[] = [];
        const weekSelect = doc.querySelector("select#zc");
        if (weekSelect) {
            weekSelect.querySelectorAll("option").forEach(opt => {
                const val = opt.getAttribute("value") || opt.value;
                const isSelected = opt.hasAttribute("selected") || opt.selected;
                if (val) {
                    const num = parseInt(val, 10);
                    weeks.push({ val, txt: opt.textContent?.trim() || val });
                    if (isSelected && !isNaN(num) && num > 0) {
                        currentWeek = num;
                    }
                }
            });
        }

        // 3. 提取详细课程表数据 (强智系统的 table#kbtable 与 div.kbcontent)
        const courses: CourseItem[] = [];
        const kbTable = doc.querySelector("table#kbtable") || doc.querySelector("table.kbtable");
        if (kbTable) {
            const divs = kbTable.querySelectorAll("div.kbcontent");
            divs.forEach(div => {
                const divId = div.id || "";
                const parts = divId.split("_");
                if (parts.length >= 2) {
                    const slotIndex = parseInt(parts[0], 10);
                    const dayOfWeek = parseInt(parts[1], 10);
                    const courseText = div.innerHTML;

                    if (!div.childNodes || div.childNodes.length === 0) return;
                    const rawName = div.childNodes[0].textContent?.trim() || "";
                    if (!rawName || rawName === "&nbsp;" || rawName.length < 2) return;

                    const teacherMatch = courseText.match(/老师['"]?>([^<]+)/);
                    const roomMatch = courseText.match(/教室['"]?>([^<]+)/);
                    const weeksMatch = courseText.match(/周次\(节次\)['"]?>([^<]+)/);
                    const codeMatch = courseText.match(/通知单编号['"]?>([^<]+)/) || courseText.match(/课程编号['"]?>([^<]+)/);

                    const teacher = teacherMatch ? teacherMatch[1].trim() : "未知教师";
                    const room = roomMatch ? roomMatch[1].trim() : "未定教室";
                    const weeksStr = weeksMatch ? weeksMatch[1].trim() : "全周";
                    const code = codeMatch ? codeMatch[1].trim() : "-";

                    // 单元格内的红色字体是调课标记（O=整体调课，P=部分调课），
                    // 与"选修/必修"无关；页面同时存在 color='red' 与 color="red" 两种写法。
                    const isAdjusted = /color=['"]?red['"]?/i.test(courseText);

                    // 解析具体生效周次区间（干净剥离 [06-07节]、(周)、(单周)、(双周) 等字符杂质）
                    const activeWeeks: number[] = [];
                    const cleanWeeks = weeksStr
                        .replace(/\[[^\]]*\]/g, "")
                        .replace(/\([^)]*\)/g, "")
                        .trim();

                    cleanWeeks.split(",").forEach(part => {
                        const trimmed = part.trim();
                        if (trimmed.includes("-")) {
                            const range = trimmed.split("-").map(Number);
                            if (range.length === 2 && !isNaN(range[0]) && !isNaN(range[1])) {
                                for (let i = range[0]; i <= range[1]; i++) activeWeeks.push(i);
                            }
                        } else {
                            const single = Number(trimmed);
                            if (!isNaN(single) && single > 0) activeWeeks.push(single);
                        }
                    });

                    courses.push({
                        name: rawName,
                        teacher,
                        room,
                        weeks: weeksStr,
                        code,
                        day: dayOfWeek,
                        slot: slotIndex,
                        session: Math.ceil(slotIndex / 2),
                        isAdjusted,
                        activeWeeks
                    });
                }
            });
        }

        const currentSemester = semesters.find(s => s.selected)?.value || (semesters[0] ? semesters[0].value : "");

        return {
            courses,
            semesters,
            weeks,
            currentSemesterId: currentSemester,
            currentWeek
        };
    }
}
