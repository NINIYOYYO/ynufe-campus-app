/**
 * 选课活动项类型定义
 */
export interface XkActivityItem {
    name: string;
    type: string;
    timeRange: string;
    status: string;
    url: string;
}

/**
 * 毕业设计/实践环节信息类型定义
 */
export interface PracticeThesisInfo {
    empty: boolean;
    msg?: string;
    title?: string;
    report?: string;
    guidanceCount?: string;
    grade?: string;
}
