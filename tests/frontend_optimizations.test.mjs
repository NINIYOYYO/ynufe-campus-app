import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';
import { readFileSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const TMP_DIR = join(HERE, '.frontend_opt_build');

// 1. Mock LocalStorage
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

// 2. LinkeDOM Setup
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
<body class="theme-light">
    <div id="style-preset-grid"></div>
    <div class="theme-toggle-bar">
        <button class="theme-btn" data-theme="dark"></button>
        <button class="theme-btn active" data-theme="light"></button>
    </div>
    <div class="accent-color-palette">
        <button class="accent-color-btn" data-hex="#0071e3" data-rgb="0, 113, 227"></button>
        <button class="accent-color-btn" data-hex="#3b82f6" data-rgb="59, 130, 246"></button>
        <button class="accent-color-btn" data-hex="#8b5cf6" data-rgb="139, 92, 246"></button>
    </div>
    <div class="text-color-palette">
        <button class="text-color-btn" data-hex=""></button>
        <button class="text-color-btn" data-hex="#ffffff"></button>
    </div>
    <div class="bg-color-palette">
        <button class="bg-color-btn" data-hex=""></button>
        <button class="bg-color-btn" data-hex="#ffffff"></button>
    </div>
    <input type="color" id="custom-text-color-picker" />
    <input type="color" id="custom-bg-color-picker" />
    <button id="btn-reset-text-color"></button>
    <button id="btn-reset-bg-color"></button>
    
    <!-- Grades DOM -->
    <span id="gpa-val"></span>
    <span id="gpa-progress-bar"></span>
    <span id="credit-val"></span>
    <span id="credit-progress-bar"></span>
    <select id="select-grade-semester"></select>
    <select id="select-exam-semester"></select>
    <input type="text" id="input-grade-search" />
    <div id="grades-list"></div>
    <div id="bottom-sheet"></div>
    <div id="btn-close-sheet"></div>
    <div id="level-grades-list"></div>

    <!-- Timetable DOM -->
    <select id="select-week"></select>
    <div class="grid-course-slot" data-day="1" data-session="1"></div>
    <div class="grid-course-slot" data-day="1" data-session="2"></div>
    <div class="grid-course-slot" data-day="2" data-session="1"></div>
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
        if (typeof this._selectedIndex === 'number') {
            return this._selectedIndex;
        }
        const opts = Array.from(this.querySelectorAll('option'));
        const idx = opts.findIndex(o => o.selected || o.hasAttribute('selected'));
        return idx !== -1 ? idx : (opts.length > 0 ? 0 : -1);
    },
    set(val) {
        this._selectedIndex = val;
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

// 3. Compile TypeScript Modules
await build({
    entryPoints: [
        join(ROOT, 'src', 'components', 'themeCustomizer.ts'),
        join(ROOT, 'src', 'config', 'themePresets.ts'),
        join(ROOT, 'src', 'config', 'storageKeys.ts'),
        join(ROOT, 'src', 'views', 'settingsView.ts'),
        join(ROOT, 'src', 'views', 'gradeView.ts'),
        join(ROOT, 'src', 'views', 'timetableView.ts'),
        join(ROOT, 'src', 'services', 'cacheService.ts')
    ],
    outdir: TMP_DIR,
    format: 'esm',
    bundle: true,
    splitting: true,
    platform: 'browser',
    external: ['../styles/app.css', './styles/app.css']
});

const { ThemeCustomizer } = await import(pathToFileURL(join(TMP_DIR, 'components', 'themeCustomizer.js')).href);
const { ACCENT_COLORS, STYLE_PRESETS } = await import(pathToFileURL(join(TMP_DIR, 'config', 'themePresets.js')).href);
const { StorageKeys } = await import(pathToFileURL(join(TMP_DIR, 'config', 'storageKeys.js')).href);
const { SettingsView } = await import(pathToFileURL(join(TMP_DIR, 'views', 'settingsView.js')).href);
const { GradeView } = await import(pathToFileURL(join(TMP_DIR, 'views', 'gradeView.js')).href);
const { TimetableView } = await import(pathToFileURL(join(TMP_DIR, 'views', 'timetableView.js')).href);
const { CacheService } = await import(pathToFileURL(join(TMP_DIR, 'services', 'cacheService.js')).href);

console.log('=== 开始运行 前端体验与样式三大优化专项测试 ===\n');

// ── R1 测试套件: 默认主题 "云瓷白" (Cloud Porcelain White) ──────────────────────
console.log('--- 测试套件 1: R1 默认主题 "云瓷白" 与初始样式测试 ---');

// 1.1 预设表完整性测试
const cloudPreset = STYLE_PRESETS.find(p => p.name === "云瓷白");
assert.ok(cloudPreset, 'STYLE_PRESETS 必须包含 "云瓷白" 预设方案');
assert.equal(cloudPreset.mode, 'light', '云瓷白预设 mode 必须为 light');
assert.equal(cloudPreset.accentHex, '#0071e3', '云瓷白预设 accentHex 必须为 #0071e3');
assert.equal(cloudPreset.bg, '#ffffff', '云瓷白预设 bg 必须为 #ffffff');

const appleBlueAccent = ACCENT_COLORS.find(a => a.hex === '#0071e3');
assert.ok(appleBlueAccent, 'ACCENT_COLORS 必须包含 #0071e3 (苹果蓝)');
console.log('[PASS] 用例 1.1 通过: 主题预设与强调色配置完整');

// 1.2 SettingsView.initTheme 初始加载默认浅色
mockStorage.clear();
SettingsView.initTheme();
assert.equal(CacheService.get(StorageKeys.THEME_MODE), 'light', '未自定义时 SettingsView.initTheme 必须默认持久化/应用 light 模式');
assert.ok(document.body.classList.contains('theme-light'), 'body 必须包含 theme-light class');
assert.ok(!document.body.classList.contains('theme-dark'), 'body 严禁包含 theme-dark class');
console.log('[PASS] 用例 1.2 通过: SettingsView.initTheme 未自定义时默认激活 light 模式');

// 1.3 ThemeCustomizer.init 未自定义时高亮 "云瓷白"
mockStorage.clear();
ThemeCustomizer.init();
const presetBtns = document.querySelectorAll('.style-preset-btn');
const activePresetBtn = document.querySelector('.style-preset-btn.active');
assert.ok(activePresetBtn, '未自定义状态下必须有选中的风格预设按钮');
assert.equal(activePresetBtn.getAttribute('data-preset'), '云瓷白', '未自定义状态下选中的风格预设必须是 "云瓷白"');
console.log('[PASS] 用例 1.3 通过: ThemeCustomizer.init 未自定义时默认高亮 "云瓷白"');

// 1.4 ThemeCustomizer.resetColors 重置为默认强调色 #0071e3
ThemeCustomizer.setAccentColor('#8b5cf6', '139, 92, 246', true);
ThemeCustomizer.resetColors();
const activeAccentBtn = document.querySelector('.accent-color-btn.active');
assert.ok(activeAccentBtn, '重置后必须有高亮的强调色按钮');
assert.equal(activeAccentBtn.getAttribute('data-hex'), '#0071e3', '重置后高亮的强调色按钮必须为 #0071e3');
console.log('[PASS] 用例 1.4 通过: ThemeCustomizer.resetColors 成功重置强调色 UI 为 #0071e3');

// 1.5 验证 app.css 默认主题样式定义
const cssContent = readFileSync(join(ROOT, 'src', 'styles', 'app.css'), 'utf-8');
assert.ok(cssContent.includes('--primary-color: #0071e3;'), 'app.css :root 必须包含 --primary-color: #0071e3');
assert.ok(cssContent.includes('body, body.theme-light'), 'app.css 必须将 body 默认样式与 body.theme-light 绑定');
assert.ok(cssContent.includes('--bg-color: #ffffff;'), 'app.css theme-light 必须包含 --bg-color: #ffffff');
console.log('[PASS] 用例 1.5 通过: app.css 默认样式变量正确定义为云瓷白浅色模式');

// 1.6 风格主题预设切换与自适应联动
ThemeCustomizer.applyStylePreset('暖阳米', true);
assert.equal(CacheService.get(StorageKeys.STYLE_PRESET), '暖阳米', '切换暖阳米预设必须持久化');
assert.equal(CacheService.get(StorageKeys.THEME_MODE), 'light', '暖阳米必须属于 light 模式');
assert.ok(document.body.classList.contains('theme-light'), '暖阳米激活时 body 必须包含 theme-light');
assert.equal(document.body.style.getPropertyValue('--primary-color'), '#f59e0b', '强调色必须更新为 #f59e0b');
assert.equal(document.body.style.getPropertyValue('--bg-color'), '#fff7ed', '背景色必须更新为 #fff7ed');

ThemeCustomizer.applyStylePreset('曜石蓝', true);
assert.equal(CacheService.get(StorageKeys.THEME_MODE), 'dark', '曜石蓝必须切换为 dark 模式');
assert.ok(document.body.classList.contains('theme-dark'), '曜石蓝激活时 body 必须包含 theme-dark');

// 重新切回云瓷白
ThemeCustomizer.applyStylePreset('云瓷白', true);
assert.equal(CacheService.get(StorageKeys.STYLE_PRESET), '云瓷白');
assert.equal(CacheService.get(StorageKeys.THEME_MODE), 'light');
assert.ok(document.body.classList.contains('theme-light'));
assert.equal(document.body.style.getPropertyValue('--primary-color'), '#0071e3');
assert.equal(document.body.style.getPropertyValue('--bg-color'), '#ffffff');
console.log('[PASS] 用例 1.6 通过: 风格主题预设切换与深浅模式联动测试成功');

// 1.7 自定义背景颜色注入与重置
ThemeCustomizer.setBgColor('#f3e8ff', true);
assert.equal(CacheService.get(StorageKeys.BG_COLOR), '#f3e8ff', '自定义背景色必须存入 CacheService');
assert.equal(document.body.style.getPropertyValue('--bg-color'), '#f3e8ff', '自定义背景色必须内联注入 body');
ThemeCustomizer.resetColors();
assert.equal(CacheService.get(StorageKeys.BG_COLOR), null, '重置后背景色必须从 CacheService 清除');
assert.equal(CacheService.get(StorageKeys.STYLE_PRESET), null, '重置后风格预设必须从 CacheService 清除');
const activePresetAfterReset = document.querySelector('.style-preset-btn.active');
assert.ok(activePresetAfterReset, '浅色模式重置后必须默认选中云瓷白预设');
assert.equal(activePresetAfterReset.getAttribute('data-preset'), '云瓷白', '浅色模式重置后选中的风格预设必须为云瓷白');
console.log('[PASS] 用例 1.7 通过: 自定义背景颜色动态注入与重置测试成功');

// 1.8 自由 Color Picker 微调时自动清除整套风格预设选中态
ThemeCustomizer.applyStylePreset('暖阳米', true);
assert.equal(document.querySelector('.style-preset-btn.active')?.getAttribute('data-preset'), '暖阳米');

const textPickerEl = document.getElementById('custom-text-color-picker');
textPickerEl.value = '#123456';
textPickerEl.dispatchEvent(new window.Event('input'));
assert.equal(CacheService.get(StorageKeys.STYLE_PRESET), null, '使用文字选色器微调后必须清除风格预设');
assert.equal(document.querySelector('.style-preset-btn.active'), null, '使用文字选色器微调后必须取消所有预设选中态');

ThemeCustomizer.applyStylePreset('云瓷白', true);
assert.equal(document.querySelector('.style-preset-btn.active')?.getAttribute('data-preset'), '云瓷白');

const bgPickerEl = document.getElementById('custom-bg-color-picker');
bgPickerEl.value = '#abcdef';
bgPickerEl.dispatchEvent(new window.Event('input'));
assert.equal(CacheService.get(StorageKeys.STYLE_PRESET), null, '使用背景选色器微调后必须清除风格预设');
assert.equal(document.querySelector('.style-preset-btn.active'), null, '使用背景选色器微调后必须取消所有预设选中态');
console.log('[PASS] 用例 1.8 通过: 自由 Color Picker 选色与风格预设状态解耦联动测试成功');

// ── R2 测试套件: 成绩全部学期倒序排列 ──────────────────────────────────────────
console.log('\n--- 测试套件 2: R2 期末成绩全部学期倒序排列测试 ---');

const mockGradeSummary = {
    gpa: '3.85',
    totalCredits: '120.5',
    coursesCount: 5,
    semesters: ['2023-2024-2', '2023-2024-1', '2022-2023-2', '2022-2023-1'],
    gradesList: [
        { semester: '2021-2022-1', courseId: 'C01', courseName: '高等数学A', score: '88', credit: '5.0', gpa: '3.8' },
        { semester: '2023-2024-2', courseId: 'C02', courseName: '分布式系统', score: '95', credit: '3.0', gpa: '4.5' },
        { semester: '2022-2023-2', courseId: 'C03', courseName: '数据结构与算法', score: '90', credit: '4.0', gpa: '4.0' },
        { semester: '2023-2024-1', courseId: 'C04', courseName: '操作系统原理', score: '92', credit: '4.0', gpa: '4.2' },
        { semester: '2022-2023-1', courseId: 'C05', courseName: '计算机网络', score: '85', credit: '3.5', gpa: '3.5' }
    ]
};

// 2.1 初始渲染 / 全部学期时按学期倒序
GradeView.renderGradesData(mockGradeSummary);
const gradeCards = document.querySelectorAll('#grades-list .grade-card');
assert.equal(gradeCards.length, 5, '必须渲染全部 5 门课程成绩卡片');

const renderedSemesters = Array.from(gradeCards).map(card => {
    const metaText = card.querySelector('.grade-meta').textContent || '';
    const match = metaText.match(/学期:\s*([\d-]+)/);
    return match ? match[1] : '';
});

assert.deepEqual(
    renderedSemesters,
    ['2023-2024-2', '2023-2024-1', '2022-2023-2', '2022-2023-1', '2021-2022-1'],
    '全部学期视图下的成绩卡片必须严格按学期降序排列 (最新学期排在顶部)'
);
console.log('[PASS] 用例 2.1 通过: 成绩卡片在全部学期视图下严格按最新学期倒序排列');

// 2.2 单学期筛选测试
const selectSemEl = document.getElementById('select-grade-semester');
selectSemEl.value = '2022-2023-2';
GradeView.filterGrades();
const filteredCards = document.querySelectorAll('#grades-list .grade-card');
assert.equal(filteredCards.length, 1, '指定学期后只渲染该学期的 1 门课程');
assert.ok(filteredCards[0].textContent.includes('数据结构与算法'), '渲染的课程必须匹配指定学期');
console.log('[PASS] 用例 2.2 通过: 单学期筛选功能正常');

// 2.3 切换回全部学期重新验证倒序
selectSemEl.value = '';
GradeView.filterGrades();
const resetCards = document.querySelectorAll('#grades-list .grade-card');
const resetSemesters = Array.from(resetCards).map(card => {
    const match = card.querySelector('.grade-meta').textContent.match(/学期:\s*([\d-]+)/);
    return match ? match[1] : '';
});
assert.deepEqual(
    resetSemesters,
    ['2023-2024-2', '2023-2024-1', '2022-2023-2', '2022-2023-1', '2021-2022-1'],
    '切换回全部学期后必须重新恢复按学期降序排列'
);
console.log('[PASS] 用例 2.3 通过: 切换回全部学期后稳定保持倒序');

// 2.4 跨学期搜索过滤下的学期倒序
const searchInput = document.getElementById('input-grade-search');
searchInput.value = '系统'; // 匹配 2023-2024-2 '分布式系统' 与 2023-2024-1 '操作系统原理'
GradeView.filterGrades();
const searchCards = document.querySelectorAll('#grades-list .grade-card');
assert.equal(searchCards.length, 2, '搜索 "系统" 必须跨学期匹配出 2 门课程');
const searchSemesters = Array.from(searchCards).map(card => {
    const match = card.querySelector('.grade-meta').textContent.match(/学期:\s*([\d-]+)/);
    return match ? match[1] : '';
});
assert.deepEqual(
    searchSemesters,
    ['2023-2024-2', '2023-2024-1'],
    '全部学期下的搜索过滤结果必须同样按学期降序排列'
);
searchInput.value = '';
GradeView.filterGrades();
console.log('[PASS] 用例 2.4 通过: 跨学期多条搜索过滤交互及倒序保持验证成功');

// 2.5 复杂与边界学期数据倒序排列（多学期重叠、同届同季、空学期容错）
const complexSummary = {
    gpa: '3.90',
    totalCredits: '160',
    coursesCount: 7,
    semesters: ['2024-2025-1', '2023-2024-2', '2023-2024-1', '2022-2023-2'],
    gradesList: [
        { semester: '', courseId: 'E01', courseName: '未知学期补考', score: '70', credit: '2.0', gpa: '2.0' },
        { semester: '2023-2024-2', courseId: 'A01', courseName: '数据库原理', score: '92', credit: '3.0', gpa: '4.2' },
        { semester: '2024-2025-1', courseId: 'B01', courseName: '人工智能导论', score: '96', credit: '3.5', gpa: '4.8' },
        { semester: '2022-2023-2', courseId: 'C01', courseName: '大学物理', score: '85', credit: '4.0', gpa: '3.5' },
        { semester: '2023-2024-2', courseId: 'A02', courseName: '计算机体系结构', score: '89', credit: '3.5', gpa: '3.9' },
        { semester: '2023-2024-1', courseId: 'D01', courseName: '离散数学', score: '91', credit: '4.0', gpa: '4.1' }
    ]
};
selectSemEl.value = '';
GradeView.renderGradesData(complexSummary);
const complexCards = document.querySelectorAll('#grades-list .grade-card');
assert.equal(complexCards.length, 6, '必须渲染全部 6 门成绩卡片');

const complexOrderSemesters = Array.from(complexCards).map(card => {
    const metaText = card.querySelector('.grade-meta').textContent || '';
    const match = metaText.match(/学期:\s*([\d-]*)/);
    return match ? match[1] : '';
});
assert.deepEqual(
    complexOrderSemesters,
    ['2024-2025-1', '2023-2024-2', '2023-2024-2', '2023-2024-1', '2022-2023-2', ''],
    '复杂多学期降序排序正确且同届同季顺序稳定、空学期安全置底'
);
console.log('[PASS] 用例 2.5 通过: 复杂多学期与边界学期倒序排布测试成功');

// ── R3 测试套件: 课表网格纯净均匀边框 ──────────────────────────────────────────
console.log('\n--- 测试套件 3: R3 课表网格均匀边框与彩条消除测试 ---');

// 3.1 CSS 规则静态扫描
assert.ok(
    !cssContent.includes('border-left-width: 3px'),
    'app.css 严禁包含 border-left-width: 3px'
);
assert.ok(
    !cssContent.includes('border-left-color: rgba(56, 189, 248'),
    'app.css .blue 类严禁包含 border-left-color'
);
assert.ok(
    !cssContent.includes('border-left-color: rgba(244, 143, 177'),
    'app.css .pink 类严禁包含 border-left-color'
);
assert.ok(
    !cssContent.includes('border-left-color: rgba(45, 212, 191'),
    'app.css .cyan 类严禁包含 border-left-color'
);
assert.ok(
    !cssContent.includes('border-left-color: rgba(192, 132, 252'),
    'app.css .purple 类严禁包含 border-left-color'
);
console.log('[PASS] 用例 3.1 通过: app.css 中所有 3px 左侧彩条边框定义已彻底移除');

// 3.2 课表网格卡片渲染结构验证
const mockTimetable = {
    week: 1,
    term: '2023-2024-2',
    courses: [
        { name: '软件工程', room: '汇新401', day: 1, session: 1, slot: 1, activeWeeks: [1, 2, 3] },
        { name: '编译原理', room: '汇新402', day: 1, session: 2, slot: 3, activeWeeks: [1, 2, 3] },
        { name: '数据库系统', room: '汇文301', day: 2, session: 1, slot: 1, activeWeeks: [1, 2, 3] }
    ]
};

TimetableView.renderTimetableData(mockTimetable);
const courseCards = document.querySelectorAll('.grid-course-card');
assert.equal(courseCards.length, 3, '必须渲染 3 张课表卡片');

courseCards.forEach(card => {
    assert.ok(card.classList.contains('grid-course-card'), '必须包含 grid-course-card 类');
    const hasColorClass = ['blue', 'pink', 'cyan', 'purple'].some(c => card.classList.contains(c));
    assert.ok(hasColorClass, '课表卡片必须分配了合法颜色修饰类');
});
console.log('[PASS] 用例 3.2 通过: 课表网格卡片 DOM 渲染结构正常且类名规范');

// 清理临时构建目录
try { rmSync(TMP_DIR, { recursive: true, force: true }); } catch {}

console.log('\n==========================================================');
console.log('  全部 3 大体验与样式优化专项测试用例 100% 实测通过！');
console.log('==========================================================\n');
