"""Decode a configured release keystore without printing signing material."""
import base64
import os
from pathlib import Path


def main():
    names = ("ANDROID_KEYSTORE_BASE64", "ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD")
    missing = [name for name in names if not os.environ.get(name)]
    if missing:
        raise SystemExit("Missing repository signing secrets: " + ", ".join(missing))
    destination = Path(os.environ["ANDROID_KEYSTORE_PATH"])
    destination.write_bytes(base64.b64decode(os.environ["ANDROID_KEYSTORE_BASE64"], validate=True))
    destination.chmod(0o600)


if __name__ == "__main__":
    main()
