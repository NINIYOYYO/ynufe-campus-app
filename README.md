# 云财智能教务助手 (YNUFE Mobile Assistant)

[![CI](https://img.shields.io/badge/CI-Passing-brightgreen.svg)](https://github.com/NINIYOYYO/ynufe-campus-app/actions/workflows/ci.yml)
[![Android APK](https://img.shields.io/badge/Android-APK_v1.1.0-blue.svg)](https://github.com/NINIYOYYO/ynufe-campus-app/actions/workflows/build-apk.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-5.1-purple.svg)](https://vitejs.dev/)
[![Capacitor](https://img.shields.io/badge/Capacitor-6.0-blue.svg)](https://capacitorjs.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Security Policy](https://img.shields.io/badge/Security-Policy-green.svg)](SECURITY.md)

云财智能教务助手是一款专为云南财经大学学子打造的现代化、轻量级、离线优先的第三方教务移动端应用（支持 Android 原生 APK 与 Web SPA）。

所有网络请求均由客户端直连学校强智教务系统（`https://xjwis.ynufe.edu.cn`），DOM 解析与数据渲染均在端侧完成，**不经过任何第三方服务器中转**，彻底杜绝学号、密码与成绩数据泄露风险。

---

## 📥 快速下载与安装 (For Students)

- **Android 手机安装包**：前往 **[Releases 页面](https://github.com/NINIYOYYO/ynufe-campus-app/releases)**，直接下载最新版的 **`云财学子.apk`**（约 3.9 MB）即可安装使用。
- **免安装网页版 (Web)**：直接通过手机或电脑浏览器访问部署地址，无需安装即可体验全功能。

---

## 核心亮点与架构特性

### 1. 零中转纯本地直连 (Zero-Server Architecture)
所有认证与教务数据查询直接与学校教务服务器建立安全 HTTPS 传输通道，不设任何收集个人凭据的后端服务，学生隐私与账号安全拥有完整保障。

### 2. 纯原生 DOM 直操与毫秒级冷启动 (Zero Framework Overhead)
摒弃重型 UI 框架，首屏基于 36 个核心 DOM 节点直操与 FLIP 补间动效，带来 60FPS 丝滑交互与毫秒级即开即用体验，打包产物极小（APK 约 3.9MB）。

### 3. 强类型离线优先缓存 (Offline-First with Auto-Healing)
课表、成绩、排考、公告等数据采用带 TTL 时间戳的强类型本地缓存。断网或教务系统临时维护时秒级加载历史数据，并具备损坏自愈清理机制，绝不以空数据覆盖有效缓存。

### 4. 本地拓扑图形验证码 OCR (Embedded Captcha OCR)
内置基于 Otsu 二值化、连通域分割与骨架拓扑特征匹配的纯前端 OCR 识别引擎（纯 TypeScript 实现，零外部依赖）。在免密静默续期遇到验证码拦截时自动重试识别，大幅减少人工验证码弹窗。

### 5. 双向 Android Cookie 穿透插件 (Native Cookie Persistence)
针对 Android WebView 在应用退出后清理 Session Cookie 的平台特性，自研 `NativeCookiePlugin` 原生桥接插件，实现 Android 原生 `CookieManager` 与前端运行时的双向同步与远期持久化。

### 6. 系统级本地上课提醒 (Local Notifications)
结合教学周与课表排程，自动为未来两周课程排期本地系统通知。支持提前 5~60 分钟自定义推送，应用被划掉后台提醒依然准时触发。

---

## 功能全景

| 模块 | 功能说明 | 核心特性 |
| :--- | :--- | :--- |
| **智能课表** | 周视图 / 日视图平滑切换，单双周课程自动展开 | 自动推算当前教学周、调课标记识别、槽位多课程切分、课程详情抽屉 |
| **学业成绩** | 历年全部与各学期成绩明细，GPA / 总学分实时计算 | 成绩构成穿透（平时/期末/实验分项及占比）、请求时序防竞态控制 |
| **考试日程** | 期末统一排考与教师随堂考集中展示 | 考场校区/教学楼/座位号精确展示、开考实时倒计时 |
| **综合服务** | 空教室复合多维查询、等级考试、选课情况、毕业设计 | 支持校区/楼宇/星期/节次筛选空教室；CET-4/6 准考证与成绩穿透 |
| **教务公告** | 教务处通知分类聚合与富文本段落排版 | 结构化公文字号保持、URL 白名单安全校验、附件下载支持 |
| **个性主题** | 深色 / 浅色 / 毛玻璃自适应主题切换 | 自定义背景壁纸、手势缩放与模糊度调节、壁纸主色调智能提取算法 |

---

## 项目目录结构

```text
campus_app/
├── index.html                  # SPA 主界面单页骨架（5 大 Tab 布局与抽屉容器）
├── app.css                     # 毛玻璃自适应主题、色彩变量与动画样式
├── vite.config.ts              # Vite 构建与 /jsxsd 本地开发反向代理配置
├── capacitor.config.json       # Capacitor 跨平台原生容器配置
├── build_apk.py                # 一键编译与打包 Android APK 脚本
├── test_suite.py               # DOM 锚点与 TS 契约一致性冒烟检查
├── android/                    # Capacitor Android 原生工程（含 NativeCookiePlugin）
├── src/
│   ├── main.ts                 # 业务总控（路由分发、初始化与生命周期挂载）
│   ├── config.ts               # 全局集中配置（教务域名、节次时间、心跳周期）
│   ├── api/
│   │   ├── client.ts           # 网络通信引擎（CapacitorHttp 原生通道与 fetch 降级）
│   │   └── heartbeat.ts        # 会话心跳保活服务
│   ├── services/
│   │   ├── autoLogin.ts        # 持久化登录：会话探测 + CaptchaOCR 自动续期
│   │   ├── cookieManager.ts    # 原生 Cookie 穿透、双向注入与远期持久化
│   │   ├── notificationManager.ts # 本地系统级通知排程与定时器管理
│   │   └── cacheService.ts     # 强类型离线存储与 TTL 自愈缓存服务
│   ├── stores/
│   │   └── sessionStore.ts     # 凭据存储、安全注销与会话状态机
│   ├── parsers/                # 强智教务系统 6 大专职 DOM 解析器
│   │   ├── profileParser.ts    # 个人学籍信息解析器
│   │   ├── timetableParser.ts  # 智能课表与周次展开解析器
│   │   ├── gradeParser.ts      # 期末成绩与等级考试解析器
│   │   ├── examParser.ts       # 期末排考与随堂考解析器
│   │   ├── serviceParser.ts    # 空教室与综合服务解析器
│   │   └── announcementParser.ts # 公告列表与附件安全解析器
│   ├── components/             # 原生 UI 交互组件
│   │   ├── customSelect.ts     # 自定义下拉选择器
│   │   ├── bottomDrawer.ts     # 底部手势抽屉面板
│   │   ├── themeCustomizer.ts  # 主题定制控制器
│   │   └── wallpaperManager.ts # 自定义壁纸与主色调提取
│   ├── utils/
│   │   ├── captchaOcr.ts       # 拓扑验证码图像二值化与字符识别引擎
│   │   ├── crypto.ts           # encodeInp 编码与设备凭据对称混淆
│   │   ├── htmlSanitizer.ts    # XSS 字符转义与 URL 安全白名单校验
│   │   └── uiFeedback.ts       # Toast 提示与骨架加载交互
│   └── views/                  # 业务视图控制器
│       ├── timetableView.ts    # 课表视图控制器
│       ├── gradeView.ts        # 成绩视图控制器
│       ├── examView.ts         # 考试视图控制器
│       ├── serviceView.ts      # 服务中心视图控制器
│       ├── announcementView.ts # 公告视图控制器
│       ├── settingsView.ts     # 设置视图控制器
│       └── loginView.ts        # 登录认证与验证码控制器
└── tests/                      # 模块化测试套件与真实教务脱敏固件
    ├── parsers.test.mjs        # 73 项 DOM 解析器全量回归断言
    ├── cookieManager.test.mjs  # Cookie 穿透与持久化测试
    ├── reminderScheduler.test.mjs # 上课提醒与考试排程测试
    ├── cacheService.test.mjs   # 强类型缓存与自愈测试
    ├── crypto.test.mjs         # 凭据对称混淆测试
    └── heartbeat.test.mjs      # 心跳保活状态机测试
```

---

## 快速上手与本地开发

### 1. 环境准备
- **Node.js** >= 18.0.0
- **npm** >= 9.0.0
- **Python** >= 3.10（可选，仅用于执行本地一键打包脚本 `build_apk.py` 与冒烟检查）

### 2. 克隆仓库与安装依赖
```cmd
git clone https://github.com/NINIYOYYO/ynufe-campus-app.git
cd ynufe-campus-app
npm install
```

### 3. 启动本地开发服务器
```cmd
npm run dev
```
启动后在浏览器中打开 `http://localhost:8000` 即可。Vite 已内置 `/jsxsd` 反向代理，支持在电脑浏览器中直接调试登录、验证码拉取与数据解析。

---

## 测试与质量保障

项目贯彻严格的测试驱动与自动化验证标准，覆盖 88 条关键测试断言：

### 1. 一键运行全量自动化测试
```cmd
npm test
```
将依次执行所有模块化测试（强智解析器 88 项断言、Cookie 穿透、提醒排程、缓存自愈、凭据混淆与心跳保活）。

### 2. 运行 DOM 解析器专属回归测试
```cmd
npm run test:parsers
```

### 3. 基于真实教务网捕获脱敏 Fixtures
当教务网页面结构调整时，可在本地抓取真实页面并脱敏存为回归测试固件：
```cmd
# Windows PowerShell 示例
$env:YNUFE_COOKIE = "JSESSIONID=xxx; jsxsd=xxx"
$env:YNUFE_REAL_NAME = "张三"
$env:YNUFE_REAL_ID = "202300000000"

npm run capture:fixtures
npm run test:parsers
```

### 4. 静态类型检查与代码风格
```cmd
# TypeScript 严格类型检查
npx tsc --noEmit

# Python 静态代码检查
uv run ruff check .
```

---

## 打包 Android 原生 APK

项目提供 **「云端免环境自动构建」** 与 **「本地一键极速打包」** 两种方式：

### 方式一（推荐）：GitHub Actions 云端免安装出包（无需本地 Android 环境）
如果您的电脑没有安装 Android Studio 或 Android SDK：
1. Fork 本仓库并进入您 GitHub 仓库的 **Actions** 标签页；
2. 选择 **Build Android APK** 工作流，点击 **Run workflow**；
3. 云端将在 1~2 分钟内完成编译，并在构件区生成打包好的 `云财学子.apk` 供直接下载。

### 方式二：本地一键极速打包 (Local CLI)
如果本地已配置 Java 17 / Android 环境：
```cmd
# 构建离线独立正式版 APK（产物为根目录下的「云财学子.apk」）
python build_apk.py

# 构建局域网热重载调试版 APK (Live Reload)
python build_apk.py --dev
```

### 3. 真机 USB 调试部署
开启手机“开发者选项 -> USB 调试”后通过 ADB 直连：
```cmd
# 1. 安装 APK 到真机
adb install -r 云财学子.apk

# 2. 实时查看应用运行日志
adb logcat -s Capacitor:V Chromium:V YnufeUI:V CookieManager:V AutoLogin:V
```
在电脑 Chrome 浏览器地址栏输入 `chrome://inspect/#devices`，即可直接可视化审查手机 App 的 Console 控制台与 Network 网络请求。

---

## 隐私与安全说明

1. **零第三方收集**：客户端所有数据请求直接发送给学校教务服务器，无中间件、无分析统计 SDK、无广告跟踪；
2. **凭据本地混淆**：勾选“记住账号密码”后，凭据通过随机生成的设备混淆密钥进行对称混淆存储在本地 Storage 中；注销登录时彻底抹除全部本地凭据；
3. **内容安全防护**：从教务系统解析出的所有富文本在渲染前均经过 HTML 转义处理，防止恶意脚本注入。

---

## 免责声明 (Disclaimer)

- 本项目为开源第三方教务助手，与云南财经大学官方或强智科技无任何商业关联；
- 本软件仅供学术交流与个人学习使用，开发者不对因使用本软件造成的任何直接或间接后果承担责任；
- 请妥善保管个人教务账号密码，切勿在非信任的公开设备上勾选“记住密码”。

---

## 作者与贡献者 (Author)

- **核心作者 / Maintainer**：[NINIYOYYO](https://github.com/NINIYOYYO)
- **开源贡献**：欢迎提交 Issue 与 Pull Request，详情请参见 [CONTRIBUTING.md](CONTRIBUTING.md)。

---

## 开源许可 (License)

本项目基于 [MIT License](LICENSE) 协议开源，版权所有 (c) 2026 [NINIYOYYO](https://github.com/NINIYOYYO)。

