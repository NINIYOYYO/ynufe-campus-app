import { AppConfig } from '../config';

/**
 * SessionCookieManager: 强智教务网 Session Cookie 持久化与恢复引擎
 *
 * 背景与痛点：
 * 1. 教务网 Tomcat 返回的 JSESSIONID 没有设置 Expires / Max-Age（即 Session Cookie），
 *    且限定了 Path=/jsxsd 子路径。
 * 2. Android WebView / Chromium 启动时会自动执行 DELETE FROM cookies WHERE is_persistent=0，
 *    删除所有未设置过期时间的 Session Cookie，导致进程杀死后重启必丢失 JSESSIONID。
 * 3. 标准 JS 的 document.cookie / Response.headers 在 Capacitor 原生容器中受到浏览器安全规范限制，
 *    无法直接获取 HTTP 响应头的 Set-Cookie 字段。
 *
 * 解决方案：
 * - 结合 Android 原生插件 NativeCookie / CapacitorCookies 穿透直接读取 Android CookieManager 在根域名与 /jsxsd 下的内存。
 * - 将获取到的 JSESSIONID 强行持久化到 localStorage。
 * - 启动与发请求前，手动注入 Cookie 头 + 给 Native CookieManager 重新写入带有
 *   2038 年远期 Expires 的 JSESSIONID（强制将 is_persistent 转为 1），阻止 Android 启动清理。
 * - 写入和恢复 Cookie 后立即调用 flushCookies 刷盘写入磁盘 SQLite。
 */
export class SessionCookieManager {
    private static KEY_JSESSIONID = "ynufe_saved_jsessionid";
    private static KEY_JSXSD = "ynufe_saved_jsxsd";

    /**
     * 获取本地持久化保存的 JSESSIONID。
     *
     * Returns:
     *     string: 本地保存的 JSESSIONID 字符串。
     */
    static getSavedJsessionId(): string {
        return localStorage.getItem(this.KEY_JSESSIONID) || "";
    }

    /**
     * 获取本地持久化保存的 jsxsd 作用域标记。
     *
     * Returns:
     *     string: 本地保存的 jsxsd 字符串。
     */
    static getSavedJsxsd(): string {
        return localStorage.getItem(this.KEY_JSXSD) || "";
    }

    /**
     * 捕获并保存当前页面与原生 WebView 容器中的 JSESSIONID 与 jsxsd 会话凭据。
     *
     * Args:
     *     force (boolean): 是否强制覆盖已有凭据（在刷新验证码或登录成功时传入 true）。
     *
     * Returns:
     *     Promise<string>: 捕获到的有效 JSESSIONID 字符串；若未能获取则返回空串。
     */
    static async captureAndPersist(force: boolean = false): Promise<string> {
        let jsessionid = "";
        let jsxsd = "";
        const cap = window.Capacitor;
        const targetHost = AppConfig.TARGET_HOST;
        const targetJsxsdUrl = `${targetHost}/jsxsd`;
        const localOrigin = typeof window !== "undefined" ? window.location.origin : "";
        const localJsxsdUrl = localOrigin ? `${localOrigin}/jsxsd` : "";

        // 1. 优先尝试用 NativeCookie 插件从 Android 底层 CookieManager 中多路径读取
        if (cap?.Plugins?.NativeCookie?.getCookie) {
            try {
                let res = await cap.Plugins.NativeCookie.getCookie({ url: targetJsxsdUrl });
                if (!res?.cookie && localJsxsdUrl) {
                    res = await cap.Plugins.NativeCookie.getCookie({ url: localJsxsdUrl });
                }
                if (!res?.cookie) {
                    res = await cap.Plugins.NativeCookie.getCookie({ url: targetHost });
                }
                if (res && res.cookie) {
                    const matchJsession = res.cookie.match(/JSESSIONID=([^;]+)/i);
                    const matchJsxsd = res.cookie.match(/jsxsd=([^;]+)/i);
                    if (matchJsession && matchJsession[1]) {
                        jsessionid = matchJsession[1].trim();
                    }
                    if (matchJsxsd && matchJsxsd[1]) {
                        jsxsd = matchJsxsd[1].trim();
                    }
                }
            } catch (e) {
                console.warn("[CookieManager] NativeCookie.getCookie error:", e);
            }
        }

        // 2. 尝试从 document.cookie 中解析
        if (typeof document !== "undefined" && document.cookie) {
            if (!jsessionid) {
                const matchJsession = document.cookie.match(/JSESSIONID=([^;]+)/i);
                if (matchJsession && matchJsession[1]) {
                    jsessionid = matchJsession[1].trim();
                }
            }
            if (!jsxsd) {
                const matchJsxsd = document.cookie.match(/jsxsd=([^;]+)/i);
                if (matchJsxsd && matchJsxsd[1]) {
                    jsxsd = matchJsxsd[1].trim();
                }
            }
        }

        // 3. 在 Capacitor 原生容器中从 CapacitorCookies 插件按全路径读取
        if ((!jsessionid || !jsxsd) && cap?.Plugins?.CapacitorCookies?.getCookies) {
            try {
                let res = await cap.Plugins.CapacitorCookies.getCookies({ url: targetJsxsdUrl });
                if (!res || Object.keys(res).length === 0) {
                    res = await cap.Plugins.CapacitorCookies.getCookies({ url: targetHost });
                }
                if (res) {
                    const keyJsession = Object.keys(res).find(k => k.toUpperCase() === "JSESSIONID");
                    if (!jsessionid && keyJsession && res[keyJsession]) {
                        jsessionid = res[keyJsession];
                    }
                    const keyJsxsd = Object.keys(res).find(k => k.toLowerCase() === "jsxsd");
                    if (!jsxsd && keyJsxsd && res[keyJsxsd]) {
                        jsxsd = res[keyJsxsd];
                    }
                }
            } catch (e) {
                console.warn("[CookieManager] CapacitorCookies.getCookies error:", e);
            }
        }

        if (jsessionid) {
            const currentSaved = this.getSavedJsessionId();
            if (force || !currentSaved) {
                this.saveJsessionId(jsessionid, jsxsd || undefined);
            }
        }
        return jsessionid;
    }

