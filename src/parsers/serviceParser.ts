import { XkActivityItem } from '../types/exam';
import { ParseError, hasEmptyMarker, pickRichestTable } from '../utils/tableUtils';

export interface PracticeThesisInfo {
    empty: boolean;
    msg?: string;
    title?: string;
    report?: string;
    guidanceCount?: string;
    grade?: string;
}

/**
 * 选课中心、空教室查询与毕业设计实践环节解析器
 */
export class ServiceParser {
    /**
     * 实例化 HTML 文档解析器。
     *
     * Args:
     *     htmlStr (string): 页面 HTML 源码。
     *
     * Returns:
     *     Document: DOM 文档对象。
     */
    private static getDoc(htmlStr: string): Document {
        return new DOMParser().parseFromString(htmlStr, "text/html");
    }

    /**
     * 解析选课中心活动列表。
     *
     * Args:
     *     htmlStr (string): /jsxsd/xsxk/xklc_list 响应的 HTML。
     *
     * Returns:
     *     XkActivityItem[]: 选课活动列表。
     */
    static parseXkCenter(htmlStr: string): XkActivityItem[] {
        const doc = this.getDoc(htmlStr);
        const activities: XkActivityItem[] = [];
        const tables = doc.querySelectorAll("table");

        tables.forEach(table => {
            const rows = table.querySelectorAll("tr");
            for (let i = 1; i < rows.length; i++) {
                const tds = rows[i].querySelectorAll("td");
                if (tds.length >= 5) {
                    const name = tds[0].textContent?.trim() || "";
                    const type = tds[1].textContent?.trim() || "";
                    const startTime = tds[2].textContent?.trim() || "";
                    const endTime = tds[3].textContent?.trim() || "";

                    const actionLink = tds[4].querySelector("a");
                    const status = actionLink ? actionLink.textContent?.trim() || "未开放" : "未开放";
                    const url = actionLink ? actionLink.getAttribute("href") || "" : "";

                    if (name) {
                        activities.push({
                            name,
                            type,
                            timeRange: `${startTime} ~ ${endTime}`,
                            status,
                            url
                        });
                    }
                }
            }
        });
        return activities;
    }

    /**
     * 解析毕业设计与实践环节进度信息。
     *
     * Args:
     *     htmlStr (string): /jsxsd/bysj/xsyxxt.do 响应的 HTML。
     *
     * Returns:
     *     PracticeThesisInfo: 包含了课题名、开题报告、过程指导次数与最终成绩的对象。
     */
    static parsePractice(htmlStr: string): PracticeThesisInfo {
        const doc = this.getDoc(htmlStr);

        // 非毕业年级访问该页时，教务网仍会渲染选题表格骨架，只是表体为"未查询到数据"，
        // 因此必须把这类空表也判为"未进入毕业环节"，否则会展示出默认的假数据。
        if (
            htmlStr.includes("未进入毕业环节") ||
            htmlStr.includes("无权访问") ||
            htmlStr.includes("未查询到数据") ||
            htmlStr.includes("暂无数据") ||
            !doc.querySelector("table")
        ) {
            return { empty: true, msg: "您目前处于非毕业设计阶段" };
        }

        const table = doc.querySelector("table");
        let title = "未选题";
        let report = "未提交";
        let count = "0次";
        let grade = "-";

        if (table) {
            const textContent = table.textContent || "";
            const titleMatch = textContent.match(/课题名称[:：]\s*([^\n]+)/);
            const reportMatch = textContent.match(/开题报告[:：]\s*([^\n]+)/);
            const countMatch = textContent.match(/过程指导[:：]\s*(\d+次)/);
            const gradeMatch = textContent.match(/最终成绩[:：]\s*([^\n]+)/);

            if (titleMatch) title = titleMatch[1].trim();
            if (reportMatch) report = reportMatch[1].trim();
            if (countMatch) count = countMatch[1].trim();
            if (gradeMatch) grade = gradeMatch[1].trim();
        }

        return {
            empty: false,
            title,
            report,
            guidanceCount: count,
            grade
        };
    }

    /**
     * 解析空教室查询响应页面。
     *
     * 教务网 jsjy_query2 返回的是一张"教室 × 节次"占用矩阵，而非普通列表：
     * - 页面里存在多个 id="dataList" 的表格，真正有数据的往往不是第一个；
     * - 首行是表头（第一格为空，其后每格是一个节次分组，如 "0102"、"030405"）；
     * - 数据行第一格是教室名（如 "汇新101(50/30)"），其后每格用 "◆" 标记该节次已被占用。
     *
     * 因此"空闲"的判定是：该行所有节次列均无占用标记。
     *
     * Args:
     *     htmlStr (string): /jsxsd/kbxx/jsjy_query2 响应的 HTML。
     *
     * Returns:
     *     string[]: 在查询时段内完全空闲的教室名称列表。
     */
    static parseClassrooms(htmlStr: string): string[] {
        const doc = this.getDoc(htmlStr);

        // 页面存在多个同 id 的表格，选取实际含数据行最多的那一个
        const table = pickRichestTable(doc, "table#dataList, table#Table1, table.Nsb_r_list");
        if (!table) {
            throw new ParseError("ServiceParser.parseClassrooms", "未找到教室占用表格");
        }

        const rooms: string[] = [];
        const rows = table.querySelectorAll("tr");
        // 「一间都不空」是合法业务结果，所以失败信号只能是「一行教室都认不出来」
        let recognizedRows = 0;

        // 首行为节次表头，从第 1 行开始才是教室数据
        for (let i = 1; i < rows.length; i++) {
            const tds = rows[i].querySelectorAll("td");
            if (tds.length < 2) continue;

            const name = tds[0].textContent?.replace(/ /g, " ").trim() || "";
            if (!name || name === "暂无数据" || name === "未查询到数据" || name === "教室名称") {
                continue;
            }

            recognizedRows++;

            // 任意一个节次列存在占用标记，则该教室在此时段不空闲
            let occupied = false;
            for (let c = 1; c < tds.length; c++) {
                const mark = tds[c].textContent?.replace(/ /g, "").trim() || "";
                if (mark) {
                    occupied = true;
                    break;
                }
            }

            if (!occupied) rooms.push(name);
        }

        if (recognizedRows === 0 && !hasEmptyMarker(htmlStr)) {
            throw new ParseError("ServiceParser.parseClassrooms", "教室表格存在但未识别出任何教室行");
        }

        return rooms;
    }
}
