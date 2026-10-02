import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseHTML } from 'linkedom';

const out = resolve('tests/.build/captcha-recovery.mjs');
await build({
    stdin: { contents: `
        export { YnufeClient } from './src/api/client';
        export { CaptchaOCR } from './src/utils/captchaOcr';
        export { LoginView } from './src/views/loginView';
        export { AutoLogin } from './src/services/autoLogin';
        export { YnufeSession } from './src/stores/sessionStore';
        export { SessionCookieManager } from './src/services/cookieManager';
    `, resolveDir: process.cwd(), loader: 'ts' },
    outfile: out, bundle: true, platform: 'node', format: 'esm',
});

const storage = new Map();
globalThis.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
};
const { window, document, HTMLElement, Event, CustomEvent } = parseHTML(`<!doctype html><html><body>
    <div id="login-overlay" class="overlay active"></div>
    <div id="loading-spinner"><p></p></div>
    <input id="username"><input id="password"><input id="captcha"><input id="remember-me" type="checkbox">
    <img id="captcha-img"><div id="login-msg"></div><form id="login-form"></form>
    <span id="sync-status-tag" class="sync-tag"><span class="sync-text"></span></span>
</body></html>`);
Object.assign(globalThis, { window, document, Event, CustomEvent });
window.location = { hostname: 'localhost', origin: 'http://localhost', port: '' };
Object.defineProperty(document, 'cookie', { get: () => '', set() {}, configurable: true });
Object.defineProperty(HTMLElement.prototype, 'innerText', {
    get() { return this.textContent; }, set(value) { this.textContent = value; }, configurable: true,
});
globalThis.requestAnimationFrame = fn => { fn(); return 1; };

const { YnufeClient, CaptchaOCR, LoginView, AutoLogin, YnufeSession, SessionCookieManager } = await import(pathToFileURL(out).href);
const originalFetch = globalThis.fetch;
const originalCreateURL = URL.createObjectURL;
const originalRevokeURL = URL.revokeObjectURL;
const originalCreateElement = document.createElement.bind(document);
const originalRecognize = CaptchaOCR.recognize;
const originalGetCaptcha = YnufeClient.getCaptchaBlob;
const originalPost = YnufeClient.postForm;
const originalVerify = AutoLogin.verifySession;
const originalSetTimeout = globalThis.setTimeout;
const originalImage = globalThis.Image;
const revoked = [];
let urlNumber = 0;
URL.createObjectURL = () => `blob:test-${++urlNumber}`;
URL.revokeObjectURL = url => revoked.push(url);
const deferred = () => {
    let resolvePromise;
    const promise = new Promise(resolve => { resolvePromise = resolve; });
    return { promise, resolve: resolvePromise };
};

