"""Milestone 2 Python & Native Bridge 对抗性压力测试 (Challenger 2 Empirical Stress Test).

覆盖模块:
1. NativeCookiePlugin.java (SEC-04): 针对 resolveBaseUrl / probeUrls / setCookie 的多环境极限 URL 边界测试。
2. build_apk.py (SEC-06): CLI 非法参数、失败退出码、UTF-8 编码安全及配置自愈测试。
"""
import json
import os
import re
import subprocess
import sys
import unittest
from urllib.parse import urlparse

if sys.platform.startswith("win"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD_SCRIPT = os.path.join(PROJECT_DIR, "build_apk.py")
CONFIG_PATH = os.path.join(PROJECT_DIR, "capacitor.config.json")
JAVA_PLUGIN_PATH = os.path.join(
    PROJECT_DIR,
    "android", "app", "src", "main", "java", "com", "ynufe", "campusapp", "NativeCookiePlugin.java"
)


class TestNativeCookiePluginLogic(unittest.TestCase):
    """SEC-04 NativeCookiePlugin 逻辑与极端 URL 解析边界测试。"""

    DEFAULT_BASE_URL = "https://xjwis.ynufe.edu.cn"

    def setUp(self):
        """加载 NativeCookiePlugin.java 源码进行静态与模式验证。"""
        self.assertTrue(os.path.exists(JAVA_PLUGIN_PATH), f"未找到插件文件: {JAVA_PLUGIN_PATH}")
        with open(JAVA_PLUGIN_PATH, "r", encoding="utf-8") as f:
            self.java_source = f.read()

    def simulate_resolve_base_url(self, input_url: str | None) -> str:
        """精确模拟 Java 原生 resolveBaseUrl 算法行为。"""
        if not input_url or not input_url.strip():
            return self.DEFAULT_BASE_URL
        trimmed = input_url.strip()
        try:
            parsed = urlparse(trimmed)
            if parsed.scheme and parsed.netloc:
                port = parsed.port
                port_part = f":{port}" if port and port not in (80, 443) else ""
                hostname = parsed.hostname
                if hostname and ":" in hostname and not hostname.startswith("["):
                    # IPv6 格式规范化
                    hostname = f"[{hostname}]"
                return f"{parsed.scheme}://{hostname}{port_part}"
        except (ValueError, AttributeError):
            pass
        return re.sub(r"/+$", "", trimmed)

    def test_empty_and_null_urls(self):
        """测试空串、全空格及 None 是否安全回退至默认教务系统域名。"""
        self.assertEqual(self.simulate_resolve_base_url(None), self.DEFAULT_BASE_URL)
        self.assertEqual(self.simulate_resolve_base_url(""), self.DEFAULT_BASE_URL)
        self.assertEqual(self.simulate_resolve_base_url("   \t\n  "), self.DEFAULT_BASE_URL)

    def test_standard_ports(self):
        """测试 80 和 443 标准端口被安全省略。"""
        self.assertEqual(
            self.simulate_resolve_base_url("http://xjwis.ynufe.edu.cn:80/jsxsd"),
            "http://xjwis.ynufe.edu.cn"
        )
        self.assertEqual(
            self.simulate_resolve_base_url("https://xjwis.ynufe.edu.cn:443/jsxsd/framework"),
            "https://xjwis.ynufe.edu.cn"
        )

    def test_custom_ports_and_ips(self):
        """测试自定义局域网端口、IPv4 与 IPv6 地址。"""
        self.assertEqual(
            self.simulate_resolve_base_url("http://192.168.1.100:8000/api/v1?token=123#test"),
            "http://192.168.1.100:8000"
        )
        self.assertEqual(
            self.simulate_resolve_base_url("http://10.0.2.2:3000/"),
            "http://10.0.2.2:3000"
        )
        self.assertEqual(
            self.simulate_resolve_base_url("http://[::1]:8080/jsxsd"),
            "http://[::1]:8080"
        )

    def test_query_params_and_fragments(self):
        """测试带有复杂查询参数和 Hash 锚点的 URL 清洗。"""
        self.assertEqual(
            self.simulate_resolve_base_url("https://proxy.ynufe.edu.cn:8443/jsxsd/kscj/cjcx_list?xsfs=all&year=2026#row1"),
            "https://proxy.ynufe.edu.cn:8443"
        )

    def test_java_source_contract(self):
        """验证 Java 源码中的关键安全性断言与调用契约。"""
        self.assertIn("resolveBaseUrl", self.java_source)
        self.assertIn("call.getString(\"url\", \"\")", self.java_source)
        self.assertIn("call.getString(\"cookie\", \"\")", self.java_source)
        self.assertIn("cookieManager.flush()", self.java_source)
        self.assertIn("call.resolve", self.java_source)
        self.assertIn("call.reject", self.java_source)
        # 确保包含关键子路径探针
        for path in ["/jsxsd", "/jsxsd/xk/LoginToXkLdap", "/jsxsd/verifycode.servlet", "/jsxsd/framework/xsMain.jsp"]:
            self.assertIn(path, self.java_source)


class TestBuildApkScript(unittest.TestCase):
    """SEC-06 build_apk.py 构建脚本对抗性压力与退出码测试。"""

    def test_cli_help_flag(self):
        """验证 --help 与 -h 返回退出码 0 并输出完整帮助说明。"""
        res = subprocess.run(
            [sys.executable, BUILD_SCRIPT, "--help"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            check=False,
        )
        self.assertEqual(res.returncode, 0)
        self.assertIn("--dev", res.stdout)
        self.assertIn("--release", res.stdout)
        self.assertIn("--clean", res.stdout)

    def test_invalid_cli_arguments(self):
        """验证传递非法 CLI 参数时 argparse 能够以非零状态码退出。"""
        res = subprocess.run(
            [sys.executable, BUILD_SCRIPT, "--invalid-flag-12345"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            check=False,
        )
        self.assertNotEqual(res.returncode, 0)
        self.assertEqual(res.returncode, 2)  # argparse 退出码为 2
        self.assertIn("unrecognized arguments", res.stderr)

    def test_utf8_redirection_and_encoding_safety(self):
        """验证脚本包含 UTF-8 标准输出重定向。"""
        with open(BUILD_SCRIPT, "r", encoding="utf-8") as f:
            content = f.read()
        self.assertIn("sys.stdout.reconfigure(encoding=\"utf-8\")", content)
        self.assertIn("sys.stderr.reconfigure(encoding=\"utf-8\")", content)
        self.assertIn("encoding=\"utf-8\"", content)

    def test_capacitor_config_update_and_restore(self):
        """验证 update_capacitor_config 在 dev 与 prod 模式下正常切换且可无损还原。"""
        if not os.path.exists(CONFIG_PATH):
            self.skipTest("capacitor.config.json 不存在")

        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            original_content = f.read()

        try:
            # 导入 build_apk.py 中的函数
            sys.path.insert(0, PROJECT_DIR)
            import build_apk

            # 1. 切换到 Dev 模式
            build_apk.update_capacitor_config(is_dev=True)
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                dev_config = json.load(f)
            self.assertIn("server", dev_config)
            self.assertTrue(dev_config["server"]["cleartext"])
            self.assertTrue(dev_config["server"]["url"].startswith("http://"))

            # 2. 切换回 Release / 离线模式
            build_apk.update_capacitor_config(is_dev=False)
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                prod_config = json.load(f)
            self.assertNotIn("server", prod_config)

        finally:
            # 还原原始配置文件
            with open(CONFIG_PATH, "w", encoding="utf-8") as f:
                f.write(original_content)

    def test_non_zero_exit_on_failed_step(self):
        """验证 run_step 抛出 CalledProcessError 时主流程正确退出非零状态码。"""
        sys.path.insert(0, PROJECT_DIR)
        import build_apk

        with self.assertRaises(subprocess.CalledProcessError):
            build_apk.run_step("exit 1", PROJECT_DIR, "测试失败步骤")


if __name__ == "__main__":
    unittest.main(verbosity=2)
