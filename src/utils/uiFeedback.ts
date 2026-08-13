import { SessionExpiredError } from '../api/client';
import { ParseError } from './tableUtils';

/** 各区块最近一次渲染的数据指纹，用于跳过内容未变化的重复渲染 */
const renderFingerprints: Record<string, string> = {};

/**
 * 判断某区块的数据是否与上一次渲染完全相同（Stale-While-Revalidate 防抖）。
 *
 * Args:
 *     key (string): 区块标识。
 *     data (unknown): 本次待渲染的数据。
 *
 * Returns:
 *     boolean: true 表示与上次一致、可以跳过本次渲染。
 */
export function isSameAsRendered(key: string, data: unknown): boolean {
    let fingerprint: string;
    try {
        fingerprint = JSON.stringify(data);
    } catch {
        return false;
    }
    if (renderFingerprints[key] === fingerprint) return true;
    renderFingerprints[key] = fingerprint;
    return false;
}

/** 退出登录或切换账号时清空指纹，避免下一位用户的首次渲染被误跳过。 */
export function resetRenderFingerprints(): void {
    Object.keys(renderFingerprints).forEach(k => delete renderFingerprints[k]);
}

/**
 * 让容器的子项播一次入场级联动效（.stagger-in，见 app.css）。
 *
 * Args:
 *     container (HTMLElement | null): 刚完成子项渲染的列表容器。
 */
export function playEntrance(container: HTMLElement | null): void {
    if (!container) return;

    (container as any)._staggerCleanup?.();
    void container.offsetWidth;
    container.classList.add("stagger-in");

    let timer: number | undefined;
    const cleanup = () => {
        if (timer !== undefined) window.clearTimeout(timer);
        container.removeEventListener("animationend", onEnd);
        container.classList.remove("stagger-in");
        delete (container as any)._staggerCleanup;
    };
    const onEnd = () => {
        if (timer !== undefined) window.clearTimeout(timer);
        timer = window.setTimeout(cleanup, 150);
    };
    (container as any)._staggerCleanup = cleanup;
    container.addEventListener("animationend", onEnd);
}

/**
 * 弹出全屏浮层轻量 Toast 提示框。
 *
 * Args:
 *     msg (string): 提示文本。
 *     type ("success" | "warn" | "error" | "info"): 样式类型。
 */
export function showToast(msg: string, type: "success" | "warn" | "error" | "info" = "info"): void {
    let container = document.getElementById("toast-container");
    if (!container) {
        container = document.createElement("div");
        container.id = "toast-container";
        document.body.appendChild(container);
    }
    const toast = document.createElement("div");
    toast.className = `app-toast toast-${type}`;
    toast.textContent = msg;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("show"));
    setTimeout(() => {
        toast.classList.remove("show");
        setTimeout(() => toast.remove(), 400);
    }, 3200);
}

/**
 * 控制全局 Loading 加载遮罩的显隐及提示文字。
 *
 * Args:
 *     show (boolean): 是否显示。
 *     msg (string): 加载文案。
 */
export function showLoading(show: boolean, msg: string = "加载中..."): void {
    const loadingOverlay = document.getElementById("loading-spinner");
    const pEl = loadingOverlay ? loadingOverlay.querySelector("p") : null;
    if (pEl) pEl.innerText = msg;
    if (loadingOverlay) {
        loadingOverlay.style.display = show ? "flex" : "none";
        if (show) loadingOverlay.classList.add("active");
        else loadingOverlay.classList.remove("active");
    }
}

/**
 * 统一处理各业务模块的加载异常。
 *
 * Args:
 *     moduleName (string): 出错模块的中文名。
 *     e (unknown): 捕获到的异常。
 */
export function handleLoadError(moduleName: string, e: unknown): void {
    if (e instanceof SessionExpiredError) return;

    if (e instanceof ParseError) {
        console.error(`[YnufeUI] ${moduleName} 解析失败:`, e);
        showToast(`${moduleName}解析异常，可能是教务系统改版`, "error");
        return;
    }

    console.error(`[YnufeUI] ${moduleName} 加载失败:`, e);
    showToast(`${moduleName}加载失败，请检查网络`, "error");
}
