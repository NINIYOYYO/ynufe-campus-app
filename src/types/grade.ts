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
    /** 课程属性（必修/选修等） */
    category?: string;
    /** 分组名 */
    groupName?: string;
    /** 考核方式（考试/考查） */
    assessMode?: string;
    /** 考试性质（正常考试/补考等） */
    examNature?: string;
    /** 课程性质（如思想政治理论课） */
    courseNature?: string;
    /** 成绩明细页地址（pscj_list.do），可查期末/期中/平时构成 */
    detailUrl?: string;
}

/**
 * 单门课程的成绩构成明细。
 *
 * 对应 pscj_list.do 的真实表头：
 * [序号, 期末成绩, 期末成绩比例, 期中成绩, 期中成绩比例, 平时成绩, 平时成绩比例, 总成绩]
 */
export interface ScoreComponent {
    /** 展示名，如「期末成绩」 */
    label: string;
    /** 分数 */
    score: string;
    /** 占比，如 "40%"；无占比时为空 */
    ratio: string;
}

export interface ScoreDetail {
    components: ScoreComponent[];
    /** 总成绩 */
    total: string;
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
