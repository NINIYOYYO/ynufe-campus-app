import { ClassroomTestItem, ExamItem } from '../types/exam';
import { ParseError, buildHeaderIndex, cellText, hasEmptyMarker } from '../utils/tableUtils';

/**
 * 云南财经大学期末排考与随堂测试 DOM 解析器
 */
export class ExamParser {
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
     * 解析期初/期中/期末排考安排表格 HTML。
     *
     * 真实表头（13 列）：
     * [序号, 校区, 考场校区, 考试场次, 课程编号, 课程名称, 授课教师, 考试时间, 考场, 座位号, 准考证号, 备注, 操作]
     * 表格本身不含学年学期与考试类别，这两项由调用方按查询条件回填。
     *
     * Args:
     *     htmlStr (string): /jsxsd/xsks/xsksap_list 响应的 HTML。
     *     term (string): 查询所用的学年学期，用于回填。
     *     typeLabel (string): 查询所用的考试类别名称（期末/期中/期初）。
     *
     * Returns:
     *     ExamItem[]: 排考卡片结构化列表。
     */
    static parseExams(htmlStr: string, term: string = "", typeLabel: string = ""): ExamItem[] {
        const doc = this.getDoc(htmlStr);
        const exams: ExamItem[] = [];
        const dataTable = doc.querySelector("table#dataList") || doc.querySelector("table.Nsb_r_list");
        if (!dataTable) {
            throw new ParseError("ExamParser.parseExams", "未找到排考表格 (table#dataList)");
        }

        const head = buildHeaderIndex(dataTable);
        const rows = dataTable.querySelectorAll("tr");

        for (let i = 1; i < rows.length; i++) {
            const tds = rows[i].querySelectorAll("td");
            // "未查询到数据" 占位行只有 1 格，天然被此长度校验挡掉
            if (tds.length < 10) continue;

            const campus = cellText(tds, head, ["校区"], 1);
            const examSession = cellText(tds, head, ["考试场次"], 3);
            const courseId = cellText(tds, head, ["课程编号"], 4);
            const name = cellText(tds, head, ["课程名称"], 5);
            const teacher = cellText(tds, head, ["授课教师"], 6);
            const date = cellText(tds, head, ["考试时间"], 7);
            const room = cellText(tds, head, ["考场"], 8);
            const seatNo = cellText(tds, head, ["座位号"], 9) || "-";
            const admissionNo = cellText(tds, head, ["准考证号"], 10);
            const note = cellText(tds, head, ["备注"], 11);

            if (name && name !== "未查询到数据") {
                exams.push({
                    term,
                    courseName: name,
                    name,
                    time: date,
                    date,
                    location: room,
                    room,
                    seat: seatNo,
                    seatNo,
                    type: typeLabel || "考试",
                    courseId,
                    teacher,
                    campus,
                    examSession,
                    admissionNo,
                    note
                });
            }
        }

        if (exams.length === 0 && !hasEmptyMarker(htmlStr)) {
            throw new ParseError("ExamParser.parseExams", "排考表格存在但未解析出任何行");
        }
        return exams;
    }

    /**
     * 解析随堂测试安排。
     *
     * 真实表头（10 列）：
     * [学年学期, 课程编号, 课程名称, 考试周次, 考试星期, 考试节次, 监考老师, 考试教室, 考试时间, 考试类型]
     *
     * Args:
     *     htmlStr (string): /jsxsd/xsks/xsstk_list 响应的 HTML。
     *
     * Returns:
     *     ClassroomTestItem[]: 随堂测试列表。
     */
    static parseClassroomTests(htmlStr: string): ClassroomTestItem[] {
        const doc = this.getDoc(htmlStr);
        const tests: ClassroomTestItem[] = [];
        const dataTable = doc.querySelector("table#dataList") || doc.querySelector("table.Nsb_r_list");
        if (!dataTable) {
            throw new ParseError("ExamParser.parseClassroomTests", "未找到随堂考表格 (table#dataList)");
        }

        const head = buildHeaderIndex(dataTable);
        const rows = dataTable.querySelectorAll("tr");

        for (let i = 1; i < rows.length; i++) {
            const tds = rows[i].querySelectorAll("td");
            if (tds.length < 9) continue;

            const term = cellText(tds, head, ["学年学期"], 0);
            const courseId = cellText(tds, head, ["课程编号"], 1);
            const name = cellText(tds, head, ["课程名称"], 2);
            const week = cellText(tds, head, ["考试周次"], 3);
            const weekday = cellText(tds, head, ["考试星期"], 4);
            const period = cellText(tds, head, ["考试节次"], 5);
            const teacher = cellText(tds, head, ["监考老师"], 6);
            const room = cellText(tds, head, ["考试教室"], 7);
            const examTime = cellText(tds, head, ["考试时间"], 8);
            const type = cellText(tds, head, ["考试类型"], 9) || "普通";

            if (!name || name === "未查询到数据" || name === "暂无数据") continue;

            // 考试时间列可能为空，此时用"第 N 周 星期X 第 N 节"兜底展示
            const fallback = [
                week ? `第${week}周` : "",
                weekday ? `星期${weekday}` : "",
                period ? `第${period}节` : ""
            ].filter(Boolean).join(" ");

            tests.push({
                name,
                date: examTime || fallback || "-",
                room: room || "-",
                type,
                term,
                courseId,
                week,
                weekday,
                period,
                teacher
            });
        }

        if (tests.length === 0 && !hasEmptyMarker(htmlStr)) {
            throw new ParseError("ExamParser.parseClassroomTests", "随堂考表格存在但未解析出任何行");
        }
        return tests;
    }
}
