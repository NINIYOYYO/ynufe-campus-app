import { UserProfile } from '../types/profile';

/**
 * 云南财经大学教务网个人学籍 DOM 解析器 (.middletopdwxxcont)
 */
export class ProfileParser {
    static parseProfile(htmlStr: string): UserProfile {
        const profile: UserProfile = {
            name: "未登录",
            dept: "-",
            major: "-",
            className: "-",
            studentId: "-"
        };

        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlStr, "text/html");

        // 云南财经大学教务网框架页 xsMain_new.jsp 的专属个人信息节点
        const details = doc.querySelectorAll(".middletopdwxxcont");
        if (details.length >= 6) {
            profile.name = details[1].textContent?.trim() || "未登录";
            profile.studentId = details[2].textContent?.trim() || "-";
            profile.dept = details[3].textContent?.trim() || "-";
            profile.major = details[4].textContent?.trim() || "-";
            profile.className = details[5].textContent?.trim() || "-";
            return profile;
        }

        // 备用兼容正则解析
        const nameMatch = htmlStr.match(/姓名[：:]\s*([^<&\s]+)/);
        if (nameMatch) profile.name = nameMatch[1];

        const idMatch = htmlStr.match(/学号[：:]\s*([^<&\s]+)/);
        if (idMatch) profile.studentId = idMatch[1];

        const deptMatch = htmlStr.match(/院系[：:]\s*([^<&\s]+)/);
        if (deptMatch) profile.dept = deptMatch[1];

        const majorMatch = htmlStr.match(/专业[：:]\s*([^<&\s]+)/);
        if (majorMatch) profile.major = majorMatch[1];

        const classMatch = htmlStr.match(/班级[：:]\s*([^<&\s]+)/);
        if (classMatch) profile.className = classMatch[1];

        return profile;
    }

    /**
     * 从教务网首页框架解析"当前教学周"。
     *
     * 课表页 (xskb_list.do) 的周次下拉默认停在"(全部)"且不带 selected 属性，
     * 无法据此判断当前是第几教学周；真正的教学周信息在首页 #li_showWeek 里，
     * 形如"第 12 周"；假期期间则显示"当前日期不在教学周历内"。
     *
     * Args:
     *     htmlStr (string): /jsxsd/framework/xsMain_new.jsp 响应的 HTML。
     *
     * Returns:
     *     number | undefined: 当前教学周序号；不在教学周历内时返回 undefined。
     */
    static parseCurrentWeek(htmlStr: string): number | undefined {
        const doc = new DOMParser().parseFromString(htmlStr, "text/html");
        const box = doc.querySelector("#li_showWeek") || doc.querySelector(".middletopleftzc");

        const scopes = [box?.textContent || "", htmlStr];
        for (const text of scopes) {
            if (!text) continue;
            if (text.includes("不在教学周历内")) return undefined;

            const m = text.match(/第\s*(\d+)\s*周/);
            if (m) {
                const week = parseInt(m[1], 10);
                if (!isNaN(week) && week > 0 && week <= 30) return week;
            }
        }
        return undefined;
    }
}
