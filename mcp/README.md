# ynufe-campus-mcp

云南财经大学教务系统 MCP 服务器 — 将强智教务系统 (xjwis.ynufe.edu.cn) 的登录与数据查询封装为 [Model Context Protocol](https://modelcontextprotocol.io) 工具。

本包是 [NINIYOYYO/ynufe-campus-app](https://github.com/NINIYOYYO/ynufe-campus-app) 仓库的独立 Python 子包：前端 App（TypeScript/Capacitor）负责移动端体验，本包为 AI Agent / CLI 提供同一套教务数据的程序化访问。

## 功能

| 工具 | 说明 |
| :--- | :--- |
| ynufe_login | 登录（自动 OCR 验证码，无需人工输入） |
| ynufe_profile | 学籍信息（姓名/院系/专业/班级） |
| ynufe_grades | 成绩单（GPA / 学分 / 全部明细，可按学期过滤） |
| ynufe_timetable | 课表（按日期定位周次，支持校区过滤） |
| ynufe_semester | 学期信息（当前周次 / 总周数 / 校区模式） |
| ynufe_exams | 考试安排 |
| ynufe_notices | 教务通知 / 公告（标题/时间/未读状态） |
| ynufe_plan | 培养方案（课程总表 / 学分缺口 / 未修必修） |
| ynufe_logout | 退出登录 |

## 凭据安全

- **绝不硬编码** 学号 / 密码
- 凭据仅通过 MCP 工具参数或环境变量传入：

```bash
export YNUFE_USER="你的学号"
export YNUFE_PASS="你的密码"
```

- 所有数据只落在使用者本地，不经任何第三方服务器中转

## 安装

### 方式一：本地源码运行（尚未发布 PyPI）

> 尚未发布到 PyPI，uvx ynufe-campus-mcp 暂不可用。

```bash
cd mcp
uv sync     # 安装依赖
uv run ynufe-campus-mcp
```

### 方式二：交互式 CLI

```bash
YNUFE_USER=学号 YNUFE_PASS=密码 uv run ynufe-campus-mcp --interactive
```

## 接入 MCP 客户端

以 Claude Desktop / Hermes / Cursor 为例，在 MCP 配置中加入：

```json
{
  "mcpServers": {
    "ynufe": {
      "command": "uvx",
      "args": ["--from", "/path/to/ynufe-campus-app/mcp", "ynufe-campus-mcp"],
      "env": {
        "YNUFE_USER": "你的学号",
        "YNUFE_PASS": "你的密码"
      }
    }
  }
}
```

## 自测（无需真实凭据）

```bash
uv run python tests/mcp_protocol_test.py
```

验证 MCP 协议握手与 9 个工具的 tools/list 声明，不发起真实登录。

## 免责声明

本项目为个人学习用途，仅供云财在校生自用，请遵守学校网络与信息系统使用规定。强智教务系统接口可能变更，作者不保证持续可用。

## License

MIT — 见 [LICENSE](LICENSE)
