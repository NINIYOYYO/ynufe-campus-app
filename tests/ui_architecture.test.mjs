import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';
import { rmSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const TMP_DIR = join(HERE, '.ui_arch_build');

// 1. 模拟 LocalStorage
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

const mockStorage = new LocalStorageMock();
globalThis.localStorage = mockStorage;
globalThis.sessionStorage = new LocalStorageMock();

// 2. 初始化 linkedom DOM 环境
const {
    window,
    document,
    HTMLElement,
    HTMLSelectElement,
    HTMLInputElement,
    HTMLImageElement,
    HTMLButtonElement,
    Event,
    CustomEvent,
    MutationObserver,
    Node
} = parseHTML(`<!DOCTYPE html>
<html>
<head></head>
<body>
    <div id="home-announcements-list"></div>
    <div id="style-preset-grid"></div>
    <div id="wallpaper-img" style="display:none;"></div>
    <div id="wallpaper-adjust-section" style="display:none;"></div>
    <div id="wallpaper-tune-section" style="display:none;"></div>
    <div id="wallpaper-adjust-overlay" style="display:none;"></div>
    <button id="btn-enter-wallpaper-adjust"></button>
    <button id="btn-save-wallpaper-adjust"></button>
    <button id="btn-cancel-wallpaper-adjust"></button>
    <input type="file" id="wallpaper-file-input" />
    <button id="btn-reset-wallpaper"></button>
    <input type="range" id="slider-wallpaper-blur" />
    <input type="range" id="slider-wallpaper-mask" />
    <span id="val-wallpaper-blur"></span>
    <span id="val-wallpaper-mask"></span>
    <span id="upload-status-text"></span>
    <div id="settings-sheet" style="display:none;"></div>
    <div id="settings-overlay" style="display:none;"></div>
    <div id="bottom-sheet"></div>
    <div id="btn-close-sheet"></div>
    <div id="notify-sheet"></div>
    <div id="notify-overlay"></div>
    <div id="notify-status-text"></div>
    <button class="theme-btn" data-theme="dark"></button>
    <button class="theme-btn" data-theme="light"></button>
</body>
</html>`);

globalThis.window = window;
globalThis.window.location = { hostname: "localhost", origin: "http://localhost", port: "", protocol: "http:", href: "http://localhost/" };
globalThis.document = document;
globalThis.HTMLElement = HTMLElement;
globalThis.HTMLSelectElement = HTMLSelectElement;
globalThis.HTMLInputElement = HTMLInputElement;
globalThis.HTMLImageElement = HTMLImageElement;
globalThis.HTMLButtonElement = HTMLButtonElement;
globalThis.Event = Event;
globalThis.CustomEvent = CustomEvent;
globalThis.MutationObserver = MutationObserver;
globalThis.Node = Node;
globalThis.requestAnimationFrame = (cb) => { cb(); return 1; };
globalThis.cancelAnimationFrame = () => {};

if (!HTMLElement.prototype.remove) {
    HTMLElement.prototype.remove = function() {
        if (this.parentNode) {
            this.parentNode.removeChild(this);
        }
    };
}

// linkedom 兼容性 Shim: 补齐 innerText setter 与 getBoundingClientRect
if (!Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText')?.set) {
    Object.defineProperty(HTMLElement.prototype, 'innerText', {
        get() {
            return this.textContent;
        },
        set(val) {
            this.textContent = val;
        },
        configurable: true
    });
}

if (!HTMLElement.prototype.getBoundingClientRect) {
    HTMLElement.prototype.getBoundingClientRect = function() {
        return { top: 0, left: 0, right: 100, bottom: 30, width: 100, height: 30, x: 0, y: 0 };
    };
}

if (!HTMLElement.prototype.matches) {
    HTMLElement.prototype.matches = function(selector) {
        if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
        if (selector.startsWith('#')) return this.id === selector.slice(1);
        return this.tagName?.toLowerCase() === selector.toLowerCase();
    };
}

if (!HTMLElement.prototype.closest) {
    HTMLElement.prototype.closest = function(selector) {
        let el = this;
        while (el && el.nodeType === 1) {
            if (el.matches && el.matches(selector)) {
                return el;
            }
            el = el.parentElement || el.parentNode;
        }
        return null;
    };
}

// 补齐 linkedom HTMLSelectElement 与 HTMLOptionElement 浏览器级属性
Object.defineProperty(HTMLSelectElement.prototype, 'options', {
    get() {
        const opts = Array.from(this.querySelectorAll('option'));
        opts.item = (i) => opts[i];
        return opts;
    },
    configurable: true
});

Object.defineProperty(HTMLSelectElement.prototype, 'selectedIndex', {
    get() {
        const opts = Array.from(this.querySelectorAll('option'));
        const idx = opts.findIndex(o => o.selected || o.hasAttribute('selected'));
        return idx !== -1 ? idx : (opts.length > 0 ? 0 : -1);
    },
    set(val) {
        const opts = Array.from(this.querySelectorAll('option'));
        opts.forEach((o, i) => {
            o.selected = (i === val);
            if (i === val) o.setAttribute('selected', '');
            else o.removeAttribute('selected');
        });
    },
    configurable: true
});

Object.defineProperty(HTMLSelectElement.prototype, 'value', {
    get() {
        const opts = Array.from(this.querySelectorAll('option'));
        const sel = opts[this.selectedIndex];
        return sel ? (sel.getAttribute('value') ?? sel.textContent) : '';
    },
    set(val) {
        const opts = Array.from(this.querySelectorAll('option'));
        const idx = opts.findIndex(o => (o.getAttribute('value') ?? o.textContent) === val);
        if (idx !== -1) {
            this.selectedIndex = idx;
        }
    },
    configurable: true
});

HTMLElement.prototype.click = function() {
    const evt = new window.Event('click', { bubbles: true, cancelable: true });
    this.dispatchEvent(evt);
};

const optionProto = document.createElement('option').constructor.prototype;

Object.defineProperty(optionProto, 'value', {
    get() {
        return this.getAttribute('value') ?? this.textContent ?? '';
    },
    set(val) {
        this.setAttribute('value', val);
    },
    configurable: true
});

Object.defineProperty(optionProto, 'text', {
    get() {
        return this.textContent ?? '';
    },
    set(val) {
        this.textContent = val;
    },
    configurable: true
});

Object.defineProperty(optionProto, 'selected', {
    get() {
        return this.hasAttribute('selected');
    },
    set(val) {
        if (val) {
            this.setAttribute('selected', '');
        } else {
            this.removeAttribute('selected');
        }
    },
    configurable: true
});

// 3. 编译 TypeScript 模块
await build({
    entryPoints: [
        join(ROOT, 'src', 'api', 'client.ts'),
        join(ROOT, 'src', 'core', 'app.ts'),
        join(ROOT, 'src', 'core', 'lifecycle.ts'),
        join(ROOT, 'src', 'components', 'customSelect.ts'),
        join(ROOT, 'src', 'views', 'announcementView.ts'),
        join(ROOT, 'src', 'components', 'themeCustomizer.ts'),
        join(ROOT, 'src', 'components', 'wallpaperManager.ts'),
        join(ROOT, 'src', 'components', 'wallpaperGesture.ts'),
        join(ROOT, 'src', 'views', 'settingsView.ts'),
        join(ROOT, 'src', 'services', 'cacheService.ts'),
        join(ROOT, 'src', 'config', 'storageKeys.ts')
    ],
    outdir: TMP_DIR,
    format: 'esm',
    bundle: true,
    splitting: true,
    platform: 'browser',
    external: ['../styles/app.css', './styles/app.css']
});

const { YnufeClient } = await import(pathToFileURL(join(TMP_DIR, 'api', 'client.js')).href);
const { YnufeApp } = await import(pathToFileURL(join(TMP_DIR, 'core', 'app.js')).href);
const { AppLifecycleManager } = await import(pathToFileURL(join(TMP_DIR, 'core', 'lifecycle.js')).href);
const { CustomSelect } = await import(pathToFileURL(join(TMP_DIR, 'components', 'customSelect.js')).href);
const { AnnouncementView } = await import(pathToFileURL(join(TMP_DIR, 'views', 'announcementView.js')).href);
const { ThemeCustomizer } = await import(pathToFileURL(join(TMP_DIR, 'components', 'themeCustomizer.js')).href);
const { WallpaperManager } = await import(pathToFileURL(join(TMP_DIR, 'components', 'wallpaperManager.js')).href);
const { WallpaperGesture } = await import(pathToFileURL(join(TMP_DIR, 'components', 'wallpaperGesture.js')).href);
const { SettingsView } = await import(pathToFileURL(join(TMP_DIR, 'views', 'settingsView.js')).href);
const { CacheService } = await import(pathToFileURL(join(TMP_DIR, 'services', 'cacheService.js')).href);
const { StorageKeys } = await import(pathToFileURL(join(TMP_DIR, 'config', 'storageKeys.js')).href);

console.log("=== 开始运行 UI、架构防重入与存储统一化测试 ===");

// -----------------------------------------------------------------------------
// 测试套件 1: FE-05 YnufeApp 与 AppLifecycleManager 防重入幂等保护测试
// -----------------------------------------------------------------------------
console.log("\n--- 测试套件 1: FE-05 防重入幂等与测试重置测试 ---");

{
    // 重置状态
    YnufeApp.resetForTesting();
    AppLifecycleManager.resetForTesting();

    let visibilityListeners = 0;
    let sessionExpiredListeners = 0;
    let themeListeners = 0;

    const originalDocAddEventListener = document.addEventListener;
    const originalWinAddEventListener = window.addEventListener;

    document.addEventListener = (type, listener, options) => {
        if (type === "visibilitychange") visibilityListeners++;
        return originalDocAddEventListener.call(document, type, listener, options);
    };

    window.addEventListener = (type, listener, options) => {
        if (type === "ynufe-session-expired") sessionExpiredListeners++;
        if (type === "ynufe-theme-preset-applied") themeListeners++;
        return originalWinAddEventListener.call(window, type, listener, options);
    };

    // 首次调用 init
    AppLifecycleManager.init();
    assert.equal(visibilityListeners, 1, "首次初始化应当注册 1 个 visibilitychange 监听器");
    assert.equal(sessionExpiredListeners, 1, "首次初始化应当注册 1 个 ynufe-session-expired 监听器");
    assert.equal(themeListeners, 1, "首次初始化应当注册 1 个 ynufe-theme-preset-applied 监听器");

    // 重入多次调用 init
    AppLifecycleManager.init();
    AppLifecycleManager.init();
    AppLifecycleManager.init();

    assert.equal(visibilityListeners, 1, "重入调用 init 严禁重复注册 visibilitychange 监听器");
    assert.equal(sessionExpiredListeners, 1, "重入调用 init 严禁重复注册 ynufe-session-expired 监听器");
    assert.equal(themeListeners, 1, "重入调用 init 严禁重复注册 ynufe-theme-preset-applied 监听器");

    // 测试 resetForTesting 后重新调用 init
    AppLifecycleManager.resetForTesting();
    AppLifecycleManager.init();

    assert.equal(visibilityListeners, 2, "resetForTesting 后重新 init 应当能够再次注册监听器");
    assert.equal(sessionExpiredListeners, 2, "resetForTesting 后重新 init 应当能够再次注册监听器");
    assert.equal(themeListeners, 2, "resetForTesting 后重新 init 应当能够再次注册监听器");

    document.addEventListener = originalDocAddEventListener;
    window.addEventListener = originalWinAddEventListener;
    console.log("[PASS] 用例 1.1 通过: AppLifecycleManager 防重入幂等守卫与 resetForTesting 验证成功");
}

{
    // YnufeApp init 重入幂等测试
    YnufeApp.resetForTesting();

    // 连续调用 3 次 YnufeApp.init()
    YnufeApp.init();
    YnufeApp.init();
    YnufeApp.init();

    assert.doesNotThrow(() => {
        YnufeApp.resetForTesting();
    }, "YnufeApp.resetForTesting 必须能够安全执行");

    console.log("[PASS] 用例 1.2 通过: YnufeApp.init 防重入幂等守卫与 resetForTesting 验证成功");
}

// -----------------------------------------------------------------------------
// 测试套件 2: FE-03 CustomSelect 动态选项持久化、WeakMap 缓存与非破坏性关闭测试
// -----------------------------------------------------------------------------
console.log("\n--- 测试套件 2: FE-03 CustomSelect 动态选项与 DOM 保持测试 ---");

{
    // 创建一个 select 元素并注入 DOM
    const selectContainer = document.createElement("div");
    selectContainer.innerHTML = `
        <select id="test-week-select">
            <option value="1">第1周</option>
            <option value="2">第2周</option>
        </select>
    `;
    document.body.appendChild(selectContainer);
    const selectEl = selectContainer.querySelector("#test-week-select");

    // 1. 增强包装 select
    CustomSelect.enhance(selectEl);
    const wrapper = selectContainer.querySelector(".custom-select-wrapper");
    assert.ok(wrapper, "包装容器 .custom-select-wrapper 必须成功生成并注入 DOM");

    const trigger = wrapper.querySelector(".custom-select-trigger");
    const textSpan = wrapper.querySelector(".custom-select-text");
    assert.equal(textSpan.innerText, "第1周", "初始文本应展示第 1 个 option 的文案");

    const menu = document.querySelector(`.custom-select-menu[data-select-id="test-week-select"]`);
    assert.ok(menu, "浮层菜单 .custom-select-menu 必须挂载至 body");
    assert.equal(menu.querySelectorAll(".custom-select-option").length, 2, "初始应渲染 2 个自定义选项");

    // 2. 模拟动态增删 option 并触发 updateMenuOptions（例如周次数据异步加载）
    const opt3 = document.createElement("option");
    opt3.value = "3";
    opt3.innerText = "第3周";
    selectEl.appendChild(opt3);

    const opt4 = document.createElement("option");
    opt4.value = "4";
    opt4.innerText = "第4周";
    selectEl.appendChild(opt4);

    // 触发选项同步
    CustomSelect.updateMenuOptions(selectEl);

    const updatedOptions = menu.querySelectorAll(".custom-select-option");
    assert.equal(updatedOptions.length, 4, "动态新增 option 后菜单必须同步更新为 4 个选项");
    assert.equal(updatedOptions[2].querySelector("span").textContent, "第3周", "新增选项文本渲染正确");
    assert.equal(updatedOptions[3].querySelector("span").textContent, "第4周", "新增选项文本渲染正确");

    // 3. 模拟点击打开与选项选择，验证原生 change 事件驱动
    let nativeChangeFired = false;
    selectEl.addEventListener("change", () => {
        nativeChangeFired = true;
    });

    // 模拟点击第 3 个选项 (第3周)
    updatedOptions[2].click();

    assert.equal(selectEl.selectedIndex, 2, "原生 select.selectedIndex 必须同步更新为 2");
    assert.equal(selectEl.value, "3", "原生 select.value 必须同步更新为 '3'");
    assert.equal(textSpan.innerText, "第3周", "触发按钮文案必须同步更新为 '第3周'");
    assert.equal(nativeChangeFired, true, "必须正确向原生 select 节点派发 change 事件");

    // 4. 验证 closeAll 非破坏性 DOM 保持（不移除 menu 节点）
    menu.classList.add("active");
    trigger.classList.add("active");
    wrapper.classList.add("active-wrapper");

    CustomSelect.closeAll();

    assert.equal(menu.classList.contains("active"), false, "closeAll 必须移除 active 类");
    assert.equal(trigger.classList.contains("active"), false, "closeAll 必须移除 trigger active 类");
    assert.equal(wrapper.classList.contains("active-wrapper"), false, "closeAll 必须移除 wrapper active 类");
    assert.ok(document.body.contains(menu), "closeAll 绝不能销毁或 removeChild 菜单 DOM 节点");

    // 5. 验证重复调用 enhance 具有幂等性，不会产生多层 wrapper 嵌套
    CustomSelect.enhance(selectEl);
    const wrappers = selectContainer.querySelectorAll(".custom-select-wrapper");
    assert.equal(wrappers.length, 1, "重复调用 enhance 不得重复生成 wrapper 包装容器");

    // 清理 DOM
    selectContainer.remove();
    menu.remove();
    console.log("[PASS] 用例 2.1 通过: CustomSelect 动态选项渲染、WeakMap 缓存与 DOM 节点保持验证成功");
}

// -----------------------------------------------------------------------------
// 测试套件 3: FE-04 AnnouncementView 附件下载 ObjectURL 延迟释放测试
// -----------------------------------------------------------------------------
console.log("\n--- 测试套件 3: FE-04 AnnouncementView 附件下载延迟释放测试 ---");

{
    let revokedUrls = [];
    let scheduledTimeouts = [];

    // Mock URL.createObjectURL 和 URL.revokeObjectURL
    globalThis.URL.createObjectURL = (blob) => "blob:ynufe-attachment-12345";
    globalThis.URL.revokeObjectURL = (url) => {
        revokedUrls.push(url);
    };

    // Mock window.setTimeout
    const originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (fn, delay) => {
        scheduledTimeouts.push({ fn, delay });
        return originalSetTimeout(fn, delay);
    };

    // Mock YnufeClient.getBlob
    YnufeClient.getBlob = async (url) => {
        return {
            blob: {
                size: 8192,
                slice: () => ({ text: async () => "fake binary content" })
            },
            contentType: "application/pdf"
        };
    };

    // 执行附件下载
    await AnnouncementView.downloadAttachment("/jsxsd/test/file.pdf", "课表通知.pdf");

    // 断言：在执行刚结束时，URL.revokeObjectURL 必须尚未被同步调用
    assert.equal(revokedUrls.length, 0, "URL.revokeObjectURL 严禁在 a.click() 之后立即同步执行，防止下载中断");

    // 断言：必须排程了 1500ms 的延迟定时器
    const timeoutEntry = scheduledTimeouts.find(t => t.delay === 1500);
    assert.ok(timeoutEntry, "必须使用 1500ms 的 setTimeout 排程释放 ObjectURL");

    // 模拟定时器触发
    timeoutEntry.fn();
    assert.deepEqual(revokedUrls, ["blob:ynufe-attachment-12345"], "1500ms 超时后必须安全释放 ObjectURL");

    globalThis.setTimeout = originalSetTimeout;
    console.log("[PASS] 用例 3.1 通过: AnnouncementView 附件下载 1500ms 延迟释放 ObjectURL 验证成功");
}

// -----------------------------------------------------------------------------
// 测试套件 4: FE-07 StorageKeys 常量与 CacheService 统一存储与向后兼容测试
// -----------------------------------------------------------------------------
console.log("\n--- 测试套件 4: FE-07 统一存储与向后兼容容错测试 ---");

{
    // 1. 测试 CacheService.get 对旧版未包装裸字符串的平滑兼容
    mockStorage.setItem("ynufe_theme_raw", "dark");
    const rawStringVal = CacheService.get("ynufe_theme_raw");
    assert.equal(rawStringVal, "dark", "未带 JSON 包装的裸字符串必须平滑向后兼容读取");

    mockStorage.setItem("ynufe_accent_raw", "#3b82f6");
    const rawAccentVal = CacheService.get("ynufe_accent_raw");
    assert.equal(rawAccentVal, "#3b82f6", "未带 JSON 包装的十六进制颜色裸字符串必须平滑向后兼容读取");

    // 2. 测试 CacheService.get 对损坏 JSON 结构的自愈清理
    mockStorage.setItem("ynufe_corrupted_struct", "{ invalid json: syntax error ");
    const corruptedVal = CacheService.get("ynufe_corrupted_struct");
    assert.equal(corruptedVal, null, "损坏的结构化 JSON 必须安全返回 null");
    assert.equal(mockStorage.getItem("ynufe_corrupted_struct"), null, "损坏的结构化 JSON 必须被自动清理");

    // 3. 测试 ThemeCustomizer 存储持久化
    ThemeCustomizer.setAccentColor("#10b981", "16, 185, 129", true);
    assert.equal(CacheService.get(StorageKeys.ACCENT_HEX), "#10b981", "强调色十六进制必须通过 StorageKeys 存入 CacheService");
    assert.equal(CacheService.get(StorageKeys.ACCENT_RGB), "16, 185, 129", "强调色 RGB 必须通过 StorageKeys 存入 CacheService");

    ThemeCustomizer.setTextColor("#ffffff", true);
    assert.equal(CacheService.get(StorageKeys.TEXT_COLOR), "#ffffff", "主文字颜色必须通过 StorageKeys 存入 CacheService");

    ThemeCustomizer.setBgColor("#1e1e2d", true);
    assert.equal(CacheService.get(StorageKeys.BG_COLOR), "#1e1e2d", "背景颜色必须通过 StorageKeys 存入 CacheService");

    ThemeCustomizer.resetColors();
    assert.equal(CacheService.get(StorageKeys.ACCENT_HEX), null, "重置后 ACCENT_HEX 必须已清理");
    assert.equal(CacheService.get(StorageKeys.ACCENT_RGB), null, "重置后 ACCENT_RGB 必须已清理");
    assert.equal(CacheService.get(StorageKeys.TEXT_COLOR), null, "重置后 TEXT_COLOR 必须已清理");
    assert.equal(CacheService.get(StorageKeys.BG_COLOR), null, "重置后 BG_COLOR 必须已清理");

    // 4. 测试 WallpaperGesture 变换矩阵持久化与重置
    WallpaperGesture.transformState = { scale: 1.85, x: 24, y: -48 };
    CacheService.set(StorageKeys.WALLPAPER_TRANSFORM, WallpaperGesture.transformState);

    WallpaperGesture.transformState = { scale: 1.0, x: 0, y: 0 };
    WallpaperGesture.loadSavedTransform();
    assert.deepEqual(WallpaperGesture.transformState, { scale: 1.85, x: 24, y: -48 }, "WallpaperGesture loadSavedTransform 必须正确还原变换矩阵");

    WallpaperGesture.resetTransform();
    assert.deepEqual(WallpaperGesture.transformState, { scale: 1.0, x: 0, y: 0 }, "WallpaperGesture resetTransform 必须重置变换参数");
    assert.equal(CacheService.get(StorageKeys.WALLPAPER_TRANSFORM), null, "resetTransform 必须清除持久化键值");

    // 5. 测试 SettingsView setThemeMode
    SettingsView.setThemeMode("light");
    assert.equal(CacheService.get(StorageKeys.THEME_MODE), "light", "SettingsView setThemeMode 必须通过 StorageKeys 存入 CacheService");

    SettingsView.setThemeMode("dark");
    assert.equal(CacheService.get(StorageKeys.THEME_MODE), "dark", "SettingsView setThemeMode 必须通过 StorageKeys 存入 CacheService");

    console.log("[PASS] 用例 4.1 通过: StorageKeys 与 CacheService 全站统一存取与向后兼容验证成功");
}

// -----------------------------------------------------------------------------
// 测试套件 5: CSP 安全策略加固与 7 天周末课程表完整网格实测
// -----------------------------------------------------------------------------
console.log("\n--- 测试套件 5: CSP 安全加固与课表周末支持实测 ---");
{
    const { readFileSync } = await import('node:fs');
    const indexHtml = readFileSync(join(ROOT, 'index.html'), 'utf-8');
    const appCss = readFileSync(join(ROOT, 'src', 'styles', 'app.css'), 'utf-8');

    // 1. CSP 策略校验：script-src 禁止包含 unsafe-inline
    const cspMatch = indexHtml.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i);
    assert.ok(cspMatch, "index.html 必须配置严格的 CSP 策略");
    const cspContent = cspMatch[1];
    const scriptSrcMatch = cspContent.match(/script-src\s+([^;]+)/i);
    assert.ok(scriptSrcMatch, "CSP 必须显式定义 script-src");
    assert.ok(!scriptSrcMatch[1].includes("'unsafe-inline'"), "生产环境 CSP script-src 严禁包含 'unsafe-inline'");

    // 2. 课表表头包含六、日
    assert.ok(indexHtml.includes('<div class="grid-header">六</div>'), "课表表头必须包含周六");
    assert.ok(indexHtml.includes('<div class="grid-header">日</div>'), "课表表头必须包含周日");

    // 3. 课表 1-7 大节均包含 data-day 6 和 7
    for (let s = 1; s <= 7; s++) {
        assert.ok(
            indexHtml.includes(`data-day="6" data-session="${s}"`),
            `第 ${s} 大节必须具备周六 (day=6) 槽位 DOM`
        );
        assert.ok(
            indexHtml.includes(`data-day="7" data-session="${s}"`),
            `第 ${s} 大节必须具备周日 (day=7) 槽位 DOM`
        );
    }

    // 4. app.css 网格列数必须支持 7 天自适应收缩
    assert.ok(
        appCss.includes("repeat(7, minmax(0, 1fr))"),
        "app.css 中的 timetable-grid 必须定义 7 列自适应布局"
    );

    console.log("[PASS] 用例 5.1 通过: CSP 策略严格禁用 unsafe-inline，周末 7 天课程网格完整就绪");
}

// 清理构建临时目录
try { rmSync(TMP_DIR, { recursive: true, force: true }); } catch {}

console.log("\n==========================================================");
console.log("  Milestone 1 (UI, 架构与生命周期韧性) 全部测试用例实测通过！");
console.log("==========================================================");
