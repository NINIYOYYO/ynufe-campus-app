import { GradeItem, GradeSummary, LevelGradeItem, ScoreComponent, ScoreDetail } from '../types/grade';
import { ParseError, buildHeaderIndex, buildMultiRowHeaderColumns, cellText, hasEmptyMarker, pickIndex } from '../utils/tableUtils';

/**
 * 云南财经大学期末成绩与社会等级考试 DOM 解析器
 */
export class GradeParser {
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
     * 解析期末成绩页面提取官方 GPA、已修总学分、学期列表及成绩明细。
     *
     * Args:
     *     htmlStr (string): /jsxsd/kscj/cjcx_list?xsfs=all 响应的 HTML。
     *
     * Returns:
     *     GradeSummary: 成绩概览与列表数据结构。
     */
    static parseGrades(htmlStr: string): GradeSummary {
        const doc = this.getDoc(htmlStr);

        // 1. 解析头部的官方总平均绩点与总学分
        // 该接口返回的是不带 <body> 的 HTML 片段，浏览器会自动补全，
        // 但在非浏览器 DOM 实现下 body 可能为空，故回退到原始文本兜底。
        const headerText = doc.body?.textContent || htmlStr;
        const gpaMatch = headerText.match(/平均学分绩点[:：]\s*([\d.]+)/);
        const creditMatch = headerText.match(/所修总学分[:：]\s*([\d.]+)/);

        const gpa = gpaMatch ? parseFloat(gpaMatch[1]).toFixed(2) : "0.00";
        const totalCredits = creditMatch ? parseFloat(creditMatch[1]).toFixed(1) : "0.0";

        // 2. 遍历成绩表格提取课程明细（列按表头名定位，避免教务网调整列序后静默错位）
        const gradesList: GradeItem[] = [];
        const semesterSet = new Set<string>();
        const dataTable = doc.querySelector("table#dataList") || doc.querySelector("table.Nsb_r_list");
        if (!dataTable) {
            throw new ParseError("GradeParser.parseGrades", "未找到成绩表格 (table#dataList)");
        }

        const head = buildHeaderIndex(dataTable);
        const scoreIdx = pickIndex(head, ["成绩"], 5);

        const rows = dataTable.querySelectorAll("tr");
        for (let i = 1; i < rows.length; i++) {
            const tds = rows[i].querySelectorAll("td");
            if (tds.length < 10) continue;

            const semester = cellText(tds, head, ["开课学期"], 1);
            const courseId = cellText(tds, head, ["课程编号"], 2);
            const courseName = cellText(tds, head, ["课程名称"], 3);

            // 成绩列可能是一个可点开明细的链接
            const scoreCell = tds[scoreIdx];
            const scoreLink = scoreCell ? scoreCell.querySelector("a") : null;
            const score = scoreLink
                ? scoreLink.textContent?.trim() || ""
                : (scoreCell ? scoreCell.textContent?.trim() || "" : "");

            // 成绩链接同时是「成绩构成明细」的入口：
            // javascript:openWindow('/jsxsd/kscj/pscj_list.do?...')
            let detailUrl = "";
            if (scoreLink) {
                const m = (scoreLink.getAttribute("href") || "")
                    .match(/openWindow\(\s*['"]([^'"]+)['"]/);
                if (m && m[1].includes("pscj_list")) detailUrl = m[1];
            }

            const creditStr = cellText(tds, head, ["学分"], 7) || "0";
            const hours = cellText(tds, head, ["总学时"], 8) || "-";
            const point = cellText(tds, head, ["绩点"], 9) || "0";
            const category = cellText(tds, head, ["课程属性"], 13);
            const groupName = cellText(tds, head, ["分组名"], 4);
            const assessMode = cellText(tds, head, ["考核方式"], 11);
            const examNature = cellText(tds, head, ["考试性质"], 12);
            const courseNature = cellText(tds, head, ["课程性质"], 14);

            if (semester) semesterSet.add(semester);
            if (courseName) {
                gradesList.push({
                    semester,
                    courseId,
                    courseName,
                    score,
                    credit: creditStr,
                    gpa: point,
                    hours,
                    point,
                    category,
                    groupName,
                    assessMode,
                    examNature,
                    courseNature,
                    detailUrl
                });
            }
        }

        // 表格在、却一行都认不出来，且页面没有「无数据」占位 → 结构已变，必须报错而非返回空列表
        if (gradesList.length === 0 && !hasEmptyMarker(headerText || htmlStr)) {
            throw new ParseError("GradeParser.parseGrades", "成绩表格存在但未解析出任何行");
        }

        const sortedSemesters = Array.from(semesterSet).sort().reverse();

        return {
            gpa,
            totalCredits,
            coursesCount: gradesList.length,
            semesters: sortedSemesters,
            gradesList
        };
    }

    /**
     * 解析单门课程的成绩构成明细。
     *
     * 真实表头（8 列）：
     * [序号, 期末成绩, 期末成绩比例, 期中成绩, 期中成绩比例, 平时成绩, 平时成绩比例, 总成绩]
     * 未参与考核的项（如无期中）分数与比例为空或 0，此处会被过滤掉，
     * 只保留真实存在的构成项。
     *
     * Args:
     *     htmlStr (string): /jsxsd/kscj/pscj_list.do 响应的 HTML。
     *
     * Returns:
     *     ScoreDetail: 构成项列表与总成绩。
     */
    static parseScoreDetail(htmlStr: string): ScoreDetail {
        const doc = this.getDoc(htmlStr);
        const dataTable = doc.querySelector("table#dataList") || doc.querySelector("table.Nsb_r_list");
        if (!dataTable) {
            throw new ParseError("GradeParser.parseScoreDetail", "未找到成绩构成表格");
        }

        const head = buildHeaderIndex(dataTable);
        const rows = dataTable.querySelectorAll("tr");

        for (let i = 1; i < rows.length; i++) {
            const tds = rows[i].querySelectorAll("td");
            if (tds.length < 8) continue;

            const pairs: Array<[string, string, string]> = [
                ["期末成绩", "期末成绩", "期末成绩比例"],
                ["期中成绩", "期中成绩", "期中成绩比例"],
                ["平时成绩", "平时成绩", "平时成绩比例"],
            ];
            const components: ScoreComponent[] = [];
            pairs.forEach(([label, scoreKey, ratioKey], idx) => {
                const score = cellText(tds, head, [scoreKey], 1 + idx * 2);
                const ratio = cellText(tds, head, [ratioKey], 2 + idx * 2);
                // 该项未参与考核时分数与比例均为空/零，不展示
                const meaningful = score && score !== "0" && ratio && ratio !== "0%";
                if (meaningful) components.push({ label, score, ratio });
            });

            const total = cellText(tds, head, ["总成绩"], 7);
            if (components.length > 0 || total) {
                return { components, total };
            }
        }

        if (!hasEmptyMarker(htmlStr)) {
            throw new ParseError("GradeParser.parseScoreDetail", "成绩构成表格存在但未解析出数据行");
        }
        return { components: [], total: "" };
    }

    /**
     * 解析等级考试成绩 (英语四六级、计算机等级考试等)。
     *
     * Args:
     *     htmlStr (string): /jsxsd/kscj/djkscj_list 响应的 HTML。
     *
     * Returns:
     *     LevelGradeItem[]: 等级考试成绩明细列表。
     *
     * Raises:
     *     ParseError: 当未找到等级考试表格或解析结构异常时抛出。
     */
    static parseLevelGrades(htmlStr: string): LevelGradeItem[] {
        const doc = this.getDoc(htmlStr);
        const levelGrades: LevelGradeItem[] = [];
        const dataTable = doc.querySelector("table#dataList") || doc.querySelector("table.Nsb_r_list");
        if (!dataTable) {
            throw new ParseError("GradeParser.parseLevelGrades", "未找到等级考试表格 (table#dataList)");
        }

        const headerCols = buildMultiRowHeaderColumns(dataTable);

        const findCol = (pattern: RegExp, fallback: number): number => {
            const found = headerCols.findIndex(h => pattern.test(h));
            return found !== -1 ? found : fallback;
        };

        const nameIdx = findCol(/课程|科目|项目|考试名称/i, 1);
        const writtenIdx = findCol(/分数.*笔试|笔试.*分数/i, 2);
        const machineIdx = findCol(/分数.*机试|机试.*分数/i, 3);
        const totalIdx = findCol(/分数.*总(?:成绩|分)|(?:总成绩|总分).*分数|^总成绩$|^(?:分数类成绩|分数成绩|分数)$/i, 4);
        const lvWrittenIdx = findCol(/等级.*笔试|笔试.*等级/i, 5);
        const lvMachineIdx = findCol(/等级.*机试|机试.*等级/i, 6);
        const lvTotalIdx = findCol(/等级.*总(?:成绩|分|评)|(?:总成绩|总分|总评).*等级|^总评$|^(?:等级类成绩|等级成绩|等级)$/i, 7);
        const dateIdx = findCol(/时间|日期/i, 8);

        const minCols = Math.max(nameIdx, dateIdx) + 1;

        /** 判断成绩单元格是否为有效成绩（教务网用 "0" / 空串表示该项无成绩）。 */
        const isMeaningful = (v: string): boolean => !!v && v !== "0" && v !== "0.0" && v !== "-";

        const rows = dataTable.querySelectorAll("tr");
        const hasThHeaders = dataTable.querySelectorAll("th").length > 0;
        const startRow = hasThHeaders ? 0 : 1;
        for (let i = startRow; i < rows.length; i++) {
            if (rows[i].querySelectorAll("th").length > 0) continue;
            const tds = rows[i].querySelectorAll("td");
            if (tds.length < minCols) continue;

            const name = tds[nameIdx]?.textContent?.trim() || "";
            if (!name || name === "未查询到数据" || name === "暂无数据") continue;

            const written = tds[writtenIdx]?.textContent?.trim() || "";
            const machine = tds[machineIdx]?.textContent?.trim() || "";
            const total = tds[totalIdx]?.textContent?.trim() || "";
            const lvWritten = tds[lvWrittenIdx]?.textContent?.trim() || "";
            const lvMachine = tds[lvMachineIdx]?.textContent?.trim() || "";
            const lvTotal = tds[lvTotalIdx]?.textContent?.trim() || "";
            const date = tds[dateIdx]?.textContent?.trim() || "-";

            // 展示用主成绩：优先分数类（总成绩→笔试→机试），再退化到等级类
            const levelResult = [lvTotal, lvWritten, lvMachine].find(isMeaningful) || "";
            const score = [total, written, machine].find(isMeaningful) || levelResult || "-";

            levelGrades.push({
                name,
                score,
                date,
                written,
                machine,
                total,
                levelResult
            });
        }

        if (levelGrades.length === 0 && !hasEmptyMarker(htmlStr)) {
            throw new ParseError("GradeParser.parseLevelGrades", "等级考试表格存在但未解析出任何行");
        }
        return levelGrades;
    }
}
