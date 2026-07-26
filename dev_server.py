import http.server
import urllib.request
import urllib.error
import urllib.parse
import socketserver
import ssl
import os

PORT = 8000
TARGET_HOST = "https://xjwis.ynufe.edu.cn"
DIST_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dist")

class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

opener = urllib.request.build_opener(NoRedirectHandler)
urllib.request.install_opener(opener)

ssl_context = ssl.create_default_context()
ssl_context.check_hostname = False
ssl_context.verify_mode = ssl.CERT_NONE

#: 需要转发到教务网的路径前缀。
#: 教务网的资源不止 /jsxsd/——公告附件由富文本编辑器上传，实际位于
#: /ewebeditor/uploadfile/xxx.doc，此前不在代理范围内，点击附件必然 404。
PROXY_PREFIXES = ("/jsxsd/", "/ewebeditor/", "/uploadfiles/")

#: 教务网主机名，用于识别并改写重定向地址
TARGET_NETLOC = urllib.parse.urlsplit(TARGET_HOST).netloc


def rewrite_location(value):
    """把指向教务网的重定向地址改写为同源相对路径。

    登录成功后教务网会 302 到绝对地址（例如
    http://xjwis.ynufe.edu.cn/jsxsd/framework/xsMain.jsp）。若原样透传，
    浏览器会跨域跟跳并被 CORS 拦截，表现为「密码正确却登录失败」。

    Args:
        value (str): 原始 Location 头。

    Returns:
        str: 指向教务网时返回 path[?query]，其余情况原样返回。
    """
    parts = urllib.parse.urlsplit(value)
    if parts.netloc and parts.netloc == TARGET_NETLOC:
        rebuilt = parts.path or "/"
        if parts.query:
            rebuilt += "?" + parts.query
        return rebuilt
    return value


class YnufeProxyHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        if os.path.exists(DIST_DIR):
            super().__init__(*args, directory=DIST_DIR, **kwargs)
        else:
            super().__init__(*args, **kwargs)

    def should_proxy(self):
        return self.path.startswith(PROXY_PREFIXES)

    def do_GET(self):
        if self.should_proxy():
            self.proxy_request("GET")
        else:
            super().do_GET()

    def do_POST(self):
        # 必须同样做前缀判断：此前无条件转发所有 POST，等于把本机变成一个
        # 携带教务网会话 Cookie 的开放代理，本地任意页面都能借它访问学校系统。
        if self.should_proxy():
            self.proxy_request("POST")
        else:
            self.send_error(404, "Not proxied")

    def proxy_request(self, method):
        target_url = TARGET_HOST + self.path
        
        content_length = int(self.headers.get('Content-Length', 0))
        body_data = self.rfile.read(content_length) if content_length > 0 else None
        
        forward_headers = {}
        for header, value in self.headers.items():
            if header.lower() not in ('host', 'content-length', 'accept-encoding', 'origin', 'referer'):
                forward_headers[header] = value
        
        forward_headers['Origin'] = TARGET_HOST
        forward_headers['Referer'] = f"{TARGET_HOST}/jsxsd/"
        forward_headers['Host'] = "xjwis.ynufe.edu.cn"

        req = urllib.request.Request(
            url=target_url,
            data=body_data,
            headers=forward_headers,
            method=method
        )
        
        try:
            with urllib.request.urlopen(req, context=ssl_context, timeout=10) as response:
                self.send_response(response.status)
                
                for header, value in response.headers.items():
                    if header.lower() not in ('content-length', 'transfer-encoding', 'content-encoding'):
                        if header.lower() == 'location':
                            value = rewrite_location(value)
                        self.send_header(header, value)
                
                content = response.read()
                self.send_header('Content-Length', str(len(content)))
                self.end_headers()
                self.wfile.write(content)
        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            for header, value in e.headers.items():
                if header.lower() not in ('content-length', 'transfer-encoding', 'content-encoding'):
                    if header.lower() == 'location':
                        value = rewrite_location(value)
                    self.send_header(header, value)
            content = e.read()
            self.send_header('Content-Length', str(len(content)))
            self.end_headers()
            self.wfile.write(content)
        except Exception as e:
            self.send_response(500)
            self.end_headers()
            self.wfile.write(f"Local Proxy Error: {e}".encode('utf-8'))

if __name__ == "__main__":
    print("==================================================")
    print(" [+] YNUFE Campus Local Dev Server Started!")
    print(f" [*] Dist Directory: {DIST_DIR}")
    print(f" [>] Access URL: http://localhost:{PORT}")
    print("==================================================")
    
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), YnufeProxyHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n Server stopped.")
