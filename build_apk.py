import os
import shutil
import subprocess

project_dir = os.path.dirname(os.path.abspath(__file__))

try:
    print("0. Installing npm dependencies (if needed)...")
    subprocess.run("npm install", shell=True, cwd=project_dir, check=True)

    print("1. Running TypeScript type-check + Vite build...")
    # 使用 package.json 的 build 脚本（tsc && vite build），确保类型错误不会被静默打进 APK
    subprocess.run("npm run build", shell=True, cwd=project_dir, check=True)

    print("2. Syncing compiled dist/ web assets & plugins to Android project...")
    subprocess.run("npx cap sync", shell=True, cwd=project_dir, check=True)

    print("3. Compiling Android APK via Gradle...")
    android_dir = os.path.join(project_dir, "android")
    subprocess.run("gradlew.bat assembleDebug", shell=True, cwd=android_dir, check=True)

    print("4. Copying compiled APK to root...")
    src_apk = os.path.join(android_dir, "app", "build", "outputs", "apk", "debug", "app-debug.apk")
    dest_apk = os.path.join(project_dir, "云财学子.apk")
    shutil.copy2(src_apk, dest_apk)

    print(f"\nSUCCESS! Build completed. APK is ready at: {dest_apk}")
except Exception as e:
    print(f"\nERROR occurred: {e}")
