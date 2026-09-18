import assert from 'node:assert/strict';
import esbuild from 'esbuild';
import path from 'node:path';
import { rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseHTML } from 'linkedom';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUT_FILE = path.join(__dirname, '.login_flow_bundle.mjs');

// 1. 模拟 LocalStorage 与 SessionStorage
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
globalThis.sessionStorage = new LocalStorageMock();

// 2. 初始化 linkedom DOM 环境
const {
    window,
    document,
    HTMLElement,
    HTMLInputElement,
    HTMLImageElement,
    Event,
    CustomEvent,
} = parseHTML(`<!DOCTYPE html>
<html>
<head></head>
<body>
    <div id="login-overlay" class="overlay active"></div>
    <div id="loading-spinner" class="overlay" style="display:none;"><p>正在拉取最新教务数据...</p></div>
    <span id="sync-status-tag" class="sync-tag offline"><span class="sync-text">未同步</span></span>
    <form id="login-form">
        <input type="text" id="username" />
        <input type="password" id="password" />
        <input type="text" id="captcha" />
        <input type="checkbox" id="remember-me" />
        <img id="captcha-img" src="" />
        <div id="login-msg" class="error-msg"></div>
        <button type="submit" id="btn-login">登录</button>
    </form>
</body>
</html>`);

globalThis.window = window;
globalThis.window.location = {
    hostname: "localhost",
    origin: "http://localhost",
    port: "",
    protocol: "http:",
    href: "http://localhost/"
};
globalThis.document = document;
let cookieStore = "";
Object.defineProperty(globalThis.document, 'cookie', {
    get: () => cookieStore,
    set: (v) => { cookieStore = v; },
    configurable: true
});
globalThis.HTMLElement = HTMLElement;
globalThis.HTMLInputElement = HTMLInputElement;
globalThis.HTMLImageElement = HTMLImageElement;
globalThis.Event = Event;
globalThis.CustomEvent = CustomEvent;
globalThis.requestAnimationFrame = (cb) => { cb(); return 1; };
globalThis.cancelAnimationFrame = () => {};

// linkedom 兼容性 Shim: 补齐 innerText
if (!Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText')?.set) {
    Object.defineProperty(HTMLElement.prototype, 'innerText', {
        get() {
            return this.textContent || '';
        },
        set(val) {
            this.textContent = val;
        },
        configurable: true
    });
}

globalThis.URL = {
    createObjectURL: () => `blob:mock-url-${Math.random()}`,
    revokeObjectURL: () => {}
};

// 3. 打包编译生产环境核心 TS 模块
const entryCode = `
export { LoginView } from '${path.resolve(__dirname, '../src/views/loginView.ts').replace(/\\/g, '/')}';
export { YnufeClient } from '${path.resolve(__dirname, '../src/api/client.ts').replace(/\\/g, '/')}';
export { AutoLogin } from '${path.resolve(__dirname, '../src/services/autoLogin.ts').replace(/\\/g, '/')}';
export { CaptchaOCR } from '${path.resolve(__dirname, '../src/utils/captchaOcr.ts').replace(/\\/g, '/')}';
export { YnufeSession } from '${path.resolve(__dirname, '../src/stores/sessionStore.ts').replace(/\\/g, '/')}';
export { SessionCookieManager } from '${path.resolve(__dirname, '../src/services/cookieManager.ts').replace(/\\/g, '/')}';
`;

