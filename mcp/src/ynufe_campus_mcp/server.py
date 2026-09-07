"""云财·通 (ynufe-tong) — 云财教务系统 MCP 服务器

把云财教务系统 (强智) 的登录 + 数据查询封装为 MCP 工具:
  - ynufe_login_session        登录并保持会话 (自动 OCR 验证码)
  - ynufe_get_grade_report     成绩单 (GPA/学分/明细)
  - ynufe_get_timetable        课表
  - ynufe_get_exams            考试安排
  - ynufe_get_profile          学籍信息
  - ynufe_logout               退出登录

用法 (stdio MCP server):
  uv run python -m ynufe_tong.mcp_server
"""
from __future__ import annotations

import argparse
import datetime
import json
import re
import sys
import time
from typing import Any

import requests

from .captcha_ocr import recognize_jpeg

__version__ = "0.2.0"

HOST = "https://xjwis.ynufe.edu.cn"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")

_ENCODE_KEY = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/="


def encode_inp(s: str) -> str:
    out = ""
    i = 0
    while i < len(s):
        c1 = ord(s[i]); i += 1
        c2 = ord(s[i]) if i < len(s) else None; i += 1
        c3 = ord(s[i]) if i < len(s) else None; i += 1
        e1 = c1 >> 2
        e2 = ((c1 & 3) << 4) | ((c2 >> 4) if c2 is not None else 0)
        e3 = 64 if c2 is None else (((c2 & 15) << 2) | ((c3 >> 6) if c3 is not None else 0))
        e4 = 64 if c3 is None else (c3 & 63)
        out += _ENCODE_KEY[e1] + _ENCODE_KEY[e2] + _ENCODE_KEY[e3] + _ENCODE_KEY[e4]
    return out


