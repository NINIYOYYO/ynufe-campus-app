"""Verify the signed release artifact before uploading it."""
import os
import subprocess
import sys
from pathlib import Path

sdk = Path(os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT') or '')
name = 'apksigner.bat' if sys.platform.startswith('win') else 'apksigner'
tools = sorted((sdk / 'build-tools').glob('*/' + name))
if not tools:
    raise SystemExit('Android apksigner is unavailable')
subprocess.run([str(tools[-1]), 'verify', '--verbose', sys.argv[1]], check=True)
