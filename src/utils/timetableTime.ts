import { AppConfig } from '../config';
import { TimetableData, TimetableSessionTime } from '../types/timetable';

/** New responses use the school's schedule; only legacy caches use the old fallback. */
export function getSessionTime(data: TimetableData | null | undefined, session: number): TimetableSessionTime | undefined {
    // 全部模式混合校区，学校返回的默认行头不能当作每门课的准确作息。
    if (data?.timeModeId === '0') return undefined;
    if (data?.sessionTimes !== undefined) return data.sessionTimes.find(time => time.session === session);
    const time = AppConfig.SESSION_TIMES[session - 1];
    return time ? { ...time, session, slots: [session * 2 - 1, session * 2] } : undefined;
}

export function formatSessionSlots(time: TimetableSessionTime): string {
    const slots = [...new Set(time.slots)].sort((a, b) => a - b);
    if (!slots.length) return `第${time.session}大节`;
    return `${slots[0]}${slots.length > 1 ? `-${slots[slots.length - 1]}` : ''}节`;
}
