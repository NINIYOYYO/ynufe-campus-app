// 云财教务系统 (强智 jsxsd) 手机端全解耦核心业务逻辑 app.js

// 动态检测运行环境：若是本地调试则使用本地代理，如果是打包后的手机 App 则直连学校公网
const BASE_URL = (window.Capacitor || (window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1"))
    ? "https://xjwis.ynufe.edu.cn"
    : window.location.origin;

// 密码加密混淆逻辑 (与学校 conwork.js 的算法完全一致)
function encodeInp(input) {
    const keyStr = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
    let output = "";
    let i = 0;
    do {
        let chr1 = input.charCodeAt(i++);
        let chr2 = input.charCodeAt(i++);
        let chr3 = input.charCodeAt(i++);
        
        let enc1 = chr1 >> 2;
        let enc2 = ((chr1 & 3) << 4) | (chr2 >> 4);
        let enc3 = isNaN(chr2) ? 64 : (((chr2 & 15) << 2) | (chr3 >> 6));
        let enc4 = isNaN(chr3) ? 64 : (chr3 & 63);
        
        output = output + keyStr.charAt(enc1) + keyStr.charAt(enc2) + keyStr.charAt(enc3) + keyStr.charAt(enc4);
    } while (i < input.length);
    return output;
}

// 全局内存缓存，用于避免二次请求并实现快速过滤搜索
let globalTimetable = [];
let globalGrades = [];

/**
 * 1. 会话管理器 (YnufeSession)
 * 职责：管理本地存储中的账号密码加密以及登录会话状态缓存。
 */
class YnufeSession {
    static getUsername() {
        return localStorage.getItem("ynufe_username") || "";
    }

    static getPassword() {
        return localStorage.getItem("ynufe_password") || "";
    }

    static getRememberMe() {
        return localStorage.getItem("ynufe_remember") !== "false";
    }

    static saveCredentials(username, password, remember) {
        if (remember) {
            localStorage.setItem("ynufe_username", username);
            localStorage.setItem("ynufe_password", password);
            localStorage.setItem("ynufe_remember", "true");
        } else {
            localStorage.removeItem("ynufe_username");
            localStorage.removeItem("ynufe_password");
            localStorage.setItem("ynufe_remember", "false");
        }
    }

    static setHasSession(hasSession) {
        localStorage.setItem("ynufe_has_session", hasSession ? "true" : "false");
    }

    static getHasSession() {
        return localStorage.getItem("ynufe_has_session") === "true";
    }

    static clearSession() {
        localStorage.removeItem("ynufe_has_session");
        localStorage.removeItem("ynufe_cached_profile");
        localStorage.removeItem("ynufe_cached_timetable_data");
        localStorage.removeItem("ynufe_cached_grades_data");
        localStorage.removeItem("ynufe_cached_exams");
        localStorage.removeItem("ynufe_cached_announcements");
    }
}


/**
 * 2. 网络通信模块 (YnufeClient)
 * 职责：统一封装 fetch 异步网络请求，附带跨越环境配置，拦截会话失效。
 */
class YnufeClient {
    static async request(endpoint, options = {}) {
        const url = `${BASE_URL}${endpoint}`;
        
        // 在打包 App/WebView 下，系统会自动管理并保存 Cookie (credentials: 'include')
        const defaultOptions = {
            credentials: 'include',
            ...options
        };

        try {
            const response = await fetch(url, defaultOptions);
            if (response.status === 401 || response.status === 403) {
                this.handleSessionTimeout();
                throw new Error("会话过期或无访问权限");
            }
            return response;
        } catch (error) {
            console.error(`Fetch request to ${endpoint} failed:`, error);
            throw error;
        }
    }

    static async getHtml(endpoint) {
        const response = await this.request(endpoint);
        const html = await response.text();
        
        // 防御性校验：如果教务系统把请求重定向到了登录页，说明 Session 已过期
        if (html.includes("sys/login.jsp") || html.includes("非法访问") || html.includes("请重新登录")) {
            this.handleSessionTimeout();
            throw new Error("登录会话已失效");
        }
        return html;
    }

    static async postForm(endpoint, paramsObject) {
        const formData = new URLSearchParams();
        for (const [key, val] of Object.entries(paramsObject)) {
            formData.append(key, val);
        }

        const response = await this.request(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: formData.toString()
        });
        return await response.text();
    }

    static handleSessionTimeout() {
        YnufeSession.clearSession();
        // 如果处于后台静默同步状态，忽略弹出登录失效的拦截，保持当前离线缓存的展示
        if (typeof YnufeUI !== 'undefined' && YnufeUI.isSilentSync) {
            console.warn("Session expired during silent background sync. Ignoring event dispatch.");
            return;
        }
        window.dispatchEvent(new Event("ynufe-session-expired"));
    }
}


/**
 * 3. 数据解析引擎 (YnufeParser)
 * 职责：纯粹的解析器（无状态）。接收 HTML 字符串，通过 DOMParser 转换并抽取结构化 JSON。与 DOM 彻底解耦。
 */
class YnufeParser {
    // 实例化文档解析器
    static getDoc(html) {
        return new DOMParser().parseFromString(html, "text/html");
    }

    // A. 解析个人基本学籍信息
    static parseProfile(html) {
        const doc = this.getDoc(html);
        const details = doc.querySelectorAll(".middletopdwxxcont");
        if (details.length >= 6) {
            return {
                name: details[1].innerText.trim(),
                id: details[2].innerText.trim(),
                dept: details[3].innerText.trim(),
                major: details[4].innerText.trim(),
                class: details[5].innerText.trim()
            };
        }
        return null;
    }

    // B. 解析学期列表、周次及课程数据
    static parseTimetable(html) {
        const doc = this.getDoc(html);
        
        // 1. 提取可选学期列表
        const semesters = [];
        const semSelect = doc.querySelector("select#xnxq01id");
        if (semSelect) {
            semSelect.querySelectorAll("option").forEach(opt => {
                semesters.push({
                    val: opt.value,
                    txt: opt.text.trim(),
                    selected: opt.selected
                });
            });
        }

        // 2. 提取周次列表
        const weeks = [];
        const weekSelect = doc.querySelector("select#zc");
        if (weekSelect) {
            weekSelect.querySelectorAll("option").forEach(opt => {
                if (opt.value) {
                    weeks.push({ val: opt.value, txt: opt.text.trim() });
                }
            });
        }

        // 3. 提取详细课程表数据
        const courses = [];
        const kbTable = doc.querySelector("table#kbtable");
        if (kbTable) {
            const divs = kbTable.querySelectorAll("div.kbcontent");
            divs.forEach(div => {
                const divId = div.id; 
                const parts = divId.split("_");
                if (parts.length >= 2) {
                    const slotIndex = parseInt(parts[0]);
                    const dayOfWeek = parseInt(parts[1]);
                    const courseText = div.innerHTML;
                    const name = div.childNodes[0].textContent.trim();
                    if (!name || name === "&nbsp;") return;
                    
                    const teacherMatch = courseText.match(/老师['"]?>([^<]+)/);
                    const roomMatch = courseText.match(/教室['"]?>([^<]+)/);
                    const weeksMatch = courseText.match(/周次\(节次\)['"]?>([^<]+)/);
                    const codeMatch = courseText.match(/通知单编号['"]?>([^<]+)/) || courseText.match(/课程编号['"]?>([^<]+)/);
                    
                    const teacher = teacherMatch ? teacherMatch[1].trim() : "未知";
                    const room = roomMatch ? roomMatch[1].trim() : "未知";
                    const weeksStr = weeksMatch ? weeksMatch[1].trim() : "未知";
                    const code = codeMatch ? codeMatch[1].trim() : "-";
                    const isOptional = !courseText.includes("color='red'");
                    
                    // 辅助解析周次区间
                    const activeWeeks = [];
                    const cleanWeeks = weeksStr.replace("(周)", "").trim();
                    cleanWeeks.split(",").forEach(part => {
                        if (part.includes("-")) {
                            const range = part.split("-").map(Number);
                            if (range.length === 2) {
                                for (let i = range[0]; i <= range[1]; i++) activeWeeks.push(i);
                            }
                        } else {
                            const single = Number(part);
                            if (!isNaN(single)) activeWeeks.push(single);
                        }
                    });

                    courses.push({
                        name,
                        teacher,
                        room,
                        weeks: weeksStr,
                        code,
                        day: dayOfWeek,
                        slot: slotIndex,
                        session: Math.ceil(slotIndex / 2),
                        isOptional,
                        activeWeeks
                    });
                }
            });
        }

        return { semesters, weeks, courses };
    }

    // C. 解析期末考试成绩
    static parseGrades(html) {
        const doc = this.getDoc(html);
        
        // 1. 解析头部的总平均绩点与总学分
        const headerText = doc.body ? doc.body.innerText : "";
        const gpaMatch = headerText.match(/平均学分绩点:([\d.]+)/);
        const creditMatch = headerText.match(/所修总学分:([\d.]+)/);
        
        const gpa = gpaMatch ? parseFloat(gpaMatch[1]) : 0.00;
        const totalCredits = creditMatch ? parseFloat(creditMatch[1]) : 0.0;

        // 2. 遍历成绩表格提取课程名细
        const grades = [];
        const semesters = new Set();
        const dataTable = doc.querySelector("table#dataList");
        
        if (dataTable) {
            const rows = dataTable.querySelectorAll("tr");
            for (let i = 1; i < rows.length; i++) {
                const tds = rows[i].querySelectorAll("td");
                if (tds.length >= 10) {
                    const semester = tds[1].innerText.trim();
                    const courseId = tds[2].innerText.trim();
                    const courseName = tds[3].innerText.trim();
                    const scoreLink = tds[5].querySelector("a");
                    const score = scoreLink ? scoreLink.innerText.trim() : tds[5].innerText.trim();
                    const credit = parseFloat(tds[7].innerText.trim());
                    const hours = tds[8].innerText.trim();
                    const point = tds[9].innerText.trim();
                    const category = tds[13].innerText.trim();
                    
                    semesters.add(semester);
                    grades.push({
                        semester,
                        courseId,
                        name: courseName,
                        score,
                        credit,
                        hours,
                        point,
                        category
                    });
                }
            }
        }

        return {
            gpa,
            totalCredits,
            semesters: Array.from(semesters).sort().reverse(),
            grades
        };
    }

    // D. 解析等级考试成绩 (社会类英语四六级等)
    static parseLevelGrades(html) {
        const doc = this.getDoc(html);
        const levelGrades = [];
        const dataTable = doc.querySelector("table#dataList") || doc.querySelector("table.Nsb_r_list");
        
        if (dataTable) {
            const rows = dataTable.querySelectorAll("tr");
            for (let i = 1; i < rows.length; i++) {
                const tds = rows[i].querySelectorAll("td");
                if (tds.length >= 6) {
                    levelGrades.push({
                        term: tds[1].innerText.trim(),
                        code: tds[2].innerText.trim(),
                        name: tds[3].innerText.trim(),
                        score: tds[5].innerText.trim(),
                        date: tds[4] ? tds[4].innerText.trim() : "-"
                    });
                }
            }
        }
        return levelGrades;
    }

    // E. 解析期末考试安排
    static parseExams(html) {
        const doc = this.getDoc(html);
        const exams = [];
        const dataTable = doc.querySelector("table#dataList") || doc.querySelector("table.Nsb_r_list");
        
        if (dataTable) {
            const rows = dataTable.querySelectorAll("tr");
            for (let i = 1; i < rows.length; i++) {
                const tds = rows[i].querySelectorAll("td");
                if (tds.length >= 8) {
                    exams.push({
                        term: tds[1].innerText.trim(),
                        name: tds[3].innerText.trim(),
                        date: tds[4].innerText.trim(), // 考试日期
                        room: tds[5].innerText.trim(), // 考场教室
                        seatNo: tds[6].innerText.trim(), // 座位号
                        type: tds[7].innerText.trim()  // 考试形式(正常/缓考)
                    });
                }
            }
        }
        return exams;
    }

    // F. 解析随堂考试查询
    static parseClassroomTests(html) {
        const doc = this.getDoc(html);
        const tests = [];
        const dataTable = doc.querySelector("table#dataList") || doc.querySelector("table.Nsb_r_list");
        
        if (dataTable) {
            const rows = dataTable.querySelectorAll("tr");
            for (let i = 1; i < rows.length; i++) {
                const tds = rows[i].querySelectorAll("td");
                if (tds.length >= 6) {
                    tests.push({
                        name: tds[2].innerText.trim(),
                        date: tds[3].innerText.trim(),
                        room: tds[4].innerText.trim(),
                        type: tds[5] ? tds[5].innerText.trim() : "普通"
                    });
                }
            }
        }
        return tests;
    }

    // G. 解析选课中心活动列表
    static parseXkCenter(html) {
        const doc = this.getDoc(html);
        const activities = [];
        const tables = doc.querySelectorAll("table");
        
        tables.forEach(table => {
            const rows = table.querySelectorAll("tr");
            // 排除表头，遍历选课活动
            for (let i = 1; i < rows.length; i++) {
                const tds = rows[i].querySelectorAll("td");
                if (tds.length >= 5) {
                    const name = tds[0].innerText.trim();
                    const type = tds[1].innerText.trim();
                    const startTime = tds[2].innerText.trim();
                    const endTime = tds[3].innerText.trim();
                    
                    // 获取点击链接
                    const actionLink = tds[4].querySelector("a");
                    const status = actionLink ? actionLink.innerText.trim() : "未开放";
                    const url = actionLink ? actionLink.getAttribute("href") : "";
                    
                    activities.push({
                        name,
                        type,
                        timeRange: `${startTime} ~ ${endTime}`,
                        status,
                        url
                    });
                }
            }
        });
        return activities;
    }

    // H. 解析公告通知列表
    static parseAnnouncements(html) {
        const doc = this.getDoc(html);
        const announces = [];
        const dataTable = doc.querySelector("table#dataList") || doc.querySelector("table.Nsb_r_list");
        
        if (dataTable) {
            const rows = dataTable.querySelectorAll("tr");
            for (let i = 1; i < rows.length; i++) {
                const tds = rows[i].querySelectorAll("td");
                if (tds.length >= 3) {
                    const link = tds[1].querySelector("a");
                    announces.push({
                        title: link ? link.innerText.trim() : tds[1].innerText.trim(),
                        date: tds[2].innerText.trim(),
                        url: link ? link.getAttribute("href") : ""
                    });
                }
            }
        }
        return announces;
    }

    // I. 解析毕业设计与实践环节
    static parsePractice(html) {
        const doc = this.getDoc(html);
        
        // 毕业设计防崩溃校验：如果页面中没有找到毕业设计的关键元素，或者出现了“非法访问/无此模块”
        if (html.includes("未进入毕业环节") || html.includes("无权访问") || !doc.querySelector("table")) {
            return { empty: true, msg: "您目前处于非毕业设计阶段" };
        }
        
        // 尝试抓取毕业设计的开题与论文情况
        const table = doc.querySelector("table");
        const rows = table.querySelectorAll("tr");
        let title = "未选题";
        let report = "未提交";
        let count = "0次";
        let grade = "-";
        
        if (rows.length >= 2) {
            // 结构化抽取各属性列（具体行通常根据强智毕业设计的首页确定）
            const textContent = table.innerText;
            const titleMatch = textContent.match(/课题名称[:：]\s*([^\n]+)/);
            const reportMatch = textContent.match(/开题报告[:：]\s*([^\n]+)/);
            const countMatch = textContent.match(/过程指导[:：]\s*(\d+次)/);
            const gradeMatch = textContent.match(/最终成绩[:：]\s*([^\n]+)/);
            
            if (titleMatch) title = titleMatch[1].trim();
            if (reportMatch) report = reportMatch[1].trim();
            if (countMatch) count = countMatch[1].trim();
            if (gradeMatch) grade = gradeMatch[1].trim();
        }

        return {
            empty: false,
            title,
            report,
            guidanceCount: count,
            grade
        };
    }
}


/**
 * 4. 视图渲染与业务控制引擎 (YnufeUI)
 * 职责：调度 YnufeClient 获取 HTML 页面并回传 YnufeParser；接着控制 DOM 进行流畅的界面显示。
 */
class YnufeUI {
    static heartbeatIntervalId = null;
    static isSilentSync = false;

    // 动态更新顶栏数据同步状态指示标签
    static updateSyncStatus(status, text) {
        const tag = document.getElementById("sync-status-tag");
        if (!tag) return;
        tag.className = `sync-tag ${status}`;
        const textDom = tag.querySelector(".sync-text");
        if (textDom) textDom.innerText = text;
    }

    // 缓存离线数据读取与还原
    static loadCachedData() {
        try {
            // 1. 恢复个人信息
            const cachedProfile = localStorage.getItem("ynufe_cached_profile");
            if (cachedProfile) {
                const profile = JSON.parse(cachedProfile);
                document.getElementById("user-name-display").innerText = profile.name;
                document.getElementById("profile-dept").innerText = profile.dept;
                document.getElementById("profile-major").innerText = profile.major;
                document.getElementById("profile-class").innerText = profile.class;
                document.getElementById("profile-id").innerText = profile.id;
                
                const hr = new Date().getHours();
                document.getElementById("time-greeting").innerText = hr < 12 ? "早上好," : (hr < 18 ? "下午好," : "晚上好,");
                document.getElementById("today-date-str").innerText = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
            }

            // 2. 恢复课程表
            const cachedTimetableData = localStorage.getItem("ynufe_cached_timetable_data");
            if (cachedTimetableData) {
                const timetableData = JSON.parse(cachedTimetableData);
                this.renderTimetableData(timetableData);
            }

            // 3. 恢复期末成绩
            const cachedGradesData = localStorage.getItem("ynufe_cached_grades_data");
            if (cachedGradesData) {
                const gradesData = JSON.parse(cachedGradesData);
                this.renderGradesData(gradesData);
            }

            // 4. 恢复考试安排
            const cachedExams = localStorage.getItem("ynufe_cached_exams");
            if (cachedExams) {
                const exams = JSON.parse(cachedExams);
                this.renderExamsList(exams);
            }
            
            // 5. 恢复公告通知
            const cachedAnnouncements = localStorage.getItem("ynufe_cached_announcements");
            if (cachedAnnouncements) {
                const announces = JSON.parse(cachedAnnouncements);
                this.renderAnnouncementsList(announces);
            }
            
            return !!cachedProfile;
        } catch (e) {
            console.error("加载本地离线缓存数据失败:", e);
            return false;
        }
    }

    // 渲染课程表核心组件 (支持下拉框填充、今日课表及完整课表渲染)
    static renderTimetableData(data, semesterId = "") {
        if (!data) return;
        globalTimetable = data.courses;

        // 填充学期下拉列表
        if (!semesterId) {
            const semSelect = document.getElementById("select-semester");
            if (semSelect) {
                semSelect.innerHTML = "";
                data.semesters.forEach(sem => {
                    const opt = document.createElement("option");
                    opt.value = sem.val;
                    opt.text = sem.txt;
                    opt.selected = sem.selected;
                    semSelect.appendChild(opt);
                });
            }
        }

        // 填充筛选周次下拉列表
        const weekSelect = document.getElementById("select-week");
        if (weekSelect) {
            weekSelect.innerHTML = '<option value="">全部周</option>';
            data.weeks.forEach(wk => {
                const opt = document.createElement("option");
                opt.value = wk.val;
                opt.text = wk.txt;
                weekSelect.appendChild(opt);
            });
        }

        // 渲染今日课程列表 (主页)
        this.renderTodayCoursesList(globalTimetable);
        // 渲染完整课表表格 (课表页)
        this.reloadTimetable();
    }

    // 渲染历史成绩核心数据 (支持总成绩卡片、学期下拉框、二级成绩卡片过滤)
    static renderGradesData(data) {
        if (!data) return;
        
        globalGrades = data.grades;

        // 渲染总览数据
        const gpaVal = document.getElementById("gpa-val");
        const gpaProgress = document.getElementById("gpa-progress-bar");
        const creditVal = document.getElementById("credit-val");
        const creditProgress = document.getElementById("credit-progress-bar");

        if (gpaVal) gpaVal.innerText = data.gpa.toFixed(2);
        if (gpaProgress) gpaProgress.setAttribute("stroke-dasharray", `${Math.min((data.gpa/5.0)*100, 100).toFixed(1)}, 100`);
        if (creditVal) creditVal.innerText = data.totalCredits.toFixed(1);
        if (creditProgress) creditProgress.setAttribute("stroke-dasharray", `${Math.min((data.totalCredits/150)*100, 100).toFixed(1)}, 100`);

        // 填充期末成绩学期下拉框
        const selectDom = document.getElementById("select-grade-semester");
        if (selectDom) {
            selectDom.innerHTML = '<option value="">全部学期</option>';
            
            // 填充考试选课板块的考试安排学期下拉框
            const selectExamSem = document.getElementById("select-exam-semester");
            if (selectExamSem) selectExamSem.innerHTML = "";

            data.semesters.forEach(sem => {
                const opt = document.createElement("option");
                opt.value = sem; opt.text = sem;
                selectDom.appendChild(opt);

                if (selectExamSem) {
                    const optExam = document.createElement("option");
                    optExam.value = sem; optExam.text = sem;
                    selectExamSem.appendChild(optExam);
                }
            });
        }

        this.filterGrades();
    }

    // 渲染排考列表卡片
    static renderExamsList(list) {
        const container = document.getElementById("exams-term-list");
        if (!container) return;
        container.innerHTML = "";
        
        if (list.length === 0) {
            container.innerHTML = `<div class="empty-state"><p>本学期该类型考试暂无排考数据</p></div>`;
            return;
        }

        list.forEach(ex => {
            const card = document.createElement("div");
            card.className = "exam-card glass-card";
            card.innerHTML = `
                <div class="exam-title">
                    <span>${ex.name}</span>
                    <span class="exam-badge">${ex.type}</span>
                </div>
                <div class="exam-info-grid">
                    <div class="info-item full-width">
                        <small>考试时间</small>
                        <span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px; vertical-align: middle;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>${ex.date}</span>
                    </div>
                    <div class="info-item">
                        <small>考场教室</small>
                        <span class="highlight">${ex.room}</span>
                    </div>
                    <div class="info-item">
                        <small>座位号</small>
                        <span class="highlight" style="color:var(--primary-color);">第 ${ex.seatNo} 号</span>
                    </div>
                </div>
            `;
            container.appendChild(card);
        });
    }

    // 渲染系统公告卡片列表 (前 5 条)
    static renderAnnouncementsList(list) {
        const container = document.getElementById("home-announcements-list");
        if (!container) return;
        container.innerHTML = "";
        
        if (list.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
                    <p>暂无新公告</p>
                </div>`;
            return;
        }

        list.slice(0, 5).forEach(ann => {
            const card = document.createElement("div");
            card.className = "announce-card glass-card";
            card.innerHTML = `
                <div class="announce-left">
                    <div class="announce-title">${ann.title}</div>
                    <div class="announce-date"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px; vertical-align: middle;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>${ann.date}</div>
                </div>
                <div style="color:var(--text-secondary); display:flex; align-items:center;">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                </div>
            `;
            card.addEventListener("click", () => this.showAnnouncementDetail(ann));
            container.appendChild(card);
        });
    }

    static init() {
        this.bindEvents();
        this.listenSessionEvents();
        this.initWallpaperSystem();
        
        if (YnufeSession.getHasSession()) {
            this.startHeartbeat();
        }
    }

    // ==================== 壁纸与个性化系统 ====================
    // ==================== 壁纸与个性化系统 ====================
    // ==================== 壁纸与个性化系统 ====================
    static initWallpaperSystem() {
        // 1. 加载并应用本地缓存壁纸与主题模式
        const savedPreset = localStorage.getItem("ynufe_wallpaper_preset") || "obsidian";
        const customWallpaper = localStorage.getItem("ynufe_custom_wallpaper");
        this.applyWallpaper(savedPreset, customWallpaper);

        const savedTheme = localStorage.getItem("ynufe_theme") || "dark";
        this.applyTheme(savedTheme);

        // 控制手势微调按钮容器的显隐
        const adjustSec = document.getElementById("wallpaper-adjust-section");
        if (adjustSec) {
            if (savedPreset === "custom" && customWallpaper) {
                adjustSec.style.display = "block";
            } else {
                adjustSec.style.display = "none";
            }
        }

        // 2. 绑定打开设置抽屉
        const btnSettings = document.getElementById("btn-settings");
        if (btnSettings) {
            btnSettings.addEventListener("click", () => this.openSettingsSheet());
        }

        // 3. 绑定关闭设置抽屉 (点击遮罩)
        const settingsOverlay = document.getElementById("settings-overlay");
        if (settingsOverlay) {
            settingsOverlay.addEventListener("click", () => this.closeSettingsSheet());
        }

        // 4. 绑定本地相册图片上传与压缩监听
        const fileInput = document.getElementById("wallpaper-file-input");
        if (fileInput) {
            fileInput.addEventListener("change", (e) => {
                if (e.target.files && e.target.files[0]) {
                    this.handleWallpaperUpload(e.target.files[0]);
                }
            });
        }

        // 5. 绑定恢复默认背景点击事件
        const btnResetWallpaper = document.getElementById("btn-reset-wallpaper");
        if (btnResetWallpaper) {
            btnResetWallpaper.addEventListener("click", () => {
                localStorage.removeItem("ynufe_custom_wallpaper");
                localStorage.removeItem("ynufe_wallpaper_color"); // 移除自适应色彩持久化
                localStorage.removeItem("ynufe_wallpaper_blur"); // 移除模糊缓存
                localStorage.removeItem("ynufe_wallpaper_mask"); // 移除遮罩缓存
                localStorage.setItem("ynufe_wallpaper_preset", "obsidian");
                this.applyWallpaper("obsidian", null);
                
                // 重置手势缩放与位移
                window.dispatchEvent(new Event("ynufe_reset_wallpaper_transform"));

                if (adjustSec) {
                    adjustSec.style.display = "none";
                }

                const statusText = document.getElementById("upload-status-text");
                if (statusText) {
                    statusText.innerText = "背景及配色已成功恢复为默认宇宙曜黑！";
                    statusText.style.color = "var(--accent-color)";
                    setTimeout(() => {
                        statusText.innerText = "提示：支持自定义 JPG/PNG 壁纸，上传后将保存在本地，断网 and 刷新依旧生效";
                        statusText.style.color = "var(--text-secondary)";
                    }, 3000);
                }
            });
        }

        // 6. 绑定主题模式（浅色/深色）切换点击
        document.querySelectorAll(".theme-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                const themeName = btn.getAttribute("data-theme");
                this.applyTheme(themeName);
                localStorage.setItem("ynufe_theme", themeName);
            });
        });

        // 7. 初始化壁纸手势拖拽缩放机制
        this.initWallpaperGestureAdjust();

        // 8. 绑定壁纸优化微调无级滑块事件
        const sliderBlur = document.getElementById("slider-wallpaper-blur");
        const sliderMask = document.getElementById("slider-wallpaper-mask");
        const valBlur = document.getElementById("val-wallpaper-blur");
        const valMask = document.getElementById("val-wallpaper-mask");

        if (sliderBlur && valBlur) {
            sliderBlur.addEventListener("input", (e) => {
                const val = e.target.value;
                valBlur.innerText = val + "px";
                document.body.style.setProperty("--wallpaper-blur", val + "px");
                localStorage.setItem("ynufe_wallpaper_blur", val);
            });
        }

        if (sliderMask && valMask) {
            sliderMask.addEventListener("input", (e) => {
                const val = e.target.value;
                valMask.innerText = val + "%";
                document.body.style.setProperty("--wallpaper-mask-opacity", (parseFloat(val) / 100).toFixed(2));
                localStorage.setItem("ynufe_wallpaper_mask", val);
            });
        }
    }

    // === 手机级壁纸手势拖拽缩放机制 ===
    static initWallpaperGestureAdjust() {
        const adjustOverlay = document.getElementById("wallpaper-adjust-overlay");
        const btnEnterAdjust = document.getElementById("btn-enter-wallpaper-adjust");
        const btnSaveAdjust = document.getElementById("btn-save-wallpaper-adjust");
        const btnCancelAdjust = document.getElementById("btn-cancel-wallpaper-adjust");
        const imgEl = document.getElementById("wallpaper-img");

        if (!adjustOverlay || !btnEnterAdjust || !btnSaveAdjust || !btnCancelAdjust || !imgEl) {
            return;
        }

        // 当前壁纸状态机（缩放, 偏移X, 偏移Y）
        let transformState = {
            scale: 1.0,
            x: 0,
            y: 0
        };

        // 单指手势坐标
        let startX = 0;
        let startY = 0;
        let initialX = 0;
        let initialY = 0;
        let isDragging = false;

        // 双指手势参数
        let isPinching = false;
        let initialDistance = 0;
        let initialScale = 1.0;

        // 1. 读取本地持久化坐标并还原应用
        const loadSavedTransform = () => {
            const savedStateStr = localStorage.getItem("ynufe_wallpaper_transform");
            if (savedStateStr) {
                try {
                    transformState = JSON.parse(savedStateStr);
                    applyTransform();
                } catch(e) {
                    console.error("Failed to parse wallpaper transform:", e);
                }
            } else {
                transformState = { scale: 1.0, x: 0, y: 0 };
                applyTransform();
            }
        };

        // 2. 映射更新 CSS 特效
        const applyTransform = () => {
            imgEl.style.transform = `translate(${transformState.x}px, ${transformState.y}px) scale(${transformState.scale})`;
        };

        // 自动装载
        loadSavedTransform();

        // 监听图片加载完毕的异步渲染命令，防覆盖
        window.addEventListener("ynufe_apply_saved_transform", loadSavedTransform);

        // 备份变量（用于点取消时瞬间还原）
        let backupState = { ...transformState };

        // 3. 点击“进入裁剪/手势调整”模式
        btnEnterAdjust.addEventListener("click", (e) => {
            e.stopPropagation();
            backupState = { ...transformState };
            
            // 自动收起设置菜单，腾出全部操作视野
            this.closeSettingsSheet();

            // 显示手势遮罩与按钮
            adjustOverlay.style.display = "block";
        });

        // 4. 辅助函数：计算双指距离
        const getPinchDistance = (touches) => {
            const dx = touches[0].clientX - touches[1].clientX;
            const dy = touches[0].clientY - touches[1].clientY;
            return Math.sqrt(dx * dx + dy * dy);
        };

        // 5. 绑定触控和鼠标手势事件
        // (A) 触控开始
        adjustOverlay.addEventListener("touchstart", (e) => {
            if (e.touches.length === 1) {
                isDragging = true;
                isPinching = false;
                startX = e.touches[0].clientX;
                startY = e.touches[0].clientY;
                initialX = transformState.x;
                initialY = transformState.y;
            } else if (e.touches.length === 2) {
                isDragging = false;
                isPinching = true;
                initialDistance = getPinchDistance(e.touches);
                initialScale = transformState.scale;
            }
        });

        // (B) 触控滑动中 (核心位移与缩放阻尼)
        adjustOverlay.addEventListener("touchmove", (e) => {
            e.preventDefault(); // 阻止滚动回弹，锁死页面滚动
            if (isDragging && e.touches.length === 1) {
                const dx = e.touches[0].clientX - startX;
                const dy = e.touches[0].clientY - startY;
                transformState.x = initialX + dx;
                transformState.y = initialY + dy;
                applyTransform();
            } else if (isPinching && e.touches.length === 2) {
                const currentDistance = getPinchDistance(e.touches);
                if (initialDistance > 0) {
                    const factor = currentDistance / initialDistance;
                    // 缩放范围限制在 0.5 到 5.0 倍
                    transformState.scale = Math.min(Math.max(initialScale * factor, 0.5), 5.0);
                    applyTransform();
                }
            }
        });

        // (C) 触控松开
        adjustOverlay.addEventListener("touchend", () => {
            isDragging = false;
            isPinching = false;
        });

        // (D) 鼠标事件 (兼容 PC 端调试与访问)
        adjustOverlay.addEventListener("mousedown", (e) => {
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            initialX = transformState.x;
            initialY = transformState.y;
        });

        adjustOverlay.addEventListener("mousemove", (e) => {
            if (isDragging) {
                const dx = e.clientX - startX;
                const dy = e.clientY - startY;
                transformState.x = initialX + dx;
                transformState.y = initialY + dy;
                applyTransform();
            }
        });

        window.addEventListener("mouseup", () => {
            isDragging = false;
        });

        // (E) 滚轮滚动缩放 (PC 专用)
        adjustOverlay.addEventListener("wheel", (e) => {
            e.preventDefault();
            const factor = e.deltaY < 0 ? 1.05 : 0.95;
            transformState.scale = Math.min(Math.max(transformState.scale * factor, 0.5), 5.0);
            applyTransform();
        }, { passive: false });

        // 6. 保存与取消绑定
        btnSaveAdjust.addEventListener("click", () => {
            localStorage.setItem("ynufe_wallpaper_transform", JSON.stringify(transformState));
            adjustOverlay.style.display = "none";
            this.openSettingsSheet(); // 重新展开菜单
        });

        btnCancelAdjust.addEventListener("click", () => {
            transformState = { ...backupState };
            applyTransform();
            adjustOverlay.style.display = "none";
            this.openSettingsSheet(); // 重新展开菜单
        });

        // 7. 全局重置位置事件监听
        window.addEventListener("ynufe_reset_wallpaper_transform", () => {
            transformState = { scale: 1.0, x: 0, y: 0 };
            applyTransform();
            localStorage.removeItem("ynufe_wallpaper_transform");
        });

        // 8. 监听窗口 resize 自动重排尺寸
        window.addEventListener("resize", () => {
            YnufeApp.setupWallpaperImageDimensions();
        });
    }

    // 计算壁纸图片在手机屏幕比例下的最合适无损尺寸（防预剪切）
    static setupWallpaperImageDimensions() {
        const imgEl = document.getElementById("wallpaper-img");
        if (!imgEl || imgEl.style.display === "none") return;

        const sw = window.innerWidth;
        const sh = window.innerHeight;
        const nw = imgEl.naturalWidth || 1080;
        const nh = imgEl.naturalHeight || 1920;

        const screenRatio = sw / sh;
        const imgRatio = nw / nh;
        let w, h;

        if (imgRatio > screenRatio) {
            // 说明图片太宽（横屏风景照），则高度撑满屏幕，宽度按比例溢出
            h = sh;
            w = sh * imgRatio;
        } else {
            // 说明图片太高，则宽度撑满屏幕，高度按比例溢出
            w = sw;
            h = sw / imgRatio;
        }

        imgEl.style.width = w + "px";
        imgEl.style.height = h + "px";
        imgEl.style.marginLeft = -(w / 2) + "px";
        imgEl.style.marginTop = -(h / 2) + "px";
    }

    static applyTheme(themeName) {
        document.body.classList.remove("theme-dark", "theme-light");
        document.body.classList.add(`theme-${themeName}`);

        document.querySelectorAll(".theme-btn").forEach(btn => {
            if (btn.getAttribute("data-theme") === themeName) {
                btn.classList.add("active");
            } else {
                btn.classList.remove("active");
            }
        });

        // 切换主题时，若有自定义壁纸，自动重新调校其冷暖明暗主导色，保证可读性
        this.applyAdaptiveWallpaperColor(themeName);
        this.applyWallpaperTuneValues();
    }

    static applyWallpaper(presetName, customBase64) {
        // 过滤清理所有旧的壁纸相关 class
        document.body.className = document.body.className
            .split(" ")
            .filter(c => !c.startsWith("preset-") && c !== "has-custom-wallpaper")
            .join(" ");

        const imgEl = document.getElementById("wallpaper-img");
        const adjustSec = document.getElementById("wallpaper-adjust-section");
        const tuneSec = document.getElementById("wallpaper-tune-section");

        if (presetName === "custom" && customBase64) {
            if (imgEl) {
                imgEl.src = customBase64;
                imgEl.style.display = "block";
                imgEl.onload = () => {
                    this.setupWallpaperImageDimensions();
                    // 在图片尺寸重算就绪后，应用并恢复用户保存的缩放与平移坐标
                    window.dispatchEvent(new Event("ynufe_apply_saved_transform"));
                };
            }
            document.body.classList.add("has-custom-wallpaper");
            
            // 标记所有的 preset 项为未选中状态
            document.querySelectorAll(".preset-item").forEach(p => p.classList.remove("active"));

            if (adjustSec) adjustSec.style.display = "block";
            if (tuneSec) tuneSec.style.display = "block";

            // 动态注入壁纸主色强调色与微调值
            this.applyAdaptiveWallpaperColor();
            this.applyWallpaperTuneValues();
        } else {
            if (imgEl) {
                imgEl.src = "";
                imgEl.style.display = "none";
            }
            document.body.classList.add(`preset-${presetName}`);

            // 同步预设卡片的选中状态
            document.querySelectorAll(".preset-item").forEach(p => {
                if (p.getAttribute("data-preset") === `preset-${presetName}`) {
                    p.classList.add("active");
                } else {
                    p.classList.remove("active");
                }
            });

            if (adjustSec) adjustSec.style.display = "none";
            if (tuneSec) tuneSec.style.display = "none";

            // 清除自适应壁纸强调色与微调值
            this.clearAdaptiveWallpaperColor();
            this.applyWallpaperTuneValues();
        }
    }

    // 动态载入并应用无级高斯模糊和遮罩透明度参数 (防背景人物抢戏)
    static applyWallpaperTuneValues() {
        const savedPreset = localStorage.getItem("ynufe_wallpaper_preset") || "obsidian";
        const body = document.body;
        
        if (savedPreset !== "custom") {
            body.style.removeProperty("--wallpaper-blur");
            body.style.removeProperty("--wallpaper-mask-opacity");
            return;
        }

        const savedBlur = localStorage.getItem("ynufe_wallpaper_blur") || "0";
        const defaultMask = "60";
        const savedMask = localStorage.getItem("ynufe_wallpaper_mask") || defaultMask;
        
        body.style.setProperty("--wallpaper-blur", savedBlur + "px");
        body.style.setProperty("--wallpaper-mask-opacity", (parseFloat(savedMask) / 100).toFixed(2));

        const sliderBlur = document.getElementById("slider-wallpaper-blur");
        const sliderMask = document.getElementById("slider-wallpaper-mask");
        const valBlur = document.getElementById("val-wallpaper-blur");
        const valMask = document.getElementById("val-wallpaper-mask");

        if (sliderBlur && valBlur) {
            sliderBlur.value = savedBlur;
            valBlur.innerText = savedBlur + "px";
        }
        if (sliderMask && valMask) {
            sliderMask.value = savedMask;
            valMask.innerText = savedMask + "%";
        }
    }

    // 依据本地存储壁纸主色，动态向 body 节点写入对应的强调色 RGB 变量
    static applyAdaptiveWallpaperColor(themeName) {
        const savedPreset = localStorage.getItem("ynufe_wallpaper_preset") || "obsidian";
        if (savedPreset !== "custom") return;

        const savedColorStr = localStorage.getItem("ynufe_wallpaper_color");
        if (!savedColorStr) return;

        try {
            const rgb = JSON.parse(savedColorStr);
            let r = rgb.r;
            let g = rgb.g;
            let b = rgb.b;

            const body = document.body;
            const currentTheme = themeName || (body.classList.contains("theme-light") ? "light" : "dark");

            if (currentTheme === "light") {
                // 浅色模式白底：采用等比缩放向量算法，压暗高分量以满足对比度，同时100%保留色彩原本色相
                const maxVal = Math.max(r, g, b);
                const targetMax = 135;
                const k = maxVal > targetMax ? targetMax / maxVal : 1.0;
                const darkR = Math.round(r * k);
                const darkG = Math.round(g * k);
                const darkB = Math.round(b * k);
                body.style.setProperty("--primary-color-rgb", `${darkR}, ${darkG}, ${darkB}`);
                body.style.setProperty("--wallpaper-dark-rgb", `240, 243, 250`);
            } else {
                // 深色模式：保持主色鲜艳发光
                body.style.setProperty("--primary-color-rgb", `${r}, ${g}, ${b}`);

                // 根据提取到的壁纸主色，计算出专属的暗调基色 (约 22% 亮度)，让卡片底色全自动变成壁纸的暗色偏向！
                const cardDarkR = Math.round(r * 0.22 + 8);
                const cardDarkG = Math.round(g * 0.22 + 8);
                const cardDarkB = Math.round(b * 0.22 + 8);
                body.style.setProperty("--wallpaper-dark-rgb", `${cardDarkR}, ${cardDarkG}, ${cardDarkB}`);
            }
        } catch(e) {
            console.error("Failed to parse wallpaper color:", e);
        }
    }

    // 清除自适应壁纸色彩设定，还原 CSS 原生配置的强调色
    static clearAdaptiveWallpaperColor() {
        document.body.style.removeProperty("--primary-color-rgb");
        document.body.style.removeProperty("--wallpaper-dark-rgb");
    }

    static handleWallpaperUpload(file) {
        if (!file.type.startsWith("image/")) {
            alert("请选择有效的图片文件！");
            return;
        }

        const statusText = document.getElementById("upload-status-text");
        statusText.innerText = "正在读取并进行高保真压缩...";
        statusText.style.color = "var(--warning-color)";

        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (e) => {
            const img = new Image();
            img.src = e.target.result;
            img.onload = () => {
                const canvas = document.createElement("canvas");
                const ctx = canvas.getContext("2d");

                const MAX_WIDTH = 1080;
                const MAX_HEIGHT = 1080;
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > MAX_WIDTH) {
                        height *= MAX_WIDTH / width;
                        width = MAX_WIDTH;
                    }
                } else {
                    if (height > MAX_HEIGHT) {
                        width *= MAX_HEIGHT / height;
                        height = MAX_HEIGHT;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                ctx.drawImage(img, 0, 0, width, height);

                // 压缩为 JPEG，保留 0.7 质量，完美兼顾画质与大小（通常产出 100KB+）
                const compressedBase64 = canvas.toDataURL("image/jpeg", 0.7);

                // === 智能壁纸主导色提取 (Material You 级 32x32 1024 点 HSL 直方图加权聚类) ===
                const miniCanvas = document.createElement('canvas');
                miniCanvas.width = 32;
                miniCanvas.height = 32;
                const miniCtx = miniCanvas.getContext('2d');
                miniCtx.drawImage(canvas, 0, 0, 32, 32);
                const imgData = miniCtx.getImageData(0, 0, 32, 32).data;

                // 准备 24 个 HSL 色相桶 (Buckets)
                const buckets = Array.from({ length: 24 }, () => ({ score: 0, sumR: 0, sumG: 0, sumB: 0, count: 0 }));
                let totalR = 0, totalG = 0, totalB = 0, validPixelCount = 0;

                for (let i = 0; i < 1024; i++) {
                    const rVal = imgData[i * 4];
                    const gVal = imgData[i * 4 + 1];
                    const bVal = imgData[i * 4 + 2];

                    totalR += rVal;
                    totalG += gVal;
                    totalB += bVal;
                    validPixelCount++;

                    // RGB 转 HSL
                    const rPct = rVal / 255;
                    const gPct = gVal / 255;
                    const bPct = bVal / 255;
                    const max = Math.max(rPct, gPct, bPct);
                    const min = Math.min(rPct, gPct, bPct);
                    let h = 0, s = 0, l = (max + min) / 2;

                    if (max !== min) {
                        const d = max - min;
                        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
                        switch (max) {
                            case rPct: h = (gPct - bPct) / d + (gPct < bPct ? 6 : 0); break;
                            case gPct: h = (bPct - rPct) / d + 2; break;
                            case bPct: h = (rPct - gPct) / d + 4; break;
                        }
                        h /= 6;
                    }

                    // 过滤掉过暗(死黑)、过亮(纯白)或极无颜色的死灰色
                    if (l > 0.12 && l < 0.88 && s > 0.12) {
                        const hueDegree = h * 360;
                        const bucketIdx = Math.floor(hueDegree / 15) % 24; // 24 个 15 度的色相桶
                        
                        // 权重公式：结合饱和度与舒适亮度得分
                        const lightnessWeight = 1 - Math.abs(l - 0.5) * 1.2;
                        const pixelScore = s * Math.max(0.2, lightnessWeight);

                        buckets[bucketIdx].score += pixelScore;
                        buckets[bucketIdx].sumR += rVal;
                        buckets[bucketIdx].sumG += gVal;
                        buckets[bucketIdx].sumB += bVal;
                        buckets[bucketIdx].count++;
                    }
                }

                // 寻找得分最高的主色调桶
                let bestBucket = null;
                let maxScore = -1;
                for (let b of buckets) {
                    if (b.count > 0 && b.score > maxScore) {
                        maxScore = b.score;
                        bestBucket = b;
                    }
                }

                let bestColor = { r: 59, g: 130, b: 246 }; // 默认苹果蓝
                if (bestBucket && bestBucket.count > 0) {
                    bestColor = {
                        r: Math.round(bestBucket.sumR / bestBucket.count),
                        g: Math.round(bestBucket.sumG / bestBucket.count),
                        b: Math.round(bestBucket.sumB / bestBucket.count)
                    };
                } else if (validPixelCount > 0) {
                    // 如果全图都是完全没有饱和度的黑白灰图像，降级使用全局均值
                    bestColor = {
                        r: Math.round(totalR / validPixelCount),
                        g: Math.round(totalG / validPixelCount),
                        b: Math.round(totalB / validPixelCount)
                    };
                }

                try {
                    localStorage.setItem("ynufe_custom_wallpaper", compressedBase64);
                    localStorage.setItem("ynufe_wallpaper_preset", "custom");
                    localStorage.setItem("ynufe_wallpaper_color", JSON.stringify(bestColor)); // 存储主色调

                    this.applyWallpaper("custom", compressedBase64);

                    // 上传成功后显示手势调整按钮区，并自动触发一次位置重置
                    const adjustSec = document.getElementById("wallpaper-adjust-section");
                    if (adjustSec) {
                        adjustSec.style.display = "block";
                    }
                    window.dispatchEvent(new Event("ynufe_reset_wallpaper_transform"));

                    statusText.innerText = "自定义壁纸已成功保存，强调色已自适应同步变幻！✨";
                    statusText.style.color = "var(--accent-color)";
                } catch (err) {
                    console.error("Localstorage quota exceeded:", err);
                    statusText.innerText = "保存失败，照片过大或浏览器配额不足，请更换较小照片！";
                    statusText.style.color = "var(--error-color)";
                }
            };
        };
        reader.onerror = () => {
            statusText.innerText = "读取图片失败，请重试！";
            statusText.style.color = "var(--error-color)";
        };
    }

    static openSettingsSheet() {
        document.getElementById("settings-sheet").classList.add("active");
        document.getElementById("app-container").style.filter = "blur(8px)";
    }

    static closeSettingsSheet() {
        document.getElementById("settings-sheet").classList.remove("active");
        document.getElementById("app-container").style.filter = "none";
    }

    // 后台智能心跳包保活，每隔 2 分钟发起一次极轻请求，防止强智教务网 Tomcat 自动断开
    static startHeartbeat() {
        if (this.heartbeatIntervalId) {
            clearInterval(this.heartbeatIntervalId);
        }
        
        this.heartbeatIntervalId = setInterval(async () => {
            if (!YnufeSession.getHasSession()) {
                clearInterval(this.heartbeatIntervalId);
                this.heartbeatIntervalId = null;
                return;
            }
            try {
                console.log("[Keep-Alive] 发送后台心跳请求，维持教务会话活跃状态...");
                // 请求教务网主框架进行保活。
                // 如果 Session 已过期，YnufeClient 会拦截并抛出过期事件，自动触发退登弹窗。
                await YnufeClient.request("/jsxsd/framework/xsMain.jsp");
            } catch (err) {
                console.warn("[Keep-Alive] 心跳保活检测失败，会话可能已过期或断网:", err);
            }
        }, 120000); // 2 分钟 (120 秒) 为安全保活周期
    }

    static bindEvents() {
        // A. 全局登录表单
        document.getElementById("login-form").addEventListener("submit", (e) => this.handleLogin(e));
        
        // B. 验证码点击刷新
        document.getElementById("captcha-img").addEventListener("click", () => this.refreshCaptchaImg());
        
        // C. 退出系统
        document.getElementById("btn-logout").addEventListener("click", () => this.handleLogout());

        // C2. 顶部同步/离线状态指示微标签点击
        const syncTag = document.getElementById("sync-status-tag");
        if (syncTag) {
            syncTag.addEventListener("click", async () => {
                // 如果当前已经是最新状态，尝试轻量无感静默刷新，不直接弹登录框
                if (syncTag.classList.contains("online")) {
                    this.updateSyncStatus("syncing", "刷新中...");
                    const success = await this.loadHomeBusinessData();
                    if (success) {
                        this.updateSyncStatus("online", "数据已最新");
                    } else {
                        // 刷新失败 (Session 过期)，转为离线状态并唤起验证码补全框
                        this.updateSyncStatus("offline", "未同步 · 点击刷新");
                        document.getElementById("login-overlay").classList.add("active");
                        this.refreshCaptchaImg();
                    }
                    return;
                }

                // 若处于离线未同步或报错状态，弹出验证码输入框指引用户补打
                document.getElementById("login-overlay").classList.add("active");
                this.refreshCaptchaImg();
            });
        }

        // D. 底部大选项卡导航切换
        const navItems = document.querySelectorAll(".bottom-nav .nav-item");
        navItems.forEach(item => {
            item.addEventListener("click", () => {
                const targetTab = item.getAttribute("data-target");
                this.switchTab(targetTab);
                this.loadTabBusinessData(targetTab);
            });
        });

        // E. 二级子选项卡 (Sub-tabs) 点击切换
        const subTabButtons = document.querySelectorAll(".sub-tab-item");
        subTabButtons.forEach(btn => {
            btn.addEventListener("click", () => {
                const subParent = btn.parentNode;
                // 取消同级高亮
                subParent.querySelectorAll(".sub-tab-item").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                
                // 对应板块展示
                const targetSubId = btn.getAttribute("data-sub");
                const sectionContainer = btn.closest("section");
                if (sectionContainer) {
                    const contents = sectionContainer.querySelectorAll(".sub-tab-content");
                    contents.forEach(c => c.classList.remove("active"));
                }
                const targetContent = document.getElementById(targetSubId);
                if (targetContent) {
                    targetContent.classList.add("active");
                }
                
                // 加载子板块业务数据
                this.loadSubTabBusinessData(targetSubId);
            });
        });

        // F. 空教室查询表单
        document.getElementById("classroom-query-form").addEventListener("submit", (e) => this.handleClassroomQuery(e));

        // G. 课程底浮窗关闭
        document.getElementById("sheet-overlay").addEventListener("click", () => this.closeBottomSheet());
        document.querySelector(".sheet-handle").addEventListener("click", () => () => this.closeBottomSheet());
        
        // H. 课表选择框切换
        document.getElementById("select-semester").addEventListener("change", (e) => this.reloadTimetableFromServer(e.target.value));
        document.getElementById("select-week").addEventListener("change", () => this.reloadTimetable());

        // I. 成绩单查询切换与搜索
        document.getElementById("select-grade-semester").addEventListener("change", () => this.filterGrades());
        document.getElementById("input-grade-search").addEventListener("input", () => this.filterGrades());

        // J. 考试安排学期和类型切换
        document.getElementById("select-exam-semester").addEventListener("change", () => this.loadExamsData());
        document.getElementById("select-exam-type").addEventListener("change", () => this.loadExamsData());
    }

    static listenSessionEvents() {
        // 监听全局 Client 抛出的会话失效通知，统一退登并清理心跳定时器
        window.addEventListener("ynufe-session-expired", () => {
            if (this.heartbeatIntervalId) {
                clearInterval(this.heartbeatIntervalId);
                this.heartbeatIntervalId = null;
            }
            this.showLoading(false);
            alert("您的登录凭证已失效，请重新输入验证码登录！");
            document.getElementById("login-overlay").classList.add("active");
            this.refreshCaptchaImg();
        });
    }

    // 刷新验证码
    static async refreshCaptchaImg() {
        const captchaImg = document.getElementById("captcha-img");
        document.getElementById("captcha").value = "";
        
        const url = `${BASE_URL}/jsxsd/verifycode.servlet?t=${Math.random()}`;
        
        // 手机端 App 容器直连：必须使用 fetch 发送请求并转为 Blob URL，以确保验证码和登录 API 运行在相同的 CapacitorHttp 原生 Cookie 罐里 (维持 Session 会话一致)
        if (window.Capacitor) {
            try {
                const response = await fetch(url);
                if (response.ok) {
                    const blob = await response.blob();
                    // 释放旧的内存 Blob URL 避免泄漏
                    if (captchaImg.src && captchaImg.src.startsWith("blob:")) {
                        URL.revokeObjectURL(captchaImg.src);
                    }
                    captchaImg.src = URL.createObjectURL(blob);
                } else {
                    console.error("Fetch captcha response error:", response.status);
                    captchaImg.src = url; // 备用降级
                }
            } catch (err) {
                console.error("CapacitorHttp fetch captcha failed:", err);
                captchaImg.src = url; // 备用降级
            }
        } else {
            // PC 本地 Python 代理环境或普通浏览器运行
            captchaImg.src = url;
        }
    }

    // 控制全局加载指示层
    static showLoading(show, text = "正在拼命拉取教务网数据...") {
        const spinner = document.getElementById("loading-spinner");
        spinner.querySelector("p").innerText = text;
        if (show) spinner.classList.add("active");
        else spinner.classList.remove("active");
    }

    // 处理用户手动登录
    static async handleLogin(e) {
        e.preventDefault();
        const username = document.getElementById("username").value.trim();
        const pass = document.getElementById("password").value;
        const code = document.getElementById("captcha").value.trim();
        const remember = document.getElementById("remember-me").checked;
        const msgDiv = document.getElementById("login-msg");
        
        msgDiv.innerText = "";
        this.showLoading(true, "安全身份验证中...");

        try {
            // 加密数据并发送 POST 请求
            const key1 = encodeInp(username);
            const key2 = encodeInp(pass);
            const encoded = `${key1}%%%${key2}`;
            
            const responseText = await YnufeClient.postForm("/jsxsd/xk/LoginToXkLdap", {
                userAccount: username,
                userPassword: "",
                RANDOMCODE: code,
                encoded: encoded
            });

            if (responseText.includes("错误") || responseText.includes("验证码") || responseText.includes("提示：")) {
                const doc = YnufeParser.getDoc(responseText);
                msgDiv.innerText = doc.querySelector("h3") ? doc.querySelector("h3").innerText : "账户密码或验证码错误！";
                this.showLoading(false);
                this.refreshCaptchaImg();
                return;
            }

            // 登录成功，本地持久化
            YnufeSession.saveCredentials(username, pass, remember);
            YnufeSession.setHasSession(true);
            
            // 成功登录后立刻启动心跳保活系统
            this.startHeartbeat();

            // 加载主首页数据
            const profileLoaded = await this.loadHomeBusinessData();
            this.showLoading(false);

            if (profileLoaded) {
                this.updateSyncStatus("online", "数据已最新");
                document.getElementById("login-overlay").classList.remove("active");
            } else {
                msgDiv.innerText = "同步教务网数据异常，请重试！";
                this.refreshCaptchaImg();
            }

        } catch (err) {
            this.showLoading(false);
            console.error("Login request error details:", err);
            msgDiv.innerText = "网络超时，请确认手机已连接至校园网环境！";
            this.refreshCaptchaImg();
        }
    }

    // 退出系统处理
    static handleLogout() {
        if (confirm("确定要退出登录并清除会话吗？")) {
            YnufeSession.clearSession();
            window.location.reload();
        }
    }

    // SPA 大选项卡切换视图
    static switchTab(targetTabId) {
        document.querySelectorAll(".bottom-nav .nav-item").forEach(item => {
            if (item.getAttribute("data-target") === targetTabId) item.classList.add("active");
            else item.classList.remove("active");
        });

        document.querySelectorAll(".tab-content").forEach(tab => {
            if (tab.id === targetTabId) tab.classList.add("active");
            else tab.classList.remove("active");
        });
    }

    /**
     * 根据选项卡加载各自的专属数据
     */
    static async loadTabBusinessData(tabId) {
        if (tabId === "tab-home") {
            await this.loadHomeBusinessData();
        } else if (tabId === "tab-timetable") {
            await this.reloadTimetableFromServer();
        } else if (tabId === "tab-grades") {
            // 加载成绩大板块下当前的 active 二级子 Tab
            const activeSubId = document.querySelector("#tab-grades .sub-tab-item.active").getAttribute("data-sub");
            this.loadSubTabBusinessData(activeSubId);
        } else if (tabId === "tab-exams-xk") {
            const activeSubId = document.querySelector("#tab-exams-xk .sub-tab-item.active").getAttribute("data-sub");
            this.loadSubTabBusinessData(activeSubId);
        } else if (tabId === "tab-practice-services") {
            const activeSubId = document.querySelector("#tab-practice-services .sub-tab-item.active").getAttribute("data-sub");
            this.loadSubTabBusinessData(activeSubId);
        }
    }

    /**
     * 根据二级 Sub-Tab 加载二级板块数据
     */
    static async loadSubTabBusinessData(subTabId) {
        if (subTabId === "sub-grades-final") {
            if (globalGrades.length === 0) await this.loadFinalGradesData();
        } else if (subTabId === "sub-grades-level") {
            await this.loadLevelGradesData();
        } else if (subTabId === "sub-exams-term") {
            await this.loadExamsData();
        } else if (subTabId === "sub-exams-class") {
            await this.loadClassroomTestsData();
        } else if (subTabId === "sub-xk-center") {
            await this.loadXkCenterData();
        } else if (subTabId === "sub-services-room") {
            // 空教室页面，不需要主动拉取数据，用户输入条件点击查询即可
        } else if (subTabId === "sub-practice-thesis") {
            await this.loadPracticeData();
        }
    }

    // ==================== A. 首页模块业务 ====================
    static async loadHomeBusinessData() {
        try {
            const html = await YnufeClient.getHtml("/jsxsd/framework/xsMain_new.jsp?t1=1");
            const profile = YnufeParser.parseProfile(html);
            if (!profile) return false;

            // 渲染学籍资料
            document.getElementById("user-name-display").innerText = profile.name;
            document.getElementById("profile-dept").innerText = profile.dept;
            document.getElementById("profile-major").innerText = profile.major;
            document.getElementById("profile-class").innerText = profile.class;
            document.getElementById("profile-id").innerText = profile.id;

            // 写入本地持久化缓存
            localStorage.setItem("ynufe_cached_profile", JSON.stringify(profile));

            // 定制问候
            const hr = new Date().getHours();
            document.getElementById("time-greeting").innerText = hr < 12 ? "早上好," : (hr < 18 ? "下午好," : "晚上好,");
            document.getElementById("today-date-str").innerText = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });

            // 延迟一点异步载入今日课表与系统通知
            this.loadTimetableDataOnlyForToday(profile.id);
            this.loadAnnouncementsOnlyForHome();
            
            return true;
        } catch (e) {
            console.error("Home loading error:", e);
            return false;
        }
    }

    // 仅用于首页提取今日课表并持久化整份课表
    static async loadTimetableDataOnlyForToday() {
        try {
            const html = await YnufeClient.getHtml("/jsxsd/xskb/xskb_list.do");
            const data = YnufeParser.parseTimetable(html);
            if (data) {
                // 保存课表数据缓存
                localStorage.setItem("ynufe_cached_timetable_data", JSON.stringify(data));
                this.renderTimetableData(data);
            }
        } catch (e) {
            console.warn("Failed to load today's courses list:", e);
        }
    }

    // 渲染今日课表
    static renderTodayCoursesList(courses) {
        const listDom = document.getElementById("today-courses-list");
        listDom.innerHTML = "";
        
        let jsDay = new Date().getDay();
        let currentDay = jsDay === 0 ? 7 : jsDay; 
        
        const todayCourses = courses.filter(c => c.day === currentDay).sort((a, b) => a.slot - b.slot);
        
        if (todayCourses.length === 0) {
            listDom.innerHTML = `
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1"></path><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"></path><line x1="6" y1="2" x2="6" y2="4"></line><line x1="10" y1="2" x2="10" y2="4"></line><line x1="14" y1="2" x2="14" y2="4"></line></svg>
                    <p>今天没有课，享受你的空闲时间吧</p>
                </div>`;
            return;
        }

        todayCourses.forEach(c => {
            const timeRanges = ["08:00-09:30", "10:00-12:20", "14:30-16:00", "16:30-18:00", "19:00-20:30"];
            const card = document.createElement("div");
            card.className = "course-card-mini glass-card";
            card.innerHTML = `
                <div class="mini-left">
                    <div class="mini-name">${c.name}</div>
                    <div class="mini-meta">
                        <span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px; vertical-align: middle;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>${c.teacher}</span>
                        <span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px; vertical-align: middle;"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>${c.weeks}</span>
                    </div>
                </div>
                <div class="mini-right">
                    <div class="time-badge">${timeRanges[c.session - 1] || '第' + c.slot + '节'}</div>
                    <div class="room-badge">${c.room}</div>
                </div>
            `;
            card.addEventListener("click", () => this.showCourseDetail(c));
            listDom.appendChild(card);
        });
    }

    // 首页加载最新公告
    static async loadAnnouncementsOnlyForHome() {
        const container = document.getElementById("home-announcements-list");
        container.innerHTML = `<div class="empty-state"><p>正在获取公告...</p></div>`;
        try {
            // 获取通知公告 HTML
            const html = await YnufeClient.getHtml("/jsxsd/ggly/ysgg_query");
            const list = YnufeParser.parseAnnouncements(html);
            
            container.innerHTML = "";
            if (list.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
                        <p>暂无新公告</p>
                    </div>`;
                return;
            }

            list.slice(0, 5).forEach(ann => { // 首页只展示前 5 条
                const card = document.createElement("div");
                card.className = "announce-card glass-card";
                card.innerHTML = `
                    <div class="announce-left">
                        <div class="announce-title">${ann.title}</div>
                        <div class="announce-date"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px; vertical-align: middle;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>${ann.date}</div>
                    </div>
                    <div style="color:var(--text-secondary); display:flex; align-items:center;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                    </div>
                `;
                card.addEventListener("click", () => this.showAnnouncementDetail(ann));
                container.appendChild(card);
            });
        } catch (e) {
            container.innerHTML = `
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
                    <p>公告加载失败，请检查网络</p>
                </div>`;
        }
    }

    // 弹出层展示公告内容
    static showAnnouncementDetail(ann) {
        document.getElementById("sheet-title").innerText = "公告详情";
        document.getElementById("sheet-tag").innerText = "通知";
        
        const contentDom = document.getElementById("sheet-body-content");
        contentDom.innerHTML = `
            <div class="glass-card" style="padding: 16px; margin-bottom: 14px; background: var(--card-bg); border: 1px solid var(--card-border); box-shadow: var(--card-shadow);">
                <h3 style="color: var(--text-primary); font-size: 15px; font-weight: 600; margin-bottom: 10px; line-height: 1.5;">${ann.title}</h3>
                <div style="color: var(--text-secondary); font-size: 12px; display: flex; align-items: center; gap: 4px;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.8;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                    发布时间：${ann.date}
                </div>
            </div>
            <div class="glass-card" style="padding: 16px; background: var(--card-bg); border: 1px solid var(--card-border); box-shadow: var(--card-shadow);">
                <p style="color: var(--text-secondary); font-size: 13px; line-height: 1.6; text-align: center;">
                    可在学校教务系统的通知链接中查阅该条公告的详细文档附件。
                </p>
            </div>
        `;
        document.getElementById("bottom-sheet").classList.add("active");
        document.getElementById("app-container").style.filter = "blur(8px)";
    }

    // ==================== B. 课程表模块业务 ====================
    static async reloadTimetableFromServer(semesterId = "", silent = false) {
        if (!silent) this.showLoading(true, "正在同步课程表数据...");
        try {
            const endpoint = semesterId ? `/jsxsd/xskb/xskb_list.do?xnxq01id=${semesterId}` : "/jsxsd/xskb/xskb_list.do";
            const html = await YnufeClient.getHtml(endpoint);
            const data = YnufeParser.parseTimetable(html);
            if (data) {
                // 保存课表数据缓存
                localStorage.setItem("ynufe_cached_timetable_data", JSON.stringify(data));
                this.renderTimetableData(data, semesterId);
            }
        } catch (e) {
            console.error("Timetable reload error:", e);
        } finally {
            if (!silent) this.showLoading(false);
        }
    }

    static reloadTimetable() {
        const semester = document.getElementById("select-semester").value;
        const week = document.getElementById("select-week").value;
        
        // 清空原槽位
        document.querySelectorAll(".grid-course-slot").forEach(slot => slot.innerHTML = "");

        // 筛选渲染
        let filtered = globalTimetable;
        if (week) {
            const wkNum = parseInt(week);
            filtered = globalTimetable.filter(c => c.activeWeeks.includes(wkNum));
        }

        // 智能去重：同一个格子（周几、大节）内如果课程名称与教室一致，只保留一条，防止双卡片重叠
        const seen = new Set();
        const uniqueCourses = [];
        filtered.forEach(c => {
            const key = `${c.day}-${c.session}-${c.name}-${c.room}`;
            if (!seen.has(key)) {
                seen.add(key);
                uniqueCourses.push(c);
            }
        });

        uniqueCourses.forEach(c => {
            const slotDom = document.querySelector(`.grid-course-slot[data-day="${c.day}"][data-session="${c.session}"]`);
            if (slotDom) {
                const card = document.createElement("div");
                
                // 根据课程名称哈希运算，动态均匀分配淡蓝、淡粉、淡青、淡紫 4 种有色透明玻璃配色
                const colorOptions = ["blue", "pink", "cyan", "purple"];
                let hash = 0;
                for (let i = 0; i < c.name.length; i++) {
                    hash = c.name.charCodeAt(i) + ((hash << 5) - hash);
                }
                const assignedColor = colorOptions[Math.abs(hash) % colorOptions.length];

                card.className = `grid-course-card ${assignedColor}`;
                card.innerHTML = `
                    <div class="grid-course-name">${c.name}</div>
                    <div class="grid-course-room">${c.room}</div>
                `;
                card.addEventListener("click", () => this.showCourseDetail(c));
                slotDom.appendChild(card);
            }
        });
    }

    // 弹出展示课程详细信息
    static showCourseDetail(course) {
        document.getElementById("sheet-title").innerText = course.name;
        document.getElementById("sheet-tag").innerText = course.isOptional ? "选修" : "必修";
        
        const timeRanges = ["08:00-09:30 (1-2节)", "10:00-12:20 (3-4节)", "14:30-16:00 (5-6节)", "16:30-18:00 (7-8节)", "19:00-20:30 (9-10节)"];
        const contentDom = document.getElementById("sheet-body-content");
        contentDom.innerHTML = `
            <div class="detail-row">
                <div class="detail-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect><line x1="9" y1="22" x2="9" y2="16"></line><line x1="15" y1="22" x2="15" y2="16"></line><line x1="9" y1="16" x2="15" y2="16"></line><path d="M8 6h2v2H8V6zm0 4h2v2H8v-2zm8-4h-2v2h2V6zm0 4h-2v2h2v-2z"></path></svg>
                </div>
                <div class="detail-txt-group"><small>上课教室</small><span>${course.room}</span></div>
            </div>
            <div class="detail-row">
                <div class="detail-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                </div>
                <div class="detail-txt-group"><small>授课教师</small><span>${course.teacher}</span></div>
            </div>
            <div class="detail-row">
                <div class="detail-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                </div>
                <div class="detail-txt-group"><small>上课周次</small><span>${course.weeks}</span></div>
            </div>
            <div class="detail-row">
                <div class="detail-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                </div>
                <div class="detail-txt-group"><small>大节范围</small><span>${timeRanges[course.session - 1] || '第' + course.slot + '节'}</span></div>
            </div>
            <div class="detail-row">
                <div class="detail-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
                </div>
                <div class="detail-txt-group"><small>通知单号</small><span>${course.code}</span></div>
            </div>
        `;
        
        document.getElementById("bottom-sheet").classList.add("active");
        document.getElementById("app-container").style.filter = "blur(8px)";
    }

    static closeBottomSheet() {
        document.getElementById("bottom-sheet").classList.remove("active");
        document.getElementById("app-container").style.filter = "none";
    }

    // ==================== C. 成绩板块业务 ====================
    static async loadFinalGradesData() {
        this.showLoading(true, "同步历史期末成绩...");
        try {
            const html = await YnufeClient.getHtml("/jsxsd/kscj/cjcx_list?xsfs=all");
            const data = YnufeParser.parseGrades(html);
            if (data) {
                localStorage.setItem("ynufe_cached_grades_data", JSON.stringify(data));
                this.renderGradesData(data);
            }
        } catch (e) {
            console.error("Final grades error:", e);
        } finally {
            this.showLoading(false);
        }
    }

    // 过滤与绘制普通成绩卡片
    static filterGrades() {
        const semester = document.getElementById("select-grade-semester").value;
        const search = document.getElementById("input-grade-search").value.toLowerCase().trim();
        
        let filtered = globalGrades;
        if (semester) filtered = filtered.filter(g => g.semester === semester);
        if (search) filtered = filtered.filter(g => g.name.toLowerCase().includes(search));

        const listDom = document.getElementById("grades-list");
        listDom.innerHTML = "";
        
        if (filtered.length === 0) {
            listDom.innerHTML = `
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
                    <p>未查询到匹配成绩</p>
                </div>`;
            return;
        }

        filtered.forEach(g => {
            const card = document.createElement("div");
            card.className = "grade-card glass-card";
            const scoreNum = parseFloat(g.score);
            const isFail = g.score === "不合格" || (!isNaN(scoreNum) && scoreNum < 60);

            card.innerHTML = `
                <div class="grade-left">
                    <div class="grade-name">${g.name}</div>
                    <div class="grade-meta">
                        <span>学期: ${g.semester}</span>
                        <span>学分: ${g.credit}</span>
                        <span>性质: ${g.category}</span>
                    </div>
                </div>
                <div class="grade-right">
                    <div class="grade-score ${isFail ? 'fail' : ''}">${g.score}</div>
                    <div class="grade-gpa">绩点: ${g.point}</div>
                </div>
            `;
            listDom.appendChild(card);
        });
    }

    // 等级考试成绩数据 (四六级等)
    static async loadLevelGradesData() {
        const container = document.getElementById("level-grades-list");
        container.innerHTML = `<div class="empty-state"><p>加载等级成绩中...</p></div>`;
        try {
            const html = await YnufeClient.getHtml("/jsxsd/kscj/djkscj_list");
            const list = YnufeParser.parseLevelGrades(html);
            
            container.innerHTML = "";
            if (list.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
                        <p>暂无社会考试等级成绩记录</p>
                    </div>`;
                return;
            }

            list.forEach(item => {
                const card = document.createElement("div");
                card.className = "grade-card glass-card";
                card.innerHTML = `
                    <div class="grade-left">
                        <div class="grade-name">${item.name}</div>
                        <div class="grade-meta">
                            <span>学期: ${item.term}</span>
                            <span>考试号: ${item.code}</span>
                        </div>
                    </div>
                    <div class="grade-right">
                        <div class="grade-score" style="color:var(--accent-color);">${item.score}</div>
                        <div class="grade-gpa">考试日期: ${item.date}</div>
                    </div>
                `;
                container.appendChild(card);
            });
        } catch (e) {
            container.innerHTML = `
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
                    <p>拉取等级成绩失败</p>
                </div>`;
        }
    }

    // ==================== D. 考试与选课模块业务 ====================
    // 1. 加载期末考试排考表
    static async loadExamsData() {
        const semester = document.getElementById("select-exam-semester").value;
        const examType = document.getElementById("select-exam-type").value;
        const container = document.getElementById("exams-term-list");
        
        if (!semester) {
            container.innerHTML = `<div class="empty-state"><p>请在上方学期筛选中选择要查询的学期</p></div>`;
            return;
        }

        container.innerHTML = `<div class="empty-state"><p>正在拉取考场安排...</p></div>`;
        
        try {
            // 获取考场安排数据 (POST)
            const html = await YnufeClient.postForm("/jsxsd/xsks/xsksap_query", {
                xnxqid: semester,
                kslkid: examType
            });
            const list = YnufeParser.parseExams(html);
            localStorage.setItem("ynufe_cached_exams", JSON.stringify(list));
            this.renderExamsList(list);
        } catch (e) {
            container.innerHTML = `<div class="empty-state"><p>无法连接教务网，拉取考试表失败</p></div>`;
        }
    }

    // 2. 加载随堂考试
    static async loadClassroomTestsData() {
        const container = document.getElementById("exams-class-list");
        container.innerHTML = `<div class="empty-state"><p>加载随堂考试信息...</p></div>`;
        try {
            const html = await YnufeClient.getHtml("/jsxsd/xsks/xsstk_query");
            const list = YnufeParser.parseClassroomTests(html);
            
            container.innerHTML = "";
            if (list.length === 0) {
                container.innerHTML = `<div class="empty-state"><p>暂无随堂考试记录</p></div>`;
                return;
            }

            list.forEach(t => {
                const card = document.createElement("div");
                card.className = "exam-card glass-card";
                card.innerHTML = `
                    <div class="exam-title">
                        <span>${t.name}</span>
                        <span class="exam-badge" style="background:rgba(16,185,129,0.15); color:var(--accent-color);">${t.type}</span>
                    </div>
                    <div class="exam-info-grid">
                        <div class="info-item full-width">
                            <small>测试时间</small>
                            <span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px; vertical-align: middle;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>${t.date}</span>
                        </div>
                        <div class="info-item full-width">
                            <small>考场教室/地点</small>
                            <span class="highlight">${t.room}</span>
                        </div>
                    </div>
                `;
                container.appendChild(card);
            });
        } catch (e) {
            container.innerHTML = `
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                    <p>随堂考试信息获取失败</p>
                </div>`;
        }
    }

    // 3. 选课中心业务
    static async loadXkCenterData() {
        const container = document.getElementById("xk-activities-list");
        container.innerHTML = `<div class="empty-state"><p>正在刷新选课流程中...</p></div>`;
        try {
            const html = await YnufeClient.getHtml("/jsxsd/xsxk/xklc_list");
            const list = YnufeParser.parseXkCenter(html);
            
            container.innerHTML = "";
            if (list.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"></path><path d="M2 17l10 5 10-5"></path><path d="M2 12l10 5 10-5"></path></svg>
                        <p>当前无开放的选课选教活动</p>
                    </div>`;
                return;
            }

            list.forEach(act => {
                const card = document.createElement("div");
                card.className = "xk-card glass-card";
                const isOpen = act.status.includes("进入") || act.status.includes("选课");

                card.innerHTML = `
                    <div class="xk-title">
                        <span>${act.name}</span>
                        <span class="xk-badge ${isOpen ? 'active' : ''}">${act.status}</span>
                    </div>
                    <div class="xk-info-grid">
                        <div class="info-item full-width">
                            <small>选课活动性质</small>
                            <span>${act.type}</span>
                        </div>
                        <div class="info-item full-width">
                            <small>起止时间</small>
                            <span style="font-size:12px; color:var(--text-secondary);">${act.timeRange}</span>
                        </div>
                    </div>
                `;
                container.appendChild(card);
            });
        } catch (e) {
            container.innerHTML = `
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"></path><path d="M2 17l10 5 10-5"></path><path d="M2 12l10 5 10-5"></path></svg>
                    <p>获取选课中心数据异常，请确保在内网环境</p>
                </div>`;
        }
    }

    // ==================== E. 实践与服务模块业务 ====================
    // 1. 毕业设计数据
    static async loadPracticeData() {
        try {
            // 获取毕业设计选题页面 (真实接口，防止404被重定向至登录页导致凭证失效)
            const html = await YnufeClient.getHtml("/jsxsd/bysj/xsyxxt.do");
            const practice = YnufeParser.parsePractice(html);
            
            if (practice.empty) {
                document.getElementById("thesis-title").innerText = practice.msg;
                document.getElementById("thesis-title").style.color = "var(--text-secondary)";
                document.getElementById("thesis-report").innerText = "-";
                document.getElementById("thesis-指导").innerText = "-";
                document.getElementById("thesis-grade").innerText = "-";
                return;
            }

            document.getElementById("thesis-title").innerText = practice.title;
            document.getElementById("thesis-title").style.color = "var(--primary-color)";
            document.getElementById("thesis-report").innerText = practice.report;
            document.getElementById("thesis-指导").innerText = practice.guidanceCount;
            document.getElementById("thesis-grade").innerText = practice.grade;
            
        } catch (e) {
            document.getElementById("thesis-title").innerText = "暂无毕业环节任务";
            document.getElementById("thesis-title").style.color = "var(--text-secondary)";
        }
    }

    // 2. 空教室查询业务
    static async handleClassroomQuery(e) {
        e.preventDefault();
        const xq = document.getElementById("query-xq").value;
        const jslx = document.getElementById("query-jslx").value;
        const zc = document.getElementById("query-zc").value;
        const day = document.getElementById("query-day").value;
        const jcStart = document.getElementById("query-jc-start").value;
        const jcEnd = document.getElementById("query-jc-end").value;
        
        if (parseInt(jcStart) > parseInt(jcEnd)) {
            alert("开始节次不能大于结束节次！");
            return;
        }

        this.showLoading(true, "正在智能筛选自习室...");

        try {
            const currentSemester = document.getElementById("select-semester").value || "2026-2027-1";
            
            const responseText = await YnufeClient.postForm("/jsxsd/kbxx/jsjy_query2", {
                typewhere: "jszq",
                xnxqh: currentSemester,
                xqbh: xq,
                jslx: jslx,
                zc: zc,
                zc2: zc,
                xq: day,
                xq2: day,
                jc: jcStart,
                jc2: jcEnd,
                kbjcmsid: "C8B3C60AE20444B499A15ABFA3ECFF9D" // 时间网格标准
            });

            const doc = YnufeParser.getDoc(responseText);
            const container = document.getElementById("classrooms-result-list");
            container.innerHTML = "";

            const table = doc.querySelector("table#Table1") || doc.querySelector("table.Nsb_r_list");
            const rooms = [];

            if (table) {
                table.querySelectorAll("tr").forEach((row, i) => {
                    if (i === 0) return; // skip header
                    const tds = row.querySelectorAll("td");
                    if (tds.length >= 3) {
                        const name = tds[1].innerText.trim() || tds[2].innerText.trim();
                        if (name && name !== "暂无数据" && name !== "没有找到") {
                            rooms.push(name);
                        }
                    }
                });
            }

            this.showLoading(false);
            document.getElementById("classroom-count").innerText = `共${rooms.length}间`;

            if (rooms.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect><line x1="9" y1="22" x2="9" y2="16"></line><line x1="15" y1="22" x2="15" y2="16"></line><line x1="9" y1="16" x2="15" y2="16"></line></svg>
                        <p>该时段无空闲教室，换个条件查询吧</p>
                    </div>`;
                return;
            }

            rooms.forEach(roomName => {
                const card = document.createElement("div");
                card.className = "classroom-card glass-card";
                card.innerText = roomName;
                container.appendChild(card);
            });

        } catch (err) {
            this.showLoading(false);
            alert("空教室查询网络超时，请检查校园网连接！");
        }
    }
}

// 自动侦听初始化
document.addEventListener("DOMContentLoaded", async () => {
    YnufeUI.init();

    // 检查本地自动免登录
    const savedUser = YnufeSession.getUsername();
    const savedPass = YnufeSession.getPassword();

    document.getElementById("username").value = savedUser;
    document.getElementById("password").value = savedPass;
    document.getElementById("remember-me").checked = YnufeSession.getRememberMe();

    // 1. 优先非阻塞加载离线缓存数据
    const hasCache = YnufeUI.loadCachedData();
    if (hasCache) {
        // 如果本地有任何缓存（即使进程重启了），也立即关闭登录盖板，0.1秒展示上一次的课表与成绩！
        document.getElementById("login-overlay").classList.remove("active");

        // 2. 在后台进行静默同步更新缓存数据 (启用 isSilentSync 屏蔽 Session 过期全局弹窗)
        setTimeout(async () => {
            YnufeUI.isSilentSync = true;
            YnufeUI.updateSyncStatus("syncing", "同步中...");
            console.log("[StatusSync] 开始后台静默同步教务数据...");
            const success = await YnufeUI.loadHomeBusinessData();
            if (success) {
                console.log("[StatusSync] 后台静默同步教务数据成功！已更新本地离线缓存。");
                YnufeUI.updateSyncStatus("online", "数据已最新");
            } else {
                console.warn("[StatusSync] 后台静默同步未成功（可能学校会话过期或处于断网环境），继续保留离线数据展示。");
                YnufeUI.updateSyncStatus("offline", "未同步 · 点击刷新");
            }
            YnufeUI.isSilentSync = false;
        }, 150);
        return;
    }

    // 3. 如果本地完全没有缓存数据（首次登录），则强制留着登录面板，并更新验证码
    document.getElementById("login-overlay").classList.add("active");
    YnufeUI.refreshCaptchaImg();
});