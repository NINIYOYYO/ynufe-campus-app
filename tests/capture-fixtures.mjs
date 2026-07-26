/**
 * 抓取教务网真实响应，脱敏后存为解析器回归测试的 fixture。
 *
 * 这些页面含个人信息（姓名/学号/成绩），因此不随仓库分发，需要开发者本地生成一次：
 *
 *   1. 浏览器登录 https://xjwis.ynufe.edu.cn/jsxsd/ ，从开发者工具复制 Cookie
 *   2. set YNUFE_COOKIE=JSESSIONID=...; jsxsd=...     (PowerShell: $env:YNUFE_COOKIE="...")
 *   3. npm run capture:fixtures
 *
 * 脚本会把姓名与学号替换为占位值后再落盘。会话很快过期，重跑一次即可。
 */
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'fixtures');
const HOST = 'https://xjwis.ynufe.edu.cn';

const COOKIE = process.env.YNUFE_COOKIE;
if (!COOKIE) {
    console.error('缺少 YNUFE_COOKIE 环境变量。用法见本文件顶部注释。');
    process.exit(1);
}

/** 当前学年学期，可用 YNUFE_TERM 覆盖 */
const TERM = process.env.YNUFE_TERM || '2025-2026-2';
/** 空教室查询用的节次配置 GUID，需与 src/config.ts 保持一致 */
const KBJCMSID = process.env.YNUFE_KBJCMSID || 'C8B3C60AE20444B499A15ABFA3ECFF9D';

/** 脱敏规则：真实姓名与学号 → 占位值。按需追加。 */
const REDACTIONS = [
    [process.env.YNUFE_REAL_NAME, '张三'],
    [process.env.YNUFE_REAL_ID, '200000000000'],
].filter(([from]) => !!from);

/**
 * 请求单个教务网页面。
 *
 * Args:
 *     endpoint (string): 以 /jsxsd 开头的路径。
 *     body (object|null): 传入对象则以表单 POST，否则 GET。
 *
 * Returns:
 *     Promise<string>: 响应正文。
 */
async function fetchPage(endpoint, body = null) {
    const headers = {
        Cookie: COOKIE,
        Referer: `${HOST}/jsxsd/framework/xsMain.jsp`,
        'User-Agent': 'Mozilla/5.0',
    };
    const init = { method: body ? 'POST' : 'GET', headers, redirect: 'manual' };
    if (body) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        init.body = new URLSearchParams(body).toString();
    }
    const resp = await fetch(HOST + endpoint, init);
    return await resp.text();
}

const roomQuery = (zc, xq, jc, jc2) => ({
    typewhere: 'jszq', xnxqh: TERM, xqbh: '1', jslx: '',
    zc, zc2: zc, xq, xq2: xq, jc, jc2, kbjcmsid: KBJCMSID,
});

const TARGETS = [
    ['profile', '/jsxsd/framework/xsMain_new.jsp?t1=1', null],
    ['timetable', `/jsxsd/xskb/xskb_list.do?xnxq01id=${encodeURIComponent(TERM)}`, null],
    ['grades', '/jsxsd/kscj/cjcx_list?xsfs=all', null],
    ['level_grades', '/jsxsd/kscj/djkscj_list', null],
    ['announcements', '/jsxsd/ggly/ysgg_query', null],
    ['thesis', '/jsxsd/bysj/xsyxxt.do', null],
    ['course_select', '/jsxsd/xsxk/xklc_list', null],
    ['exams_list', '/jsxsd/xsks/xsksap_list', { xnxqid: TERM, xqlb: '3', xqlbmc: '期末' }],
    ['stk_list', '/jsxsd/xsks/xsstk_list', { xnxqid: TERM, xqlb: '', xqlbmc: '' }],
    // 空教室三种时段，用于校验「◆ = 占用」的判定极性
    ['empty_classroom', '/jsxsd/kbxx/jsjy_query2', roomQuery('1', '1', '1', '2')],
    ['ec_multi', '/jsxsd/kbxx/jsjy_query2', roomQuery('1', '1', '1', '4')],
    ['ec_sunday', '/jsxsd/kbxx/jsjy_query2', roomQuery('1', '7', '9', '10')],
];

mkdirSync(OUT, { recursive: true });

let failed = 0;
for (const [name, endpoint, body] of TARGETS) {
    try {
        let html = await fetchPage(endpoint, body);

        if (/sys\/login\.jsp|LoginToXkLdap|SYSTEM_LOGIN/.test(html)) {
            console.error(`  ✗ ${name}: 会话已过期，请重新复制 Cookie`);
            failed++;
            continue;
        }
        for (const [from, to] of REDACTIONS) html = html.split(from).join(to);

        writeFileSync(join(OUT, `${name}.html`), html, 'utf-8');
        console.log(`  ✓ ${name.padEnd(16)} ${String(html.length).padStart(7)} chars`);
    } catch (e) {
        console.error(`  ✗ ${name}: ${e.message}`);
        failed++;
    }
}

console.log(
    failed === 0
        ? '\nfixture 抓取完成，现在可以运行 npm run test:parsers'
        : `\n有 ${failed} 个 fixture 抓取失败`
);
if (REDACTIONS.length === 0) {
    console.warn('注意：未设置 YNUFE_REAL_NAME / YNUFE_REAL_ID，fixture 中仍含真实姓名与学号，请勿提交到公开仓库。');
}
process.exit(failed === 0 ? 0 : 1);