try {
    let jar = 'JSESSIONID=EXPIRED_SESSION';
    let nativeGet;
    let nativePost;
    window.Capacitor = { isNativePlatform: () => true, Plugins: {
        NativeCookie: { getCookie: async () => ({ cookie: jar }), setCookie: async () => {} },
        CapacitorHttp: { get: options => nativeGet(options), post: options => nativePost(options) },
    } };
    globalThis.fetch = async () => { throw new Error('Native regression must not fall back to a network request'); };
    SessionCookieManager.saveJsessionId('EXPIRED_SESSION');
    nativeGet = async () => ({ status: 200, headers: {
        'Content-Type': 'image/png', 'Set-Cookie': 'JSESSIONID=CAPTCHA_SESSION; Path=/jsxsd; HttpOnly',
    }, data: 'QQ==' });
    await YnufeClient.getCaptchaBlob();
    assert.equal(SessionCookieManager.getSavedJsessionId(), 'CAPTCHA_SESSION', 'Explicit captcha response must beat the stale native jar');
    nativePost = async options => {
        assert.equal(options.headers.Cookie, 'JSESSIONID=CAPTCHA_SESSION');
        return { status: 200, headers: {}, data: '<html>login accepted</html>' };
    };
    await YnufeClient.postForm('/jsxsd/xk/LoginToXkLdap', { RANDOMCODE: 'TEST' });
    assert.equal(SessionCookieManager.getSavedJsessionId(), 'CAPTCHA_SESSION', 'Unchanged stale jar must not undo the explicit response on the following POST');
    console.log('[PASS] Captcha response session survives stale jar capture and the subsequent login POST');

    SessionCookieManager.saveJsessionId('EXPIRED_SESSION');
    jar = 'JSESSIONID=EXPIRED_SESSION';
    nativeGet = async () => {
        jar = 'JSESSIONID=ROTATED_SESSION; JSESSIONID=EXPIRED_SESSION';
        return { status: 200, headers: { 'Content-Type': 'image/png' }, data: 'QQ==' };
    };
    await YnufeClient.getCaptchaBlob();
    assert.equal(SessionCookieManager.getSavedJsessionId(), 'ROTATED_SESSION', 'Headerless captcha rotation must prefer the new scoped cookie');
    nativePost = async options => {
        assert.equal(options.headers.Cookie, 'JSESSIONID=ROTATED_SESSION');
        jar = 'JSESSIONID=AUTHENTICATED_SESSION; JSESSIONID=ROTATED_SESSION';
        return { status: 200, headers: {}, data: '<html>login accepted</html>' };
    };
    await YnufeClient.postForm('/jsxsd/xk/LoginToXkLdap', { RANDOMCODE: 'TEST' });
    assert.equal(SessionCookieManager.getSavedJsessionId(), 'AUTHENTICATED_SESSION');
    jar = 'JSESSIONID=UNRELATED_STALE_COOKIE';
    await SessionCookieManager.captureAndPersist();
    assert.equal(SessionCookieManager.getSavedJsessionId(), 'AUTHENTICATED_SESSION', 'Ordinary capture must preserve the verified session');
    console.log('[PASS] Headerless captcha and login rotations update only authentication requests');

    window.Capacitor.isNativePlatform = () => false;
    SessionCookieManager.saveJsessionId('EXPIRED_SESSION');
    globalThis.fetch = async () => new Response(new Uint8Array([65]), {
        headers: { 'Content-Type': 'image/png', 'Set-Cookie': 'JSESSIONID=BROWSER_SESSION; Path=/jsxsd' },
    });
    await YnufeClient.getCaptchaBlob();
    assert.equal(SessionCookieManager.getSavedJsessionId(), 'BROWSER_SESSION');
    globalThis.fetch = async () => new Response('<html>maintenance</html>', { headers: { 'Content-Type': 'text/html' } });
    await assert.rejects(YnufeClient.getCaptchaBlob(), /not an image/);
    console.log('[PASS] Browser transport rotates captcha sessions and rejects HTML masquerading as an image');

    // An image that loads synchronously reproduces WebView callback-registration ordering.
    const pixels = new Uint8ClampedArray(64 * 40 * 4).fill(255);
    document.createElement = tag => tag === 'canvas' ? {
        width: 0, height: 0,
        getContext: () => ({ drawImage() {}, getImageData: () => ({ data: pixels }) }),
    } : originalCreateElement(tag);
    globalThis.Image = class {
        naturalWidth = 64;
        naturalHeight = 40;
        set src(value) { if (value) this.onload?.(); }
    };
    const beforeSuccess = revoked.length;
    await CaptchaOCR.recognizeWithDetails(new Blob([65], { type: 'image/png' }));
    assert.equal(revoked.length, beforeSuccess + 1);
    globalThis.Image = class { set src(value) { if (value) this.onerror?.(); } };
    const beforeError = revoked.length;
    await assert.rejects(CaptchaOCR.recognizeWithDetails(new Blob([65])), /Failed to load/);
    assert.equal(revoked.length, beforeError + 1);
    globalThis.Image = class { set src(_value) {} };
    let decodeDeadline = 0;
    globalThis.setTimeout = (callback, delay, ...args) => {
        decodeDeadline = delay;
        return originalSetTimeout(callback, 0, ...args);
    };
    const beforeTimeout = revoked.length;
    await assert.rejects(CaptchaOCR.recognizeWithDetails(new Blob([65])), /timed out/);
    assert.ok(decodeDeadline > 0 && decodeDeadline <= 10000);
    assert.equal(revoked.length, beforeTimeout + 1);
    globalThis.setTimeout = originalSetTimeout;
    document.createElement = originalCreateElement;
    console.log('[PASS] Synchronous image events and missing decode callbacks complete with URL cleanup');

    const captchaInput = document.getElementById('captcha');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    usernameInput.value = 'TEST_STUDENT';
    passwordInput.value = 'TEST_PASSWORD';
    CaptchaOCR.recognize = async () => 'TEST';
    let captchaFetches = 0;
    const pendingCaptcha = deferred();
    YnufeClient.getCaptchaBlob = async () => { captchaFetches++; return pendingCaptcha.promise; };
    LoginView.bindEvents();
    const firstRefresh = LoginView.refreshCaptchaAndAutoFill();
    assert.equal(LoginView.refreshCaptchaAndAutoFill(), firstRefresh);
    assert.equal(LoginView.waitForPendingCaptcha(), firstRefresh, 'Background recovery must await the pending manual captcha before rotating sessions');
    let posts = 0;
    YnufeClient.postForm = async (_endpoint, fields) => {
        posts++;
        assert.equal(fields.RANDOMCODE, 'TEST');
        return '<html>login accepted</html>';
    };
    AutoLogin.verifySession = async () => true;
    const login = LoginView.handleLogin({ preventDefault() {} }, async () => false);
    assert.equal(LoginView.isAuthenticating, true);
    assert.equal(LoginView.handleLogin({ preventDefault() {} }), login);
    assert.equal(LoginView.handleCookieLogin('JSESSIONID=OTHER_TEST_SESSION'), login);
    document.getElementById('captcha-img').dispatchEvent(new Event('click'));
    assert.equal(captchaFetches, 1);
    assert.equal(posts, 0, 'Submitting while prefill is in flight must await that same captcha');
    pendingCaptcha.resolve(new Blob([65], { type: 'image/png' }));
    await login;
    assert.equal(posts, 1);
    assert.equal(LoginView.isAuthenticating, false);
    assert.equal(await LoginView.waitForPendingCaptcha(), '');
    assert.notEqual(captchaInput.placeholder, '识别中...');
    console.log('[PASS] Prefill, repeated submit, Cookie import and captcha clicks cannot race authentication');

    YnufeClient.getCaptchaBlob = async () => { throw new Error('Simulated offline captcha request'); };
    captchaInput.value = 'OLD_CODE';
    assert.equal(await LoginView.refreshCaptchaAndAutoFill(), '');
    assert.equal(captchaInput.value, '');
    assert.equal(captchaInput.placeholder, '请输入验证码');
    await LoginView.handleLogin({ preventDefault() {} });
    assert.equal(posts, 1, 'Failed OCR/fetch must never submit an empty captcha');
    assert.equal(LoginView.isAuthenticating, false);
    console.log('[PASS] Failed captcha refresh clears stale values and never submits an empty code');

    for (const authType of ['password', 'cookie']) {
        for (const syncFailure of ['false', 'throw']) {
            let verified = 0;
            let submitted = 0;
            let refreshed = 0;
            let syncCalls = 0;
            YnufeSession.setHasSession(false);
            SessionCookieManager.saveJsessionId('VERIFIED_TEST_SESSION');
            captchaInput.value = 'TEST';
            const overlay = document.getElementById('login-overlay');
            overlay.style.display = 'flex';
            overlay.classList.add('active');
            YnufeClient.getCaptchaBlob = async () => { refreshed++; throw new Error('Unexpected captcha refresh after authentication'); };
            YnufeClient.postForm = async () => { submitted++; return '<html>login accepted</html>'; };
            AutoLogin.verifySession = async () => { verified++; return true; };
            const sync = async () => {
                syncCalls++;
                assert.equal(overlay.style.display, 'none', 'Verified login must dismiss the form before business sync');
                if (syncFailure === 'throw') throw new Error('Simulated business data failure');
                return false;
            };
            if (authType === 'password') await LoginView.handleLogin({ preventDefault() {} }, sync);
            else await LoginView.handleCookieLogin('JSESSIONID=VERIFIED_TEST_SESSION', sync);
            assert.equal(verified, 1, `${authType}/${syncFailure}: authentication must verify exactly once`);
            assert.equal(submitted, authType === 'password' ? 1 : 0, 'Failed business sync must not repeat authentication POST');
            assert.equal(refreshed, 0, 'Failed business sync must not replace the captcha');
            assert.equal(syncCalls, 1);
            assert.equal(YnufeSession.getHasSession(), true);
            assert.equal(SessionCookieManager.getSavedJsessionId(), 'VERIFIED_TEST_SESSION');
            assert.equal(overlay.style.display, 'none');
            assert.equal(overlay.classList.contains('active'), false);
            assert.equal(document.querySelector('#sync-status-tag .sync-text').textContent, '已登录 · 待同步');
            assert.equal(document.getElementById('loading-spinner').style.display, 'none');
            assert.equal(LoginView.isAuthenticating, false);
        }
    }
    console.log('[PASS] Verified password/Cookie login remains complete when business sync returns false or throws');
} finally {
    globalThis.fetch = originalFetch;
    globalThis.Image = originalImage;
    globalThis.setTimeout = originalSetTimeout;
    document.createElement = originalCreateElement;
    URL.createObjectURL = originalCreateURL;
    URL.revokeObjectURL = originalRevokeURL;
    CaptchaOCR.recognize = originalRecognize;
    YnufeClient.getCaptchaBlob = originalGetCaptcha;
    YnufeClient.postForm = originalPost;
    AutoLogin.verifySession = originalVerify;
    rmSync(out, { force: true });
}
