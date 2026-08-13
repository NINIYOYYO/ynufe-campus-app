import json
import os
import re
import socket
import shutil
import subprocess
import sys

if sys.platform.startswith('win'):
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

project_dir = os.path.dirname(os.path.abspath(__file__))
config_path = os.path.join(project_dir, "capacitor.config.json")

def get_local_ip() -> str:
    """
    自动获取本机在局域网中的 IPv4 地址。

    Returns:
        str: 本机局域网 IP 地址（例如 "192.168.1.3"）。
    """
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

def update_capacitor_config(is_dev: bool) -> None:
    """
    根据打包模式更新 capacitor.config.json 配置。

    Args:
        is_dev (bool): 是否为开发热重载模式。
    """
    if not os.path.exists(config_path):
        return

    with open(config_path, 'r', encoding='utf-8') as f:
        config = json.load(f)

    if is_dev:
        local_ip = get_local_ip()
        config["server"] = {
            "url": f"http://{local_ip}:8000",
            "cleartext": True
        }
        print(f"[Build] Dev Live Reload Mode: Server URL set to http://{local_ip}:8000")
    else:
        if "server" in config:
            del config["server"]
        print("[Build] Release Standalone Mode: Embedded local web assets (No server URL)")

    with open(config_path, 'w', encoding='utf-8') as f:
        json.dump(config, f, indent=2, ensure_ascii=False)

def main():
    is_dev = "--dev" in sys.argv
    mode_name = "开发热重载版" if is_dev else "正式离线独立版"
    print(f"=== 开始构建云财学子 APK [{mode_name}] ===")

    try:
        print("0. 更新 Capacitor 配置...")
        update_capacitor_config(is_dev)

        print("1. 检查 npm 依赖与构建前端产物...")
        subprocess.run("npm run build", shell=True, cwd=project_dir, check=True)

        print("2. 同步前端资源与插件到 Android 工程...")
        subprocess.run("npx cap sync", shell=True, cwd=project_dir, check=True)

        print("3. 使用 Gradle 编译 Android APK...")
        android_dir = os.path.join(project_dir, "android")
        subprocess.run("gradlew.bat assembleDebug", shell=True, cwd=android_dir, check=True)

        print("4. 复制 APK 产物到项目根目录...")
        src_apk = os.path.join(android_dir, "app", "build", "outputs", "apk", "debug", "app-debug.apk")
        output_name = "云财学子_开发热重载版.apk" if is_dev else "云财学子.apk"
        dest_apk = os.path.join(project_dir, output_name)
        shutil.copy2(src_apk, dest_apk)

        print(f"\n构建成功! [{mode_name}] APK 已就绪:")
        print(f"文件位置: {dest_apk}")
    except Exception as e:
        print(f"\n构建失败: {e}")

if __name__ == "__main__":
    main()

