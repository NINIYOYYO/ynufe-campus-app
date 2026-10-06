import assert from 'node:assert/strict';
import esbuild from 'esbuild';
import path from 'node:path';
import { rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseHTML, DOMParser } from 'linkedom';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const outFile = path.join(testDir, '.startup_recovery_bundle.mjs');
const source = (file) => path.resolve(testDir, '../src', file).replace(/\\/g, '/');
const realFetch = globalThis.fetch;
const realSetTimeout = globalThis.setTimeout;
const timers = new Set();
let scenarioId = 0;

class LocalStorageMock {
    store = new Map();
    getItem(key) { return this.store.get(key) ?? null; }
    setItem(key, value) { this.store.set(key, String(value)); }
    removeItem(key) { this.store.delete(key); }
    clear() { this.store.clear(); }
}

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

async function within(promise, label) {
    let timeout;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                timeout = realSetTimeout(() => reject(new Error(`Timed out: ${label}`)), 2000);
            }),
        ]);
    } finally {
        clearTimeout(timeout);
    }
}

await esbuild.build({
    stdin: {
        contents: `
            export { bootstrapApp } from '${source('main.ts')}';
            export { YnufeApp } from '${source('core/app.ts')}';
            export { AppLifecycleManager } from '${source('core/lifecycle.ts')}';
            export { AutoLogin } from '${source('services/autoLogin.ts')}';
            export { HeartbeatService } from '${source('services/heartbeatService.ts')}';
            export { SessionCookieManager } from '${source('services/cookieManager.ts')}';
            export { CaptchaOCR } from '${source('utils/captchaOcr.ts')}';
            export { YnufeSession } from '${source('stores/sessionStore.ts')}';
            export { LoginView } from '${source('views/loginView.ts')}';
            export { StorageKeys } from '${source('config/storageKeys.ts')}';
        `,
        resolveDir: testDir,
        sourcefile: 'startup-recovery-entry.ts',
        loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    loader: { '.css': 'empty' },
    outfile: outFile,
});

/** Fresh modules isolate lifecycle listeners and single-flight state between app launches. */
async function createScenario({
    cache = true,
    cookie = 'EXPIRED_TEST_SESSION',
    credentials = true,
    initiallyValid = false,
    loginSucceeds = true,
    pauseCaptcha = false,
    pauseCaptchaRequest = pauseCaptcha ? 1 : 0,
    refreshResult = true,
    refreshThrows = false,
    ocrResult = '7K9P',
    ocrThrows = false,
} = {}) {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    const dom = parseHTML(`<!DOCTYPE html><html><body>
        <div id="login-overlay" class="overlay active" style="display:flex"></div>
        <div id="loading-spinner" style="display:none"><p></p></div>
        <span id="sync-status-tag" class="sync-tag offline"><span class="sync-text"></span></span>
        <span id="user-name-display"></span>
        <form id="login-form">
            <input id="username"><input id="password" type="password">
            <input id="captcha"><input id="remember-me" type="checkbox">
            <img id="captcha-img"><div id="login-msg"></div>
            <button id="btn-login" type="submit">登录</button>
        </form>
    </body></html>`);
    for (const name of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLImageElement', 'Event', 'CustomEvent']) {
        globalThis[name] = dom[name];
    }
    globalThis.DOMParser = DOMParser;
    globalThis.localStorage = new LocalStorageMock();
    globalThis.sessionStorage = new LocalStorageMock();
    window.location = { hostname: 'localhost', origin: 'http://localhost', port: '', protocol: 'http:', href: 'http://localhost/' };
    window.Capacitor = { isNativePlatform: () => false, Plugins: {} };
    globalThis.requestAnimationFrame = (callback) => { callback(); return 1; };
    globalThis.cancelAnimationFrame = () => {};
    globalThis.setTimeout = (...args) => {
        const timer = realSetTimeout(...args);
        timers.add(timer);
        return timer;
    };
    if (!Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText')?.set) {
        Object.defineProperty(HTMLElement.prototype, 'innerText', {
            get() { return this.textContent || ''; },
            set(value) { this.textContent = value; },
            configurable: true,
        });
    }
    const cookieJar = new Map();
    Object.defineProperty(document, 'cookie', {
        get: () => [...cookieJar].map(([key, value]) => `${key}=${value}`).join('; '),
        set: (value) => {
            const pair = value.split(';')[0];
            const separator = pair.indexOf('=');
            cookieJar.set(pair.slice(0, separator), pair.slice(separator + 1));
        },
        configurable: true,
    });

    const modules = await import(`${pathToFileURL(outFile).href}?scenario=${++scenarioId}`);
    const { YnufeApp, AppLifecycleManager, YnufeSession, SessionCookieManager, HeartbeatService, CaptchaOCR, LoginView, StorageKeys } = modules;
    const counts = { profile: 0, captcha: 0, login: 0, refresh: 0, prefill: 0, heartbeat: 0, heartbeatStop: 0, ocr: 0 };
    const captchaStarted = deferred();
    const pausedCaptchaStarted = deferred();
    const releaseCaptcha = deferred();
    let validSession = initiallyValid;
    let loginAllowed = loginSucceeds;
    let prefillCaptcha = Promise.resolve();
    const realPrefill = LoginView.prefillLoginForm.bind(LoginView);
    const realRefreshCaptcha = LoginView.refreshCaptchaAndAutoFill.bind(LoginView);
    LoginView.refreshCaptchaAndAutoFill = (...args) => {
        prefillCaptcha = realRefreshCaptcha(...args);
        return prefillCaptcha;
    };
    LoginView.prefillLoginForm = () => {
        counts.prefill++;
        realPrefill();
    };
    HeartbeatService.start = () => { counts.heartbeat++; };
    HeartbeatService.stop = () => { counts.heartbeatStop++; };
    YnufeApp.loadHomeBusinessData = async () => {
        counts.refresh++;
        if (refreshThrows) throw new Error('Simulated temporary data outage');
        return refreshResult;
    };
    // Keep real cached-profile loading and lifecycle wiring; unrelated UI setup is outside this test.
    YnufeApp.init = () => {
        AppLifecycleManager.setRefreshHandler(() => YnufeApp.loadHomeBusinessData());
        AppLifecycleManager.init();
    };
    CaptchaOCR.recognize = async () => {
        counts.ocr++;
        if (ocrThrows) throw new Error('Simulated OCR failure');
        return ocrResult;
    };
    const profileHtml = '<html><body>' + ['', '测试同学', 'TEST_STUDENT', '测试学院', '测试专业', '测试班级']
        .map((value) => `<div class="middletopdwxxcont">${value}</div>`).join('') + '</body></html>';
    // All network traffic terminates here. The real client, Cookie handling, timeout detection,
    // profile parser and AutoLogin continue to execute, including session-expired dispatches.
    globalThis.fetch = async (url, options) => {
        const endpoint = new URL(url, 'http://localhost').pathname;
        if (endpoint === '/jsxsd/framework/xsMain_new.jsp') {
            counts.profile++;
            return new Response(validSession ? profileHtml : '<form action="LoginToXkLdap">请重新登录</form>', {
                headers: { 'Content-Type': 'text/html' },
            });
        }
        if (endpoint.includes('verifycode')) {
            counts.captcha++;
            captchaStarted.resolve();
            if (counts.captcha === pauseCaptchaRequest) {
                pausedCaptchaStarted.resolve();
                await releaseCaptcha.promise;
            }
            return new Response(new Uint8Array([1, 2, 3]), {
                headers: { 'Content-Type': 'image/png', 'Set-Cookie': 'JSESSIONID=CAPTCHA_TEST_SESSION; Path=/jsxsd' },
            });
        }
        if (endpoint === '/jsxsd/xk/LoginToXkLdap') {
            counts.login++;
            const body = new URLSearchParams(options.body);
            assert.equal(body.get('userAccount'), 'TEST_STUDENT');
            assert.equal(body.get('RANDOMCODE'), '7K9P');
            assert.match(options.headers.Cookie, /JSESSIONID=CAPTCHA_TEST_SESSION/);
            validSession = loginAllowed;
            return new Response(loginAllowed ? profileHtml : '用户名或密码错误', {
                headers: { 'Content-Type': 'text/html', 'Set-Cookie': 'JSESSIONID=RENEWED_TEST_SESSION; Path=/jsxsd' },
            });
        }
        throw new Error(`Unexpected mocked endpoint: ${endpoint}`);
    };
    if (credentials) YnufeSession.saveCredentials('TEST_STUDENT', 'TestPasswordOnly!', true);
    if (cookie) SessionCookieManager.saveJsessionId(cookie);
    if (cache) YnufeSession.setCache(StorageKeys.USER_PROFILE, { name: '缓存同学', studentId: 'TEST_STUDENT' });
    return {
        ...modules,
        counts,
        captchaStarted: captchaStarted.promise,
        pausedCaptchaStarted: pausedCaptchaStarted.promise,
        releaseCaptcha: releaseCaptcha.resolve,
        setLoginSucceeds: (allowed) => { loginAllowed = allowed; },
        waitForPrefill: () => prefillCaptcha,
        overlay: document.getElementById('login-overlay'),
        sync: document.getElementById('sync-status-tag'),
    };
}

function assertRecovered(context) {
    assert.equal(context.overlay.style.display, 'none', '认证成功必须关闭登录表单');
    assert.equal(context.overlay.classList.contains('active'), false);
    assert.equal(context.YnufeSession.getHasSession(), true);
    assert.equal(context.counts.prefill, 0, '自动恢复成功不应预填表单或请求额外验证码');
    assert.equal(context.counts.refresh, 1, '每轮恢复只能同步一次业务数据');
    assert.ok(context.counts.heartbeat >= 1, '成功恢复后应启动心跳');
}

try {
    for (const cookie of ['EXPIRED_TEST_SESSION', '']) {
        const context = await createScenario({ cookie, pauseCaptcha: true });
        const boot = context.bootstrapApp();
        await within(context.captchaStarted, 'startup reaches automatic captcha request');
        assert.equal(document.getElementById('user-name-display').textContent, '缓存同学', '续期期间应保留已缓存的数据');
        assert.equal(context.overlay.style.display, 'none', '续期等待期间不能弹出登录表单');
        assert.equal(document.getElementById('loading-spinner').style.display, 'none', '已有缓存时不应遮住首页');
        assert.equal(context.counts.prefill, 0);
        assert.equal(context.counts.captcha, 1, '启动恢复与过期事件不能并发刷新验证码');
        assert.equal(context.AutoLogin.isRunning, true);
        context.YnufeSession.setHasSession(true); // A stale persisted flag must not bypass the authentication guard.
        const heartbeatCount = context.counts.heartbeat;
        Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        assert.equal(context.counts.heartbeat, heartbeatCount, '认证仍在进行时，回前台不能额外启动心跳');
        context.releaseCaptcha();
        await within(boot, 'automatic startup login completes');
        assertRecovered(context);
        assert.equal(context.counts.login, 1, '保存的密码必须自动提交，无需点击登录');
        assert.equal(context.counts.profile, 2, '应探测旧会话并验证新会话');
        assert.equal(context.SessionCookieManager.getSavedJsessionId(), 'RENEWED_TEST_SESSION');
        assert.equal(context.sync.classList.contains('online'), true);
        console.log(`[PASS] Cached startup automatically renews ${cookie ? 'expired' : 'missing'} Cookie without opening login`);
    }

    {
        const context = await createScenario({ cache: false, credentials: false, cookie: 'VALID_TEST_SESSION', initiallyValid: true });
        await within(context.bootstrapApp(), 'valid Cookie-only startup');
        assertRecovered(context);
        assert.equal(context.counts.profile, 1);
        assert.equal(context.counts.captcha, 0);
        assert.equal(context.counts.login, 0, '有效 Cookie 不需要密码和重新登录');
        console.log('[PASS] Valid Cookie starts the app without saved password or cached data');
    }

    {
        const realNow = Date.now;
        let now = 1700000000000;
        Date.now = () => now;
        try {
            const context = await createScenario({ cookie: 'VALID_TEST_SESSION', initiallyValid: true });
            await within(context.bootstrapApp(), 'session ready before quick background/foreground transition');
            const before = { ...context.counts };
            Object.defineProperty(document, 'hidden', { value: true, writable: true, configurable: true });
            document.dispatchEvent(new Event('visibilitychange'));
            assert.equal(context.counts.heartbeatStop, before.heartbeatStop + 1, '进入后台应停止心跳');
            now += 1000;
            document.hidden = false;
            document.dispatchEvent(new Event('visibilitychange'));
            assert.equal(context.counts.heartbeat, before.heartbeat + 1, '30 秒限流期间回到前台也必须恢复心跳');
            assert.equal(context.counts.profile, before.profile, '短暂切换应复用刚验证成功的会话');
            assert.equal(context.counts.login, before.login);
            assert.equal(context.counts.refresh, before.refresh);
            assert.equal(context.overlay.style.display, 'none');
            console.log('[PASS] Quick foreground return restarts heartbeat even while recovery is throttled');
        } finally {
            Date.now = realNow;
        }
    }

    {
        const context = await createScenario({ pauseCaptcha: true });
        context.YnufeApp.init();
        for (let i = 0; i < 6; i++) window.dispatchEvent(new CustomEvent('ynufe-session-expired'));
        const recovery = context.AppLifecycleManager.recoverSession();
        assert.equal(context.AppLifecycleManager.recoverSession(), recovery, '并发调用应复用同一个恢复 Promise');
        await within(context.captchaStarted, 'runtime recovery begins');
        for (let i = 0; i < 6; i++) window.dispatchEvent(new CustomEvent('ynufe-session-expired'));
        assert.equal(context.counts.captcha, 1);
        // A previously displayed overlay must also be dismissed when recovery finishes.
        context.overlay.style.display = 'flex';
        context.overlay.classList.add('active');
        context.releaseCaptcha();
        assert.equal(await within(recovery, 'concurrent runtime recovery'), true);
        assertRecovered(context);
        assert.equal(context.counts.login, 1);
        assert.equal(context.counts.captcha, 1);
        console.log('[PASS] Concurrent expiration events share recovery and dismiss an already visible login page');
    }

    {
        const context = await createScenario({ loginSucceeds: false, pauseCaptcha: true });
        const boot = context.bootstrapApp();
        await within(context.captchaStarted, 'failed recovery starts automatically');
        assert.equal(context.overlay.style.display, 'none');
        assert.equal(context.counts.prefill, 0, '必须先完成自动恢复尝试，再让用户手动登录');
        context.releaseCaptcha();
        await within(boot, 'failed recovery completes');
        await within(context.waitForPrefill(), 'fallback captcha is ready');
        assert.equal(context.overlay.style.display, 'flex');
        assert.equal(context.counts.prefill, 1);
        assert.equal(document.getElementById('username').value, 'TEST_STUDENT');
        assert.equal(document.getElementById('password').value, 'TestPasswordOnly!');
        assert.equal(document.getElementById('captcha').value, '7K9P');
        assert.equal(context.counts.login, 1, '错误密码应立即停止重试');
        assert.equal(context.counts.captcha, 2, '失败后只额外准备一次手动登录验证码');
        assert.equal(context.counts.refresh, 0);
        assert.equal(context.YnufeSession.getHasSession(), false);
        console.log('[PASS] Only failed automatic recovery prefills and opens the manual login form');
    }

    {
        const context = await createScenario({ loginSucceeds: false, pauseCaptchaRequest: 2 });
        await within(context.bootstrapApp(), 'first recovery fails and prepares fallback captcha');
        await within(context.pausedCaptchaStarted, 'fallback captcha remains pending');
        assert.equal(context.counts.prefill, 1);
        assert.equal(context.counts.captcha, 2);
        assert.equal(context.overlay.style.display, 'flex');
        const pendingCaptchaWaitStarted = deferred();
        const realWait = context.LoginView.waitForPendingCaptcha.bind(context.LoginView);
        context.LoginView.waitForPendingCaptcha = () => {
            const pending = realWait();
            pendingCaptchaWaitStarted.resolve();
            return pending;
        };
        context.setLoginSucceeds(true);
        const recovery = context.AppLifecycleManager.recoverSession();
        await within(pendingCaptchaWaitStarted.promise, 'second recovery waits for fallback captcha');
        // Drain ready work while the controlled response is still blocked, so a missing await
        // cannot pass merely because a duplicate request has not reached fetch yet.
        await new Promise(setImmediate);
        assert.equal(context.counts.captcha, 2, '旧验证码未完成前，不得发起另一轮验证码请求');
        assert.equal(context.counts.profile, 1, '旧验证码未完成前，不得开始验证或覆盖会话');
        assert.equal(context.counts.login, 1);
        assert.equal(context.overlay.style.display, 'none');
        context.releaseCaptcha();
        assert.equal(await within(recovery, 'second recovery succeeds after fallback captcha settles'), true);
        assert.equal(context.overlay.style.display, 'none');
        assert.equal(context.YnufeSession.getHasSession(), true);
        assert.equal(context.counts.captcha, 3, '旧验证码完成后，新恢复只应再请求一次验证码');
        assert.equal(context.counts.login, 2);
        assert.equal(context.counts.prefill, 1, '恢复成功不应再准备手动登录验证码');
        assert.equal(context.counts.refresh, 1);
        assert.equal(context.SessionCookieManager.getSavedJsessionId(), 'RENEWED_TEST_SESSION');
        console.log('[PASS] Retried recovery waits for the prior fallback captcha before authenticating');
    }

    {
        const context = await createScenario();
        let onLoginSuccess;
        context.LoginView.bindEvents = (callback) => { onLoginSuccess = callback; };
        // Exercise the real app event wiring without initializing wallpaper/theme components.
        context.YnufeApp.bindEvents();
        assert.equal(typeof onLoginSuccess, 'function');
        const order = [];
        const startHeartbeat = context.HeartbeatService.start.bind(context.HeartbeatService);
        const loadHome = context.YnufeApp.loadHomeBusinessData.bind(context.YnufeApp);
        context.HeartbeatService.start = () => { order.push('heartbeat'); startHeartbeat(); };
        context.YnufeApp.loadHomeBusinessData = () => { order.push('refresh'); return loadHome(); };
        document.getElementById('username').value = 'TEST_STUDENT';
        document.getElementById('password').value = 'TestPasswordOnly!';
        document.getElementById('remember-me').checked = true;
        await within(context.LoginView.handleLogin({ preventDefault() {} }, onLoginSuccess), 'manual login follows real app callback');
        assert.deepEqual(order, ['heartbeat', 'refresh'], '真实登录成功回调必须先恢复心跳，再刷新业务数据');
        assert.equal(context.counts.login, 1);
        assert.equal(context.counts.refresh, 1);
        assert.equal(context.overlay.style.display, 'none');
        assert.equal(context.YnufeSession.getHasSession(), true);
        console.log('[PASS] Real manual-login callback starts heartbeat before home refresh');
    }

    for (const refreshThrows of [false, true]) {
        const context = await createScenario({ refreshResult: false, refreshThrows });
        await within(context.bootstrapApp(), 'authenticated startup with data outage');
        assertRecovered(context);
        assert.equal(context.sync.classList.contains('offline'), true);
        assert.match(context.sync.textContent, /未同步/);
        assert.equal(context.counts.login, 1);
        console.log(`[PASS] ${refreshThrows ? 'Thrown' : 'Reported'} data refresh failure keeps the restored session and homepage`);
    }

    for (const ocrThrows of [false, true]) {
        const context = await createScenario({ ocrResult: '  ', ocrThrows });
        assert.equal(await within(context.AutoLogin.attempt(), 'OCR failure attempts finish'), false);
        assert.equal(context.counts.captcha, 3, '验证码失败应受最多三次重试限制');
        assert.equal(context.counts.login, 0, 'OCR 空结果或异常不能提交空验证码');
        console.log(`[PASS] ${ocrThrows ? 'Failed' : 'Blank'} OCR never submits an empty captcha`);
    }

    console.log('Startup/session recovery regressions passed (12 scenarios, real client and AutoLogin).');
} finally {
    globalThis.fetch = realFetch;
    globalThis.setTimeout = realSetTimeout;
    for (const timer of timers) clearTimeout(timer);
    rmSync(outFile, { force: true });
}
