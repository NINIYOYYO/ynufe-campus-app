"""MCP 协议层自测: initialize + tools/list (不实登录, CI 可复用)"""
import json
import subprocess
import sys

BIN = sys.argv[1] if len(sys.argv) > 1 else ".venv/bin/ynufe-campus-mcp"

msgs = [
    {"jsonrpc": "2.0", "id": 1, "method": "initialize",
     "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "selftest"}}},
    {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
]

p = subprocess.Popen([BIN], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
out, _ = p.communicate("\n".join(json.dumps(m) for m in msgs) + "\n")
p.wait()

results = [json.loads(l) for l in out.strip().splitlines() if l.strip()]
init = next((r for r in results if r.get("id") == 1), None)
tl = next((r for r in results if r.get("id") == 2), None)

assert init and "result" in init, f"initialize 失败: {init}"
assert init["result"]["serverInfo"]["name"] == "ynufe-campus-mcp", init
tools = tl["result"]["tools"]
names = [t["name"] for t in tools]
print(f"server: {init['result']['serverInfo']}")
print(f"tools ({len(tools)}): {names}")

expected = ["ynufe_login", "ynufe_profile", "ynufe_grades", "ynufe_timetable",
            "ynufe_semester", "ynufe_exams", "ynufe_notices", "ynufe_plan", "ynufe_logout"]
missing = [e for e in expected if e not in names]
assert not missing, f"缺工具: {missing}"
print("MCP 协议自测通过 ✔")
