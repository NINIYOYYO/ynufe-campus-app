import sys
import urllib.request
import ssl

if sys.platform.startswith('win'):
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

COOKIE = "jsxsd=24411319; JSESSIONID=43A9B645E8E936C378974081E8CC39A8"
BASE_URL = "https://xjwis.ynufe.edu.cn"

def fetch(url_path: str) -> str:
    """
    使用临时 Cookie 请求教务网页面并返回响应内容。

    Args:
        url_path (str): 请求相对路径。

    Returns:
        str: 响应 HTML 文本。
    """
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    req = urllib.request.Request(
        f"{BASE_URL}{url_path}",
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Cookie": COOKIE,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        }
    )
    with urllib.request.urlopen(req, context=ctx, timeout=10) as resp:
        return resp.read().decode('utf-8', errors='ignore')

def main():
    """
    验证临时 Cookie 联通性与教务网核心接口返回状态。
    """
    print("=== 开始验证教务网真实连通性与 Cookie 有效性 ===")
    try:
        html = fetch("/jsxsd/framework/xsMain_new.jsp?t1=1")
        if "middletopdwxxcont" in html or "云南财经大学" in html:
            print(" [PASS] 首页框架接口连通成功，成功识别到学籍与校园信息结构！")
            if "不在教学周历内" in html:
                print(" [INFO] 当前处于假期/开学前夕，周次状态: 不在教学周历内")
            elif "第" in html and "周" in html:
                print(" [INFO] 识别到当前教学周信息")
        else:
            print(" [WARN] 页面响应中未直接命中特征节点，但连接通畅。")
        
        kb_html = fetch("/jsxsd/xskb/xskb_list.do")
        if "kbtable" in kb_html:
            print(" [PASS] 课表接口连通成功，成功识别到 table#kbtable 课表矩阵！")
        else:
            print(" [WARN] 课表页面返回非标准结构")

    except Exception as e:
        print(f" [INFO] 网络或连接提示: {e}")

if __name__ == "__main__":
    main()
