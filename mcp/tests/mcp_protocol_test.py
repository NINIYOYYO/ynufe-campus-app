"""MCP 协议层自测: initialize + tools/list (不实登录, CI 可复用)。"""
import json
import os
import subprocess
import sys

if sys.platform.startswith("win"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")


def test_mcp_protocol() -> None:
    """验证 MCP JSON-RPC 协议握手、工具列表与参数 Schema 声明。

    Raises:
        AssertionError: 当协议初始化失败、缺失必备工具或参数 Schema 不完整时抛出。
    """
    if len(sys.argv) > 1 and not sys.argv[1].endswith(".py") and not sys.argv[1].startswith("-") and "pytest" not in sys.argv[0]:
        cmd = [sys.argv[1]]
    else:
        cmd = [sys.executable, "-m", "ynufe_campus_mcp.server"]

    msgs = [
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": "selftest"},
            },
        },
        {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
        {"jsonrpc": "2.0", "id": 3, "method": "ping"},
        {"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "ynufe_logout", "arguments": {}}},
        {"jsonrpc": "2.0", "id": 5, "method": "tools/call", "params": {"name": "non_existent_tool", "arguments": {}}},
    ]

    project_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    src_dir = os.path.join(project_dir, "src")
    env = os.environ.copy()
    env["PYTHONPATH"] = f"{src_dir}{os.pathsep}{env.get('PYTHONPATH', '')}"

    p = subprocess.Popen(
        cmd,
        cwd=project_dir,
        env=env,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
    )
    payload = "\n".join(json.dumps(m) for m in msgs) + "\n"
    out, err = p.communicate(payload)
    p.wait()

    results = [json.loads(line) for line in out.strip().splitlines() if line.strip()]
    init = next((r for r in results if r.get("id") == 1), None)
    tl = next((r for r in results if r.get("id") == 2), None)
    ping = next((r for r in results if r.get("id") == 3), None)
    call_logout = next((r for r in results if r.get("id") == 4), None)
    call_invalid = next((r for r in results if r.get("id") == 5), None)

    assert init and "result" in init, f"initialize 失败: {init}, cmd={cmd}, out={out!r}, err={err!r}"
    assert init["result"]["serverInfo"]["name"] == "ynufe-campus-mcp", init
    tools = tl["result"]["tools"]
    names = [t["name"] for t in tools]
    print(f"server: {init['result']['serverInfo']}")
    print(f"tools ({len(tools)}): {names}")

    expected = [
        "ynufe_login",
        "ynufe_profile",
        "ynufe_grades",
        "ynufe_timetable",
        "ynufe_semester",
        "ynufe_exams",
        "ynufe_notices",
        "ynufe_plan",
        "ynufe_logout",
    ]
    missing = [e for e in expected if e not in names]
    assert not missing, f"缺工具: {missing}"

    # 验证 MCP-04: ynufe_grades 与 ynufe_notices 的参数 Schema 定义
    grades_tool = next(t for t in tools if t["name"] == "ynufe_grades")
    assert "semester" in grades_tool["inputSchema"]["properties"], "ynufe_grades 缺少 semester 参数定义"

    notices_tool = next(t for t in tools if t["name"] == "ynufe_notices")
    assert "limit" in notices_tool["inputSchema"]["properties"], "ynufe_notices 缺少 limit 参数定义"

    # 验证 ping 与 tools/call
    assert ping and "result" in ping, f"ping 失败: {ping}"
    assert call_logout and "result" in call_logout, f"tools/call ynufe_logout 失败: {call_logout}"
    assert "ok" in call_logout["result"]["content"][0]["text"], call_logout
    assert call_invalid and "error" in call_invalid, f"未知工具应返回 error: {call_invalid}"
    assert call_invalid["error"]["code"] == -32602, call_invalid

    print("MCP 协议自测通过 [PASS]")


if __name__ == "__main__":
    test_mcp_protocol()
