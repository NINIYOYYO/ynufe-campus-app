import { AnnouncementItem } from '../types/announcement';
import { AppConfig } from '../config';
import { ParseError, buildHeaderIndex, hasEmptyMarker, pickIndex } from '../utils/tableUtils';

/** 公告附件：展示名 + 教务网相对路径 */
export interface AnnouncementAttachment {
    name: string;
    url: string;
}

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

    /**
     * 解析公告详情页正文与附件。
     *
     * Args:
     *     htmlStr (string): /jsxsd/ggly/ggly_show?ggid=... 响应的 HTML。
     *
     * Returns:
     *     { paragraphs: string[]; attachments: string[] }: 正文段落与附件名列表。
     */
    /**
     * 把详情页里的链接地址解析为「可安全使用的教务网相对路径」。
     *
     * 详情页 HTML 来自第三方，其中的 href 会被写进 <a>，因此必须先做白名单校验：
     * 拒绝 javascript: 等伪协议，并且只允许指向教务网自身的资源。
     *
     * Args:
     *     href (string): 原始 href。
     *     pageUrl (string): 详情页自身地址，用于解析相对路径。
     *
     * Returns:
     *     string | null: 形如 "/jsxsd/..." 的相对路径；不安全或非教务网资源时为 null。
     */
    static safeResourcePath(href: string, pageUrl: string): string | null {
        const raw = (href || "").trim();
        if (!raw || raw.startsWith("#")) return null;
        // 伪协议一律拒绝（javascript:、data:、vbscript: 等）
        if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^https?:/i.test(raw)) return null;

        try {
            const origin = new URL(AppConfig.TARGET_HOST).origin;
            const base = new URL(pageUrl || "/", origin);
            const resolved = new URL(raw, base);
            if (resolved.origin !== origin) return null;
            return resolved.pathname + resolved.search;
        } catch {
            return null;
        }
    }

    static parseDetail(htmlStr: string, pageUrl: string = ""): { paragraphs: string[]; attachments: AnnouncementAttachment[] } {
        const doc = this.getDoc(htmlStr);
        doc.querySelectorAll("script, style").forEach(el => el.remove());

        // 正文容器：优先取已知选择器，都不命中时退化为「文字最多的块级元素」。
        // 强智各部署的容器命名不一致，这里保持宽松，解析不到时由 UI 层如实提示。
        const KNOWN = ["#ggnr", ".ggnr", "#ggnrtd", "#content", ".content", ".Nsb_layout_r"];
        let container: Element | null = null;
        for (const sel of KNOWN) {
            const el = doc.querySelector(sel);
            if (el && (el.textContent || "").trim().length > 20) {
                container = el;
                break;
            }
        }
        if (!container) {
            let bestLen = 0;
            doc.querySelectorAll("td, div, article, section").forEach(el => {
                // 只考虑不再包含同类块级子节点的「叶子块」，避免整页被当成正文
                if (el.querySelector("td, div, article, section")) return;
                const len = (el.textContent || "").trim().length;
                if (len > bestLen) {
                    bestLen = len;
                    container = el;
                }
            });
        }
        if (!container) return { paragraphs: [], attachments: [] };

        const paragraphs = (container.textContent || "")
            .split(/\r?\n/)
            .map(s => s.replace(/ /g, " ").trim())
            .filter(s => s.length > 0);

        // 附件：详情页里指向教务网自身资源的链接。
        // 不再按 href 关键字猜测「像不像附件」——那样既会漏也会误判，
        // 而是收录所有安全且非本页自身的链接，并保留真实地址供下载。
        const attachments: AnnouncementAttachment[] = [];
        const seen = new Set<string>();
        doc.querySelectorAll("a[href]").forEach(a => {
            const name = a.textContent?.replace(/ /g, " ").trim() || "";
            if (!name) return;

            const path = this.safeResourcePath(a.getAttribute("href") || "", pageUrl);
            if (!path || seen.has(path)) return;
            // 跳过指向公告详情页自身的链接（返回、打印之类）
            if (pageUrl && path === pageUrl.split("#")[0]) return;

            seen.add(path);
            attachments.push({ name, url: path });
        });

        return { paragraphs, attachments };
    }
}
