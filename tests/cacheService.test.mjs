import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { rmSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_FILE = join(HERE, '.cache_bundle.mjs');

// 模拟 LocalStorage
class LocalStorageMock {
    constructor() {
        this.store = {};
    }
    getItem(key) {
        return this.store[key] !== undefined ? this.store[key] : null;
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
    get length() {
        return Object.keys(this.store).length;
    }
    key(i) {
        return Object.keys(this.store)[i] || null;
    }
}

globalThis.localStorage = new LocalStorageMock();

// esbuild 打包
await build({
    entryPoints: [join(ROOT, 'src', 'services', 'cacheService.ts')],
    outfile: OUT_FILE,
    format: 'esm',
    bundle: true,
    platform: 'node',
});

const { CacheService } = await import(pathToFileURL(OUT_FILE).href);

console.log("=== 开始运行 CacheService 强类型缓存服务测试 ===");

// 1. 基础存取与信封解包测试
const testData = { studentId: "202311001", name: "张三", courses: [{ id: 1, name: "微积分" }] };
CacheService.set("ynufe_test_data", testData);

const readBack = CacheService.get("ynufe_test_data");
assert.deepEqual(readBack, testData, "写入的数据与读取出的数据结构内容必须完全一致");
const ts = CacheService.getTimestamp("ynufe_test_data");
assert.ok(typeof ts === "number" && ts > 0, "写入时必须自动附带有效时间戳");
console.log("✓ 用例 1 通过: 基础强类型存取与时间戳信封工作正常");

// 2. 向后兼容旧版未包装 JSON 测试
globalThis.localStorage.setItem("ynufe_legacy_cache", JSON.stringify({ legacy: true, count: 42 }));
const legacyRead = CacheService.get("ynufe_legacy_cache");
assert.deepEqual(legacyRead, { legacy: true, count: 42 }, "旧版未带信封的原始 JSON 必须平滑向后兼容读取");
console.log("✓ 用例 2 通过: 旧版裸 JSON 缓存向后兼容读取成功");

// 3. TTL 有效期过期控制测试
// 构造一个 5 分钟前写入的缓存
const expiredEnvelope = {
    data: { token: "expired_token" },
    cachedAt: Date.now() - 300000,
    version: 1
};
globalThis.localStorage.setItem("ynufe_expired_test", JSON.stringify(expiredEnvelope));

// 允许存活 60000ms（1分钟），已过去 5 分钟，应该返回 null
const expiredResult = CacheService.get("ynufe_expired_test", 60000);
assert.equal(expiredResult, null, "超过 maxAgeMs 的过期缓存必须返回 null");

// 允许存活 600000ms（10分钟），未过期，应该返回数据
const validResult = CacheService.get("ynufe_expired_test", 600000);
assert.deepEqual(validResult, { token: "expired_token" }, "未超过 maxAgeMs 的缓存应正常返回");
console.log("✓ 用例 3 通过: TTL 存活时间过期自动失效策略验证通过");

// 4. 损坏数据自愈安全测试
globalThis.localStorage.setItem("ynufe_corrupted_key", "{ bad_json: unquoted, broken... ");
const safeNull = CacheService.get("ynufe_corrupted_key");
assert.equal(safeNull, null, "损坏 JSON 不应抛出未捕获异常，必须安全返回 null");
assert.equal(globalThis.localStorage.getItem("ynufe_corrupted_key"), null, "损坏的脏数据必须被自动清除");
console.log("✓ 用例 4 通过: 损坏数据防御性捕获与自愈清理机制验证通过");

// 5. 前缀批量清理测试
CacheService.set("ynufe_cache_a", 1);
CacheService.set("ynufe_cache_b", 2);
CacheService.set("ynufe_user_info", "keep_me");

CacheService.clearByPrefix("ynufe_cache_");
assert.equal(CacheService.get("ynufe_cache_a"), null, "匹配前缀的缓存项应被清除");
assert.equal(CacheService.get("ynufe_cache_b"), null, "匹配前缀的缓存项应被清除");
assert.equal(CacheService.get("ynufe_user_info"), "keep_me", "未匹配前缀的缓存项应完好保留");
console.log("✓ 用例 5 通过: clearByPrefix 批量前缀清理验证通过");

// 6. 存储配额超限错误抛出测试 (QuotaExceededError 不被静默吞噬)
const originalSetItem = globalThis.localStorage.setItem;
try {
    globalThis.localStorage.setItem = () => {
        const quotaErr = new Error("QuotaExceededError: DOM Exception 22");
        quotaErr.name = "QuotaExceededError";
        throw quotaErr;
    };
    assert.throws(
        () => CacheService.set("ynufe_oversized_key", "massive_image_data"),
        (err) => err.name === "QuotaExceededError",
        "超出存储配额时必须主动向上抛出异常供上层捕获"
    );
    console.log("[PASS] 用例 6 通过: QuotaExceededError 配额超限向上抛出验证通过");
} finally {
    globalThis.localStorage.setItem = originalSetItem;
}

try { rmSync(OUT_FILE); } catch {}

console.log("==========================================");
console.log("  CacheService 全部测试用例实测通过！");
console.log("==========================================");
