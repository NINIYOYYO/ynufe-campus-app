import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { rmSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_FILE = join(HERE, '.heartbeat_bundle.mjs');

// 模拟 LocalStorage
class LocalStorageMock {
    constructor() { this.store = {}; }
    getItem(key) { return this.store[key] !== undefined ? this.store[key] : null; }
    setItem(key, value) { this.store[key] = String(value); }
    removeItem(key) { delete this.store[key]; }
    clear() { this.store = {}; }
}
globalThis.localStorage = new LocalStorageMock();
globalThis.document = { hidden: false, addEventListener() {} };

await build({
    entryPoints: [join(ROOT, 'src', 'services', 'heartbeatService.ts')],
    outfile: OUT_FILE,
    format: 'esm',
    bundle: true,
    platform: 'node',
});

const { HeartbeatService } = await import(pathToFileURL(OUT_FILE).href);

console.log("=== 开始运行 HeartbeatService 心跳保活服务单元测试 ===");

// 1. 启动与停止状态管理测试
assert.equal(HeartbeatService.isRunning(), false, "初始状态下心跳不应处于运行中");

HeartbeatService.start();
assert.equal(HeartbeatService.isRunning(), true, "调用 start() 后心跳应处于活跃状态");

// 重复调用 start 不应创建重叠定时器
HeartbeatService.start();
assert.equal(HeartbeatService.isRunning(), true, "重复调用 start() 应安全重置并保持活跃");

HeartbeatService.stop();
assert.equal(HeartbeatService.isRunning(), false, "调用 stop() 后心跳应停止");

HeartbeatService.stop();
assert.equal(HeartbeatService.isRunning(), false, "重复调用 stop() 不应报错");

console.log("✓ 用例 1 通过: 心跳启动、幂等重置与停止状态机运转正常");

try { rmSync(OUT_FILE); } catch {}

console.log("==========================================");
console.log("  HeartbeatService 测试用例实测通过！");
console.log("==========================================");
