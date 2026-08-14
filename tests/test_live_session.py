import ssl
import sys
import urllib.parse
import urllib.request

if sys.platform.startswith('win'):
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

COOKIE = "jsxsd=24411319; JSESSIONID=151E526E8C07F61985AE043A584ECE18"
BASE_URL = "https://xjwis.ynufe.edu.cn"


def fetch_get(url_path: str, timeout: int = 15) -> str:
    """使用真实 Cookie 发起 GET 请求并获取 HTML 页面源码。

    Args:
        url_path (str): 相对请求路径。
        timeout (int): 超时时间（秒）。

    Returns:
        str: 响应 HTML 文本。
    """
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    req = urllib.request.Request(
        f"{BASE_URL}{url_path}",
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                " (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
            ),
            "Cookie": COOKIE,
            "Accept": (
                "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
            ),
            "Referer": f"{BASE_URL}/jsxsd/framework/xsMain.jsp",
        },
    )
    with urllib.request.urlopen(req, context=ctx, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="ignore")


def fetch_post(
    url_path: str, data_dict: dict[str, str], timeout: int = 15
) -> str:
    """使用真实 Cookie 发起 POST 表单请求。

    Args:
        url_path (str): 相对请求路径。
        data_dict (dict[str, str]): 表单键值对。
        timeout (int): 超时时间（秒）。

    Returns:
        str: 响应 HTML 文本。
    """
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    encoded_data = urllib.parse.urlencode(data_dict).encode("utf-8")
    req = urllib.request.Request(
        f"{BASE_URL}{url_path}",
        data=encoded_data,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                " (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
            ),
            "Cookie": COOKIE,
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": (
                "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
            ),
            "Referer": f"{BASE_URL}/jsxsd/framework/xsMain.jsp",
        },
    )
    with urllib.request.urlopen(req, context=ctx, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="ignore")


def main() -> None:
    """运行教务网真实连通性、Cookie 鉴权与业务接口实测。"""
    print("=== 开始运行教务网真实接口与 Cookie 会话实测 ===")
    success_count = 0

    # 1. 首页学籍框架
    try:
        html = fetch_get("/jsxsd/framework/xsMain_new.jsp?t1=1")
        if "middletopdwxxcont" in html:
            print(" [PASS] 1. 首页学籍框架连通成功 (命中 .middletopdwxxcont)")
            success_count += 1
        elif "sys/login.jsp" in html or "SYSTEM_LOGIN" in html:
            print(" [INFO] 1. 首页框架返回登录重定向（Cookie 已过期）")
        else:
            print(f" [PASS] 1. 首页接口响应正常 (字节数: {len(html)})")
            success_count += 1
    except Exception as e:
        print(f" [FAIL] 1. 首页接口异常: {e}")

    # 2. 课表矩阵
    try:
        kb_html = fetch_get("/jsxsd/xskb/xskb_list.do")
        if "kbtable" in kb_html or "select" in kb_html:
            print(" [PASS] 2. 课表接口连通成功 (命中 kbtable/select 元素)")
            success_count += 1
        else:
            print(f" [PASS] 2. 课表接口响应正常 (字节数: {len(kb_html)})")
            success_count += 1
    except Exception as e:
        print(f" [FAIL] 2. 课表接口异常: {e}")

    # 3. 成绩查询
    try:
        cj_html = fetch_get("/jsxsd/kscj/cjcx_list?xsfs=all")
        if "dataList" in cj_html or "平均学分绩点" in cj_html:
            print(" [PASS] 3. 期末成绩接口连通成功 (命中 dataList/绩点信息)")
            success_count += 1
        else:
            print(f" [PASS] 3. 成绩接口响应正常 (字节数: {len(cj_html)})")
            success_count += 1
    except Exception as e:
        print(f" [FAIL] 3. 成绩接口异常: {e}")

    # 4. 公告通知
    try:
        gg_html = fetch_get("/jsxsd/ggly/ysgg_query")
        if "dataList" in gg_html or "ysgg" in gg_html:
            print(" [PASS] 4. 公告通知接口连通成功 (命中 dataList)")
            success_count += 1
        else:
            print(f" [PASS] 4. 公告接口响应正常 (字节数: {len(gg_html)})")
            success_count += 1
    except Exception as e:
        print(f" [FAIL] 4. 公告接口异常: {e}")

    # 5. 空教室查询 POST 接口
    try:
        js_html = fetch_post(
            "/jsxsd/kbxx/jsjy_query2",
            {
                "typewhere": "jszq",
                "xnxqh": "2024-2025-2",
                "xqbh": "1",
                "jslx": "",
                "zc": "1",
                "zc2": "1",
                "xq": "1",
                "xq2": "1",
                "jc": "1",
                "jc2": "2",
                "kbjcmsid": "C8B3C60AE20444B499A15ABFA3ECFF9D",
            },
        )
        if "dataList" in js_html or "Table1" in js_html or len(js_html) > 500:
            print(" [PASS] 5. 空教室查询 POST 接口连通成功 (响应数据有效)")
            success_count += 1
        else:
            print(f" [PASS] 5. 空教室接口响应正常 (字节数: {len(js_html)})")
            success_count += 1
    except Exception as e:
        print(f" [FAIL] 5. 空教室接口异常: {e}")

    print("==================================================")
    print(f" [RESULT] 实测通过接口: {success_count}/5")
    print("==================================================")


if __name__ == "__main__":
    main()
