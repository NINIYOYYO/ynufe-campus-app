"""结构完整性冒烟检查（并非功能测试）。

只验证构建产物与关键 DOM 骨架是否齐全，不能证明业务逻辑正确。
真正的功能验证请用 `npm run dev` 实际登录调试。
"""
import os
import re
import sys

if sys.platform.startswith('win'):
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

BASE = os.path.dirname(os.path.abspath(__file__))

print("==================================================")
print(" [+] Structural smoke check ...")
print("==================================================")

# 1. 检查 dist 编译输出目录及必备文件
dist_dir = os.path.join(BASE, "dist")
index_html = os.path.join(dist_dir, "index.html")

assert os.path.exists(dist_dir), "ERROR: dist directory not found! Run `npm run build` first."
assert os.path.exists(index_html), "ERROR: dist/index.html not found!"

with open(index_html, "r", encoding="utf-8") as f:
    html_content = f.read()

js_match = re.search(r'src=["\']\.?/assets/([^"\']+\.js)["\']', html_content)
css_match = re.search(r'href=["\']\.?/assets/([^"\']+\.css)["\']', html_content)

assert js_match, "ERROR: JS bundle not linked in dist/index.html!"
assert css_match, "ERROR: CSS bundle not linked in dist/index.html!"

js_file = os.path.join(dist_dir, "assets", js_match.group(1))
css_file = os.path.join(dist_dir, "assets", css_match.group(1))
assert os.path.exists(js_file), f"ERROR: JS bundle file missing: {js_file}"
assert os.path.exists(css_file), f"ERROR: CSS bundle file missing: {css_file}"
print(f" [V] Dist bundle: {js_match.group(1)} ({os.path.getsize(js_file)} bytes)")

# 2. 检查关键 DOM 容器 ID
with open(os.path.join(BASE, "index.html"), "r", encoding="utf-8") as f:
    src_html = f.read()

required_ids = [
    "user-name-display", "profile-dept", "profile-major", "profile-class", "profile-id",
    "sync-status-tag", "captcha-img", "login-overlay", "login-form", "username", "password", "captcha",
    "remember-me", "gpa-val", "grades-list", "exams-term-list", "home-announcements-list",
    "bottom-sheet", "sheet-title", "sheet-tag", "sheet-body-content", "sheet-overlay",
    "wallpaper-img", "wallpaper-file-input", "btn-reset-wallpaper",
    "slider-wallpaper-blur", "slider-wallpaper-mask", "val-wallpaper-blur", "val-wallpaper-mask",
    # v1.1 新增
    "btn-notify", "notify-sheet", "notify-overlay", "notify-enabled-toggle",
    "select-notify-lead", "notify-status-text", "thesis-guidance-count",
]

missing_ids = [i for i in required_ids if f'id="{i}"' not in src_html and f"id='{i}'" not in src_html]
assert not missing_ids, f"ERROR: Missing DOM IDs in index.html: {missing_ids}"
print(f" [V] All {len(required_ids)} critical DOM IDs present")

# 3. 检查 TypeScript 源码模块存在
src_ts_files = [
    "src/main.ts", "src/config.ts", "src/api/client.ts",
    "src/services/autoLogin.ts", "src/services/notificationManager.ts",
    "src/stores/sessionStore.ts", "src/config/themePresets.ts",
    "src/types/theme.ts",
    "src/parsers/profileParser.ts", "src/parsers/timetableParser.ts",
    "src/parsers/gradeParser.ts", "src/parsers/examParser.ts",
    "src/parsers/announcementParser.ts", "src/parsers/serviceParser.ts",
    "src/utils/crypto.ts", "src/utils/escapeHtml.ts", "src/utils/colorExtractor.ts",
    "src/utils/uiFeedback.ts",
    "src/components/wallpaperManager.ts", "src/components/bottomSheet.ts",
    "src/components/syncStatusTag.ts", "src/components/customSelect.ts",
    "src/components/themeCustomizer.ts", "src/styles/app.css",
    "src/views/announcementView.ts",
    "src/views/examView.ts",
    "src/views/serviceView.ts",
    "src/views/gradeView.ts",
    "src/views/timetableView.ts",
    "src/views/settingsView.ts",
    "src/core/app.ts",
    "src/core/router.ts",
]
for rel in src_ts_files:
    assert os.path.exists(os.path.join(BASE, rel)), f"ERROR: Missing source file: {rel}"
print(f" [V] All {len(src_ts_files)} TypeScript source modules present")

print("==================================================")
print(" [PASS] Structural smoke check finished.")
print(" (Note: this does NOT prove the app is bug-free —")
print("  it only checks that files and DOM anchors exist.)")
print("==================================================")
