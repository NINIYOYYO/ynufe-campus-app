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
        // 注意：@capacitor/core 被打进 Web 包后，浏览器里同样会定义 window.Capacitor，
        // 因此「全局是否存在」不能用来判断运行环境，必须调用 isNativePlatform()。
        // 早期用前者判断，导致浏览器调试时请求被打到绝对域名、直接被 CORS 拦掉，
        // vite 与 dev_server.py 的 /jsxsd 代理形同虚设。
        const cap = (window as any).Capacitor;
        const isNative = typeof cap?.isNativePlatform === "function" && cap.isNativePlatform() === true;

        // 原生壳内由 CapacitorHttp 直连教务网，不受同源策略限制；
        // 浏览器里则一律走同源相对路径，交给本地代理转发——浏览器直连教务网
        // 永远会失败（对方不返回 CORS 头），所以这里不存在「直连」的可用场景。
        return isNative ? AppConfig.TARGET_HOST : "";
    }

    /**
     * 把 /jsxsd 开头的相对路径解析为当前环境下可直接访问的地址。
     *
     * 供需要真实 URL 的场景使用（如附件下载的 <a href>），
     * 保证与 fetch 走同一套环境判定：浏览器内是同源代理路径，原生壳内是绝对域名。
     *
     * Args:
     *     endpoint (string): 以 / 开头的相对路径。
     *
     * Returns:
     *     string: 可直接用于导航或下载的地址。
     */
    static resolveUrl(endpoint: string): string {
        return `${this.BASE_URL}${endpoint}`;
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
     * 拉取任意教务网资源的二进制流（用于公告附件等文件下载）。
     *
     * Args:
     *     endpoint (string): 以 / 开头的相对路径。
     *
     * Returns:
     *     Promise<{ blob: Blob; contentType: string }>: 响应体与其 Content-Type。
     */
    static async getBlob(endpoint: string): Promise<{ blob: Blob; contentType: string }> {
        const resp = await fetch(`${this.BASE_URL}${endpoint}`, {
            method: "GET",
            credentials: "include",
        });
        if (!resp.ok) {
            throw new Error(`Download failed with status ${resp.status}`);
        }
        return {
            blob: await resp.blob(),
            contentType: resp.headers.get("Content-Type") || "",
        };
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
