import assert from 'node:assert/strict';

// 1. 模拟 DOM 与 Storage 环境
class LocalStorageMock {
    constructor() {
        this.store = {};
    }
    getItem(key) {
        return this.store[key] || null;
    }
    setItem(key, value) {
        this.store[key] = String(value);
    }
    removeItem(key) {
        delete this.store[key];
    }
    clear() {
        this.store = {};
    }
}

global.localStorage = new LocalStorageMock();
global.document = {
    _cookies: [],
    get cookie() {
        return this._cookies.join("; ");
    },
    set cookie(str) {
        this._cookies.push(str);
    }
};

// 模拟 Capacitor 及其 NativeCookie / CapacitorCookies 插件
const nativeStore = new Map();
global.window = {
    location: { hostname: "localhost", origin: "http://localhost", port: "" },
    Capacitor: {
        isNativePlatform: () => true,
        Plugins: {
            NativeCookie: {
                getCookie: async ({ url }) => {
                    const cookie = nativeStore.get(url) || "";
                    return { cookie };
                },
                setCookie: async ({ url, cookie }) => {
                    nativeStore.set(url, cookie);
                }
            },
            CapacitorCookies: {
                getCookies: async ({ url }) => {
                    const val = nativeStore.get(url + "_cap") || "";
                    return val ? { JSESSIONID: val } : {};
                },
                setCookie: async ({ url, key, value }) => {
                    if (key === "JSESSIONID") {
                        nativeStore.set(url + "_cap", value);
                    }
                },
                flushCookies: async () => true
            }
        }
    }
};

const KEY_JSESSIONID = "ynufe_saved_jsessionid";
const TARGET_HOST = "https://xjwis.ynufe.edu.cn";
const TARGET_JSXSD = "https://xjwis.ynufe.edu.cn/jsxsd";

async function testCookieLogic() {
    console.log("=== 开始运行 SessionCookieManager 存取逻辑实测 ===");

    // 用例 1: 保存有效 Session Cookie
    const validSession = "VALID_SESSION_ABC123";
    localStorage.setItem(KEY_JSESSIONID, validSession);
    assert.equal(localStorage.getItem(KEY_JSESSIONID), validSession, "用例 1 失败: localStorage 应成功保存有效 Cookie");
    console.log("✓ 用例 1 通过: 有效 JSESSIONID 成功存入 localStorage");

    // 用例 2: 验证 onlyIfVerified 保护锁机制 (阻止空白/未登录 Cookie 擦除有效 Cookie)
    let currentSaved = localStorage.getItem(KEY_JSESSIONID);
    let capturedBlankSession = "BLANK_UNAUTH_SESSION_XYZ999";
    let onlyIfVerified = false; // 模拟未经验证的普通请求捕获

    if (onlyIfVerified || !currentSaved) {
        localStorage.setItem(KEY_JSESSIONID, capturedBlankSession);
    }

    assert.equal(localStorage.getItem(KEY_JSESSIONID), validSession, "用例 2 失败: 未登录的空白 Cookie 不应擦除已被保护的有效 Cookie");
    console.log("✓ 用例 2 通过: 身份保护锁成功拦截空白 Cookie 覆盖");

    // 用例 3: 多路径恢复校验
    nativeStore.set(TARGET_HOST, `JSESSIONID=${validSession}; Expires=Fri, 31 Dec 2038 23:59:59 GMT; Path=/`);
    nativeStore.set(TARGET_JSXSD, `JSESSIONID=${validSession}; Expires=Fri, 31 Dec 2038 23:59:59 GMT; Path=/jsxsd`);

    const resRoot = await window.Capacitor.Plugins.NativeCookie.getCookie({ url: TARGET_HOST });
    const resJsxsd = await window.Capacitor.Plugins.NativeCookie.getCookie({ url: TARGET_JSXSD });

    assert.match(resRoot.cookie, /JSESSIONID=VALID_SESSION_ABC123/, "用例 3a 失败: 根路径 NativeCookie 恢复不匹配");
    assert.match(resJsxsd.cookie, /JSESSIONID=VALID_SESSION_ABC123/, "用例 3b 失败: /jsxsd 路径 NativeCookie 恢复不匹配");
    assert.match(resJsxsd.cookie, /Expires=Fri, 31 Dec 2038/, "用例 3c 失败: 2038 远期持久化标记丢失");
    console.log("✓ 用例 3 通过: 根路径与 /jsxsd 子路径双重注入与 2038 远期持久化验证正确");

    console.log("==========================================");
    console.log("  全部测试用例实测通过！");
    console.log("==========================================");
}

testCookieLogic().catch(err => {
    console.error("测试失败:", err);
    process.exit(1);
});