    /**
     * 将 JSESSIONID 与 jsxsd 写入 localStorage，并赋予 2038 远期过期时间重新写回 WebView 并触发磁盘刷盘。
     *
     * Args:
     *     jsessionid (string): 教务网分配的会话 ID。
     *     jsxsd (string, optional): 教务网分配的子路径标记。
     */
    static saveJsessionId(jsessionid: string, jsxsd?: string): void {
        if (!jsessionid) return;
        localStorage.setItem(this.KEY_JSESSIONID, jsessionid);
        if (jsxsd) {
            localStorage.setItem(this.KEY_JSXSD, jsxsd);
        }

        const farFuture = "Fri, 31 Dec 2038 23:59:59 GMT";
        const isoFarFuture = "2038-01-01T00:00:00.000Z";
        const targetHost = AppConfig.TARGET_HOST;
        const targetJsxsdUrl = `${targetHost}/jsxsd`;
        const localOrigin = typeof window !== "undefined" ? window.location.origin : "";
        const localJsxsdUrl = localOrigin ? `${localOrigin}/jsxsd` : "";

        // 1. 赋予 2038 远期过期时间重新写回 document.cookie（强制转为 is_persistent = 1）
        if (typeof document !== "undefined") {
            document.cookie = `JSESSIONID=${jsessionid}; expires=${farFuture}; path=/; SameSite=Lax`;
            document.cookie = `JSESSIONID=${jsessionid}; expires=${farFuture}; path=/jsxsd; SameSite=Lax`;
            if (jsxsd) {
                document.cookie = `jsxsd=${jsxsd}; expires=${farFuture}; path=/; SameSite=Lax`;
                document.cookie = `jsxsd=${jsxsd}; expires=${farFuture}; path=/jsxsd; SameSite=Lax`;
            }
        }

        const cap = window.Capacitor;
        // 2. 写回 NativeCookie 原生插件（覆盖域名与 /jsxsd 路径）
        if (cap?.Plugins?.NativeCookie?.setCookie) {
            cap.Plugins.NativeCookie.setCookie({
                url: targetHost,
                cookie: `JSESSIONID=${jsessionid}; Expires=${farFuture}; Path=/; SameSite=Lax`
            }).catch(() => {});
            cap.Plugins.NativeCookie.setCookie({
                url: targetJsxsdUrl,
                cookie: `JSESSIONID=${jsessionid}; Expires=${farFuture}; Path=/jsxsd; SameSite=Lax`
            }).catch(() => {});
            if (jsxsd) {
                cap.Plugins.NativeCookie.setCookie({
                    url: targetHost,
                    cookie: `jsxsd=${jsxsd}; Expires=${farFuture}; Path=/; SameSite=Lax`
                }).catch(() => {});
                cap.Plugins.NativeCookie.setCookie({
                    url: targetJsxsdUrl,
                    cookie: `jsxsd=${jsxsd}; Expires=${farFuture}; Path=/jsxsd; SameSite=Lax`
                }).catch(() => {});
            }
            if (localOrigin) {
                cap.Plugins.NativeCookie.setCookie({
                    url: localOrigin,
                    cookie: `JSESSIONID=${jsessionid}; Expires=${farFuture}; Path=/; SameSite=Lax`
                }).catch(() => {});
                cap.Plugins.NativeCookie.setCookie({
                    url: localJsxsdUrl,
                    cookie: `JSESSIONID=${jsessionid}; Expires=${farFuture}; Path=/jsxsd; SameSite=Lax`
                }).catch(() => {});
            }
        }

        // 3. 同步写回 Capacitor 原生 CookieManager 并触发磁盘刷盘
        if (cap?.Plugins?.CapacitorCookies?.setCookie) {
            const setPromises = [
                cap.Plugins.CapacitorCookies.setCookie({
                    url: targetHost,
                    key: "JSESSIONID",
                    value: jsessionid,
                    expires: isoFarFuture,
                    path: "/"
                }),
                cap.Plugins.CapacitorCookies.setCookie({
                    url: targetJsxsdUrl,
                    key: "JSESSIONID",
                    value: jsessionid,
                    expires: isoFarFuture,
                    path: "/jsxsd"
                })
            ];

            if (jsxsd) {
                setPromises.push(
                    cap.Plugins.CapacitorCookies.setCookie({
                        url: targetHost,
                        key: "jsxsd",
                        value: jsxsd,
                        expires: isoFarFuture,
                        path: "/"
                    }),
                    cap.Plugins.CapacitorCookies.setCookie({
                        url: targetJsxsdUrl,
                        key: "jsxsd",
                        value: jsxsd,
                        expires: isoFarFuture,
                        path: "/jsxsd"
                    })
                );
            }

            Promise.all(setPromises).then(() => {
                if (cap?.Plugins?.CapacitorCookies?.flushCookies) {
                    cap.Plugins.CapacitorCookies.flushCookies().catch(() => {});
                }
            }).catch(() => {});
        }
    }

