"""ynufe-campus-mcp — 云南财经大学教务系统 MCP 服务器.

作为 NINIYOYYO/ynufe-campus-app 仓库的独立 Python 子包发布,
提供强智教务系统 (xjwis.ynufe.edu.cn) 的登录 + 数据查询 MCP 工具.

工具:
  - ynufe_login       登录 (自动 OCR 验证码)
  - ynufe_profile     学籍信息
  - ynufe_grades      成绩单
  - ynufe_timetable   课表 (按周)
  - ynufe_semester    学期信息
  - ynufe_exams       考试安排
  - ynufe_notices     教务通知
  - ynufe_plan        培养方案 + 学分缺口
  - ynufe_logout      退出

凭据: 通过 MCP 工具参数或环境变量 YNUFE_USER / YNUFE_PASS 传入,
      绝不硬编码 / 落盘.
"""

from .server import (
    HOST,
    YnufeSession,
    encode_inp,
    get_session,
    main,
    run_interactive,
    run_stdio,
)

__version__ = "0.2.0"
__all__ = [
    "HOST",
    "YnufeSession",
    "__version__",
    "encode_inp",
    "get_session",
    "main",
    "run_interactive",
    "run_stdio",
]
