/**
 * 单条课程数据结构定义
 */
export interface CourseItem {
    name: string;
    day: number;           // 星期 1-7
    slot: number;          // 节次 1-10
    session?: number;      // 大节 1-5
    room: string;          // 教室
    teacher: string;       // 教师
    weeks: string;         // 周次描述文本
    code?: string;         // 课程编号
    isAdjusted?: boolean;  // 是否被调课（教务网以红色 O/P 标记）
    activeWeeks?: number[];// 具体生效的周次列表 [1,2,3...]
}

/**
 * 周次下拉选项定义
 */
export interface WeekOption {
    val: string;
    txt: string;
}

/**
 * 学期下拉选项定义
 */
export interface SemesterOption {
    value: string;
    text: string;
    selected?: boolean;
}

/**
 * 完整课表数据集
 */
export interface TimetableData {
    courses: CourseItem[];
    semesters: SemesterOption[];
    weeks?: WeekOption[];
    currentSemesterId?: string;
    currentWeek?: number; // 当前教务系统默认/选中的教学周 (1-20)
}

