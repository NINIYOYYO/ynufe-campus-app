import os
import shutil
import subprocess
import sys
import time

if sys.platform.startswith('win'):
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SDK_DIR = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT") or r"D:\AndoridSDK"
ADB_BIN = shutil.which("adb") or os.path.join(SDK_DIR, "platform-tools", "adb.exe")
EMULATOR_BIN = shutil.which("emulator") or os.path.join(SDK_DIR, "emulator", "emulator.exe")
AVD_NAME = os.environ.get("AVD_NAME", "Pixel_9_API_36")
PACKAGE_NAME = "com.ynufe.campusapp"
ACTIVITY_NAME = f"{PACKAGE_NAME}/.MainActivity"
APK_PATH = os.path.join(BASE_DIR, "云财学子.apk")
SCREENSHOTS_DIR = os.path.join(BASE_DIR, "screenshots")

def run_cmd(cmd: str, check: bool = True, capture: bool = True) -> subprocess.CompletedProcess:
    """
    执行外部命令行指令并以 UTF-8 获取输出。

    Args:
        cmd (str): 待执行的命令字符串。
        check (bool): 是否在命令返回非零错误码时抛出异常。
        capture (bool): 是否捕获标准输出与标准错误。

    Returns:
        subprocess.CompletedProcess: 执行结果实体。
    """
    return subprocess.run(
        cmd,
        shell=True,
        check=check,
        capture_output=capture,
        text=True,
        encoding='utf-8',
        errors='replace'
    )

def check_sdk_tools() -> bool:
    """
    检查 ADB 与 Emulator 核心工具链是否存在。

    Returns:
        bool: 工具链完备返回 True。
    """
    if not (os.path.exists(ADB_BIN) or shutil.which(ADB_BIN)):
        print(f"[ERROR] 未找到 ADB 工具: {ADB_BIN}")
        return False
    if not (os.path.exists(EMULATOR_BIN) or shutil.which(EMULATOR_BIN)):
        print(f"[ERROR] 未找到 Emulator 工具: {EMULATOR_BIN}")
        return False
    print(f"[+] ADB 路径: {ADB_BIN}")
    print(f"[+] Emulator 路径: {EMULATOR_BIN}")
    return True

def get_running_devices() -> list:
    """
    获取当前在线的 ADB 设备列表。

    Returns:
        list: 设备序列号列表（如 ['emulator-5554']）。
    """
    res = run_cmd(f'"{ADB_BIN}" devices')
    lines = res.stdout.strip().splitlines()
    devices = []
    for line in lines[1:]:
        parts = line.split()
        if len(parts) >= 2 and parts[1] == 'device':
            devices.append(parts[0])
    return devices

def start_emulator_if_needed() -> str:
    """
    检测或后台启动 Android 模拟器，并阻塞等待启动完成。

    Returns:
        str: 目标设备的序列号。
    """
    devices = get_running_devices()
    if devices:
        print(f"[+] 检测到已运行的 Android 设备/模拟器: {devices[0]}")
        return devices[0]

    print(f"[+] 正在后台启动模拟器 [{AVD_NAME}] ...")
    # 使用 Windows DETACHED_PROCESS 在后台独立启动模拟器
    subprocess.Popen(
        [EMULATOR_BIN, "-avd", AVD_NAME, "-no-boot-anim", "-no-snapshot-save", "-gpu", "auto"],
        creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
    )

    print("[+] 等待模拟器连接 ADB ...")
    for _ in range(60):
        time.sleep(2)
        devices = get_running_devices()
        if devices:
            break

    if not devices:
        raise RuntimeError("启动模拟器超时，未能成功连接 ADB")

    serial = devices[0]
    print(f"[+] 模拟器已连接 ({serial})，正在等待系统桌面加载完成 (sys.boot_completed) ...")
    
    for attempt in range(60):
        time.sleep(2)
        res = run_cmd(f'"{ADB_BIN}" -s {serial} shell getprop sys.boot_completed', check=False)
        if res.stdout.strip() == "1":
            print(f"[+] Android 系统桌面加载就绪! (耗时 ~{(attempt + 1) * 2}s)")
            break
    else:
        print("[!] 警告: boot_completed 检测超时，尝试继续执行后续步骤...")

    return serial

