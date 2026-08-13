import { Logger } from '../utils/logger';

/**
 * DebugOverlay: 手机端实时运行日志浮窗与可视化排查控制台
 *
 * 职责：在 App 界面右下角提供一个轻量级的 【🐞 调试日志】 浮动按钮，
 * 点击后弹出全屏/半屏调试日志面板，支持实时抓取网络 Cookie、Session 恢复过程、
 * 请求响应头及掉线原因，一键复制日志文本。
 */
export class DebugOverlay {
    private static container: HTMLElement | null = null;
    private static modal: HTMLElement | null = null;
    private static isVisible = false;

    /**
     * 初始化调试控制台悬浮按钮与面板。
     */
    static init(): void {
        if (document.getElementById("debug-overlay-btn")) return;

        // 1. 创建右下角悬浮按钮
        const btn = document.createElement("button");
        btn.id = "debug-overlay-btn";
        btn.innerHTML = "🐞 调试日志";
        btn.style.cssText = `
            position: fixed;
            bottom: 75px;
            right: 16px;
            z-index: 99999;
            background: rgba(15, 23, 42, 0.85);
            color: #38bdf8;
            border: 1px solid rgba(56, 189, 248, 0.4);
            backdrop-filter: blur(8px);
            padding: 8px 14px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: bold;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            cursor: pointer;
            transition: all 0.2s ease;
        `;
        btn.onclick = () => this.toggleModal();
        document.body.appendChild(btn);

        // 2. 创建日志弹窗
        const modal = document.createElement("div");
        modal.id = "debug-overlay-modal";
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0, 0, 0, 0.75);
            backdrop-filter: blur(10px);
            z-index: 100000;
            display: none;
            flex-direction: column;
            box-sizing: border-box;
            padding: 16px;
            color: #e2e8f0;
            font-family: monospace;
        `;

        modal.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; border-bottom: 1px solid #334155; padding-bottom: 8px;">
                <h3 style="margin: 0; color: #38bdf8; font-size: 16px;">🐞 实时运行调试日志</h3>
                <div>
                    <button id="debug-copy-btn" style="background: #0284c7; color: white; border: none; padding: 5px 10px; border-radius: 6px; margin-right: 6px; font-size: 12px;">复制全量日志</button>
                    <button id="debug-clear-btn" style="background: #475569; color: white; border: none; padding: 5px 10px; border-radius: 6px; margin-right: 6px; font-size: 12px;">清空</button>
                    <button id="debug-close-btn" style="background: #ef4444; color: white; border: none; padding: 5px 10px; border-radius: 6px; font-size: 12px;">关闭</button>
                </div>
            </div>
            <div id="debug-logs-container" style="flex: 1; overflow-y: auto; background: #090d16; border-radius: 8px; padding: 12px; border: 1px solid #1e293b; font-size: 11px; line-height: 1.5;">
            </div>
        `;

        document.body.appendChild(modal);
        this.modal = modal;

        document.getElementById("debug-close-btn")?.addEventListener("click", () => this.toggleModal(false));
        document.getElementById("debug-clear-btn")?.addEventListener("click", () => Logger.clear());
        document.getElementById("debug-copy-btn")?.addEventListener("click", () => {
            const allText = Logger.getLogs().map(l => `[${l.time}] [${l.level.toUpperCase()}] ${l.msg}`).join("\n");
            navigator.clipboard.writeText(allText).then(() => {
                alert("日志已复制到剪贴板！");
            }).catch(() => {
                alert("复制失败，请手动选择复制。");
            });
        });

        Logger.subscribe(() => this.renderLogs());
        this.renderLogs();
    }

    /**
     * 切换调试日志面板显隐状态。
     *
     * Args:
     *     show (boolean, optional): 显隐标记；不传时取反。
     */
    static toggleModal(show?: boolean): void {
        this.isVisible = show !== undefined ? show : !this.isVisible;
        if (this.modal) {
            this.modal.style.display = this.isVisible ? "flex" : "none";
            if (this.isVisible) this.renderLogs();
        }
    }

    /**
     * 将 Logger 中的最新日志渲染到界面上。
     */
    private static renderLogs(): void {
        const container = document.getElementById("debug-logs-container");
        if (!container) return;

        const logs = Logger.getLogs();
        if (logs.length === 0) {
            container.innerHTML = `<div style="color: #64748b; text-align: center; margin-top: 20px;">暂无日志数据</div>`;
            return;
        }

        container.innerHTML = logs.map(l => {
            let color = "#38bdf8"; // info
            if (l.level === "warn") color = "#fbbf24";
            if (l.level === "error") color = "#f87171";
            return `<div style="margin-bottom: 6px; border-bottom: 1px solid #1e293b; padding-bottom: 4px;">
                <span style="color: #64748b;">[${l.time}]</span>
                <span style="color: ${color}; font-weight: bold; margin: 0 4px;">[${l.level.toUpperCase()}]</span>
                <span style="color: #f1f5f9; word-break: break-all;">${this.escapeHtml(l.msg)}</span>
            </div>`;
        }).join("");
    }

    private static escapeHtml(str: string): string {
        return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
}
