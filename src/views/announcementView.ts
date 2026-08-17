import { YnufeClient, SessionExpiredError } from '../api/client';
import { AnnouncementParser } from '../parsers/announcementParser';
import { AnnouncementItem } from '../types/announcement';
import { StorageKeys } from '../config/storageKeys';
import { CacheService } from '../services/cacheService';
import { BottomSheet } from '../components/bottomSheet';
import { escapeHtml } from '../utils/escapeHtml';
import { isSameAsRendered, playEntrance, showToast } from '../utils/uiFeedback';
import { withViewLoading, renderEmptyState } from '../utils/viewHelper';

/**
 * 校内公告通知视图控制器
 */
export class AnnouncementView {
    /**
     * 拉取最新公告列表并渲染。
     *
     * Returns:
     *     Promise<boolean>: 是否成功。
     */
    static async loadAnnouncementsData(): Promise<boolean> {
        const result = await withViewLoading({
            silent: true,
            moduleName: "公告"
        }, async () => {
            const html = await YnufeClient.getHtml("/jsxsd/ggly/ysgg_query");
            const list = AnnouncementParser.parseAnnouncements(html);
            this.renderAnnouncementsList(list);
            CacheService.set(StorageKeys.ANNOUNCEMENTS_CACHE, list);
            return true;
        });

        return result ?? false;
    }

    /**
     * 渲染公告通知列表前 5 条卡片。
     *
     * Args:
     *     list (AnnouncementItem[]): 公告列表。
     */
    static renderAnnouncementsList(list: AnnouncementItem[]): void {
        const container = document.getElementById("home-announcements-list");
        if (!container) return;
        if (container.childElementCount > 0 && isSameAsRendered("announcements", list)) return;
        container.innerHTML = "";

        if (!Array.isArray(list) || list.length === 0) {
            const bellSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.4; margin-bottom:10px;"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path></svg>`;
            renderEmptyState(container, "暂无新公告", bellSvg);
            return;
        }

        list.slice(0, 5).forEach(ann => {
            const card = document.createElement("div");
            card.className = "announce-card glass-card";
            card.innerHTML = `
                <div class="announce-left">
                    <div class="announce-title">${escapeHtml(ann.title)}</div>
                    <div class="announce-date"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px; vertical-align: middle;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect></svg>${escapeHtml(ann.date)}</div>
                </div>
                <div style="color:var(--text-secondary); display:flex; align-items:center;">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
                </div>
            `;
            card.addEventListener("click", () => this.showAnnouncementDetail(ann));
            container.appendChild(card);
        });
        playEntrance(container);
    }

    /**
     * 在 BottomSheet 中弹窗展示公告详情。
     *
     * Args:
     *     ann (AnnouncementItem): 目标公告对象。
     */
    static async showAnnouncementDetail(ann: AnnouncementItem): Promise<void> {
        BottomSheet.show(ann.title, "通知", `
            <div class="ann-detail-meta">${escapeHtml(ann.date)}</div>
            <div class="ann-detail-body" id="ann-detail-body">
                <div class="ann-detail-hint">正在加载公告正文…</div>
            </div>
        `);

        const body = document.getElementById("ann-detail-body");
        if (!body) return;

        if (!ann.url) {
            body.innerHTML = `<div class="ann-detail-hint">该公告未提供详情链接</div>`;
            return;
        }

        try {
            const [html] = await Promise.all([
                YnufeClient.getHtml(ann.url),
                BottomSheet.settled()
            ]);
            const detail = AnnouncementParser.parseDetail(html, ann.url);

            if (!detail.paragraphs.length && !detail.attachments.length) {
                body.innerHTML = `<div class="ann-detail-hint">未能提取到正文内容</div>`;
                return;
            }

            const paragraphs = detail.paragraphs
                .map(p => `<p>${escapeHtml(p)}</p>`)
                .join("");
            const attachments = detail.attachments.length
                ? `<div class="ann-detail-files"><small>附件</small>${
                      detail.attachments.map((f, i) =>
                          `<button type="button" class="ann-attach-btn" data-idx="${i}">${escapeHtml(f.name)}</button>`
                      ).join("")
                  }</div>`
                : "";

            await BottomSheet.morphHeight(() => {
                body.innerHTML = `<div class="sheet-swap-in">${paragraphs + attachments}</div>`;
            });

            body.querySelectorAll(".ann-attach-btn").forEach(btn => {
                btn.addEventListener("click", () => {
                    const idx = parseInt(btn.getAttribute("data-idx") || "-1", 10);
                    const file = detail.attachments[idx];
                    if (file) this.downloadAttachment(file.url, file.name, ann.url);
                });
            });
        } catch (e) {
            await BottomSheet.settled();
            const reason = e instanceof SessionExpiredError ? "登录已过期" : "加载失败，请稍后重试";
            body.innerHTML = `<div class="ann-detail-hint">${escapeHtml(reason)}</div>`;
        }
    }

