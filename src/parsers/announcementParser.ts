import { AnnouncementItem } from '../types/announcement';
import { ParseError, buildHeaderIndex, hasEmptyMarker, pickIndex } from '../utils/tableUtils';

/**
 * 云南财经大学校内公告通知 DOM 解析器
 */
export class AnnouncementParser {
    /**
     * 实例化 DOM HTML 文档对象。
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
     * 解析教务网最新公告通知列表。
     *
     * Args:
     *     htmlStr (string): /jsxsd/ggly/ysgg_query 响应的 HTML。
     *
     * Returns:
     *     AnnouncementItem[]: 包含了标题、时间与相对 URL 的公告对象列表。
     */
    static parseAnnouncements(htmlStr: string): AnnouncementItem[] {
        const doc = this.getDoc(htmlStr);
        const list: AnnouncementItem[] = [];
        const dataTable = doc.querySelector("table#dataList") || doc.querySelector("table.Nsb_r_list");

        if (dataTable) {
            // 真实表头：[序号, 标题, 类别, 发送人, 发送时间, 操作]
            // 注意：标题列是纯文本，跳转链接在"操作"列的 javascript:openWindow('/jsxsd/...') 里
            const head = buildHeaderIndex(dataTable);
            const titleIdx = pickIndex(head, ["标题"], 1);
            const dateIdx = pickIndex(head, ["发送时间", "发布时间"], 4);
            const actionIdx = pickIndex(head, ["操作"], -1);

            const rows = dataTable.querySelectorAll("tr");
            for (let i = 1; i < rows.length; i++) {
                const tds = rows[i].querySelectorAll("td");
                if (tds.length >= 5) {
                    const titleCell = tds[titleIdx];
                    if (!titleCell) continue;
                    const titleLink = titleCell.querySelector("a");
                    const title = (titleLink ? titleLink.textContent : titleCell.textContent)?.trim() || "";
                    const date = tds[dateIdx] ? tds[dateIdx].textContent?.trim() || "" : "";

                    // 从"操作"列提取真实公告地址
                    let url = "";
                    const actionCell = actionIdx >= 0 ? tds[actionIdx] : tds[tds.length - 1];
                    const actionLink = (actionCell ? actionCell.querySelector("a") : null) || titleLink;
                    if (actionLink) {
                        const href = actionLink.getAttribute("href") || "";
                        const jsMatch = href.match(/openWindow\(\s*['"]([^'"]+)['"]/);
                        if (jsMatch) {
                            url = jsMatch[1];
                        } else if (href && !href.startsWith("javascript:")) {
                            url = href;
                        }
                    }

                    if (title && title !== "未查询到数据" && title !== "暂无数据") {
                        list.push({ title, date, url });
                    }
                }
            }
        }

        // 主表解析不出内容且页面没有「无数据」占位时，说明结构已变
        if (!dataTable) {
            throw new ParseError("AnnouncementParser", "未找到公告表格 (table#dataList)");
        }

        // 备用兼容解析逻辑
        if (list.length === 0) {
            const rows = doc.querySelectorAll("table tr, ul li, .ann-item");
            rows.forEach(r => {
                const a = r.querySelector("a");
                if (a) {
                    const title = a.textContent?.trim() || "";
                    const url = a.getAttribute("href") || "";
                    const dateMatch = r.textContent?.match(/\d{4}-\d{2}-\d{2}/);
                    const date = dateMatch ? dateMatch[0] : "近期";

                    if (title && title.length > 3) {
                        list.push({ title, date, url });
                    }
                }
            });
        }

        if (list.length === 0 && !hasEmptyMarker(htmlStr)) {
            throw new ParseError("AnnouncementParser", "公告表格存在但未解析出任何行");
        }

        return list;
    }
}
