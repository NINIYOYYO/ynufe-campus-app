import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { DOMParser } from 'linkedom';
import { readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const out = resolve('tests/.build/campus-timetable.mjs');
await build({ stdin: { contents: `
export { TimetableParser } from './src/parsers/timetableParser';
export { TimetableView } from './src/views/timetableView';
export { ReminderScheduler } from './src/services/reminderScheduler';
export { NotificationManager } from './src/services/notificationManager';
export { CacheService } from './src/services/cacheService';
export { YnufeClient } from './src/api/client';
export { ServiceView } from './src/views/serviceView';
`, resolveDir: process.cwd(), loader: 'ts' }, outfile: out, bundle: true, platform: 'node', format: 'esm', external: ['@capacitor/core'] });
globalThis.DOMParser = DOMParser;
const store = new Map();
globalThis.localStorage = { getItem: key => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)), removeItem: key => store.delete(key) };
globalThis.document = new DOMParser().parseFromString(`<html><body>
<select id="select-semester"></select><select id="select-week"></select><select id="select-time-mode"></select>
<div id="today-courses-list"></div><span id="home-week-badge"></span>
<div class="timetable-grid">${Array.from({ length: 7 }, (_, i) => `<div class="grid-time-cell"><span></span><small></small></div><div class="grid-course-slot" data-day="3" data-session="${i + 1}"></div>`).join('')}</div>
<select id="query-xq"><option value="E298641275B7471181C291FA9BC76452" selected>安宁</option></select>
</body></html>`, 'text/html');
globalThis.window = document.defaultView;
globalThis.HTMLElement = window.HTMLElement;
globalThis.HTMLSelectElement = window.HTMLSelectElement;
Object.defineProperty(window.HTMLElement.prototype, 'innerText', {
    configurable: true, get() { return this.textContent; }, set(value) { this.textContent = value; },
});
window.Capacitor = { isNativePlatform: () => true };
globalThis.MutationObserver = window.MutationObserver;
globalThis.requestAnimationFrame = fn => fn();
const RealDate = Date;
let now = new RealDate('2026-09-30T10:00:00+08:00').getTime();
globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
};
const anning = '49FBA90C4D064812908BAB02593318B2';
const south = 'C8B3C60AE20444B499A15ABFA3ECFF9D';
const modes = (mode) => `<select id="kbjcmsid"><option value="0">全部</option><option value="${south}" ${mode === south ? 'selected' : ''}>南院模式</option><option value="${anning}" ${mode === anning ? 'selected' : ''}>安宁校区</option></select>`;
function timetable(mode) {
    const start = mode === anning ? '08:20-09:50' : '08:00-09:30';
    const afternoon = mode === anning ? '14:00-16:20' : '14:30-16:00';
    const groups = [['第一大节', start, [1, 2]], ['第二大节', '10:10-12:30', [3, 4, 5]],
        ['第三大节', afternoon, [6, 7, 8]], ['第四大节', '16:40-18:10', [9, 10]], ['第五大节', '19:00-21:20', [11, 12, 13]]];
    return `<select id="xnxq01id"><option value="2026-2027-1" selected>2026-2027-1</option></select>
        <select id="zc"><option value="5" selected>第5周</option></select>${modes(mode)}<table id="kbtable">${groups.map(([name, time, slots]) => slots.map(slot => `<tr><th>${name}<br>${time}</th><th>第${slot}节</th>
        <td><div class="kbcontent" id="${slot}_3_2">${[6, 7].includes(slot) ? '虚构课程<br><font title="教师">模拟老师</font><br><font title="教室">测试教室</font><br><font title="周次(节次)">1-16(周)[06-08节]</font>' : ''}</div></td></tr>`).join('')).join('')}</table>`;
}
const schedules = [];
let cancelled = 0;
try {
    const { TimetableParser, TimetableView, ReminderScheduler, NotificationManager, CacheService, YnufeClient, ServiceView } = await import(pathToFileURL(out).href);
    NotificationManager.setPluginForTest({ requestPermissions: async () => ({ display: 'granted' }),
        getPending: async () => ({ notifications: [{ id: 60000 }] }),
        cancel: async () => { cancelled++; }, schedule: async value => schedules.push(value) });
    localStorage.setItem('ynufe_notify_enabled', 'true');
    const html = timetable(anning);
    const parsed = TimetableParser.parseTimetable(html);
    assert.equal(parsed.timeModeId, anning);
    assert.equal(parsed.sessionTimes[0].start, '08:20');
    assert.deepEqual(parsed.sessionTimes[2].slots, [6, 7, 8]);
    assert.equal(parsed.courses.length, 2);
    assert.ok(parsed.courses.every(course => course.session === 3));
    const notices = ReminderScheduler.computeTimetableReminders(parsed, { now: new Date(), leadMinutes: 15, daysAhead: 2 });
    assert.equal(notices.length, 1, '三小节大节中重复的课程只能排一次提醒');
    assert.equal(notices[0].fireAt.getHours(), 13);
    assert.equal(notices[0].fireAt.getMinutes(), 45);
    TimetableView.renderTimetableData(parsed);
    assert.match(document.getElementById('today-courses-list').textContent, /14:00/);
    assert.equal(document.querySelectorAll('.grid-time-cell')[2].querySelector('span').textContent, '6-8节');
    let endpoint;
    YnufeClient.getHtml = async value => { endpoint = value; return html; };
    assert.equal(await TimetableView.reloadTimetableFromServer('', true, anning), true);
    assert.match(endpoint, /kbjcmsid=49FBA90C4D064812908BAB02593318B2/);
    assert.equal(CacheService.get('ynufe_timetable_time_mode'), anning);
    assert.ok(CacheService.get('ynufe_timetable_cache').week1MondayIso, '同步时必须先固化日期再写缓存');
    YnufeClient.getHtml = async () => html.replace(`value="${anning}" selected`, `value="${anning}"`);
    assert.equal(await TimetableView.reloadTimetableFromServer('', true, south), false);
    assert.equal(CacheService.get('ynufe_timetable_time_mode'), anning, '失败不能保存新模式');
    let resolveOld;
    YnufeClient.getHtml = value => value.includes(anning) ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve(timetable(south));
    const old = TimetableView.reloadTimetableFromServer('', true, anning);
    const newest = TimetableView.reloadTimetableFromServer('', true, south);
    assert.equal(await newest, true);
    resolveOld(html);
    assert.equal(await old, false);
    assert.equal(TimetableView.currentTimetableData.timeModeId, south);
    assert.equal(CacheService.get('ynufe_timetable_time_mode'), south);
    const legacy = { currentWeek: 5, courses: [{ ...parsed.courses[0], day: 5, activeWeeks: [5] }] };
    CacheService.set('ynufe_timetable_cache', legacy);
    assert.equal(await NotificationManager.rescheduleFromTimetable(legacy), 1);
    now = new RealDate('2026-10-07T10:00:00+08:00').getTime();
    assert.equal(await NotificationManager.rescheduleFromTimetable(CacheService.get('ynufe_timetable_cache')), 0,
        '一周后不能把已结束的第5周课程移到第6周');
    const beforeCancel = cancelled;
    await NotificationManager.rescheduleFromTimetable({ courses: [], semesters: [] });
    assert.ok(cancelled > beforeCancel, '无课的新模式必须取消旧课表提醒');
    assert.equal(await NotificationManager.rescheduleFromTimetable({ ...parsed, timeModeId: '0' }), -2,
        '未选择校区时不能按混合模式的默认作息排程提醒');
    let payload;
    YnufeClient.postForm = async (_path, body) => { payload = body; return readFileSync('tests/fixtures/empty_classroom.html', 'utf8'); };
    await ServiceView.handleClassroomQuery({ preventDefault() {} });
    assert.equal(payload.kbjcmsid, anning, '安宁空教室查询必须传安宁时间模式');
    console.log('[PASS] Campus parsing, display, switching, race protection, persisted reminders and classroom query');
} finally {
    globalThis.Date = RealDate;
    rmSync(out, { force: true });
}