class YnufeSession:
    """教务系统会话: 负责登录态管理与请求封装"""

    def __init__(self, timeout: int = 20):
        self.s = requests.Session()
        self.s.headers.update({
            "User-Agent": UA,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9",
        })
        self.timeout = timeout
        self.logged_in = False
        self.student_name: str | None = None
        self.student_id: str | None = None

    def _get(self, path: str) -> str:
        r = self.s.get(HOST + path, timeout=self.timeout,
                       headers={"Referer": f"{HOST}/jsxsd/framework/xsMain.jsp"})
        r.raise_for_status()
        return r.text

    def _post(self, path: str, data: dict, referer: str | None = None) -> str:
        hdrs = {}
        if referer:
            hdrs["Referer"] = HOST + referer
        r = self.s.post(HOST + path, data=data, timeout=self.timeout, headers=hdrs)
        r.raise_for_status()
        return r.text

    def get_captcha(self) -> bytes:
        return self.s.get(f"{HOST}/jsxsd/verifycode.servlet?t={time.time()}",
                          timeout=self.timeout).content

    def login(self, user: str, password: str, captcha: str) -> str:
        encoded = f"{encode_inp(user)}%%%{encode_inp(password)}"
        data = {"userAccount": user, "userPassword": "", "RANDOMCODE": captcha, "encoded": encoded}
        return self._post("/jsxsd/xk/LoginToXkLdap", data, referer="/jsxsd/xk/login.jsp")

    def login_with_ocr(self, user: str, password: str, max_retries: int = 5) -> dict:
        """登录并 OCR 自动过验证码. 返回 {ok, name?, attempts, error?}"""
        attempts = 0
        for attempt in range(1, max_retries + 1):
            attempts = attempt
            try:
                cap = self.get_captcha()
                text, avg, _ = recognize_jpeg(cap)
            except Exception as e:
                continue
            if not (text and text.isalnum() and len(text) == 4):
                continue
            html = self.login(user, password, text)
            # 失败标志
            if any(x in html for x in ("用户名或密码错误", "账号或密码不正确", "密码错误")):
                return {"ok": False, "attempts": attempt, "error": "账号或密码错误"}
            if "验证码错误" in html or "验证码已过期" in html:
                continue
            # 验证会话
            try:
                main = self._get("/jsxsd/framework/xsMain_new.jsp?t1=1")
            except Exception:
                continue
            if len(main) > 2000:
                name, sid = self._parse_profile(main)
                if name:
                    self.logged_in = True
                    self.student_name = name
                    self.student_id = sid or user
                    return {"ok": True, "name": name, "student_id": sid or user, "attempts": attempt}
            # 会话未建立——稍等再试 (防风控)
            time.sleep(0.8)
        return {"ok": False, "attempts": attempts, "error": "登录失败(验证码/会话未建立，重试次数用尽)"}

    @staticmethod
    def _parse_profile(main: str) -> tuple[str | None, str | None]:
        txt = main.replace("&nbsp;", " ").replace("&nbsp", " ")
        txt = re.sub(r"<[^>]+>", " ", txt)
        txt = re.sub(r"\s+", " ", txt)
        m = re.search(r"学生姓名[：:]\s*([^\s]{2,10})", txt)
        name = m.group(1).strip() if m else None
        m2 = re.search(r"学生编号[：:]\s*(\d+)", txt)
        sid = m2.group(1).strip() if m2 else None
        return name, sid

    def require_online(self):
        if not self.logged_in:
            raise RuntimeError("尚未登录, 请先调用 login 工具")

    # ---- 数据接口 ----

    def fetch_profile(self) -> dict:
        self.require_online()
        main = self._get("/jsxsd/framework/xsMain_new.jsp?t1=1")
        txt = re.sub(r"<script.*?</script>", "", main, flags=re.S)
        txt = txt.replace("&nbsp;", " ")
        txt = re.sub(r"<[^>]+>", " ", txt)
        txt = re.sub(r"\s+", " ", txt)
        fields = {}
        for key in ("学生姓名", "学生编号", "所属院系", "专业名称", "班级名称", "学生标签"):
            m = re.search(re.escape(key) + r"[：:]\s*([^\s]{1,40})", txt)
            if m:
                fields[key] = m.group(1).strip()
        return fields

    def fetch_grades(self, semester: str | None = None) -> dict:
        """成绩单: 汇总 + 全部明细 (可指定学期过滤, 如 '2024-2025-1').

        返回 {summary:{...}, courses:[{学期,课程编号,课程名称,成绩,学分,学时,绩点,考核方式,考试性质,课程属性,课程性质}...]}
        """
        self.require_online()
        html = self._get("/jsxsd/kscj/cjcx_list?xsfs=all")
        txt = re.sub(r"<script.*?</script>", "", html, flags=re.S)
        txt = re.sub(r"<[^>]+>", " ", txt)
        txt = re.sub(r"\s+", " ", txt)
        m = re.search(r"所修门数[:：]?\s*(\d+)", txt)
        m2 = re.search(r"所修总学分[:：]?\s*([\d.]+)", txt)
        m3 = re.search(r"平均学分绩点[:：]?\s*([\d.]+)", txt)
        m4 = re.search(r"平均成绩[:：]?\s*([\d.]+)", txt)
        summary = {
            "所修门数": m.group(1) if m else None,
            "所修总学分": m2.group(1) if m2 else None,
            "平均学分绩点": m3.group(1) if m3 else None,
            "平均成绩": m4.group(1) if m4 else None,
        }
        # 明细表
        rows = re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S)
        courses = []
        for row in rows:
            if "<td" not in row:
                continue
            cells = []
            for td in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S):
                t = re.sub(r"<[^>]+>", " ", td)
                t = re.sub(r"\s+", " ", t).strip()
                cells.append(t)
            if not cells or cells[0] == "序号" or len(cells) < 16:
                continue
            c = {
                "学期": cells[1],
                "课程编号": cells[2],
                "课程名称": cells[3],
                "分组名": cells[4],
                "成绩": cells[5],
                "成绩标识": cells[6],
                "学分": cells[7],
                "学时": cells[8],
                "绩点": cells[9],
                "补重学期": cells[10],
                "考核方式": cells[11],
                "考试性质": cells[12],
                "课程属性": cells[13],
                "课程性质": cells[14],
                "通选课类别": cells[15],
            }
            if semester and c["学期"] != semester:
                continue
            courses.append(c)
        return {"summary": summary, "course_count": len(courses), "courses": courses}

    def fetch_exams(self) -> dict:
        """考试安排查询 (接口 xsksap_list; 学期初可能返回空)"""
        self.require_online()
        html = self._get("/jsxsd/xsks/xsksap_list")
        rows = re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S)
        exams: list[dict] = []
        empty = False
        for row in rows:
            if "<td" not in row:
                continue
            cells = []
            for td in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S):
                t = re.sub(r"<[^>]+>", " ", td)
                t = re.sub(r"\s+", " ", t).strip()
                cells.append(t)
            if not cells:
                continue
            if len(cells) == 1 and "未查询到数据" in cells[0]:
                empty = True
                continue
            if len(cells) < 9:
                continue
            exams.append({
                "序号": cells[0],
                "校区": cells[1],
                "考场校区": cells[2],
                "考试场次": cells[3],
                "课程编号": cells[4],
                "课程名称": cells[5],
                "授课教师": cells[6],
                "考试时间": cells[7],
                "考场": cells[8],
                "座位号": cells[9] if len(cells) > 9 else "",
                "准考证号": cells[10] if len(cells) > 10 else "",
                "备注": cells[11] if len(cells) > 11 else "",
            })
        return {
            "exam_count": len(exams),
            "exams": exams,
            "empty": empty,
            "note": "当前无考试安排" if empty else "",
            "raw_len": len(html),
        }

    def fetch_timetable(self, date: str | None = None, sjms: str = "") -> dict:
        """当前/指定日期的周课表 (首页迷你课表接口)

        date: 日期字符串 YYYY-MM-DD, 默认今天 (自动定位到所在周)
        sjms: 校区模式值 (""=全部, C8B3..=南院, 49FB..=安宁, 99AD..=北院, 0333..=呈贡)
        """
        self.require_online()
        if not date:
            date = datetime.date.today().strftime("%Y-%m-%d")
        html = self.s.get(
            f"{HOST}/jsxsd/framework/main_index_loadkb.jsp",
            params={"rq": date, "sjmsValue": sjms},
            timeout=self.timeout,
            headers={"Referer": f"{HOST}/jsxsd/framework/xsMain_new.jsp?t1=1"},
        )
        html.raise_for_status()
        html = html.text
        return self._parse_week_timetable(html, rq=date)

    def _parse_week_timetable(self, html: str, rq: str) -> dict:
        """解析首页迷你课表 HTML -> {week, total_weeks, date, lessons:[...], raw_len}"""
        # 课程在 <p title='课程学分：X<br/>...上课时间：第N周 星期X [节次]节<br/>上课地点：地点<br/>通知单号：编号'>
        title_pat = re.compile(
            r"title\s*=\s*'(?P<title>[^']+)'", re.S)
        lessons = []
        seen = set()
        for m in title_pat.finditer(html):
            t = m.group("title")
            info = {}
            for field in ("课程学分", "课程属性", "课程名称", "上课时间", "上课地点", "通知单号"):
                fm = re.search(field + r"[：:]\s*([^<]+)", t)
                if fm:
                    info[field] = fm.group(1).strip()
            if "上课时间" not in info or "课程名称" not in info:
                continue
            tm = re.match(r"第(\d+)周\s*星期([一二三四五六日])\s*\[([\d\-]+)\]节", info["上课时间"])
            if not tm:
                continue
            week_no = int(tm.group(1))
            weekday = tm.group(2)
            periods = tm.group(3).split("-")
            lesson = {
                "week": week_no,
                "weekday": weekday,
                "periods": periods,
                "period_str": tm.group(3),
                "course": info.get("课程名称"),
                "credit": info.get("课程学分"),
                "attr": info.get("课程属性"),
                "location": info.get("上课地点"),
                "course_id": info.get("通知单号"),
            }
            # 去重 (同一课程格子在一大节里重复渲染)
            key = (lesson["week"], lesson["weekday"], lesson["period_str"], lesson["course"], lesson["location"])
            if key in seen:
                continue
            seen.add(key)
            lessons.append(lesson)

        week_no = lessons[0]["week"] if lessons else None
        mw = re.search(r"(\d+)周", html)
        total_weeks = None
        if mw:
            try:
                total_weeks = int(mw.group(1))
            except ValueError:
                pass
        return {
            "date": rq,
            "week": week_no,
            "total_weeks": total_weeks,
            "lesson_count": len(lessons),
            "lessons": lessons,
            "raw_len": len(html),
        }

    def fetch_semester_info(self) -> dict:
        """学期信息: 当前周次 / 学期总周数 / 学生标签等 (来自首页)"""
        self.require_online()
        main = self._get("/jsxsd/framework/xsMain_new.jsp?t1=1")
        info = {}
        m = re.search(r"第(\d+)周</span>/(\d+)周", main)
        if m:
            info["current_week"] = int(m.group(1))
            info["total_weeks"] = int(m.group(2))
        # 校区模式
        modes = re.findall(r"<option\s+value=\"([0-9A-F]{32})\">([^<]+)</option>", main)
        info["campus_modes"] = [{"value": v, "name": n} for v, n in modes]
        return info

    def fetch_exams(self) -> dict:
        self.require_online()
        html = self._get("/jsxsd/xsks/xsksap_list")
        return {"exam_count": 0, "exams": [], "empty": True, "note": "当前无考试安排", "raw_len": len(html)}

    def fetch_notices(self, limit: int = 20) -> dict:
        """教务通知/公告列表 (首页通知): 标题/发布时间/未读状态/通知id"""
        self.require_online()
        html = self._get("/jsxsd/framework/main_index_loadtzgg.jsp")
        notices = []
        # 每个 <li class="list-group-item"> 一条通知
        for m in re.finditer(
            r'<li class="list-group-item[^"]*"[^>]*title="([^"]+)".*?'
            r"gotoTzgg\('([0-9A-F]+)'\)[^>]*>(.*?)</a>.*?"
            r"<span id=\"fbsj\d+\"[^>]*>\s*([\d/ :]+)", html, re.S):
            title, nid, inner, ts = m.group(1), m.group(2), m.group(3), m.group(4)
            unread = "[未读]" in inner
            notices.append({
                "id": nid,
                "title": title.strip(),
                "time": ts.strip(),
                "unread": unread,
            })
        return {"count": len(notices), "notices": notices[:limit], "raw_len": len(html)}

    def fetch_plan(self) -> dict:
        """培养方案明细: 标题/培养目标/课程模块学分结构/课程总表/学分缺口分析"""
        self.require_online()
        html = self._get("/jsxsd/pyfa/topyfamx")
        clean = lambda s: re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s)).strip()

        # 标题 (caption 或 首行)
        cap = re.search(r"<caption[^>]*>(.*?)</caption>", html, re.S)
        title = clean(cap.group(1)) if cap else ""
        if not title:
            m0 = re.search(r">([^<>]{10,80}培养方案[^<>]{0,40})<", html)
            if m0:
                title = clean(m0.group(1))

        # 培养目标：一、培养目标 后到 二、
        m = re.search(r"一、培养目标\s*(.*?)\s*(?:二、|\Z)", html, re.S)
        goal = clean(m.group(1)) if m else ""

        # 课程模块 (应修/已修) + 课程行
        # 注意: 单元格文本含 &nbsp;, clean 前先转空格; 模块行的 td[0] 可能用 <td> 小写
        rows = re.findall(r"<TR>(.*?)</TR>", html, re.S)
        modules = []
        module_short = []
        courses = []
        cur_module = ""
        for row in rows:
            cells = re.findall(r"<TD[^>]*>(.*?)</TD>", row, re.S)
            # 兼容小写 td (培养方案数据行是大写 TD, 但稳妥起见两种都试)
            if not cells:
                cells = re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)
            if not cells:
                continue
            texts = [clean(c.replace("&nbsp;", " ")) for c in cells]
            if texts[0] and ("应修" in texts[0] or "课" in texts[0]):
                cur_module = texts[0]
                mm = re.match(r"([\u4e00-\u9fff]{2,12}课?)\s*\(应修\s*([\d.]+)\s*/\s*已修\s*([\d.]+)\)", cur_module)
                if mm:
                    name, need, have = mm.group(1), float(mm.group(2)), float(mm.group(3))
                    modules.append({"模块": name, "应修": need, "已修": have, "缺口": round(need - have, 2)})
                    if need > have:
                        module_short.append({"模块": name, "缺口": round(need - have, 2)})
            if len(texts) >= 8 and re.match(r"^[A-Z]\d{4,5}$", texts[1].replace("&nbsp;", "").strip()):
                courses.append({
                    "模块": cur_module,
                    "课程编号": texts[1],
                    "课程名称": texts[2],
                    "完成情况": texts[3],
                    "课程性质": texts[4],
                    "必修选修": texts[5],
                    "学分": texts[6],
                    "开课学期": texts[8] if len(texts) > 8 else "",
                    "总学时": texts[-1] if texts else "",
                })
        module_short.sort(key=lambda x: -x["缺口"])
        # 未修必修: 完成情况为空 (=未上) 且 必修. (完成情况非"已修"即算未修)
        def _not_done(st: str) -> bool:
            return not st or "已修" not in st and "完成" not in st
        need_take = [c for c in courses if _not_done(c["完成情况"]) and c["必修选修"] == "必修"]
        return {
            "title": title,
            "goal": goal,
            "module_count": len(modules),
            "modules": modules,
            "module_shortage": module_short,
            "course_count": len(courses),
            "courses": courses,
            "need_take_count": len(need_take),
            "need_take": need_take,
            "raw_len": len(html),
        }

    def logout(self) -> dict:
        try:
            self._get("/jsxsd/xk/LoginToXkLdap?button1=logout")
        except Exception:
            pass
        self.logged_in = False
        return {"ok": True}