    /**
     * 恢复本地持久化的 JSESSIONID 与 jsxsd 到当前 Web 环境与原生 WebView 中，并刷入磁盘。
     *
     * Returns:
     *     Promise<boolean>: 是否成功恢复了有效的 JSESSIONID。
     */
    static async restoreCookies(): Promise<boolean> {
        const jsessionid = this.getSavedJsessionId();
        if (!jsessionid) {
            return false;
        }
        const jsxsd = this.getSavedJsxsd();

        const farFuture = "Fri, 31 Dec 2038 23:59:59 GMT";
        const isoFarFuture = "2038-01-01T00:00:00.000Z";
        const targetHost = AppConfig.TARGET_HOST;
        const targetJsxsdUrl = `${targetHost}/jsxsd`;
        const localOrigin = typeof window !== "undefined" ? window.location.origin : "";
        const localJsxsdUrl = localOrigin ? `${localOrigin}/jsxsd` : "";

        // 1. 重新写入 document.cookie
        if (typeof document !== "undefined") {
            document.cookie = `JSESSIONID=${jsessionid}; expires=${farFuture}; path=/; SameSite=Lax`;
            document.cookie = `JSESSIONID=${jsessionid}; expires=${farFuture}; path=/jsxsd; SameSite=Lax`;
            if (jsxsd) {
                document.cookie = `jsxsd=${jsxsd}; expires=${farFuture}; path=/; SameSite=Lax`;
                document.cookie = `jsxsd=${jsxsd}; expires=${farFuture}; path=/jsxsd; SameSite=Lax`;
            }
        }

        const cap = window.Capacitor;
        // 2. 恢复到 NativeCookie 插件
        if (cap?.Plugins?.NativeCookie?.setCookie) {
            try {
                await cap.Plugins.NativeCookie.setCookie({
                    url: targetHost,
                    cookie: `JSESSIONID=${jsessionid}; Expires=${farFuture}; Path=/; SameSite=Lax`
                });
                await cap.Plugins.NativeCookie.setCookie({
                    url: targetJsxsdUrl,
                    cookie: `JSESSIONID=${jsessionid}; Expires=${farFuture}; Path=/jsxsd; SameSite=Lax`
                });
                if (jsxsd) {
                    await cap.Plugins.NativeCookie.setCookie({
                        url: targetHost,
                        cookie: `jsxsd=${jsxsd}; Expires=${farFuture}; Path=/; SameSite=Lax`
                    });
                    await cap.Plugins.NativeCookie.setCookie({
                        url: targetJsxsdUrl,
                        cookie: `jsxsd=${jsxsd}; Expires=${farFuture}; Path=/jsxsd; SameSite=Lax`
                    });
                }
                if (localOrigin) {
                    await cap.Plugins.NativeCookie.setCookie({
                        url: localOrigin,
                        cookie: `JSESSIONID=${jsessionid}; Expires=${farFuture}; Path=/; SameSite=Lax`
                    });
                    await cap.Plugins.NativeCookie.setCookie({
                        url: localJsxsdUrl,
                        cookie: `JSESSIONID=${jsessionid}; Expires=${farFuture}; Path=/jsxsd; SameSite=Lax`
                    });
                }
            } catch (e) {
                console.warn("[CookieManager] NativeCookie restore error:", e);
            }
        }

        // 3. 重新写入 Capacitor Native CookieManager 并强行磁盘刷盘
        if (cap?.Plugins?.CapacitorCookies?.setCookie) {
            try {
                await cap.Plugins.CapacitorCookies.setCookie({
                    url: targetHost,
                    key: "JSESSIONID",
                    value: jsessionid,
                    expires: isoFarFuture,
                    path: "/"
                });
                await cap.Plugins.CapacitorCookies.setCookie({
                    url: targetJsxsdUrl,
                    key: "JSESSIONID",
                    value: jsessionid,
                    expires: isoFarFuture,
                    path: "/jsxsd"
                });
                if (jsxsd) {
                    await cap.Plugins.CapacitorCookies.setCookie({
                        url: targetHost,
                        key: "jsxsd",
                        value: jsxsd,
                        expires: isoFarFuture,
                        path: "/"
                    });
                    await cap.Plugins.CapacitorCookies.setCookie({
                        url: targetJsxsdUrl,
                        key: "jsxsd",
                        value: jsxsd,
                        expires: isoFarFuture,
                        path: "/jsxsd"
                    });
                }
                if (localOrigin) {
                    await cap.Plugins.CapacitorCookies.setCookie({
                        url: localOrigin,
                        key: "JSESSIONID",
                        value: jsessionid,
                        expires: isoFarFuture,
                        path: "/"
                    });
                    await cap.Plugins.CapacitorCookies.setCookie({
                        url: localJsxsdUrl,
                        key: "JSESSIONID",
                        value: jsessionid,
                        expires: isoFarFuture,
                        path: "/jsxsd"
                    });
                }
                if (cap?.Plugins?.CapacitorCookies?.flushCookies) {
                    await cap.Plugins.CapacitorCookies.flushCookies();
                }
            } catch (e) {
                console.warn("[CookieManager] CapacitorCookies restore error:", e);
            }
        }

        return true;
    }