await esbuild.build({
    stdin: {
        contents: entryCode,
        resolveDir: __dirname,
        sourcefile: 'login-test-entry.ts',
        loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    outfile: OUT_FILE,
    platform: 'browser',
    external: ['../styles/app.css', '*.css']
});

const {
    LoginView,
    YnufeClient,
    AutoLogin,
    CaptchaOCR,
    YnufeSession
} = await import(pathToFileURL(OUT_FILE).href);

console.log("=== 开始运行 智能验证码自动识别与自动登录实测 (真实生产模块) ===");

const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const captchaInput = document.getElementById("captcha");
const rememberInput = document.getElementById("remember-me");
const loginMsg = document.getElementById("login-msg");

// Mock Captcha 图片与 OCR 识别
YnufeClient.getCaptchaBlob = async () => ({ size: 1024, type: "image/jpeg" });
CaptchaOCR.recognize = async () => "7K9P";

try {
    // 测试用例 1: prefillLoginForm 真实调用与凭据自动装填
    {
        YnufeSession.saveCredentials("2023110099", "RealTestPassword999", true);
        LoginView.prefillLoginForm();

        assert.equal(usernameInput.value, "2023110099", "LoginView.prefillLoginForm 应自动填入学号");
        assert.equal(passwordInput.value, "RealTestPassword999", "LoginView.prefillLoginForm 应自动填入密码");
        assert.equal(rememberInput.checked, true, "记住账号密码复选框应自动勾选");
        console.log("[PASS] 用例 1: LoginView.prefillLoginForm 真实凭据装填与调度通过");
    }

    // 测试用例 2: 空输入校验与错误提示
    {
        usernameInput.value = "";
        passwordInput.value = "";
        loginMsg.innerText = "";
        const fakeEvent = { preventDefault: () => {} };

        await LoginView.handleLogin(fakeEvent);
        assert.equal(loginMsg.innerText, "请输入完整的学号与密码！", "空输入时应立即提示错误并不发起网络请求");
        console.log("[PASS] 用例 2: 空账号密码防御性拦截验证通过");
    }

    // 测试用例 3: 密码错误立即熔断拦截 (不执行任何重试)
    {
        usernameInput.value = "2023110099";
        passwordInput.value = "WrongPassword";
        captchaInput.value = "7K9P";
        loginMsg.innerText = "";
        const fakeEvent = { preventDefault: () => {} };

        let postCount = 0;
        YnufeClient.postForm = async () => {
            postCount++;
            return "<html><script>alert('用户名或密码错误，请重新输入');</script></html>";
        };

        await LoginView.handleLogin(fakeEvent);
        assert.equal(postCount, 1, "密码错误时必须立即熔断，严禁进行无意义自动重试");
        assert.equal(loginMsg.innerText, "学号或密码有误，请仔细核对！", "密码错误时必须展示清晰提示");
        console.log("[PASS] 用例 3: 账号密码错误立即熔断机制验证通过");
    }

    // 测试用例 4: 验证码错误自动换图重试与 3 次超限保护 (MAX_LOGIN_RETRIES = 3)
    {
        usernameInput.value = "2023110099";
        passwordInput.value = "CorrectPassword";
        captchaInput.value = "7K9P";
        loginMsg.innerText = "";
        const fakeEvent = { preventDefault: () => {} };

        let postAttempts = 0;
        YnufeClient.postForm = async () => {
            postAttempts++;
            return "<html><script>alert('验证码错误');</script></html>";
        };

        await LoginView.handleLogin(fakeEvent);
        assert.equal(postAttempts, 3, "验证码错误时必须自动重试正好 3 次 (MAX_LOGIN_RETRIES)");
        assert.equal(loginMsg.innerText, "验证码自动重试超限，请手动核对并输入验证码！", "3次重试超限后必须优雅降级让用户手动输入");
        console.log("[PASS] 用例 4: 验证码错误自愈重试与 3 次超限降级实测通过");
    }

    // 测试用例 5: 登录成功全生命周期链路测试
    {
        usernameInput.value = "2023110099";
        passwordInput.value = "CorrectPassword";
        captchaInput.value = "7K9P";
        loginMsg.innerText = "";
        const fakeEvent = { preventDefault: () => {} };

        YnufeClient.postForm = async () => {
            return "<html><head><title>主页</title></head><body>欢迎登录</body></html>";
        };
        AutoLogin.verifySession = async () => true;

        let successCallbackExecuted = false;
        await LoginView.handleLogin(fakeEvent, async () => {
            successCallbackExecuted = true;
            return true;
        });

        assert.equal(successCallbackExecuted, true, "登录成功后必须执行 onSuccess 回调");
        assert.equal(YnufeSession.getHasSession(), true, "登录成功后 session 标记必须置为 true");
        assert.equal(YnufeSession.getUsername(), "2023110099", "登录成功后凭据必须正确持久化");
        console.log("[PASS] 用例 5: 真实登录成功生命周期全链路穿透测试通过");
    }

    console.log("==========================================");
    console.log("  智能验证码与自动登录全部真实用例实测通过！");
    console.log("==========================================");
} finally {
    try { rmSync(OUT_FILE); } catch {}
}
