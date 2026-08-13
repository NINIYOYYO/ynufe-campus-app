/**
 * Logger: 手机端实时日志采集与可视化分发引擎
 *
 * 职责：捕获 App 运行过程中的控制台输出、Cookie 读写状态、网络请求日志，
 * 并持久化在本地缓存中，供前端调试遮罩（DebugOverlay）实时渲染，让手机端直观可见。
 */
export class Logger {
    private static maxLogs = 100;
    private static logs: Array<{ time: string; level: "info" | "warn" | "error"; msg: string }> = [];
    private static listeners: Array<() => void> = [];

    /**
     * 初始化日志引擎，恢复上一次运行残留的崩溃/调试日志。
     */
    static init(): void {
        try {
            const saved = localStorage.getItem("ynufe_debug_logs");
            if (saved) {
                this.logs = JSON.parse(saved);
            }
        } catch {
            this.logs = [];
        }
    }

    /**
     * 记录一条调试日志。
     *
     * Args:
     *     level ("info" | "warn" | "error"): 日志级别。
     *     msg (string): 日志内容。
     */
    static log(level: "info" | "warn" | "error", msg: string): void {
        const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
        const entry = { time, level, msg };
        this.logs.unshift(entry);
        if (this.logs.length > this.maxLogs) {
            this.logs.pop();
        }
        try {
            localStorage.setItem("ynufe_debug_logs", JSON.stringify(this.logs.slice(0, 50)));
        } catch {}

        if (level === "error") console.error(`[AppLog] ${msg}`);
        else if (level === "warn") console.warn(`[AppLog] ${msg}`);
        else console.log(`[AppLog] ${msg}`);

        this.listeners.forEach(fn => fn());
    }

    /**
     * 输出普通信息日志。
     *
     * Args:
     *     msg (string): 日志文本。
     */
    static info(msg: string): void {
        this.log("info", msg);
    }

    /**
     * 输出警告级别日志。
     *
     * Args:
     *     msg (string): 日志文本。
     */
    static warn(msg: string): void {
        this.log("warn", msg);
    }

    /**
     * 输出错误级别日志。
     *
     * Args:
     *     msg (string): 日志文本。
     */
    static error(msg: string): void {
        this.log("error", msg);
    }

    /**
     * 获取所有调试日志列表。
     *
     * Returns:
     *     Array<{ time: string; level: string; msg: string }>: 日志条目列表。
     */
    static getLogs(): Array<{ time: string; level: "info" | "warn" | "error"; msg: string }> {
        return this.logs;
    }

    /**
     * 清空当前所有日志缓存。
     */
    static clear(): void {
        this.logs = [];
        localStorage.removeItem("ynufe_debug_logs");
        this.listeners.forEach(fn => fn());
    }

    /**
     * 订阅日志实时更新事件。
     *
     * Args:
     *     listener (function): 回调函数。
     *
     * Returns:
     *     function: 取消订阅函数。
     */
    static subscribe(listener: () => void): () => void {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }
}
