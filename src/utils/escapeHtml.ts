/**
 * HTML 转义工具：所有从教务网页面解析出来、再拼接进 innerHTML 的文本
 * 必须先经过本函数，防止公告/课程名中的特殊字符破坏布局或注入脚本 (XSS)。
 */
export function escapeHtml(input: string | null | undefined): string {
    if (input === null || input === undefined) return "";
    return String(input)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
