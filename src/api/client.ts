import { AppConfig } from '../config';

/**
 * SessionExpiredError: 教务会话过期专用异常。
 * 请求层检测到登录重定向时抛出，阻止上层用登录页 HTML 去解析业务数据、污染缓存。
 */
export class SessionExpiredError extends Error {
    constructor(endpoint: string) {
        super(`Session expired on: ${endpoint}`);
        this.name = "SessionExpiredError";
    }
}

/**
 * YnufeClient: 跨平台教务网网络通信引擎
 * 职责：封装 fetch 网络请求，管理会话 Cookie 传递，并拦截 Session 超时重定向。
 */
export class YnufeClient {
    /**
     * 获取当前环境下的基础 API 地址。
     *
     * Returns:
     *     string: 本地代理/vite 开发模式下返回空字符串（走同源代理），
     *     Capacitor 原生手机应用下返回教务系统域名。
     */
    private static get BASE_URL(): string {
        const isCapacitor = typeof (window as any).Capacitor !== "undefined";
        const isLocalHost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
        return (isCapacitor || !isLocalHost) ? AppConfig.TARGET_HOST : "";
    }

    /**
     * 校验请求返回的 HTML 文本是否触发了教务系统的登录重定向。
     * 检测到过期时：广播 ynufe-session-expired 事件并抛出 SessionExpiredError，
     * 上层 catch 后应中止本轮同步（绝不能拿登录页去解析、写缓存）。
     */
    private static checkSessionTimeout(text: string, endpoint: string): void {
        if (endpoint.includes("LoginToXkLdap")) {
            return;
        }

        // 1. 结构性特征：只可能出现在登录页/拦截页，判定为掉线是安全的
        const structural =
            text.includes("sys/login.jsp") ||
            text.includes("LoginToXkLdap") ||
            text.includes("SYSTEM_LOGIN");

        // 2. 纯中文提示词具有歧义：公告标题（如《关于教务系统升级后请重新登录的通知》）
        //    同样会命中，误判会导致整轮同步被中止。因此仅当页面不含任何业务数据容器时才采信。
        const hasBusinessContent =
            text.includes('id="dataList"') ||
            text.includes('id="kbtable"') ||
            text.includes("middletopdwxxcont") ||
            text.includes('id="Table1"');
        const phraseOnly =
            (text.includes("非法访问") || text.includes("请重新登录")) && !hasBusinessContent;

        if (structural || phraseOnly) {
            console.warn(`[YnufeClient] Session timeout detected on: ${endpoint}`);
            window.dispatchEvent(new CustomEvent("ynufe-session-expired"));
            throw new SessionExpiredError(endpoint);
        }
    }

    /**
     * 发起 GET 请求并获取 HTML 页面源码。
     *
     * Raises:
     *     SessionExpiredError: 会话已过期。
     *     Error: 网络超时或请求异常。
     */
    static async getHtml(endpoint: string): Promise<string> {
        const url = `${this.BASE_URL}${endpoint}`;
        try {
            const resp = await fetch(url, {
                method: "GET",
                credentials: "include",
                headers: {
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
                }
            });
            const text = await resp.text();
            this.checkSessionTimeout(text, endpoint);
            return text;
        } catch (err) {
            if (!(err instanceof SessionExpiredError)) {
                console.error(`[YnufeClient] GET ${endpoint} error:`, err);
            }
            throw err;
        }
    }

    /**
     * 发起 POST 表单提交请求。
     *
     * Raises:
     *     SessionExpiredError: 会话已过期。
     *     Error: 表单提交失败或网络超时。
     */
    static async postForm(endpoint: string, formDataObj: Record<string, string>): Promise<string> {
        const url = `${this.BASE_URL}${endpoint}`;
        const params = new URLSearchParams();
        for (const key in formDataObj) {
            params.append(key, formDataObj[key]);
        }

        try {
            const resp = await fetch(url, {
                method: "POST",
                credentials: "include",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
                },
                body: params.toString()
            });
            const text = await resp.text();
            this.checkSessionTimeout(text, endpoint);
            return text;
        } catch (err) {
            if (!(err instanceof SessionExpiredError)) {
                console.error(`[YnufeClient] POST ${endpoint} error:`, err);
            }
            throw err;
        }
    }

    /**
     * 请求并拉取验证码图片 Blob 二进制流。
     */
    static async getCaptchaBlob(): Promise<Blob> {
        const endpoint = `/jsxsd/verifycode.servlet?t=${Math.random()}`;
        const url = `${this.BASE_URL}${endpoint}`;
        try {
            const resp = await fetch(url, {
                method: "GET",
                credentials: "include",
                headers: {
                    "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
                }
            });
            if (!resp.ok) {
                throw new Error(`Captcha request failed with status ${resp.status}`);
            }
            return await resp.blob();
        } catch (err) {
            console.error("[YnufeClient] Fetch captcha blob error:", err);
            throw err;
        }
    }
}
