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
     * 解析具体生效周次区间（支持单周、双周、非标符号清洗与连续周次展开）。
     *
     * Args:
     *     weeksStr (string): 周次原始描述文本（如 "1-16(单周)[01-02节]"、"第1-8周" 或 "1~8周,10至18周"）。
     *
     * Returns:
     *     number[]: 展开后的生效周次数组。
     */
    static parseActiveWeeks(weeksStr: string): number[] {
        if (!weeksStr || weeksStr === "全周") return [];
        const isOddOnly = /(?:^|[^\w(])单周?(?:$|[^\w)])/.test(weeksStr) || weeksStr.includes("单周");
        const isEvenOnly = /(?:^|[^\w(])双周?(?:$|[^\w)])/.test(weeksStr) || weeksStr.includes("双周");

        const normalized = weeksStr
            .replace(/\[[^\]]*\]/g, "")
            .replace(/\([^)]*\)/g, "")
            .replace(/[，；;、]/g, ",")
            .replace(/[~～至到]/g, "-")
            .replace(/[第周次\s单双]/g, "")
            .trim();

        const activeWeeks: number[] = [];
        normalized.split(",").forEach(part => {
            const trimmed = part.trim();
            if (!trimmed) return;
            if (trimmed.includes("-")) {
                const parts = trimmed.split("-").map(s => parseInt(s.trim(), 10));
                if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                    const start = Math.min(parts[0], parts[1]);
                    const end = Math.max(parts[0], parts[1]);
                    for (let i = start; i <= end; i++) {
                        if (isOddOnly && i % 2 === 0) continue;
                        if (isEvenOnly && i % 2 !== 0) continue;
                        activeWeeks.push(i);
                    }
                }
            } else {
                const single = parseInt(trimmed, 10);
                if (!isNaN(single) && single > 0) {
                    if (isOddOnly && single % 2 === 0) return;
                    if (isEvenOnly && single % 2 !== 0) return;
                    activeWeeks.push(single);
                }
            }
        });
        return activeWeeks;
    }

    private static readonly META_PREFIX_RE = /^(?:教师|老师|教室|周次|节次|通知单编号|课程编号|校区|教学班|选课备注)(?:[:：]|\(节次\)|$)/;

    /**
     * 从课程单元 HTML 块中提取完整的课程名称（兼容多行换行、<br/> 截断与内联修饰标签）。
     *
     * Args:
     *     blockHtml (string): 单门课程的 HTML 源码片段。
     *     doc (Document): DOM 文档上下文。
     *
     * Returns:
     *     string: 提取并清洗后的完整课程名称。
     */
    static extractCourseName(blockHtml: string, doc: Document): string {
        if (!blockHtml || !blockHtml.trim()) return "";

        const tempDiv = doc.createElement("div");
        tempDiv.innerHTML = blockHtml;

        const nameParts: string[] = [];
        for (let i = 0; i < tempDiv.childNodes.length; i++) {
            const node = tempDiv.childNodes[i];

            if (node.nodeType === 1) {
                const el = node as HTMLElement;
                const tagName = el.tagName.toLowerCase();

                // 遇到强智教务系统元数据标签，终止名称收集
                if (el.hasAttribute("title") ||
                    (el.id && (el.id.startsWith("jc_") || el.id.startsWith("kc_"))) ||
                    tagName === "input" ||
                    tagName === "select") {
                    break;
                }

                if (tagName === "br") {
                    continue;
                }

                const txt = el.textContent?.trim() || "";
                if (txt && txt !== "&nbsp;") {
                    if (this.META_PREFIX_RE.test(txt)) {
                        break;
                    }
                    nameParts.push(txt);
                }
            } else if (node.nodeType === 3) {
                const txt = node.textContent || "";
                const lines = txt.split(/\r?\n/);
                let shouldStop = false;
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed === "&nbsp;") continue;
                    if (this.META_PREFIX_RE.test(trimmed)) {
                        shouldStop = true;
                        break;
                    }
                    nameParts.push(trimmed);
                }
                if (shouldStop) {
                    break;
                }
            }
        }

        if (nameParts.length === 0) return "";

        let combined = "";
        for (const part of nameParts) {
            if (!combined) {
                combined = part;
            } else {
                const lastChar = combined.slice(-1);
                const firstChar = part.slice(0, 1);
                const isLatinLast = /[a-zA-Z0-9]/.test(lastChar);
                const isLatinFirst = /[a-zA-Z0-9]/.test(firstChar);
                if (isLatinLast && isLatinFirst) {
                    combined += " " + part;
                } else {
                    combined += part;
                }
            }
        }

        return combined.replace(/\s+/g, " ").trim();
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

                        // 提取课程名称：取元数据标签前的完整文本并清洗
                        const rawName = this.extractCourseName(blockHtml, doc);
                        if (!rawName || rawName === "&nbsp;" || rawName.length < 2) continue;

                        const teacherMatch = blockHtml.match(/(?:老师|教师)['"]?(?:>|[:：])\s*([^<]+)/);
                        const roomMatch = blockHtml.match(/教室['"]?(?:>|[:：])\s*([^<]+)/);
                        const weeksMatch = blockHtml.match(/周次\(节次\)['"]?(?:>|[:：])\s*([^<]+)/);
                        const codeMatch = blockHtml.match(/(?:通知单编号|课程编号)['"]?(?:>|[:：])\s*([^<]+)/);

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
