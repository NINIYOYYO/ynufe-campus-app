import { AppConfig } from '../config';
import { SessionCookieManager } from '../services/cookieManager';

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
        const cap = (window as any).Capacitor;
        const isNative = typeof cap?.isNativePlatform === "function" && cap.isNativePlatform() === true;
        // 仅当端口为 Vite 开发端口 8000 时走本地开发代理；在手机原生离线版（localhost）下精准返回教务网域名
        const isViteDev = typeof window !== "undefined" && (window.location.port === "8000" || (!isNative && window.location.hostname !== "xjwis.ynufe.edu.cn"));
        if (isViteDev) {
            return "";
        }
        return isNative ? AppConfig.TARGET_HOST : "";
    }

    /**
     * 把 /jsxsd 开头的相对路径解析为当前环境下可直接访问的地址。
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
     * 从 HTTP 响应头中直接提取 Set-Cookie / JSESSIONID 并存入本地。
     */
    private static extractAndSaveCookieFromHeaders(resp: Response): void {
        try {
            let setCookie = resp.headers.get("Set-Cookie") || resp.headers.get("set-cookie");
            if (!setCookie && (resp.headers as any).entries) {
                for (const [k, v] of (resp.headers as any).entries()) {
                    if (k.toLowerCase() === "set-cookie") {
                        setCookie = v;
                        break;
                    }
                }
            }
            if (setCookie) {
                const match = setCookie.match(/JSESSIONID=([^;]+)/i);
                if (match && match[1]) {
                    SessionCookieManager.saveJsessionId(match[1].trim());
                }
            }
        } catch (e) {
            console.warn("[YnufeClient] Extract Set-Cookie error:", e);
        }
    }

    /**
     * 校验请求返回的 HTML 文本是否触发了教务系统的登录重定向。
     */
    private static checkSessionTimeout(text: string, endpoint: string): void {
        if (endpoint.includes("LoginToXkLdap")) {
            return;
        }

        const structural =
            text.includes("sys/login.jsp") ||
            text.includes("LoginToXkLdap") ||
            text.includes("SYSTEM_LOGIN");

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
     * 伪装为电脑端 Chrome 浏览器的标准请求头。
     * 解决教务网 Tomcat 因校验 User-Agent / Referer 缺省而将请求判定为“非法访问”返回 994 字节的问题。
     */
    private static get COMMON_HEADERS(): Record<string, string> {
        return {
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Referer": `${this.BASE_URL}/jsxsd/framework/xsMain.jsp`
        };
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
        await SessionCookieManager.restoreCookies();
        const cookieHeader = SessionCookieManager.getCookieHeader();

        try {
            const resp = await fetch(url, {
                method: "GET",
                credentials: "include",
                headers: {
                    ...this.COMMON_HEADERS,
                    ...cookieHeader
                }
            });
            const text = await resp.text();
            this.extractAndSaveCookieFromHeaders(resp);
            await SessionCookieManager.captureAndPersist();
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
        await SessionCookieManager.restoreCookies();
        const cookieHeader = SessionCookieManager.getCookieHeader();

        const params = new URLSearchParams();
        for (const key in formDataObj) {
            params.append(key, formDataObj[key]);
        }

        try {
            const resp = await fetch(url, {
                method: "POST",
                credentials: "include",
                headers: {
                    ...this.COMMON_HEADERS,
                    "Content-Type": "application/x-www-form-urlencoded",
                    ...cookieHeader
                },
                body: params.toString()
            });
            const text = await resp.text();
            this.extractAndSaveCookieFromHeaders(resp);
            await SessionCookieManager.captureAndPersist();
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
        await SessionCookieManager.restoreCookies();
        const cookieHeader = SessionCookieManager.getCookieHeader();

        try {
            const resp = await fetch(url, {
                method: "GET",
                credentials: "include",
                headers: {
                    ...this.COMMON_HEADERS,
                    "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
                    ...cookieHeader
                }
            });
            if (!resp.ok) {
                throw new Error(`Captcha request failed with status ${resp.status}`);
            }
            this.extractAndSaveCookieFromHeaders(resp);
            await SessionCookieManager.captureAndPersist();
            return await resp.blob();
        } catch (err) {
            console.error("[YnufeClient] Fetch captcha blob error:", err);
            throw err;
        }
    }
}