    /**
     * 生成供 HTTP 请求直接携带的 Cookie 请求头。
     *
     * Returns:
     *     Record<string, string>: 包含 Cookie 字段的请求头对象。
     */
    static getCookieHeader(): Record<string, string> {
        const jsessionid = this.getSavedJsessionId();
        const jsxsd = this.getSavedJsxsd();
        const cookies: string[] = [];
        if (jsessionid) {
            cookies.push(`JSESSIONID=${jsessionid}`);
        }
        if (jsxsd) {
            cookies.push(`jsxsd=${jsxsd}`);
        }
        if (cookies.length > 0) {
            return { "Cookie": cookies.join("; ") };
        }
        return {};
    }

    /**
     * 清理保存的 JSESSIONID 与 jsxsd（退出登录时调用）。
     */
    static clearCookies(): void {
        localStorage.removeItem(this.KEY_JSESSIONID);
        localStorage.removeItem(this.KEY_JSXSD);
        if (typeof document !== "undefined") {
            document.cookie = "JSESSIONID=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
            document.cookie = "JSESSIONID=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/jsxsd";
            document.cookie = "jsxsd=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
            document.cookie = "jsxsd=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/jsxsd";
        }
        const cap = window.Capacitor;
        const targetHost = AppConfig.TARGET_HOST;
        const targetJsxsdUrl = `${targetHost}/jsxsd`;

        if (cap?.Plugins?.NativeCookie?.setCookie) {
            cap.Plugins.NativeCookie.setCookie({
                url: targetHost,
                cookie: "JSESSIONID=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/"
            }).catch(() => {});
            cap.Plugins.NativeCookie.setCookie({
                url: targetJsxsdUrl,
                cookie: "JSESSIONID=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/jsxsd"
            }).catch(() => {});
            cap.Plugins.NativeCookie.setCookie({
                url: targetHost,
                cookie: "jsxsd=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/"
            }).catch(() => {});
            cap.Plugins.NativeCookie.setCookie({
                url: targetJsxsdUrl,
                cookie: "jsxsd=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/jsxsd"
            }).catch(() => {});
        }
        if (cap?.Plugins?.CapacitorCookies?.clearCookies) {
            cap.Plugins.CapacitorCookies.clearCookies({ url: targetHost }).catch(() => {});
            cap.Plugins.CapacitorCookies.clearCookies({ url: targetJsxsdUrl }).catch(() => {});
        }
    }
}

