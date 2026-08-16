# 贡献指南 (Contributing Guide)

感谢您对云财智能教务助手 (YNUFE Mobile Assistant) 项目的关注与支持！我们欢迎社区提交 Bug 报告、功能建议以及高质量的代码贡献。

---

## 1. 行为准则与编码规范

在提交代码或 Pull Request 之前，请确保遵循以下工程规范：

### 1.1 架构与接口准则
- **单一职责**：函数保持单一职责，复用逻辑抽离为独立的 Utility 或 Service；
- **强类型标准**：全量使用 TypeScript 严格强类型，严禁使用 `any` 绕过类型系统；
- **文档注释**：所有新增或修改的函数/方法必须配齐标准 Google 风格 Docstring 文档注释；
- **图标与界面文本**：严禁在代码或 UI 文本中参杂 Emoji 表情符号，所有图标统一使用纯 SVG 绘制；
- **编码防乱码**：文件读写与控制台输出显式指定 UTF-8 编码。

### 1.2 提交信息规范 (Conventional Commits)
Git 提交信息必须遵循 Conventional Commits 规范，常见前缀如下：
- `feat:` 新增业务功能或模块
- `fix:` 修复已知缺陷或异常
- `refactor:` 代码重构（不改变现有外部功能）
- `perf:` 性能优化
- `test:` 单元测试与测试用例更新
- `docs:` 文档更新
- `chore:` 构建脚本或辅助工具变动

---

## 2. 本地开发与测试流程

### 2.1 依赖安装与本地运行
```cmd
# 安装依赖
npm install

# 启动本地开发服务器 (内置 /jsxsd 反向代理)
npm run dev
```

### 2.2 质量门禁与测试套件
在提交 PR 前，必须在本地完整运行并确保以下检查 100% 通过：

```cmd
# 1. 运行全部模块化单元测试
npm test

# 2. 运行 DOM 解析器全量回归测试
npm run test:parsers

# 3. 运行 TypeScript 严格类型检查
npx tsc --noEmit

# 4. 运行 Python 脚本静态检查
uv run ruff check .

# 5. 校验前端生产打包
npm run build
```

---

## 3. 分支与 Pull Request 流程

1. Fork 本仓库并基于 `master` 创建特性分支（如 `feat/your-feature-name` 或 `fix/bug-description`）；
2. 编写代码并编写对应的单元测试用例；
3. 执行 `npm test` 与 `npx tsc --noEmit` 确保质量门禁全部通过；
4. 提交规范的 Conventional Commits 并在 GitHub 上发起 Pull Request；
5. PR 将由维护团队进行代码审查并在 CI 验证通过后合入。