# ---------- MCP server ----------

def _make_tool(name: str, description: str, args_schema: dict, handler) -> dict:
    return {
        "name": name,
        "description": description,
        "inputSchema": args_schema,
        "handler": handler,
    }


def build_tools(get_session) -> list[dict]:
    def sess():
        return get_session()

    def tool_login(user: str | None = None, password: str | None = None, max_retries: int = 5) -> dict:
        s = sess()
        if s.logged_in:
            return {"ok": True, "already_logged_in": True, "name": s.student_name}
        if not user or not password:
            return {"ok": False, "error": "需要提供 user (学号) 和 password"}
        return s.login_with_ocr(user, password, max_retries=max_retries)

    def tool_profile() -> dict:
        return sess().fetch_profile()

    def tool_grades() -> dict:
        return sess().fetch_grades()

    def tool_timetable(date: str | None = None, sjms: str = "") -> dict:
        return sess().fetch_timetable(date=date, sjms=sjms)

    def tool_semester() -> dict:
        return sess().fetch_semester_info()

    def tool_exams() -> dict:
        return sess().fetch_exams()

    def tool_notices() -> dict:
        return sess().fetch_notices()

    def tool_plan() -> dict:
        return sess().fetch_plan()

    def tool_logout() -> dict:
        return sess().logout()

    return [
        _make_tool("ynufe_login", "登录云财教务系统 (学号+密码, 自动过验证码). 成功后会话保持.", {
            "type": "object",
            "properties": {
                "user": {"type": "string", "description": "学号"},
                "password": {"type": "string", "description": "密码"},
                "max_retries": {"type": "integer", "description": "验证码重试次数, 默认5", "minimum": 1, "maximum": 10},
            },
            "required": ["user", "password"],
        }, tool_login),
        _make_tool("ynufe_profile", "获取学籍信息 (姓名/院系/专业/班级).", {
            "type": "object", "properties": {},
        }, tool_profile),
        _make_tool("ynufe_grades", "获取成绩单 (GPA/学分/成绩明细).", {
            "type": "object", "properties": {},
        }, tool_grades),
        _make_tool("ynufe_timetable", "获取课表. date=YYYY-MM-DD 指定日期所在周 (默认今天); sjms=校区模式值 (空=全部). 返回该周的课程列表.", {
            "type": "object",
            "properties": {
                "date": {"type": "string", "description": "日期 YYYY-MM-DD, 默认今天, 返回该日期所在周课表"},
                "sjms": {"type": "string", "description": "校区模式值: 空=全部, 或 fetch_semester 返回的 campus_modes[].value"},
            },
        }, tool_timetable),
        _make_tool("ynufe_semester", "获取学期信息: 当前周次/学期总周数/校区模式列表.", {
            "type": "object", "properties": {},
        }, tool_semester),
        _make_tool("ynufe_exams", "获取考试安排.", {
            "type": "object", "properties": {},
        }, tool_exams),
        _make_tool("ynufe_notices", "获取教务通知/公告列表 (标题/时间/未读状态).", {
            "type": "object", "properties": {},
        }, tool_notices),
        _make_tool("ynufe_plan", "获取培养方案: 标题/培养目标/课程模块学分结构/课程总表/学分缺口分析/未修必修课.", {
            "type": "object", "properties": {},
        }, tool_plan),
        _make_tool("ynufe_logout", "退出登录, 清除会话.", {
            "type": "object", "properties": {},
        }, tool_logout),
    ]


