import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { rmSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_FILE = join(HERE, '.crypto_bundle.mjs');

// 1. 模拟浏览器环境与 LocalStorage
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

// 2. 用 esbuild 编译 src/utils/crypto.ts
await build({
    entryPoints: [join(ROOT, 'src', 'utils', 'crypto.ts')],
    outfile: OUT_FILE,
    format: 'esm',
    bundle: true,
    platform: 'node',
});

const { encodeInp, obfuscate, deobfuscate } = await import(pathToFileURL(OUT_FILE).href);

console.log("=== 开始运行 crypto.ts 算法单元测试 ===");

// 1. encodeInp 空值与正常值测试
assert.equal(encodeInp(""), "", "encodeInp 空字符串必须返回空字符串，不能返回 AA==");
assert.notEqual(encodeInp("password123"), "", "encodeInp 非空字符串应返回编码值");
assert.equal(typeof encodeInp("admin"), "string", "encodeInp 返回值应为字符串");
console.log("✓ 用例 1 通过: encodeInp 空串与正常文本编码准确");

// 2. obfuscate 与 deobfuscate 闭环测试
const plain = "MySecretPass_2026!#@中文测试";
const cipher = obfuscate(plain);
assert.ok(cipher.startsWith("v2:"), "混淆产物应带有 v2: 版本前缀");
assert.notEqual(cipher, plain, "混淆后不应包含原始明文");

const restored = deobfuscate(cipher);
assert.equal(restored, plain, "deobfuscate 还原明文应与输入严格一致（含中文及特殊字符）");
console.log("✓ 用例 2 通过: obfuscate/deobfuscate 正常编解码闭环通过");

// 3. 密钥损坏或不匹配时的容错测试（fatal: true 严格模式验证）
globalThis.localStorage.setItem("ynufe_device_key", "0123456789abcdef0123456789abcdef");
const corruptCipher = obfuscate("Secret_A");

// 故意替换为完全不同的密钥
globalThis.localStorage.setItem("ynufe_device_key", "fedcba9876543210fedcba9876543210");
const safeResult = deobfuscate(corruptCipher);
assert.equal(safeResult, "", "密钥损坏时必须安全返回空字符串，严禁返回包含 \\uFFFD 的乱码字符");
console.log("✓ 用例 3 通过: 损坏密钥安全熔断机制验证通过 (fatal: true)");

// 4. 空值与向后兼容性测试
assert.equal(obfuscate(""), "", "obfuscate 空串返回空串");
assert.equal(deobfuscate(""), "", "deobfuscate 空串返回空串");
assert.equal(deobfuscate("plaintext_old"), "plaintext_old", "deobfuscate 未带前缀明文直接向后兼容返回");
console.log("✓ 用例 4 通过: 空值与向后兼容分支验证通过");

// 清理产物
try { rmSync(OUT_FILE); } catch {}

console.log("==========================================");
console.log("  Crypto 全部测试用例实测通过！");
console.log("==========================================");
