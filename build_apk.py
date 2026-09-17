"""云财智能教务助手 (YNUFE Mobile Assistant) Android APK 自动化构建脚本。

支持开发热重载版、正式调试版及发布混淆版的编译、同步与打包归档。
"""
import argparse
import json
import os
import shutil
import socket
import subprocess
import sys

# Windows 平台控制台输出 UTF-8 重定向
if sys.platform.startswith("win"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(PROJECT_DIR, "capacitor.config.json")
ANDROID_DIR = os.path.join(PROJECT_DIR, "android")


def get_local_ip() -> str:
    """自动获取本机在局域网中的 IPv4 地址。

    Returns:
        str: 本机局域网 IP 地址（例如 "192.168.1.3"）；若获取失败则返回 "127.0.0.1"。
    """
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip: str = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return "127.0.0.1"


def update_capacitor_config(is_dev: bool) -> None:
    """根据打包模式更新 capacitor.config.json 配置。

    Args:
        is_dev (bool): 是否为开发热重载模式。

    Raises:
        IOError: 当读取或写入配置文件失败时抛出。
    """
    if not os.path.exists(CONFIG_PATH):
        print(f"[Warn] 未找到 Capacitor 配置文件: {CONFIG_PATH}")
        return

    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        config = json.load(f)

    if is_dev:
        local_ip = get_local_ip()
        config["server"] = {
            "url": f"http://{local_ip}:8000",
            "cleartext": True,
        }
        print(f"[Build] 开发热重载模式: Server URL 设置为 http://{local_ip}:8000")
    else:
        if "server" in config:
            del config["server"]
        print("[Build] 离线独立模式: 嵌入本地静态资源 (无 Server URL)")

    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2, ensure_ascii=False)


def run_step(cmd: str, cwd: str, step_name: str) -> None:
    """执行构建步骤子进程，处理异常退出。

    Args:
        cmd (str): 待执行的命令行指令。
        cwd (str): 指令执行的工作目录。
        step_name (str): 步骤描述名称。

    Raises:
        subprocess.CalledProcessError: 当子进程执行失败返回非零退出码时抛出。
    """
    print(f"[*] 执行步骤: {step_name} -> {cmd}")
    res = subprocess.run(
        cmd,
        shell=True,
        cwd=cwd,
        check=False,
    )
    if res.returncode != 0:
        raise subprocess.CalledProcessError(res.returncode, cmd)


def main() -> None:
    """一键构建并打包发布版、开发热重载版或正式发布版 Android APK。

    根据命令行参数判断模式，依次执行配置更新、前端编译、Capacitor 资源同步、
    Gradle 构建及产物归档。构建失败时以非零状态码安全退出。
    """
    parser = argparse.ArgumentParser(description="云财智能教务助手 Android APK 一键构建工具")
    parser.add_argument("--dev", action="store_true", help="构建开发热重载版 APK (连接局域网 Vite 服务)")
    parser.add_argument("--release", action="store_true", help="构建 Release 签名优化版 APK")
    parser.add_argument("--clean", action="store_true", help="在构建前执行 Gradle clean 清理历史缓存")
    args = parser.parse_args()

    is_dev = args.dev
    is_release = args.release and not is_dev
    is_clean = args.clean

    if is_dev:
        mode_name = "开发热重载版"
        gradle_task = "assembleDebug"
        apk_subpath = os.path.join("app", "build", "outputs", "apk", "debug", "app-debug.apk")
        output_name = "云财学子_开发热重载版.apk"
    elif is_release:
        mode_name = "正式发布版 (Release)"
        gradle_task = "assembleRelease"
        apk_subpath = os.path.join("app", "build", "outputs", "apk", "release", "app-release-unsigned.apk")
        output_name = "云财学子_Release.apk"
    else:
        mode_name = "正式离线独立版 (Debug签名)"
        gradle_task = "assembleDebug"
        apk_subpath = os.path.join("app", "build", "outputs", "apk", "debug", "app-debug.apk")
        output_name = "云财学子.apk"

    print(f"=== 开始构建云财学子 APK [{mode_name}] ===")

    gradle_bin = "gradlew.bat" if sys.platform.startswith("win") else "./gradlew"

    try:
        print("\n0. 更新 Capacitor 配置...")
        update_capacitor_config(is_dev)

        print("\n1. 检查 npm 依赖与构建前端产物...")
        run_step("npm run build", PROJECT_DIR, "编译前端静态产物")

        print("\n2. 同步前端资源与插件到 Android 工程...")
        run_step("npx cap sync", PROJECT_DIR, "Capacitor 资源同步")

        if is_clean:
            print("\n2.5. 清理 Gradle 历史构建缓存...")
            run_step(f"{gradle_bin} clean", ANDROID_DIR, "Gradle 清理")

        print(f"\n3. 使用 Gradle 编译 Android APK ({gradle_task})...")
        run_step(f"{gradle_bin} {gradle_task}", ANDROID_DIR, f"Gradle 编译 {gradle_task}")

        print("\n4. 复制并归档 APK 产物...")
        if is_release:
            candidates = [
                os.path.join(ANDROID_DIR, "app", "build", "outputs", "apk", "release", "app-release-unsigned.apk"),
                os.path.join(ANDROID_DIR, "app", "build", "outputs", "apk", "release", "app-release.apk"),
            ]
            src_apk = next((p for p in candidates if os.path.exists(p)), None)
            if not src_apk:
                raise FileNotFoundError(
                    f"未找到生成的 Release APK 产物 (已尝试: {candidates})。请检查 Gradle 编译日志或配置 release 签名。"
                )
            if "unsigned" in os.path.basename(src_apk):
                print(f"[提示] Release APK 未签名 ({os.path.basename(src_apk)})。安装真机前请使用 apksigner 签名，或直接打包默认版。")
            else:
                print(f"[提示] 成功定位已签名的 Release APK: {os.path.basename(src_apk)}")
        else:
            src_apk = os.path.join(ANDROID_DIR, apk_subpath)
            if not os.path.exists(src_apk):
                raise FileNotFoundError(f"未找到生成的 APK 产物: {src_apk}")

        dest_apk = os.path.join(PROJECT_DIR, output_name)
        shutil.copy2(src_apk, dest_apk)

        file_size_mb = os.path.getsize(dest_apk) / (1024 * 1024)
        print(f"\n[SUCCESS] 构建成功! [{mode_name}] APK 已就绪:")
        print(f"文件位置: {dest_apk}")
        print(f"文件大小: {file_size_mb:.2f} MB")

    except subprocess.CalledProcessError as e:
        print(f"\n[ERROR] 构建指令执行失败 (Exit Code {e.returncode}): {e.cmd}")
        sys.exit(e.returncode if e.returncode != 0 else 1)
    except Exception as e:  # noqa: BLE001
        print(f"\n[ERROR] 构建流程发生异常: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()

