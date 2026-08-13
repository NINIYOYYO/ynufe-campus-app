/**
 * 期末/期中/期初排考安排
 *
 * 对应教务网 xsksap_list 的真实表头：
 * [序号, 校区, 考场校区, 考试场次, 课程编号, 课程名称, 授课教师, 考试时间, 考场, 座位号, 准考证号, 备注, 操作]
 */
export interface ExamItem {
    /** 学年学期（表格中不含该列，由查询参数回填） */
    term?: string;
    courseName: string;
    /** courseName 的别名，保留供旧渲染代码使用 */
    name?: string;
    /** 考试时间，与 date 同值 */
    time?: string;
    date?: string;
    /** 考场，与 room 同值 */
    location?: string;
    room?: string;
    /** 座位号，与 seatNo 同值 */
    seat?: string;
    seatNo?: string;
    /** 考试类别（期末/期中/期初，由查询参数回填） */
    type?: string;
    courseId?: string;
    teacher?: string;
    campus?: string;
    examSession?: string;
    admissionNo?: string;
    note?: string;
}

/**
 * 随堂测试安排
 *
 * 对应教务网 xsstk_list 的真实表头：
 * [学年学期, 课程编号, 课程名称, 考试周次, 考试星期, 考试节次, 监考老师, 考试教室, 考试时间, 考试类型]
 */
export interface ClassroomTestItem {
    name: string;
    /** 考试时间 */
    date: string;
    /** 考试教室 */
    room: string;
    /** 考试类型 */
    type: string;
    term?: string;
    courseId?: string;
    /** 考试周次 */
    week?: string;
    /** 考试星期 */
    weekday?: string;
    /** 考试节次 */
    period?: string;
    /** 监考老师 */
    teacher?: string;
}
