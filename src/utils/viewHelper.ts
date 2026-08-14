import { escapeHtml } from './escapeHtml';
import { showLoading, handleLoadError } from './uiFeedback';

/**
 * 视图层通用加载、空状态及容错处理辅助工具。
 */

/**
 * 通用视图异步数据请求包装器（统一管理 Loading 弹窗与异常捕获）。
 *
 * Args:
 *     options (Object):
 *         - silent (boolean, optional): 是否静默执行（不弹出全屏加载动画）。
 *         - loadingText (string, optional): 加载中文案。
 *         - moduleName (string): 模块名称（用于错误提示归类）。
 *     task (Function): 实际执行的异步数据获取与渲染逻辑。
 *
 * Returns:
 *     Promise<T | null>: 成功时返回任务返回值，失败时统一捕获并返回 null。
 */
export async function withViewLoading<T>(
    options: { silent?: boolean; loadingText?: string; moduleName: string },
    task: () => Promise<T>
): Promise<T | null> {
    if (!options.silent && options.loadingText) {
        showLoading(true, options.loadingText);
    }
    try {
        return await task();
    } catch (err) {
        handleLoadError(options.moduleName, err);
        return null;
    } finally {
        if (!options.silent) {
            showLoading(false);
        }
    }
}

/**
 * 向容器中渲染标准化的空数据占位界面（纯 SVG 图标与自适应提示）。
 *
 * Args:
 *     container (HTMLElement | null): 目标 DOM 容器。
 *     message (string): 提示文案。
 *     customSvg (string, optional): 自定义 SVG 图标字符串。
 */
export function renderEmptyState(
    container: HTMLElement | null,
    message: string,
    customSvg?: string
): void {
    if (!container) return;
    const defaultSvg = `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.4; margin-bottom:10px;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
    container.innerHTML = `
        <div class="empty-state">
            ${customSvg || defaultSvg}
            <p>${escapeHtml(message)}</p>
        </div>
    `;
}

/**
 * 向容器中渲染标准化的加载错误重试卡片。
 *
 * Args:
 *     container (HTMLElement | null): 目标 DOM 容器。
 *     errorMessage (string): 错误提示文案。
 *     onRetry (Function, optional): 点击重试的回调函数。
 */
export function renderErrorCard(
    container: HTMLElement | null,
    errorMessage: string,
    onRetry?: () => void
): void {
    if (!container) return;
    container.innerHTML = `
        <div class="error-card glass-card" style="text-align: center; padding: 24px 16px; margin: 12px 0;">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--accent-red, #ef4444)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 8px;"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
            <p style="color: var(--text-primary); font-size: 14px; margin-bottom: 12px;">${escapeHtml(errorMessage)}</p>
            ${onRetry ? `<button type="button" class="btn btn-secondary retry-btn" style="padding: 6px 16px; font-size: 13px;">点击重试</button>` : ""}
        </div>
    `;
    if (onRetry) {
        container.querySelector(".retry-btn")?.addEventListener("click", onRetry);
    }
}