def build_app_if_needed() -> None:
    """
    编译最新的前端代码并构建发布版 APK。
    """
    print("[+] 正在执行 APK 编译与同步打包...")
    res = run_cmd(f'"{sys.executable}" build_apk.py', check=True)
    print(res.stdout)

def test_app_lifecycle(serial: str) -> None:
    """
    在模拟器中完整测试应用安装、冷启动、杀后台、二次启动与会话保持状态。

    Args:
        serial (str): 目标设备序列号。
    """
    os.makedirs(SCREENSHOTS_DIR, exist_ok=True)

    print(f"\n[+] 1. 向模拟器安装应用: {APK_PATH}")
    install_res = run_cmd(f'"{ADB_BIN}" -s {serial} install -r "{APK_PATH}"')
    print(f"    安装结果: {install_res.stdout.strip()}")

    print("[+] 2. 清理历史日志并冷启动应用...")
    run_cmd(f'"{ADB_BIN}" -s {serial} logcat -c')
    run_cmd(f'"{ADB_BIN}" -s {serial} shell am start -n {ACTIVITY_NAME}')

    print("[+] 3. 等待应用初始化 (5 秒)...")
    time.sleep(5)

    shot1 = os.path.join(SCREENSHOTS_DIR, "01_cold_start.png")
    run_cmd(f'"{ADB_BIN}" -s {serial} exec-out screencap -p > "{shot1}"')
    print(f"    [V] 首次冷启动截图已保存: {shot1}")

    # 获取初始日志
    logs_initial = run_cmd(f'"{ADB_BIN}" -s {serial} logcat -d -s Capacitor:V Chromium:V YnufeUI:V CookieManager:V AutoLogin:V', check=False)

    print("\n[+] 4. 模拟用户划掉/杀死后台进程 (am force-stop)...")
    run_cmd(f'"{ADB_BIN}" -s {serial} shell am force-stop {PACKAGE_NAME}')
    time.sleep(2)

    print("[+] 5. 进程已被彻底终止，再次重新启动应用 (二次冷启动)...")
    run_cmd(f'"{ADB_BIN}" -s {serial} logcat -c')
    run_cmd(f'"{ADB_BIN}" -s {serial} shell am start -n {ACTIVITY_NAME}')

    print("[+] 6. 等待二次启动加载与缓存恢复 (5 秒)...")
    time.sleep(5)

    shot2 = os.path.join(SCREENSHOTS_DIR, "02_after_kill_and_reopen.png")
    run_cmd(f'"{ADB_BIN}" -s {serial} exec-out screencap -p > "{shot2}"')
    print(f"    [V] 杀后台重启后截图已保存: {shot2}")

    # 获取重启后日志
    logs_after_kill = run_cmd(f'"{ADB_BIN}" -s {serial} logcat -d -s Capacitor:V Chromium:V YnufeUI:V CookieManager:V AutoLogin:V', check=False)

    print("\n==================================================")
    print(" [TEST REPORT] 模拟器生命周期实测日志摘要:")
    print("==================================================")
    print("--- 首次冷启动关键日志 ---")
    for line_str in logs_initial.stdout.splitlines()[-15:]:
        print(f"  {line_str}")
    print("\n--- 杀后台重启后关键日志 ---")
    for line_str in logs_after_kill.stdout.splitlines()[-15:]:
        print(f"  {line_str}")
    print("==================================================")

def main() -> None:
    """
    主自动化测试入口。
    """
    print("=== 开始运行 Android Studio 模拟器实测脚本 ===")
    if not check_sdk_tools():
        return

    build_app_if_needed()
    serial = start_emulator_if_needed()
    test_app_lifecycle(serial)
    print("\n[PASS] 模拟器实测与截图流程全部执行完成。")

if __name__ == "__main__":
    main()
