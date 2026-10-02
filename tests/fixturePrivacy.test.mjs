import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { requireRedactionIdentity, redactFixture } from './fixturePrivacy.mjs';

for (const identity of [{}, { YNUFE_REAL_NAME: '测试姓名' }, { YNUFE_REAL_ID: '200000001' }]) {
    assert.throws(() => requireRedactionIdentity(identity), /必须同时设置/);
    const env = { ...process.env, YNUFE_COOKIE: 'JSESSIONID=DUMMY_SESSION' };
    delete env.YNUFE_REAL_NAME;
    delete env.YNUFE_REAL_ID;
    Object.assign(env, identity);
    const result = spawnSync(process.execPath, ['tests/capture-fixtures.mjs'], { env, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /必须同时设置/);
    assert.ok(!result.stdout.includes('✓'), '隐私参数缺失时应在联网和写文件之前退出');
    assert.ok(!result.stderr.includes('DUMMY_SESSION'));
}
const identity = requireRedactionIdentity({ YNUFE_REAL_NAME: '虚构同学', YNUFE_REAL_ID: '209999999' });
const input = '虚构同学 209999999 JSESSIONID=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA; jsxsd=209999999';
const cleaned = redactFixture(input, identity);
assert.ok(!cleaned.includes(identity.name) && !cleaned.includes(identity.studentId));
assert.ok(!cleaned.includes('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'));
console.log('[PASS] Fixture capture rejects incomplete privacy settings and removes session identifiers');
