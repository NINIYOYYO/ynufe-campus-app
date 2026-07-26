import http.server
import urllib.request
import urllib.error
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

class YnufeProxyHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        if os.path.exists(DIST_DIR):
            super().__init__(*args, directory=DIST_DIR, **kwargs)
        else:
            super().__init__(*args, **kwargs)

    def do_GET(self):
        if self.path.startswith("/jsxsd/"):
            self.proxy_request("GET")
        else:
            super().do_GET()

    def do_POST(self):
        self.proxy_request("POST")

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
                        self.send_header(header, value)
                
                content = response.read()
                self.send_header('Content-Length', str(len(content)))
                self.end_headers()
                self.wfile.write(content)
        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            for header, value in e.headers.items():
                if header.lower() not in ('content-length', 'transfer-encoding', 'content-encoding'):
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