    /**
     * 生成教务网附件的多候选路径列表（自动适配 /ewebeditor、/jsxsd/ewebeditor、/uploadfile 等历史路径部署差异）。
     *
     * Args:
     *     originalPath (string): 原始相对路径。
     *
     * Returns:
     *     string[]: 候选路径列表。
     */
    private static getAttachmentCandidates(originalPath: string): string[] {
        const candidates: string[] = [];
        const trimmed = originalPath.startsWith('/') ? originalPath : `/${originalPath}`;

        const uploadMatch = trimmed.match(/(?:uploadfile|uploadfiles)\/([^?#]+)/i);
        if (uploadMatch && uploadMatch[1]) {
            const filename = uploadMatch[1].replace(/^\.?\/?/, "");
            candidates.push(`/ewebeditor/uploadfile/${filename}`);
            candidates.push(`/uploadfiles/${filename}`);
            candidates.push(`/uploadfile/${filename}`);
            candidates.push(`/jsxsd/ewebeditor/uploadfile/${filename}`);
            candidates.push(`/jsxsd/uploadfile/${filename}`);
        } else {
            candidates.push(trimmed);
            if (trimmed.startsWith('/ewebeditor/')) {
                candidates.push(`/jsxsd${trimmed}`);
            } else if (!trimmed.startsWith('/jsxsd/')) {
                candidates.push(`/jsxsd${trimmed}`);
            }
        }

        return Array.from(new Set(candidates));
    }

    /**
     * 下载公告附件（带二进制与 HTML 拦截校验、多候选路径容错与 ObjectURL 延迟释放保护）。
     *
     * Args:
     *     url (string): 附件相对路径。
     *     name (string): 保存文件名。
     *     refererUrl (string, optional): 公告详情页面地址。
     */
    static async downloadAttachment(url: string, name: string, refererUrl?: string): Promise<void> {
        showToast(`正在获取「${name}」…`, "info");
        try {
            const candidates = this.getAttachmentCandidates(url);
            let successBlob: Blob | null = null;

            for (const targetUrl of candidates) {
                try {
                    const { blob, contentType } = await YnufeClient.getBlob(targetUrl, refererUrl);
                    if (contentType.includes("text/html") || blob.size < 4096) {
                        const head = await blob.slice(0, 4096).text();
                        if (
                            head.includes("非法访问") ||
                            head.includes("出错页面") ||
                            head.includes("404 error") ||
                            head.includes("404 错误") ||
                            head.includes("页面不存在") ||
                            head.includes("未找到文件") ||
                            head.includes("SYSTEM_LOGIN") ||
                            head.includes("sys/login.jsp")
                        ) {
                            continue;
                        }
                    }
                    successBlob = blob;
                    break;
                } catch {
                    // 尝试下一个候选路径
                }
            }

            if (!successBlob) {
                showToast("教务系统限制了该附件的直接下载或文件已下架", "warn");
                return;
            }

            const objectUrl = URL.createObjectURL(successBlob);
            const a = document.createElement("a");
            a.href = objectUrl;
            a.download = name;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.setTimeout(() => {
                URL.revokeObjectURL(objectUrl);
            }, 1500);
            showToast(`「${name}」已开始下载`, "success");
        } catch (e) {
            if (e instanceof SessionExpiredError) {
                showToast("登录已过期，请重新登录后再试", "warn");
            } else {
                console.error("[YnufeUI] 附件下载失败:", e);
                showToast("附件下载失败，请检查网络", "error");
            }
        }
    }
}
