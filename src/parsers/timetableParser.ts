import { CourseItem, SemesterOption, TimetableData, WeekOption } from '../types/timetable';
import { hasEmptyMarker, ParseError } from '../utils/tableUtils';

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
     * 解析具体生效周次区间（支持单周、双周、连续周次与中文“周”清洗）。
     *
     * Args:
     *     weeksStr (string): 周次原始描述文本（如 "1-16(单周)[01-02节]" 或 "1-8周,10-18周"）。
     *
     * Returns:
     *     number[]: 展开后的生效周次数组。
     */
    static parseActiveWeeks(weeksStr: string): number[] {
        if (!weeksStr || weeksStr === "全周") return [];
        const isOddOnly = /\(单周?\)|\b单周?\b/.test(weeksStr);
        const isEvenOnly = /\(双周?\)|\b双周?\b/.test(weeksStr);

        const cleanWeeks = weeksStr
            .replace(/\[[^\]]*\]/g, "")
            .replace(/\([^)]*\)/g, "")
            .replace(/[周次\s]/g, "")
            .trim();

        const activeWeeks: number[] = [];
        cleanWeeks.split(",").forEach(part => {
            const trimmed = part.trim();
            if (trimmed.includes("-")) {
                const range = trimmed.split("-").map(Number);
                if (range.length === 2 && !isNaN(range[0]) && !isNaN(range[1])) {
                    for (let i = range[0]; i <= range[1]; i++) {
                        if (isOddOnly && i % 2 === 0) continue;
                        if (isEvenOnly && i % 2 !== 0) continue;
                        activeWeeks.push(i);
                    }
                }
            } else {
                const single = Number(trimmed);
                if (!isNaN(single) && single > 0) {
                    if (isOddOnly && single % 2 === 0) return;
                    if (isEvenOnly && single % 2 !== 0) return;
                    activeWeeks.push(single);
                }
            }
        });
        return activeWeeks;
    }

    /**
     * 深度解析课程表 HTML 提取学期列表、周次筛选列表及结构化课程实体。
     *
     * Args:
     *     htmlStr (string): 强智教务网 /jsxsd/xskb/xskb_list.do 响应的 HTML。
     *
     * Returns:
     *     TimetableData: 包含学期、周次及课程数组的结构化数据对象。
     *
     * Raises:
     *     ParseError: 页面结构不匹配且未找到空数据占位符时抛出。
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
                    const fullHtml = div.innerHTML;

                    // 兼容同一槽位多课程（教务网以虚线分割多门课程）
                    const courseBlocks = fullHtml.split(/(?:<br\s*\/?>)?\s*-{10,}\s*(?:<br\s*\/?>)?|<hr\s*\/?>/i);

                    for (const blockHtml of courseBlocks) {
                        if (!blockHtml || blockHtml.trim().length === 0) continue;

                        // 提取课程名称：取标签前的纯文本或首段非空白文字
                        const tempDiv = doc.createElement("div");
                        tempDiv.innerHTML = blockHtml;
                        const rawName = tempDiv.childNodes[0]?.textContent?.trim() || "";
                        if (!rawName || rawName === "&nbsp;" || rawName.length < 2) continue;

                        const teacherMatch = blockHtml.match(/老师['"]?>([^<]+)/);
                        const roomMatch = blockHtml.match(/教室['"]?>([^<]+)/);
                        const weeksMatch = blockHtml.match(/周次\(节次\)['"]?>([^<]+)/);
                        const codeMatch = blockHtml.match(/通知单编号['"]?>([^<]+)/) || blockHtml.match(/课程编号['"]?>([^<]+)/);

                        const teacher = teacherMatch ? teacherMatch[1].trim() : "未知教师";
                        const room = roomMatch ? roomMatch[1].trim() : "未定教室";
                        const weeksStr = weeksMatch ? weeksMatch[1].trim() : "全周";
                        const code = codeMatch ? codeMatch[1].trim() : "-";
                        const isAdjusted = /color=['"]?red['"]?/i.test(blockHtml);

                        const activeWeeks = this.parseActiveWeeks(weeksStr);

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
                }
            });
        } else if (!hasEmptyMarker(htmlStr)) {
            throw new ParseError("TimetableParser", "未找到课程表表格 (table#kbtable)");
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
