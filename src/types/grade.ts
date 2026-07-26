/**
 * 单门课程期末成绩明细
 */
export interface GradeItem {
    courseName: string;
    score: string;
    gpa: string;
    credit: string;
    semester: string;
    courseId?: string;
    hours?: string;
    point?: string;
    category?: string;
}

/**
 * 社会等级考试成绩 (英语四六级等)
 *
 * 对应教务网 djkscj_list 的真实表头：
 * [序号, 考级课程(等级), 分数类成绩(笔试/机试/总成绩), 等级类成绩(笔试/机试/总成绩), 考级时间]
 */
export interface LevelGradeItem {
    /** 考级课程(等级)，如"大学英语考试（大学英语考试四级全校）" */
    name: string;
    /** 用于展示的主成绩（在分数类/等级类中挑选出的有效值） */
    score: string;
    /** 考级时间 */
    date: string;
    /** 分数类成绩-笔试 */
    written?: string;
    /** 分数类成绩-机试 */
    machine?: string;
    /** 分数类成绩-总成绩 */
    total?: string;
    /** 等级类成绩（笔试/机试/总成绩中的有效值） */
    levelResult?: string;
}

/**
 * 成绩统计概览及列表
 */
export interface GradeSummary {
    gpa: string;
    totalCredits: string;
    coursesCount: number;
    semesters?: string[];
    gradesList: GradeItem[];
    levelGrades?: LevelGradeItem[];
}