MCP_PROTOCOL = "2025-06-18"


def run_stdio(get_session):
    """stdin/stdout JSON-RPC MCP 协议"""
    tools = build_tools(get_session)

    def send(obj: dict):
        sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
        sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            send({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "parse error"}})
            continue
        method = msg.get("method")
        msg_id = msg.get("id")
        if method == "initialize":
            send({"jsonrpc": "2.0", "id": msg_id,
                  "result": {"protocolVersion": MCP_PROTOCOL,
                             "capabilities": {"tools": {}},
                             "serverInfo": {"name": "ynufe-campus-mcp", "version": __version__}}})
        elif method == "notifications/initialized":
            pass
        elif method == "tools/list":
            send({"jsonrpc": "2.0", "id": msg_id,
                  "result": {"tools": [{"name": t["name"], "description": t["description"],
                                        "inputSchema": t["inputSchema"]} for t in tools]}})
        elif method == "tools/call":
            params = msg.get("params", {})
            name = params.get("name")
            args = params.get("arguments", {})
            tool = next((t for t in tools if t["name"] == name), None)
            if not tool:
                send({"jsonrpc": "2.0", "id": msg_id,
                      "error": {"code": -32602, "message": f"Unknown tool {name}"}})
                continue
            try:
                result = tool["handler"](**args)
                if isinstance(result, dict):
                    send({"jsonrpc": "2.0", "id": msg_id,
                          "result": {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}]}})
                else:
                    send({"jsonrpc": "2.0", "id": msg_id,
                          "result": {"content": [{"type": "text", "text": str(result)}]}})
            except Exception as e:
                send({"jsonrpc": "2.0", "id": msg_id,
                      "error": {"code": -32603, "message": str(e)}})
        elif method == "ping":
            send({"jsonrpc": "2.0", "id": msg_id, "result": {}})
        else:
            send({"jsonrpc": "2.0", "id": msg_id,
                  "error": {"code": -32601, "message": f"Method not found {method}"}})


