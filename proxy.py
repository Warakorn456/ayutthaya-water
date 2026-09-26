"""เซิร์ฟเวอร์สำรอง: เปิดหน้าเว็บที่ http://localhost:8000 และส่งต่อข้อมูลจาก thaiwater.net
ใช้เมื่อเปิด index.html ตรงๆ แล้วโหลดข้อมูลไม่ได้
รัน:  python proxy.py
"""
import http.server
import os
import urllib.request

API = "https://api-v3.thaiwater.net/api/v1/thaiwater30/public/waterlevel_load"
PORT = 8000


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/api/waterlevel"):
            try:
                req = urllib.request.Request(API, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=30) as r:
                    body = r.read()
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except Exception as e:
                self.send_error(502, f"thaiwater error: {e}")
            return
        super().do_GET()


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    print(f"เปิดเบราว์เซอร์ที่ http://localhost:{PORT}")
    http.server.ThreadingHTTPServer(("", PORT), Handler).serve_forever()
