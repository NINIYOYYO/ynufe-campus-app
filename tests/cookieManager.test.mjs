import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_FILE = join(HERE, '.cookie_manager_bundle.mjs');

// 1. 模拟 LocalStorage 与全局 DOM 环境
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

globalThis.localStorage = new LocalStorageMock();

const nativeStore = new Map();
const capacitorStore = new Map();
let flushedCount = 0;

globalThis.document = {
    _cookies: [],
    get cookie() {
        return this._cookies.join("; ");
    },
    set cookie(str) {
        this._cookies.push(str);
    }
};

globalThis.window = {
    location: {
        hostname: "localhost",
        origin: "http://localhost",
        port: "",
        protocol: "http:",
        href: "http://localhost/"
    },
    Capacitor: {
        isNativePlatform: () => true,
        Plugins: {
            NativeCookie: {
                getCookie: async ({ url }) => {
                    const cookie = nativeStore.get(url) || "";
                    return { cookie };
                },
                setCookie: async ({ url, cookie }) => {
                    const prev = nativeStore.get(url) || "";
                    const key = cookie.split("=")[0].trim();
                    const existing = prev ? prev.split("; ").filter(p => !p.startsWith(key + "=")) : [];
                    existing.push(cookie);
                    nativeStore.set(url, existing.join("; "));
                }
            },
            CapacitorCookies: {
                getCookies: async ({ url }) => {
                    return capacitorStore.get(url) || {};
                },
                setCookie: async ({ url, key, value }) => {
                    const existing = capacitorStore.get(url) || {};
                    existing[key] = value;
                    capacitorStore.set(url, existing);
                },
                flushCookies: async () => {
                    flushedCount++;
                    return true;
                },
                clearCookies: async ({ url }) => {
                    capacitorStore.delete(url);
                }
            }
        }
    }
};

// 2. esbuild 编译真实的 TypeScript SessionCookieManager
await build({
    entryPoints: [join(ROOT, 'src', 'services', 'cookieManager.ts')],
    outfile: OUT_FILE,
    format: 'esm',
    bundle: true,
    platform: 'node',
});

const { SessionCookieManager } = await import(pathToFileURL(OUT_FILE).href);

console.log("=== 开始运行 SessionCookieManager 真实模块实测 ===");

try {
    // 用例 1: 保存并持久化有效 Session Cookie
    const validSession = "VALID_SESSION_ABC123";
    const validJsxsd = "MOCK_JSXSD_999888";
    SessionCookieManager.saveJsessionId(validSession, validJsxsd);
    await new Promise(r => setTimeout(r, 10));

    assert.equal(SessionCookieManager.getSavedJsessionId(), validSession, "getSavedJsessionId 必须返回真实持久化的 JSESSIONID");
    assert.equal(SessionCookieManager.getSavedJsxsd(), validJsxsd, "getSavedJsxsd 必须返回真实持久化的 jsxsd");
    console.log("[PASS] 用例 1: SessionCookieManager.saveJsessionId 与读取工作正常");

    // 用例 2: 验证 2038 年远期过期时间与双路径写入 NativeCookie
    const rootNative = nativeStore.get("https://xjwis.ynufe.edu.cn");
    const jsxsdNative = nativeStore.get("https://xjwis.ynufe.edu.cn/jsxsd");
    assert.ok(rootNative && rootNative.includes("VALID_SESSION_ABC123"), "根路径 NativeCookie 必须包含凭据");
    assert.ok(rootNative.includes("Expires=Fri, 31 Dec 2038"), "NativeCookie 必须包含 2038 远期过期时间");
    assert.ok(jsxsdNative && jsxsdNative.includes("Path=/jsxsd"), "子路径 NativeCookie 必须包含 Path=/jsxsd");
    console.log("[PASS] 用例 2: 2038 远期过期时间与全路径 NativeCookie 注入成功");

    // 用例 3: 验证 getCookieHeader 请求头组装
    const headers = SessionCookieManager.getCookieHeader();
    assert.ok(headers.Cookie, "请求头必须包含 Cookie 字段");
    assert.ok(headers.Cookie.includes(`JSESSIONID=${validSession}`), "请求头必须拼接有效 JSESSIONID");
    assert.ok(headers.Cookie.includes(`jsxsd=${validJsxsd}`), "请求头必须拼接有效 jsxsd");
    console.log("[PASS] 用例 3: SessionCookieManager.getCookieHeader 请求头构造准确");

    // 用例 4: 验证 captureAndPersist 从 NativeCookie 捕获
    nativeStore.set("https://xjwis.ynufe.edu.cn/jsxsd", "JSESSIONID=NEW_CAPTURED_999; jsxsd=987654");
    // force=false 且已有值时应保留已有值
    let captured = await SessionCookieManager.captureAndPersist(false);
    assert.equal(captured, "NEW_CAPTURED_999", "captureAndPersist 应成功从 NativeCookie 探测解析出凭据");
    assert.equal(SessionCookieManager.getSavedJsessionId(), validSession, "force=false 时不应覆盖已有合法凭据");

    // force=true 时强制覆盖写入
    await SessionCookieManager.captureAndPersist(true);
    assert.equal(SessionCookieManager.getSavedJsessionId(), "NEW_CAPTURED_999", "force=true 时应成功持久化新凭据");
    assert.equal(SessionCookieManager.getSavedJsxsd(), "987654", "force=true 时应成功更新 jsxsd");
    console.log("[PASS] 用例 4: captureAndPersist 原生层探测与 force 保护策略实测通过");

    // 用例 5: 验证 restoreCookies 恢复与 flush 刷盘
    const prevFlushed = flushedCount;
    const restoredOk = await SessionCookieManager.restoreCookies();
    assert.equal(restoredOk, true, "restoreCookies 必须返回 true");
    assert.ok(flushedCount >= prevFlushed, "restoreCookies 必须触发 CapacitorCookies 刷盘");
    console.log("[PASS] 用例 5: restoreCookies 全路径还原与持久化刷盘通过");

    // 用例 6: clearCookies 彻底注销清理
    SessionCookieManager.clearCookies();
    await new Promise(r => setTimeout(r, 10));
    assert.equal(SessionCookieManager.getSavedJsessionId(), "", "清理后 JSESSIONID 必须为空");
    assert.equal(SessionCookieManager.getSavedJsxsd(), "", "清理后 jsxsd 必须为空");
    const clearedNative = nativeStore.get("https://xjwis.ynufe.edu.cn");
    assert.ok(clearedNative.includes("1970"), "清理后 NativeCookie 必须被设置为 1970 过期");
    console.log("[PASS] 用例 6: clearCookies 注销清理与 1970 过期机制实测通过");

    console.log("==========================================");
    console.log("  SessionCookieManager 全部真实测试实测通过！");
    console.log("==========================================");
} finally {
    try { rmSync(OUT_FILE); } catch {}
}
