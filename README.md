# 云财智能教务助手 (YNUFE Mobile Assistant)

这是一个完全在手机本地运行的云财教务网（强智系统）第三方客户端。所有数据请求、HTML 解析和 UI 渲染均在手机本地完成，不经过任何第三方服务器。

## 项目结构 (TypeScript + Vite + Capacitor)

```text
campus_app/
├── index.html                  # SPA 主界面骨架（5 Tab + 各底部抽屉面板）
├── app.css                     # 毛玻璃自适应主题样式（含深/浅色与自定义壁纸配色）
├── vite.config.ts              # Vite 构建与 /jsxsd 开发代理配置
├── capacitor.config.json       # Capacitor 原生壳配置（Http/Cookies/LocalNotifications）
├── build_apk.py                # 一键打包 APK 脚本
└── src/
    ├── main.ts                 # 业务总控（路由/同步/登录/提醒/UI 调度）
    ├── config.ts               # 全局集中配置（域名、节次时间、心跳间隔等）
    ├── api/client.ts           # 网络层（含会话过期拦截 SessionExpiredError）
    ├── services/
    │   ├── autoLogin.ts        # 持久化登录：会话探测 + 免验证码静默续期
    │   └── notificationManager.ts  # 上课提醒本地通知排程
    │   └── cookieManager.ts    # Android 原生 Cookie 穿透与持久化
    ├── stores/sessionStore.ts  # 凭据（混淆存储）与离线缓存
    ├── parsers/                # 各教务页面 DOM 解析器
    ├── components/             # UI 组件（抽屉/下拉/壁纸/主题等）
    └── utils/                  # encodeInp、HTML 转义、取色器等工具
```

## 开发调试

```cmd
cd D:\programing\campus_app
npm install
npm run dev
```

打开 `http://localhost:8000` 即可。Vite 已内置 `/jsxsd` 反向代理，登录、验证码、数据拉取全部可直接调试。

## 解析器回归测试

教务网页面结构一变，解析器就会**静默**输出错误数据（曾出现过成绩列错位、空教室恒为空等 9 个此类 BUG）。
`test_suite.py` 只做结构冒烟，抓不到这类问题，因此另有一套针对真实响应的回归测试：

```cmd
set YNUFE_COOKIE=JSESSIONID=xxx; jsxsd=xxx
set YNUFE_REAL_NAME=你的姓名
set YNUFE_REAL_ID=你的学号
npm run capture:fixtures
npm run test:parsers
```

- `capture:fixtures` 抓取教务网真实响应并**脱敏**后存入 `tests/fixtures/`（该目录已在 `.gitignore` 中，含个人信息，不入库）。Cookie 从浏览器开发者工具复制，过期后重抓即可。
- `test:parsers` 用这些真实页面校验全部解析器，每条断言都对应一个修复过的 BUG。

改动任何 `src/parsers/` 下的文件后都应跑一次。

## 打包手机 APK

```cmd
python build_apk.py
```

脚本会依次执行：`npm install` → `npm run build`（含 TypeScript 类型检查）→ `npx cap sync` → Gradle 打包，产物为根目录下的 `云财学子.apk`。

## 核心特性

1. **持久化登录**：App 启动时先探测已保存的 Cookie 会话是否仍有效；失效则用本地保存的凭据尝试免验证码静默续期；只有在服务器强制要求验证码时才会弹出登录框（账号密码已预填，只需输入 4 位验证码）。
2. **离线缓存秒开**：课表 / 成绩 / 考试 / 公告全部本地缓存，断网也能查看；会话过期时绝不会用错误数据覆盖缓存。
3. **上课提醒**：首页铃铛按钮可开启上课提醒，自定义提前 5-60 分钟推送本地通知（包含课程、教室、时间），基于课表与教学周自动排程未来两周，App 被杀掉提醒依然生效（Capacitor LocalNotifications）。
4. **个性化**：深/浅色主题、自定义壁纸（自动取色适配全局强调色）、自定义文字与背景颜色。

## 隐私与安全说明（诚实版）

- 所有网络请求由手机直连 `https://xjwis.ynufe.edu.cn`，不经过任何中转服务器。
- 勾选"记住账号密码"后，凭据经**本地混淆**（随机设备密钥 XOR + Base64）后存入本机存储。请注意：纯前端应用无法实现真正意义上的加密存储（密钥必然也在本机），此措施只能防止明文直接可见，无法抵御针对性逆向。请勿在 root/越狱设备上勾选记住密码。
- 从教务网解析出的所有文本在渲染前均经过 HTML 转义，防止内容注入。
