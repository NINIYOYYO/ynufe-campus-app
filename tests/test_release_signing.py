"""Check fail-closed release builds without invoking Gradle or exposing keys."""
import importlib.util
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('build_apk', Path(__file__).resolve().parents[1] / 'build_apk.py')
build_apk = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(build_apk)


class ReleaseSigningTests(unittest.TestCase):
    def test_missing_key_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {}, clear=True), patch.object(build_apk, 'ANDROID_DIR', directory), self.assertRaises(RuntimeError):
            build_apk.validate_release_signing()

    def test_configured_nonexistent_key_is_rejected(self):
        env = dict.fromkeys(('ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD'), 'dummy')
        env['ANDROID_KEYSTORE_PATH'] = '/missing-test-release-key.jks'
        with patch.dict(os.environ, env, clear=True), self.assertRaises(FileNotFoundError):
            build_apk.validate_release_signing()

    def test_supplied_key_is_accepted(self):
        with tempfile.NamedTemporaryFile() as key:
            env = dict.fromkeys(('ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD'), 'dummy')
            env['ANDROID_KEYSTORE_PATH'] = key.name
            with patch.dict(os.environ, env, clear=True):
                build_apk.validate_release_signing()

    def test_local_properties_can_configure_signing(self):
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, 'keystore.properties').write_text('# local signing configuration', encoding='utf-8')
            with patch.dict(os.environ, {}, clear=True), patch.object(build_apk, 'ANDROID_DIR', directory):
                build_apk.validate_release_signing()


if __name__ == '__main__':
    unittest.main()