# 允许通过环境变量注入学号密码, 避免把密码写死在命令行
_SESSION = None


def get_session():
    global _SESSION
    if _SESSION is None:
        _SESSION = YnufeSession()
    return _SESSION


def main():
    ap = argparse.ArgumentParser(description="ynufe-tong MCP server")
    ap.add_argument("--interactive", action="store_true",
                    help="交互式 CLI 模式 (human-friendly)")
    args = ap.parse_args()

    if args.interactive:
        run_interactive()
    else:
        run_stdio(get_session)


def run_interactive():
    """交互式 CLI: 登录 -> 菜单选择 -> 查询"""
    import os
    s = YnufeSession()
    print("=" * 40)
    print("  云财·通 (ynufe-tong) — 交互模式")
    print("=" * 40)
    user = os.environ.get("YNUFE_USER", "") or input("学号: ").strip()
    password = os.environ.get("YNUFE_PASS", "") or input("密码: ").strip()
    res = s.login_with_ocr(user, password)
    if not res.get("ok"):
        print("登录失败:", res.get("error"))
        sys.exit(1)
    print(f"✓ 登录成功: {res.get('name')} ({res.get('student_id')})")

    while True:
        print("\n[功能]")
        print("  1. 学籍信息")
        print("  2. 成绩单")
        print("  3. 课表")
        print("  4. 考试安排")
        print("  5. 退出登录")
        print("  0. 退出")
        choice = input("选择: ").strip()
        try:
            if choice == "1":
                print(json.dumps(s.fetch_profile(), ensure_ascii=False, indent=2))
            elif choice == "2":
                print(json.dumps(s.fetch_grades(), ensure_ascii=False, indent=2))
            elif choice == "3":
                print(json.dumps(s.fetch_timetable(), ensure_ascii=False, indent=2))
            elif choice == "4":
                print(json.dumps(s.fetch_exams(), ensure_ascii=False, indent=2))
            elif choice == "5":
                print(json.dumps(s.logout(), ensure_ascii=False))
            elif choice == "0":
                break
        except Exception as e:
            print("出错:", e)


if __name__ == "__main__":
    main()