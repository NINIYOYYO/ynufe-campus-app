export function requireRedactionIdentity(env) {
    const name = env.YNUFE_REAL_NAME?.trim();
    const studentId = env.YNUFE_REAL_ID?.trim();
    if (!name || !studentId) {
        throw new Error('抓取前必须同时设置 YNUFE_REAL_NAME 和 YNUFE_REAL_ID，禁止写入未脱敏页面');
    }
    return { name, studentId };
}

export function redactFixture(html, identity) {
    return html.split(identity.name).join('张三')
        .split(identity.studentId).join('200000000000')
        .replace(/JSESSIONID\s*[=:]\s*[a-z0-9_-]+/gi, 'JSESSIONID=REDACTED_SESSION')
        .replace(/jsxsd\s*=\s*\d+/gi, 'jsxsd=REDACTED_ID');
}
