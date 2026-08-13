/**
 * 校内公告通知类型定义
 */
export interface AnnouncementItem {
    id?: string;
    title: string;
    date: string;
    url?: string;
}

/** 公告附件：展示名 + 教务网相对路径 */
export interface AnnouncementAttachment {
    name: string;
    url: string;
}

