import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const out = resolve('tests/.build/native-http.mjs');
await build({ entryPoints: ['src/api/client.ts'], outfile: out, bundle: true, platform: 'node', format: 'esm' });
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.document = { cookie: '' };
const seen = [];
const native = async options => {
    assert.equal(options.connectTimeout, 15000);
    assert.equal(options.readTimeout, 15000);
    seen.push(options);
    return { status: 200, headers: { 'Content-Type': 'image/png' }, url: options.url,
        data: options.responseType === 'blob' ? 'QQ==' : '<html>business page</html>' };
};
globalThis.window = { location: { origin: 'http://localhost', hostname: 'localhost', port: '' },
    Capacitor: { isNativePlatform: () => true, Plugins: { CapacitorHttp: { get: native, post: native } } } };
try {
    const { YnufeClient } = await import(pathToFileURL(out).href);
    await YnufeClient.getHtml('/jsxsd/example');
    await YnufeClient.postForm('/jsxsd/example', { value: 'test' });
    assert.equal((await YnufeClient.getBlob('/jsxsd/file')).blob.size, 1);
    assert.equal((await YnufeClient.getCaptchaBlob()).size, 1);
    assert.equal(seen.length, 4);
    console.log('[PASS] All native HTML/form/download/captcha requests have connection and read deadlines');
} finally { rmSync(out, { force: true }); }
