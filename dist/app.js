(() => {
  "use strict";

  const STORAGE_KEY = "hachiware-todo-gtd-v2";
  const SETTINGS_KEY = "hachiware-todo-settings-v2";
  const pad = (value) => String(value).padStart(2, "0");
  const toISO = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const fromISO = (value) => {
    if (!value) return null;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime()) ? null : date;
  };
  const addDays = (base, amount) => {
    const date = new Date(base);
    date.setDate(date.getDate() + amount);
    return date;
  };
  const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = toISO(today);

  const emptyData = () => ({
    version: 5,
    tasks: [],
    projects: [],
    documents: [],
    habits: [],
    reflections: [],
    logs: [],
    events: [],
    collectionItems: [],
    transactions: [],
    budgets: {},
    monthlyGoals: {}
  });

  function normalizeData(value) {
    const base = emptyData();
    if (!value || typeof value !== "object") return base;
    const events = Array.isArray(value.events) ? value.events.map((item) => ({ ...item })) : [];
    const eventIds = new Set(events.map((item) => item.id).filter(Boolean));
    if (Array.isArray(value.futureItems)) {
      value.futureItems.forEach((item) => {
        if (!item || (item.id && eventIds.has(item.id))) return;
        const id = item.id || uid();
        events.push({ ...item, id, date: "", month: item.month || "" });
        eventIds.add(id);
      });
    }
    return {
      version: 5,
      tasks: Array.isArray(value.tasks) ? value.tasks : [],
      projects: Array.isArray(value.projects) ? value.projects : [],
      documents: Array.isArray(value.documents) ? value.documents : [],
      habits: Array.isArray(value.habits) ? value.habits : [],
      reflections: Array.isArray(value.reflections) ? value.reflections : [],
      logs: Array.isArray(value.logs) ? value.logs : [],
      events,
      collectionItems: Array.isArray(value.collectionItems) ? value.collectionItems : [],
      transactions: Array.isArray(value.transactions) ? value.transactions : [],
      budgets: value.budgets && typeof value.budgets === "object" ? value.budgets : {},
      monthlyGoals: value.monthlyGoals && typeof value.monthlyGoals === "object" ? value.monthlyGoals : {}
    };
  }

  function loadJSON(key, fallback) {
    try {
      const saved = localStorage.getItem(key);
      return saved ? JSON.parse(saved) : fallback;
    } catch (error) {
      console.warn("保存データを読み込めませんでした", error);
      return fallback;
    }
  }

  const loadedData = loadJSON(STORAGE_KEY, emptyData());
  const state = {
    data: normalizeData(loadedData),
    view: "inbox",
    mode: "list",
    projectId: null,
    search: "",
    tag: "all",
    priority: "all",
    calendarMonth: todayISO.slice(0, 7),
    habitMonth: todayISO.slice(0, 7),
    logDate: todayISO,
    showAllLogs: false,
    selected: new Set(),
    draggedId: null
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const elements = {
    taskWorkspace: $("#taskWorkspace"),
    overviewWorkspace: $("#overviewWorkspace"),
    documentsWorkspace: $("#documentsWorkspace"),
    habitsWorkspace: $("#habitsWorkspace"),
    recordsWorkspace: $("#recordsWorkspace"),
    calendarWorkspace: $("#calendarWorkspace"),
    collectionsWorkspace: $("#collectionsWorkspace"),
    budgetWorkspace: $("#budgetWorkspace"),
    dataWorkspace: $("#dataWorkspace"),
    reflectionWorkspace: $("#reflectionWorkspace"),
    helpWorkspace: $("#helpWorkspace"),
    taskContent: $("#taskContent"),
    viewTitle: $("#viewTitle"),
    viewDescription: $("#viewDescription"),
    dateLabel: $("#dateLabel"),
    projectList: $("#projectList"),
    taskProject: $("#taskProject"),
    bulkBar: $("#bulkBar"),
    selectedCount: $("#selectedCount"),
    taskDialog: $("#taskDialog"),
    projectDialog: $("#projectDialog"),
    backupDialog: $("#backupDialog"),
    toast: $("#toast")
  };

  const folderNames = {
    inbox: "INBOX",
    next: "次にやる",
    remind: "リマインダー",
    waiting: "待ち状況",
    project: "プロジェクト",
    wish: "いつかやりたい"
  };
  const viewNames = {
    today: "今日",
    week: "次の7日間",
    all: "すべてのタスク",
    inbox: "INBOX",
    next: "次にやる",
    remind: "リマインダー",
    waiting: "待ち状況",
    projects: "プロジェクト",
    wish: "いつかやりたい",
    completed: "完了"
  };
  const descriptions = {
    today: "今日取り組むことだけを表示します。",
    week: "今日から7日間の予定を確認します。",
    all: "未完了のタスクをすべて確認します。",
    inbox: "思いついたことを集め、あとで整理します。",
    next: "具体的に、次に行動するタスクです。",
    remind: "指定した日に思い出したいタスクです。",
    waiting: "ほかの人や出来事を待っているタスクです。",
    projects: "複数の行動が必要なタスクです。",
    wish: "いつかやりたいことを保管します。",
    completed: "完了したタスクの記録です。"
  };
  const priorityNames = { high: "高", medium: "中", low: "低" };
  const tagNames = { work: "仕事", private: "プライベート" };
  const moodFaces = { 1: "😣", 2: "😕", 3: "😐", 4: "🙂", 5: "😊" };
  const moodNames = { 1: "重い", 2: "いまひとつ", 3: "普通", 4: "良い", 5: "とても良い" };
  const logTypeNames = { memo: "メモ", idea: "アイデア", event: "予定・出来事", completed: "完了したこと", postponed: "先送りしたこと", cancelled: "キャンセルしたこと" };
  const logSymbols = { memo: "📝", idea: "💡", event: "○", completed: "×", postponed: "＞", cancelled: "－" };

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
  }

  function escapeHTML(value = "") {
    return String(value).replace(/[&<>'"]/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    }[char]));
  }

  function safeExternalURL(value = "") {
    try {
      const url = new URL(String(value).trim());
      return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch (_) {
      return "";
    }
  }

  function safeImageSource(value = "") {
    const source = String(value || "").trim();
    if (/^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(source)) return source;
    return safeExternalURL(source);
  }

  function collectionImageFromFile(file) {
    if (!file) return Promise.resolve("");
    if (!String(file.type || "").startsWith("image/")) return Promise.reject(new Error("画像ファイルを選んでください"));
    if (file.size > 15 * 1024 * 1024) return Promise.reject(new Error("画像は15MB以下のものを選んでください"));
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("画像を読み込めませんでした"));
      reader.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error("この画像形式は読み込めません"));
        image.onload = () => {
          const maxSide = 1200;
          const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
          const context = canvas.getContext("2d");
          if (!context) return reject(new Error("画像を処理できませんでした"));
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          let dataURL = canvas.toDataURL("image/webp", 0.82);
          if (!dataURL.startsWith("data:image/webp")) dataURL = canvas.toDataURL("image/jpeg", 0.82);
          if (dataURL.length > 2500000) return reject(new Error("画像の保存サイズが大きすぎます。別の画像を選んでください"));
          resolve(dataURL);
        };
        image.src = String(reader.result || "");
      };
      reader.readAsDataURL(file);
    });
  }

  function projectById(id) {
    return state.data.projects.find((project) => project.id === id);
  }

  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => elements.toast.classList.remove("show"), 1900);
  }

  function daysText(due) {
    const date = fromISO(due);
    if (!date) return "";
    const days = Math.round((date - today) / 86400000);
    if (days < 0) return `期限超過 ${Math.abs(days)}日`;
    if (days === 0) return "今日まで";
    if (days === 1) return "残り1日";
    return `残り${days}日`;
  }

  function formatDate(due) {
    const date = fromISO(due);
    if (!date) return "期限なし";
    return `${date.getMonth() + 1}/${date.getDate()}（${"日月火水木金土"[date.getDay()]}）`;
  }

  function formatFullDate(value) {
    const date = fromISO(value);
    if (!date) return value;
    return new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "short" }).format(date);
  }

  function filteredTasks() {
    let tasks = [...state.data.tasks];
    if (state.projectId) {
      tasks = tasks.filter((task) => task.projectId === state.projectId && !task.completed);
    } else {
      const weekEnd = toISO(addDays(today, 6));
      if (state.view === "today") {
        tasks = tasks.filter((task) => !task.completed && (task.pinned || task.folder === "inbox" || (task.due && task.due <= todayISO)));
      } else if (state.view === "week") {
        tasks = tasks.filter((task) => !task.completed && task.due && task.due >= todayISO && task.due <= weekEnd);
      } else if (state.view === "all") {
        tasks = tasks.filter((task) => !task.completed);
      } else if (state.view === "projects") {
        tasks = tasks.filter((task) => !task.completed && task.folder === "project");
      } else if (state.view === "completed") {
        tasks = tasks.filter((task) => task.completed);
      } else {
        tasks = tasks.filter((task) => !task.completed && task.folder === state.view);
      }
    }
    if (state.tag !== "all") {
      tasks = tasks.filter((task) => state.tag === "none" ? !task.tag : task.tag === state.tag);
    }
    if (state.priority !== "all") tasks = tasks.filter((task) => task.priority === state.priority);
    if (state.search) {
      const query = state.search.toLocaleLowerCase("ja");
      tasks = tasks.filter((task) => `${task.title} ${task.notes || ""}`.toLocaleLowerCase("ja").includes(query));
    }
    return tasks.sort((a, b) => Number(b.pinned) - Number(a.pinned) || (a.order || 0) - (b.order || 0));
  }

  function taskRow(task) {
    const project = projectById(task.projectId);
    const remaining = daysText(task.due);
    const remainingClass = remaining.startsWith("期限超過") ? "days-over" : remaining === "今日まで" || remaining === "残り1日" ? "days-soon" : "";
    return `<article class="task-row ${task.completed ? "completed" : ""}" draggable="true" data-id="${task.id}">
      <input class="select-task" type="checkbox" ${state.selected.has(task.id) ? "checked" : ""} aria-label="${escapeHTML(task.title)}を選択" />
      <input class="complete-task" type="checkbox" ${task.completed ? "checked" : ""} aria-label="${escapeHTML(task.title)}を完了にする" />
      <div class="task-body" tabindex="0" role="button" aria-label="${escapeHTML(task.title)}を編集">
        <p class="task-title">${task.pinned ? '<span class="pin">◆</span> ' : ""}${escapeHTML(task.title)}</p>
        <div class="task-meta">
          <span>${formatDate(task.due)}</span>
          ${remaining ? `<span class="${remainingClass}">${remaining}</span>` : ""}
          <span class="pill">${folderNames[task.folder] || "INBOX"}</span>
          ${task.tag ? `<span class="pill tag-${task.tag}">${tagNames[task.tag]}</span>` : ""}
          <span class="pill ${task.priority === "high" ? "priority-high" : task.priority === "low" ? "priority-low" : ""}">優先度 ${priorityNames[task.priority] || "中"}</span>
          ${project ? `<span class="pill"><i class="project-dot" style="display:inline-block;background:${project.color}"></i> ${escapeHTML(project.name)}</span>` : ""}
          ${task.repeat ? `<span>↻ ${{ daily: "毎日", weekly: "毎週", monthly: "毎月" }[task.repeat]}</span>` : ""}
        </div>
      </div>
      <button class="task-menu" aria-label="${escapeHTML(task.title)}を編集">•••</button>
    </article>`;
  }

  function renderList(tasks) {
    if (!tasks.length) return emptyState();
    let groups;
    if (state.view === "today" && !state.projectId) {
      groups = [
        ["固定したタスク", tasks.filter((task) => task.pinned)],
        ["INBOX", tasks.filter((task) => !task.pinned && task.folder === "inbox")],
        ["プロジェクト・行動", tasks.filter((task) => !task.pinned && task.folder !== "inbox")]
      ].filter(([, items]) => items.length);
    } else if (state.view === "projects" && !state.projectId) {
      const projectGroups = state.data.projects.map((project) => [project.name, tasks.filter((task) => task.projectId === project.id)]);
      const unassigned = tasks.filter((task) => !task.projectId);
      groups = [...projectGroups, ["プロジェクト未設定", unassigned]].filter(([, items]) => items.length);
    } else {
      groups = [[state.projectId ? projectById(state.projectId)?.name || "プロジェクト" : viewNames[state.view], tasks]];
    }
    return groups.map(([name, items]) => `<section class="task-group"><div class="group-heading"><h2>${escapeHTML(name)}</h2><span>${items.length}件</span></div><div class="task-list">${items.map(taskRow).join("")}</div></section>`).join("");
  }

  function renderTable(tasks) {
    if (!tasks.length) return emptyState();
    return `<table class="task-table"><thead><tr><th>タスク</th><th>フォルダー</th><th>期限</th><th>残り</th><th>タグ</th><th>優先度</th></tr></thead><tbody>${tasks.map((task) => `<tr data-id="${task.id}"><td>${escapeHTML(task.title)}</td><td>${folderNames[task.folder] || "INBOX"}</td><td>${formatDate(task.due)}</td><td>${daysText(task.due)}</td><td>${tagNames[task.tag] || "—"}</td><td>${priorityNames[task.priority] || "中"}</td></tr>`).join("")}</tbody></table>`;
  }

  function renderWeek(tasks) {
    const days = Array.from({ length: 7 }, (_, index) => addDays(today, index));
    return `<div class="week-board">${days.map((date) => {
      const iso = toISO(date);
      const items = tasks.filter((task) => task.due === iso);
      return `<section class="week-column"><h3>${date.getMonth() + 1}/${date.getDate()}（${"日月火水木金土"[date.getDay()]}）</h3>${items.map((task) => `<button class="week-card" data-id="${task.id}">${escapeHTML(task.title)}</button>`).join("") || '<span class="task-meta">予定なし</span>'}</section>`;
    }).join("")}</div>`;
  }

  function renderMonth(tasks) {
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    const start = addDays(first, -first.getDay());
    const days = Array.from({ length: 42 }, (_, index) => addDays(start, index));
    return `<div class="calendar">${"日月火水木金土".split("").map((day) => `<div class="calendar-head">${day}</div>`).join("")}${days.map((date) => {
      const iso = toISO(date);
      const items = tasks.filter((task) => task.due === iso);
      return `<div class="calendar-day ${date.getMonth() !== today.getMonth() ? "outside" : ""} ${iso === todayISO ? "today" : ""}"><span class="day-number">${date.getDate()}</span>${items.map((task) => `<button class="calendar-task" data-id="${task.id}">${escapeHTML(task.title)}</button>`).join("")}</div>`;
    }).join("")}</div>`;
  }

  function emptyState() {
    return '<div class="empty-state"><strong>タスクはありません</strong><span>思いついたことをINBOXへ追加してください。</span></div>';
  }

  function renderTasks() {
    const tasks = filteredTasks();
    if (state.mode === "table") elements.taskContent.innerHTML = renderTable(tasks);
    else if (state.mode === "week") elements.taskContent.innerHTML = renderWeek(tasks);
    else if (state.mode === "month") elements.taskContent.innerHTML = renderMonth(tasks);
    else elements.taskContent.innerHTML = renderList(tasks);
    renderBulkBar();
  }

  function renderCounts() {
    const open = state.data.tasks.filter((task) => !task.completed);
    const weekEnd = toISO(addDays(today, 6));
    const counts = {
      today: open.filter((task) => task.pinned || task.folder === "inbox" || (task.due && task.due <= todayISO)).length,
      week: open.filter((task) => task.due && task.due >= todayISO && task.due <= weekEnd).length,
      all: open.length,
      inbox: open.filter((task) => task.folder === "inbox").length,
      next: open.filter((task) => task.folder === "next").length,
      remind: open.filter((task) => task.folder === "remind").length,
      waiting: open.filter((task) => task.folder === "waiting").length,
      projects: open.filter((task) => task.folder === "project").length,
      wish: open.filter((task) => task.folder === "wish").length,
      completed: state.data.tasks.filter((task) => task.completed).length
    };
    Object.entries(counts).forEach(([key, value]) => $$(`[data-count="${key}"]`).forEach((node) => { node.textContent = value; node.hidden = !value; }));
  }

  function renderProjects() {
    elements.projectList.innerHTML = state.data.projects.map((project) => {
      const count = state.data.tasks.filter((task) => task.projectId === project.id && !task.completed).length;
      return `<button class="project-button ${state.projectId === project.id ? "active" : ""}" data-project="${project.id}"><i class="project-dot" style="background:${project.color}"></i><span>${escapeHTML(project.name)}</span><em>${count}</em></button>`;
    }).join("") || '<span class="task-meta" style="padding:7px 10px">まだありません</span>';
    elements.taskProject.innerHTML = '<option value="">未設定</option>' + state.data.projects.map((project) => `<option value="${project.id}">${escapeHTML(project.name)}</option>`).join("");
  }

  function renderHeading() {
    const project = projectById(state.projectId);
    const home = state.view === "inbox" && !project;
    elements.viewTitle.textContent = home ? "ホーム" : project ? project.name : viewNames[state.view] || "今日";
    elements.viewDescription.textContent = home ? "INBOXと手帳の記録を、ここからすぐ入力できます。" : project ? "このプロジェクトの未完了タスクです。" : descriptions[state.view] || "";
    elements.dateLabel.textContent = new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(today);
  }

  function renderNavigation() {
    $$("[data-view]").forEach((button) => button.classList.toggle("active", !state.projectId && button.dataset.view === state.view));
    $$("[data-mode]").forEach((button) => button.classList.toggle("active", button.dataset.mode === state.mode));
    $$(".nav-group").forEach((group) => {
      if (group.querySelector(`[data-view="${state.view}"]`)) group.open = true;
    });
  }

  function renderOverview() {
    const tasks = state.data.tasks;
    const open = tasks.filter((task) => !task.completed);
    const dueToday = open.filter((task) => task.due && task.due <= todayISO).length;
    const completedToday = tasks.filter((task) => task.completedAt && toISO(new Date(task.completedAt)) === todayISO).length;
    $("#overviewGrid").innerHTML = [
      ["未完了", open.length],
      ["今日まで", dueToday],
      ["INBOX", open.filter((task) => task.folder === "inbox").length],
      ["今日の完了", completedToday],
      ["次にやる", open.filter((task) => task.folder === "next").length],
      ["待ち状況", open.filter((task) => task.folder === "waiting").length],
      ["プロジェクト", open.filter((task) => task.folder === "project").length],
      ["いつかやりたい", open.filter((task) => task.folder === "wish").length]
    ].map(([label, value]) => `<article class="overview-card"><span>${label}</span><strong>${value}</strong></article>`).join("");
  }

  function renderDocuments() {
    $("#documentList").innerHTML = state.data.documents.map((item) => `<article class="simple-item">${item.url ? `<a href="${escapeHTML(item.url)}" target="_blank" rel="noopener">${escapeHTML(item.title)}</a>` : `<strong>${escapeHTML(item.title)}</strong>`}<button data-delete-document="${item.id}">削除</button></article>`).join("") || emptyState();
  }

  function renderHabitCalendar() {
    const [year, month] = state.habitMonth.split("-").map(Number);
    const first = new Date(year, month - 1, 1);
    const start = addDays(first, -first.getDay());
    const days = Array.from({ length: 42 }, (_, index) => addDays(start, index));
    $("#habitCalendarMonthLabel").textContent = `${year}年${month}月`;
    $("#habitCalendar").innerHTML = `<div class="calendar habit-calendar-grid">${"日月火水木金土".split("").map((day) => `<div class="calendar-head">${day}</div>`).join("")}${days.map((date) => {
      const iso = toISO(date);
      const completed = state.data.habits.filter((item) => Array.isArray(item.dates) && item.dates.includes(iso));
      return `<div class="calendar-day habit-calendar-day ${date.getMonth() !== month - 1 ? "outside" : ""} ${iso === todayISO ? "today" : ""}"><span class="day-number">${date.getDate()}</span>${completed.slice(0, 4).map((item) => `<span class="habit-calendar-item">✓ ${escapeHTML(item.name)}</span>`).join("") || '<span class="habit-calendar-empty">—</span>'}</div>`;
    }).join("")}</div>`;
  }

  function renderHabits() {
    renderHabitCalendar();
    $("#habitList").innerHTML = state.data.habits.map((item) => {
      const done = Array.isArray(item.dates) && item.dates.includes(todayISO);
      return `<article class="habit-item"><input type="checkbox" data-habit="${item.id}" ${done ? "checked" : ""} aria-label="${escapeHTML(item.name)}を今日完了" /><label>${escapeHTML(item.name)}</label><button data-delete-habit="${item.id}">削除</button></article>`;
    }).join("") || emptyState();
  }

  function createLog(type, text, date = todayISO, time = "") {
    const value = String(text || "").trim();
    if (!value) return null;
    const validTime = /^\d{2}:\d{2}$/.test(String(time)) ? String(time) : "";
    const record = { id: uid(), date, time: validTime, type: logTypeNames[type] ? type : "memo", text: value, createdAt: new Date().toISOString() };
    state.data.logs.push(record);
    persist();
    return record;
  }

  function renderHomeJournal() {
    const area = $("#homeJournal");
    const home = state.view === "inbox" && !state.projectId;
    area.hidden = !home;
    if (area.hidden) return;
    $("#homeLogDate").value ||= todayISO;
  }

  function renderLogs() {
    $("#logDate").value ||= todayISO;
    $("#logFilterDate").value = state.logDate;
    const logs = [...state.data.logs].filter((item) => state.showAllLogs || item.date === state.logDate).sort((a, b) => b.date.localeCompare(a.date) || String(b.time || "").localeCompare(String(a.time || "")) || String(b.createdAt).localeCompare(String(a.createdAt)));
    $("#logList").innerHTML = logs.map((item) => `<article class="journal-row"><span class="journal-symbol">${logSymbols[item.type] || "・"}</span><div><strong>${escapeHTML(item.text)}</strong><small>${formatFullDate(item.date)}${item.time ? ` ${escapeHTML(item.time)}` : ""}・${logTypeNames[item.type] || "記録"}</small></div><div class="journal-actions"><button type="button" data-edit-log="${item.id}">編集</button><button type="button" data-delete-log="${item.id}">削除</button></div></article>`).join("") || '<div class="empty-state"><strong>記録はまだありません</strong><span>メモや出来事を残してみましょう。</span></div>';
    $("#showAllLogs").textContent = state.showAllLogs ? "日付で絞る" : "すべて表示";
  }

  function changeMonth(month, amount) {
    const [year, value] = month.split("-").map(Number);
    const date = new Date(year, value - 1 + amount, 1);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
  }

  function renderCombinedCalendar() {
    const [year, month] = state.calendarMonth.split("-").map(Number);
    const first = new Date(year, month - 1, 1);
    const start = addDays(first, -first.getDay());
    const days = Array.from({ length: 42 }, (_, index) => addDays(start, index));
    $("#calendarMonthLabel").textContent = `${year}年${month}月`;
    $("#monthGoal").value = state.data.monthlyGoals[state.calendarMonth] || "";
    $("#eventDate").value ||= todayISO;
    $("#eventMonth").value = state.calendarMonth;
    const undatedEvents = state.data.events.filter((item) => !item.date && item.month === state.calendarMonth);
    const undatedMarkup = undatedEvents.length ? `<div class="calendar-undated"><strong>日付未定</strong><div>${undatedEvents.map((item) => `<button type="button" data-edit-event="${item.id}">◷ ${escapeHTML(item.title)}</button>`).join("")}</div></div>` : "";
    $("#combinedCalendar").innerHTML = `${undatedMarkup}<div class="calendar">${"日月火水木金土".split("").map((day) => `<div class="calendar-head">${day}</div>`).join("")}${days.map((date) => {
      const iso = toISO(date);
      const tasks = state.data.tasks.filter((task) => !task.completed && task.due === iso);
      const events = state.data.events.filter((item) => item.date === iso);
      return `<div class="calendar-day ${date.getMonth() !== month - 1 ? "outside" : ""} ${iso === todayISO ? "today" : ""}"><span class="day-number">${date.getDate()}</span>${events.map((item) => `<button type="button" class="calendar-task calendar-event" data-edit-event="${item.id}">○ ${escapeHTML(item.title)}</button>`).join("")}${tasks.slice(0, 2).map((task) => `<button type="button" class="calendar-task" data-id="${task.id}">・ ${escapeHTML(task.title)}</button>`).join("")}</div>`;
    }).join("")}</div>`;
  }

  function renderCollections() {
    const groups = [...new Set(state.data.collectionItems.map((item) => item.category))].sort((a, b) => a.localeCompare(b, "ja"));
    $("#collectionList").innerHTML = groups.map((category) => {
      const items = state.data.collectionItems.filter((item) => item.category === category);
      return `<section><header><strong>${escapeHTML(category)}</strong><span>${items.length}件</span></header>${items.map((item) => {
        const image = safeImageSource(item.image);
        const url = safeExternalURL(item.url);
        const imageMarkup = image ? `<img class="collection-image" src="${escapeHTML(image)}" alt="" loading="lazy" />` : '<span class="collection-image collection-image-placeholder" aria-hidden="true"></span>';
        return `<article><input type="checkbox" data-collection-check="${item.id}" ${item.done ? "checked" : ""} aria-label="${escapeHTML(item.text)}を完了" />${imageMarkup}<div class="collection-item-body"><p class="${item.done ? "done" : ""}">${url ? `<a href="${escapeHTML(url)}" target="_blank" rel="noopener">${escapeHTML(item.text)}</a>` : escapeHTML(item.text)}</p>${url ? `<a class="collection-link" href="${escapeHTML(url)}" target="_blank" rel="noopener">URLを開く</a>` : ""}</div><button type="button" data-delete-collection="${item.id}">削除</button></article>`;
      }).join("")}</section>`;
    }).join("") || '<div class="empty-state"><strong>コレクションはまだありません</strong><span>欲しい物や読みたい物など、自由な一覧を作れます。</span></div>';
  }

  function money(value) {
    return `${new Intl.NumberFormat("ja-JP").format(Number(value) || 0)}円`;
  }

  function renderBudget() {
    $("#budgetMonth").value ||= todayISO.slice(0, 7);
    const month = $("#budgetMonth").value;
    const items = state.data.transactions.filter((item) => item.date.startsWith(month)).sort((a, b) => b.date.localeCompare(a.date));
    const income = items.filter((item) => item.type === "income").reduce((sum, item) => sum + Number(item.amount), 0);
    const expense = items.filter((item) => item.type === "expense").reduce((sum, item) => sum + Number(item.amount), 0);
    const limit = Number(state.data.budgets[month]) || 0;
    $("#budgetLimit").value = limit || "";
    $("#transactionDate").value ||= todayISO;
    $("#budgetSummary").innerHTML = [["予算", money(limit)], ["収入", money(income)], ["支出", money(expense)], ["残り", money(limit ? limit - expense : income - expense)]].map(([label, value]) => `<article><span>${label}</span><strong>${value}</strong></article>`).join("");
    $("#transactionList").innerHTML = items.map((item) => `<article><span class="transaction-kind ${item.type}">${item.type === "income" ? "収入" : "支出"}</span><div><strong>${escapeHTML(item.category)}</strong><small>${formatFullDate(item.date)}${item.note ? `・${escapeHTML(item.note)}` : ""}</small></div><b>${item.type === "income" ? "+" : "−"}${money(item.amount)}</b><button type="button" data-delete-transaction="${item.id}">削除</button></article>`).join("") || '<div class="empty-state"><strong>この月の収支はありません</strong><span>収入や支出を登録してください。</span></div>';
  }

  function renderDataSummary() {
    const counts = [["タスク", state.data.tasks.length], ["記録", state.data.logs.length], ["予定", state.data.events.length], ["振り返り", state.data.reflections.length], ["コレクション", state.data.collectionItems.length], ["家計簿", state.data.transactions.length]];
    $("#dataSummary").innerHTML = counts.map(([label, value]) => `<article><span>${label}</span><strong>${value}</strong></article>`).join("");
  }

  function reflectionDataFor(date) {
    const completedTasks = state.data.tasks.filter((task) => task.completedAt && toISO(new Date(task.completedAt)) === date).map((task) => task.title);
    const completedHabits = state.data.habits.filter((habit) => Array.isArray(habit.dates) && habit.dates.includes(date)).map((habit) => habit.name);
    return { completedTasks, completedHabits };
  }

  function renderReflectionWeek(selectedDate) {
    const selected = fromISO(selectedDate) || today;
    const days = Array.from({ length: 7 }, (_, index) => addDays(selected, index - 6));
    $("#reflectionWeek").innerHTML = days.map((date) => {
      const iso = toISO(date);
      const record = state.data.reflections.find((item) => item.date === iso);
      return `<button type="button" class="reflection-day ${iso === selectedDate ? "active" : ""}" data-reflection-date="${iso}"><span>${"日月火水木金土"[date.getDay()]}</span><strong>${date.getDate()}</strong><small>${record ? moodFaces[record.mood] || "●" : "・"}</small></button>`;
    }).join("");
  }

  function renderReflectionSummary(date) {
    const { completedTasks, completedHabits } = reflectionDataFor(date);
    const start = toISO(addDays(fromISO(date) || today, -6));
    const recentCount = state.data.reflections.filter((item) => item.date >= start && item.date <= date).length;
    $("#reflectionSummary").innerHTML = [
      ["完了したタスク", completedTasks.length, completedTasks.slice(0, 3).join("、") || "まだありません"],
      ["達成した習慣", completedHabits.length, completedHabits.slice(0, 3).join("、") || "まだありません"],
      ["7日間の記録", `${recentCount}/7`, recentCount ? "記録を積み重ねています" : "今日から始めましょう"]
    ].map(([label, value, detail]) => `<article><span>${label}</span><strong>${value}</strong><p>${escapeHTML(detail)}</p></article>`).join("");
  }

  function loadReflectionForm(date) {
    const record = state.data.reflections.find((item) => item.date === date);
    $("#reflectionDate").value = date;
    const mood = String(record?.mood || 3);
    const moodInput = $(`[name="reflectionMood"][value="${mood}"]`);
    if (moodInput) moodInput.checked = true;
    $("#reflectionGood").value = record?.good || "";
    $("#reflectionLearned").value = record?.learned || "";
    $("#reflectionTomorrow").value = record?.tomorrow || "";
    $("#reflectionNote").value = record?.note || "";
    $("#reflectionSaveNote").textContent = record ? "この日の振り返りを編集中です。保存すると内容を更新します。" : "同じ日を保存すると、以前の内容を更新します。";
  }

  function renderReflectionHistory() {
    const records = [...state.data.reflections].sort((a, b) => b.date.localeCompare(a.date));
    $("#reflectionHistoryCount").textContent = `${records.length}日分`;
    $("#reflectionHistory").innerHTML = records.map((record) => {
      const details = [["よかったこと", record.good], ["気づいたこと", record.learned], ["明日やること", record.tomorrow], ["ひとことメモ", record.note]]
        .map(([label, value]) => `<div class="reflection-detail"><dt>${label}</dt><dd>${value ? escapeHTML(value) : '<span class="reflection-empty">未記入</span>'}</dd></div>`).join("");
      const completed = Number(record.completedCount) || 0;
      const habits = Number(record.habitCount) || 0;
      return `<article class="reflection-card">
        <div class="reflection-card-head"><div><span class="reflection-face">${moodFaces[record.mood] || moodFaces[3]}</span><div><strong>${formatFullDate(record.date)}</strong><small>${moodNames[record.mood] || moodNames[3]}</small></div></div><div><button type="button" data-edit-reflection="${record.date}">編集</button><button type="button" class="danger-text" data-delete-reflection="${record.id}">削除</button></div></div>
        <dl class="reflection-details">${details}</dl>
        <footer><span>完了 ${completed}件</span><span>習慣 ${habits}件</span></footer>
      </article>`;
    }).join("") || '<div class="empty-state"><strong>振り返りはまだありません</strong><span>今日の気分や、よかったことから記録してみましょう。</span></div>';
  }

  function renderReflection(date = $("#reflectionDate").value || todayISO) {
    renderReflectionWeek(date);
    renderReflectionSummary(date);
    loadReflectionForm(date);
    renderReflectionHistory();
  }

  function renderBulkBar() {
    const visibleSelected = [...state.selected].filter((id) => state.data.tasks.some((task) => task.id === id));
    state.selected = new Set(visibleSelected);
    elements.bulkBar.hidden = !visibleSelected.length;
    elements.selectedCount.textContent = `${visibleSelected.length}件選択`;
  }

  function render() {
    renderCounts();
    renderProjects();
    renderNavigation();
    const home = state.view === "inbox" && !state.projectId;
    document.body.classList.toggle("home-page", home);
    elements.taskWorkspace.classList.toggle("home-mode", home);
    const special = ["overview", "documents", "habits", "records", "calendar", "collections", "budget", "data", "reflection", "help"].includes(state.view);
    elements.taskWorkspace.hidden = special;
    elements.overviewWorkspace.hidden = state.view !== "overview";
    elements.documentsWorkspace.hidden = state.view !== "documents";
    elements.habitsWorkspace.hidden = state.view !== "habits";
    elements.recordsWorkspace.hidden = state.view !== "records";
    elements.calendarWorkspace.hidden = state.view !== "calendar";
    elements.collectionsWorkspace.hidden = state.view !== "collections";
    elements.budgetWorkspace.hidden = state.view !== "budget";
    elements.dataWorkspace.hidden = state.view !== "data";
    elements.reflectionWorkspace.hidden = state.view !== "reflection";
    elements.helpWorkspace.hidden = state.view !== "help";
    if (state.view === "overview") renderOverview();
    else if (state.view === "documents") renderDocuments();
    else if (state.view === "habits") renderHabits();
    else if (state.view === "records") renderLogs();
    else if (state.view === "calendar") renderCombinedCalendar();
    else if (state.view === "collections") renderCollections();
    else if (state.view === "budget") renderBudget();
    else if (state.view === "data") renderDataSummary();
    else if (state.view === "reflection") renderReflection();
    else if (state.view !== "help") {
      renderHeading();
      renderTasks();
      renderHomeJournal();
    }
  }

  function setView(view) {
    state.view = view;
    state.projectId = null;
    state.selected.clear();
    if (view === "week" && state.mode === "month") state.mode = "week";
    document.body.classList.remove("menu-open");
    render();
  }

  function openTask(id = "") {
    const task = state.data.tasks.find((item) => item.id === id);
    $("#taskId").value = task?.id || "";
    $("#taskTitle").value = task?.title || "";
    $("#taskFolder").value = task?.folder || "inbox";
    $("#taskDue").value = task?.due || "";
    $("#taskPriority").value = task?.priority || "medium";
    $("#taskTag").value = task?.tag || "";
    $("#taskProject").value = task?.projectId || state.projectId || "";
    $("#taskRepeat").value = task?.repeat || "";
    $("#taskPinned").checked = Boolean(task?.pinned);
    $("#taskNotes").value = task?.notes || "";
    $("#dialogKicker").textContent = task ? folderNames[task.folder] || "タスク" : "INBOX";
    $("#dialogTitle").textContent = task ? "INBOXの内容を編集" : "INBOXに追加";
    $("#deleteTask").hidden = !task;
    elements.taskDialog.showModal();
    setTimeout(() => $("#taskTitle").focus(), 50);
  }

  function createTask(input) {
    const title = String(input.title || "").trim();
    if (!title) throw new Error("タスク名を入力してください");
    const task = {
      id: uid(),
      title,
      folder: Object.keys(folderNames).includes(input.folder) ? input.folder : "inbox",
      due: input.due || "",
      priority: ["high", "medium", "low"].includes(input.priority) ? input.priority : "medium",
      tag: ["work", "private"].includes(input.tag) ? input.tag : "",
      projectId: input.projectId || null,
      repeat: ["daily", "weekly", "monthly"].includes(input.repeat) ? input.repeat : "",
      pinned: Boolean(input.pinned),
      notes: String(input.notes || ""),
      completed: false,
      completedAt: null,
      order: Date.now()
    };
    state.data.tasks.push(task);
    persist();
    render();
    return task;
  }

  function completeTask(id, completed) {
    const task = state.data.tasks.find((item) => item.id === id);
    if (!task) throw new Error("タスクが見つかりません");
    const wasCompleted = task.completed;
    task.completed = completed;
    task.completedAt = completed ? new Date().toISOString() : null;
    if (completed && !wasCompleted && task.repeat) {
      const base = fromISO(task.due) || today;
      const nextDue = new Date(base);
      if (task.repeat === "daily") nextDue.setDate(nextDue.getDate() + 1);
      if (task.repeat === "weekly") nextDue.setDate(nextDue.getDate() + 7);
      if (task.repeat === "monthly") nextDue.setMonth(nextDue.getMonth() + 1);
      state.data.tasks.push({ ...task, id: uid(), due: toISO(nextDue), completed: false, completedAt: null, pinned: false, order: Date.now() });
    }
    state.selected.delete(id);
    persist();
    render();
    return task;
  }

  function postpone(ids) {
    let changed = 0;
    ids.forEach((id) => {
      const task = state.data.tasks.find((item) => item.id === id && !item.completed);
      if (!task) return;
      task.due = toISO(addDays(fromISO(task.due) || today, 1));
      changed += 1;
    });
    if (!changed) return showToast("先送りするタスクを選択してください");
    state.selected.clear();
    persist();
    render();
    showToast(`${changed}件を明日へ先送りしました`);
  }

  document.addEventListener("click", (event) => {
    const viewButton = event.target.closest("[data-view]");
    if (viewButton) setView(viewButton.dataset.view);

    const projectButton = event.target.closest("[data-project]");
    if (projectButton) {
      state.projectId = projectButton.dataset.project;
      state.view = "projects";
      state.selected.clear();
      document.body.classList.remove("menu-open");
      render();
    }

    const modeButton = event.target.closest("[data-mode]");
    if (modeButton) {
      state.mode = modeButton.dataset.mode;
      render();
    }

    const taskElement = event.target.closest("[data-id]");
    if (taskElement && (event.target.closest(".task-body") || event.target.closest(".task-menu") || event.target.closest(".week-card") || event.target.closest(".calendar-task") || event.target.closest("tr"))) {
      openTask(taskElement.dataset.id);
    }

    const closeButton = event.target.closest("[data-close]");
    if (closeButton) $("#" + closeButton.dataset.close + "Dialog")?.close();

    const quick = event.target.closest("[data-quick]");
    if (quick?.dataset.quick === "postpone") postpone([...state.selected]);
    if (quick?.dataset.quick === "calendar") {
      state.view = "all";
      state.projectId = null;
      state.mode = "month";
      render();
    }
  });

  $("#quickAddForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const text = $("#quickTaskInput").value.trim();
    const type = $("#quickType").value;
    if (type === "task") {
      createTask({ title: text, priority: $("#quickPriority").value, folder: "inbox" });
      showToast("INBOXへ追加しました");
    } else if (type === "event") {
      state.data.events.push({ id: uid(), date: todayISO, title: text, createdAt: new Date().toISOString() });
      persist();
      render();
      showToast("今日の予定へ追加しました");
    } else {
      createLog(type, text, todayISO);
      render();
      showToast("今日の記録へ追加しました");
    }
    $("#quickTaskInput").value = "";
  });

  $("#quickType").addEventListener("change", (event) => {
    $("#quickPriority").hidden = event.target.value !== "task";
  });

  $("#taskForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const id = $("#taskId").value;
    const values = {
      title: $("#taskTitle").value.trim(),
      folder: $("#taskFolder").value,
      due: $("#taskDue").value,
      priority: $("#taskPriority").value,
      tag: $("#taskTag").value,
      projectId: $("#taskProject").value || null,
      repeat: $("#taskRepeat").value,
      pinned: $("#taskPinned").checked,
      notes: $("#taskNotes").value.trim()
    };
    if (!values.title) return;
    if (id) {
      const task = state.data.tasks.find((item) => item.id === id);
      if (task) Object.assign(task, values);
      persist();
      render();
      showToast("変更を保存しました");
    } else {
      createTask(values);
      showToast("タスクを追加しました");
    }
    elements.taskDialog.close();
  });

  $("#deleteTask").addEventListener("click", () => {
    const id = $("#taskId").value;
    if (!id || !window.confirm("このタスクを削除しますか？")) return;
    state.data.tasks = state.data.tasks.filter((task) => task.id !== id);
    state.selected.delete(id);
    persist();
    render();
    elements.taskDialog.close();
    showToast("タスクを削除しました");
  });

  elements.taskContent.addEventListener("change", (event) => {
    const row = event.target.closest(".task-row");
    if (!row) return;
    if (event.target.matches(".select-task")) {
      if (event.target.checked) state.selected.add(row.dataset.id);
      else state.selected.delete(row.dataset.id);
      renderBulkBar();
    }
    if (event.target.matches(".complete-task")) {
      completeTask(row.dataset.id, event.target.checked);
      showToast(event.target.checked ? "完了しました" : "未完了に戻しました");
    }
  });

  elements.taskContent.addEventListener("keydown", (event) => {
    if ((event.key === "Enter" || event.key === " ") && event.target.matches(".task-body")) openTask(event.target.closest(".task-row").dataset.id);
  });

  elements.taskContent.addEventListener("dragstart", (event) => {
    const row = event.target.closest(".task-row");
    if (!row) return;
    state.draggedId = row.dataset.id;
  });
  elements.taskContent.addEventListener("dragover", (event) => event.preventDefault());
  elements.taskContent.addEventListener("drop", (event) => {
    event.preventDefault();
    const target = event.target.closest(".task-row");
    if (!target || !state.draggedId || target.dataset.id === state.draggedId) return;
    const ordered = filteredTasks();
    const from = ordered.findIndex((task) => task.id === state.draggedId);
    const to = ordered.findIndex((task) => task.id === target.dataset.id);
    if (from < 0 || to < 0) return;
    const [moved] = ordered.splice(from, 1);
    ordered.splice(to, 0, moved);
    ordered.forEach((task, index) => { task.order = index + 1; });
    persist();
    renderTasks();
  });

  $("#bulkBar").addEventListener("click", (event) => {
    const action = event.target.closest("[data-bulk]")?.dataset.bulk;
    if (!action) return;
    if (action === "tomorrow") postpone([...state.selected]);
    if (action === "complete") {
      [...state.selected].forEach((id) => completeTask(id, true));
      state.selected.clear();
      persist();
      render();
      showToast("選択したタスクを完了しました");
    }
    if (action === "clear") {
      state.selected.clear();
      renderTasks();
    }
  });

  $("#bulkFolder").addEventListener("change", (event) => {
    const folder = event.target.value;
    if (!folder) return;
    if (!folderNames[folder]) { openRoute([...state.selected], folder); event.target.value = ""; return; }
    state.data.tasks.forEach((task) => { if (state.selected.has(task.id)) task.folder = folder; });
    state.selected.clear();
    event.target.value = "";
    persist();
    render();
    showToast("フォルダーを移動しました");
  });


  let routeIds = [];
  function openRoute(ids, destination = "records") {
    routeIds = ids;
    $("#routeDestination").value = destination;
    $("#routeDate").value = state.data.tasks.find(t => t.id === ids[0])?.due || todayISO;
    $("#routeSummary").textContent = ids.length + "件を振り分けます";
    $("#routeError").textContent = "";
    $("#routeMoney").hidden = destination !== "budget";
    $("#routeAmount").required = destination === "budget";
    $("#routeDialog").showModal();
  }
  $("#routeCancel").addEventListener("click", () => $("#routeDialog").close());
  $("#routeDestination").addEventListener("change", e => {
    $("#routeMoney").hidden = e.target.value !== "budget";
    $("#routeAmount").required = e.target.value === "budget";
  });
  $("#routeItemBtn").addEventListener("click", () => {
    if (!$("#taskTitle").value.trim()) { $("#taskTitle").focus(); return; }
    const before = new Set(state.data.tasks.map(t => t.id));
    const id = $("#taskId").value;
    $("#taskForm").requestSubmit();
    if (elements.taskDialog.open) return;
    openRoute([id || state.data.tasks.find(t => !before.has(t.id)).id]);
  });
  $("#routeForm").addEventListener("submit", e => {
    e.preventDefault();
    const destination = $("#routeDestination").value;
    const date = $("#routeDate").value;
    const category = $("#routeCategory").value.trim() || "INBOXから";
    const amount = Number($("#routeAmount").value);
    const next = JSON.parse(JSON.stringify(state.data));
    try {
      if (!date || !["records","calendar","habits","collections","documents","budget","reflection"].includes(destination)) throw new Error("振り分け先と日付を確認してください");
      if (destination === "budget" && (!Number.isSafeInteger(amount) || amount <= 0)) throw new Error("金額は1円以上の整数で入力してください");
      const items = next.tasks.filter(t => routeIds.includes(t.id));
      if (!items.length) throw new Error("振り分ける項目がありません");
      for (const item of items) {
        const text = [item.title, item.notes, item.url].filter(Boolean).join("\n");
        const base = { id: uid(), createdAt: new Date().toISOString(), inboxSource: item };
        if (destination === "records") next.logs.push({...base, date, type:"memo", text});
        if (destination === "calendar") next.events.push({...base, date, title:text});
        if (destination === "habits") next.habits.push({...base, name:text, dates:[]});
        if (destination === "collections") next.collectionItems.push({...base, category, text, done:Boolean(item.completed)});
        if (destination === "documents") next.documents.push({...base, title:text, url:/^https?:\/\//i.test(item.url || "") ? item.url : ""});
        if (destination === "budget") next.transactions.push({...base, date, category, amount, type:$("#routeMoneyType").value, note:text});
        if (destination === "reflection") {
          const old = next.reflections.find(r => r.date === date);
          if (old) { old.note = [old.note,text].filter(Boolean).join("\n"); (old.inboxSources ||= []).push(item); }
          else next.reflections.push({...base, date, mood:3, good:"", learned:"", tomorrow:"", note:text});
        }
      }
      next.tasks = next.tasks.filter(t => !routeIds.includes(t.id));
      // Write the complete result before replacing the live state; quota errors leave it intact.
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      state.data = next;
      state.selected.clear();
      state.calendarMonth = date.slice(0,7);
      state.logDate = date;
      if (destination === "reflection") $("#reflectionDate").value = date;
      if (destination === "budget") $("#budgetMonth").value = date.slice(0,7);
      $("#routeDialog").close();
      setView(destination);
      showToast(items.length + "件を振り分けました");
    } catch (error) { $("#routeError").textContent = error.message; }
  });

  $("#newTaskBtn").addEventListener("click", () => openTask());
  $("#headingAddBtn").addEventListener("click", () => openTask());
  $("#mobileAdd").addEventListener("click", () => openTask());
  $("#mobileMenu").addEventListener("click", () => document.body.classList.toggle("menu-open"));
  $("#newProjectBtn").addEventListener("click", () => elements.projectDialog.showModal());

  $("#projectForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const name = $("#projectName").value.trim();
    if (!name) return;
    state.data.projects.push({ id: uid(), name, color: $("#projectColor").value });
    $("#projectName").value = "";
    persist();
    render();
    elements.projectDialog.close();
    showToast("プロジェクトを追加しました");
  });

  $("#searchInput").addEventListener("input", (event) => {
    state.search = event.target.value.trim();
    if (!["overview", "documents", "habits", "records", "calendar", "collections", "budget", "data", "reflection", "help"].includes(state.view)) renderTasks();
  });
  $("#tagFilter").addEventListener("change", (event) => { state.tag = event.target.value; renderTasks(); });
  $("#priorityFilter").addEventListener("change", (event) => { state.priority = event.target.value; renderTasks(); });

  $("#documentForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const title = $("#documentTitle").value.trim();
    if (!title) return;
    state.data.documents.push({ id: uid(), title, url: $("#documentUrl").value.trim() });
    $("#documentTitle").value = "";
    $("#documentUrl").value = "";
    persist();
    renderDocuments();
    showToast("ドキュメントを追加しました");
  });
  $("#documentList").addEventListener("click", (event) => {
    const id = event.target.closest("[data-delete-document]")?.dataset.deleteDocument;
    if (!id || !window.confirm("このドキュメントを削除しますか？")) return;
    state.data.documents = state.data.documents.filter((item) => item.id !== id);
    persist();
    renderDocuments();
  });

  $("#habitForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const name = $("#habitName").value.trim();
    if (!name) return;
    state.data.habits.push({ id: uid(), name, dates: [] });
    $("#habitName").value = "";
    persist();
    renderHabits();
    showToast("習慣を追加しました");
  });
  $("#habitList").addEventListener("change", (event) => {
    const id = event.target.dataset.habit;
    const habit = state.data.habits.find((item) => item.id === id);
    if (!habit) return;
    habit.dates = Array.isArray(habit.dates) ? habit.dates : [];
    if (event.target.checked && !habit.dates.includes(todayISO)) habit.dates.push(todayISO);
    if (!event.target.checked) habit.dates = habit.dates.filter((date) => date !== todayISO);
    persist();
    renderHabits();
  });
  $("#habitList").addEventListener("click", (event) => {
    const id = event.target.closest("[data-delete-habit]")?.dataset.deleteHabit;
    if (!id || !window.confirm("この習慣を削除しますか？")) return;
    state.data.habits = state.data.habits.filter((item) => item.id !== id);
    persist();
    renderHabits();
  });

  $("#habitCalendarPrev").addEventListener("click", () => { state.habitMonth = changeMonth(state.habitMonth, -1); renderHabitCalendar(); });
  $("#habitCalendarNext").addEventListener("click", () => { state.habitMonth = changeMonth(state.habitMonth, 1); renderHabitCalendar(); });

  $("#homeLogForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const date = $("#homeLogDate").value;
    if (!createLog($("#homeLogType").value, $("#homeLogText").value, date, $("#homeLogTime").value)) return;
    $("#homeLogText").value = "";
    $("#homeLogTime").value = "";
    state.logDate = date;
    renderHomeJournal();
    showToast("手帳に記録しました");
  });
  $("#homeLogDate").addEventListener("change", renderHomeJournal);

  $("#logForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const date = $("#logDate").value;
    if (!createLog($("#logType").value, $("#logText").value, date, $("#logTime").value)) return;
    $("#logText").value = "";
    $("#logTime").value = "";
    state.logDate = date;
    state.showAllLogs = false;
    renderLogs();
    showToast("記録を追加しました");
  });
  $("#logFilterDate").addEventListener("change", (event) => {
    state.logDate = event.target.value || todayISO;
    state.showAllLogs = false;
    renderLogs();
  });
  $("#showAllLogs").addEventListener("click", () => {
    state.showAllLogs = !state.showAllLogs;
    renderLogs();
  });
  $("#logList").addEventListener("click", (event) => {
    const editId = event.target.closest("[data-edit-log]")?.dataset.editLog;
    if (editId) {
      const record = state.data.logs.find((item) => item.id === editId);
      if (!record) return;
      $("#logEditId").value = record.id;
      $("#logEditDate").value = record.date || todayISO;
      $("#logEditTime").value = record.time || "";
      $("#logEditType").value = logTypeNames[record.type] ? record.type : "memo";
      $("#logEditText").value = record.text || "";
      $("#logEditDialog").showModal();
      return;
    }
    const id = event.target.closest("[data-delete-log]")?.dataset.deleteLog;
    if (!id || !window.confirm("この記録を削除しますか？")) return;
    state.data.logs = state.data.logs.filter((item) => item.id !== id);
    persist();
    renderLogs();
    showToast("記録を削除しました");
  });
  $("#logEditForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const record = state.data.logs.find((item) => item.id === $("#logEditId").value);
    const date = $("#logEditDate").value;
    const text = $("#logEditText").value.trim();
    if (!record || !date || !text) return;
    const time = $("#logEditTime").value;
    Object.assign(record, {
      date,
      time: /^\d{2}:\d{2}$/.test(time) ? time : "",
      type: logTypeNames[$("#logEditType").value] ? $("#logEditType").value : "memo",
      text,
      updatedAt: new Date().toISOString()
    });
    state.logDate = date;
    persist();
    $("#logEditDialog").close();
    renderLogs();
    showToast("記録を更新しました");
  });

  $("#calendarPrev").addEventListener("click", () => { state.calendarMonth = changeMonth(state.calendarMonth, -1); renderCombinedCalendar(); });
  $("#calendarNext").addEventListener("click", () => { state.calendarMonth = changeMonth(state.calendarMonth, 1); renderCombinedCalendar(); });
  $("#monthGoalForm").addEventListener("submit", (event) => {
    event.preventDefault();
    state.data.monthlyGoals[state.calendarMonth] = $("#monthGoal").value.trim();
    persist();
    showToast("月間目標を保存しました");
  });
  $("#eventForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const timing = $("#eventTiming").value;
    const date = timing === "date" ? $("#eventDate").value : "";
    const month = timing === "month" ? $("#eventMonth").value : "";
    const title = $("#eventTitle").value.trim();
    if ((!date && !month) || !title) return;
    state.data.events.push({ id: uid(), date, month, title, createdAt: new Date().toISOString() });
    state.calendarMonth = date ? date.slice(0, 7) : month;
    $("#eventTitle").value = "";
    persist();
    renderCombinedCalendar();
    showToast("予定を追加しました");
  });
  $("#eventTiming").addEventListener("change", (event) => {
    const monthOnly = event.target.value === "month";
    $("#eventDate").hidden = monthOnly;
    $("#eventDate").required = !monthOnly;
    $("#eventMonth").hidden = !monthOnly;
    $("#eventMonth").required = monthOnly;
  });
  function setEventEditTiming(timing) {
    const monthOnly = timing === "month";
    $("#eventEditTiming").value = monthOnly ? "month" : "date";
    $("#eventEditDate").hidden = monthOnly;
    $("#eventEditDate").required = !monthOnly;
    $("#eventEditMonth").hidden = !monthOnly;
    $("#eventEditMonth").required = monthOnly;
    $("#eventEditScheduleLabel").textContent = monthOnly ? "月" : "日付";
  }
  function openEventEditor(id) {
    const item = state.data.events.find((entry) => entry.id === id);
    if (!item) return;
    $("#eventEditId").value = item.id;
    setEventEditTiming(item.date ? "date" : "month");
    $("#eventEditDate").value = item.date || todayISO;
    $("#eventEditMonth").value = item.month || item.date?.slice(0, 7) || state.calendarMonth;
    $("#eventEditTitle").value = item.title || "";
    $("#eventEditDialog").showModal();
  }
  $("#eventEditTiming").addEventListener("change", (event) => setEventEditTiming(event.target.value));
  $("#combinedCalendar").addEventListener("click", (event) => {
    const editId = event.target.closest("[data-edit-event]")?.dataset.editEvent;
    if (editId) openEventEditor(editId);
  });
  $("#eventEditForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const item = state.data.events.find((entry) => entry.id === $("#eventEditId").value);
    const monthOnly = $("#eventEditTiming").value === "month";
    const date = monthOnly ? "" : $("#eventEditDate").value;
    const month = monthOnly ? $("#eventEditMonth").value : "";
    const title = $("#eventEditTitle").value.trim();
    if (!item || (!date && !month) || !title) return;
    Object.assign(item, { date, month, title, updatedAt: new Date().toISOString() });
    state.calendarMonth = date ? date.slice(0, 7) : month;
    persist();
    $("#eventEditDialog").close();
    renderCombinedCalendar();
    showToast("予定を更新しました");
  });
  $("#deleteEventBtn").addEventListener("click", () => {
    const id = $("#eventEditId").value;
    if (!id || !window.confirm("この予定を削除しますか？")) return;
    state.data.events = state.data.events.filter((item) => item.id !== id);
    persist();
    $("#eventEditDialog").close();
    renderCombinedCalendar();
    showToast("予定を削除しました");
  });

  $("#collectionForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const category = $("#collectionCategory").value.trim();
    const text = $("#collectionItem").value.trim();
    const url = $("#collectionUrl").value.trim();
    if (!category || !text) return;
    if (url && !safeExternalURL(url)) return showToast("URLはhttpまたはhttpsで入力してください");
    const submitButton = event.currentTarget.querySelector("button[type='submit']");
    const originalLabel = submitButton.textContent;
    submitButton.disabled = true;
    submitButton.textContent = "画像を処理中…";
    try {
      const image = await collectionImageFromFile($("#collectionImage").files?.[0]);
      const item = { id: uid(), category, text, image, url, done: false, createdAt: new Date().toISOString() };
      state.data.collectionItems.push(item);
      try {
        persist();
      } catch (_) {
        state.data.collectionItems = state.data.collectionItems.filter((entry) => entry.id !== item.id);
        throw new Error("保存容量が足りません。画像を減らしてからもう一度お試しください");
      }
      $("#collectionItem").value = "";
      $("#collectionImage").value = "";
      $("#collectionUrl").value = "";
      renderCollections();
      showToast("コレクションへ追加しました");
    } catch (error) {
      showToast(error.message || "画像を追加できませんでした");
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = originalLabel;
    }
  });
  $("#collectionList").addEventListener("change", (event) => {
    const id = event.target.dataset.collectionCheck;
    const item = state.data.collectionItems.find((entry) => entry.id === id);
    if (!item) return;
    item.done = event.target.checked;
    persist();
    renderCollections();
  });
  $("#collectionList").addEventListener("click", (event) => {
    const id = event.target.closest("[data-delete-collection]")?.dataset.deleteCollection;
    if (!id || !window.confirm("この項目を削除しますか？")) return;
    state.data.collectionItems = state.data.collectionItems.filter((item) => item.id !== id);
    persist();
    renderCollections();
  });

  $("#budgetMonth").addEventListener("change", renderBudget);
  $("#budgetPlanForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const month = $("#budgetMonth").value;
    state.data.budgets[month] = Math.max(0, Number($("#budgetLimit").value) || 0);
    persist();
    renderBudget();
    showToast("予算を保存しました");
  });
  $("#transactionForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const date = $("#transactionDate").value;
    const amount = Math.max(0, Number($("#transactionAmount").value) || 0);
    const category = $("#transactionCategory").value.trim();
    if (!date || !amount || !category) return;
    state.data.transactions.push({ id: uid(), date, type: $("#transactionType").value, category, amount, note: $("#transactionNote").value.trim(), createdAt: new Date().toISOString() });
    $("#budgetMonth").value = date.slice(0, 7);
    $("#transactionAmount").value = "";
    $("#transactionNote").value = "";
    persist();
    renderBudget();
    showToast("家計簿へ登録しました");
  });
  $("#transactionList").addEventListener("click", (event) => {
    const id = event.target.closest("[data-delete-transaction]")?.dataset.deleteTransaction;
    if (!id || !window.confirm("この収支を削除しますか？")) return;
    state.data.transactions = state.data.transactions.filter((item) => item.id !== id);
    persist();
    renderBudget();
  });

  $("#reflectionForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const date = $("#reflectionDate").value;
    if (!date) return;
    const summary = reflectionDataFor(date);
    const values = {
      date,
      mood: Number($("[name='reflectionMood']:checked")?.value || 3),
      good: $("#reflectionGood").value.trim(),
      learned: $("#reflectionLearned").value.trim(),
      tomorrow: $("#reflectionTomorrow").value.trim(),
      note: $("#reflectionNote").value.trim(),
      completedTasks: summary.completedTasks,
      completedCount: summary.completedTasks.length,
      completedHabits: summary.completedHabits,
      habitCount: summary.completedHabits.length,
      updatedAt: new Date().toISOString()
    };
    const existing = state.data.reflections.find((item) => item.date === date);
    if (existing) Object.assign(existing, values);
    else state.data.reflections.push({ id: uid(), ...values, createdAt: new Date().toISOString() });
    persist();
    renderReflection(date);
    showToast(existing ? "振り返りを更新しました" : "振り返りを保存しました");
  });

  $("#reflectionDate").addEventListener("change", (event) => renderReflection(event.target.value || todayISO));

  $("#reflectionWeek").addEventListener("click", (event) => {
    const date = event.target.closest("[data-reflection-date]")?.dataset.reflectionDate;
    if (date) renderReflection(date);
  });

  $("#reflectionHistory").addEventListener("click", (event) => {
    const editDate = event.target.closest("[data-edit-reflection]")?.dataset.editReflection;
    if (editDate) {
      renderReflection(editDate);
      elements.reflectionWorkspace.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const id = event.target.closest("[data-delete-reflection]")?.dataset.deleteReflection;
    if (!id || !window.confirm("この振り返りを削除しますか？")) return;
    state.data.reflections = state.data.reflections.filter((item) => item.id !== id);
    persist();
    renderReflection($("#reflectionDate").value || todayISO);
    showToast("振り返りを削除しました");
  });

  const settings = loadJSON(SETTINGS_KEY, {});
  if (settings.dark) document.body.classList.add("dark");
  $("#themeBtn").addEventListener("click", () => {
    document.body.classList.toggle("dark");
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ dark: document.body.classList.contains("dark") }));
  });

  $("#backupBtn").addEventListener("click", () => elements.backupDialog.showModal());
  $("#exportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `ハチロク手帳_バックアップ_${todayISO}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    showToast("バックアップを書き出しました");
  });
  $("#importInput").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        state.data = normalizeData(JSON.parse(reader.result));
        persist();
        render();
        elements.backupDialog.close();
        showToast("バックアップを復元しました");
      } catch (_) {
        showToast("このファイルは読み込めません");
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  });
  $("#dataExportBtn").addEventListener("click", () => $("#exportBtn").click());
  $("#dataBackupBtn").addEventListener("click", () => elements.backupDialog.showModal());
  $("#dataImportInput").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        state.data = normalizeData(JSON.parse(reader.result));
        persist();
        render();
        showToast("バックアップを復元しました");
      } catch (_) {
        showToast("このファイルは読み込めません");
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  });
  $("#clearDataBtn").addEventListener("click", () => {
    if (!window.confirm("すべてのデータを削除しますか？この操作は取り消せません。")) return;
    state.data = emptyData();
    state.selected.clear();
    persist();
    render();
    elements.backupDialog.close();
    showToast("全データを削除しました");
  });

  let installPrompt;
  const installBtn = $("#installBtn");
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    installBtn.hidden = false;
  });
  installBtn.addEventListener("click", async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    installBtn.hidden = true;
  });

  if (Array.isArray(loadedData?.futureItems) && loadedData.futureItems.length) persist();

  window.hachirokuApp = {
    replaceData(next) {
      state.data = normalizeData(next);
      render();
    }
  };

  if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js?v=37"));

  function registerWebMCP() {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const tools = [
      {
        name: "create_task",
        title: "タスクをINBOXへ追加",
        description: "ハチロク手帳のINBOXへ新しいタスクを追加します。",
        inputSchema: { type: "object", properties: { title: { type: "string" }, due: { type: "string" }, priority: { type: "string", enum: ["high", "medium", "low"] }, notes: { type: "string" } }, required: ["title"], additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute(input) {
          if (!input || typeof input.title !== "string" || (input.due && !/^\d{4}-\d{2}-\d{2}$/.test(input.due))) throw new Error("入力内容が正しくありません");
          const task = createTask({ ...input, folder: "inbox" });
          return { id: task.id, title: task.title, folder: task.folder, due: task.due };
        }
      },
      {
        name: "list_tasks",
        title: "タスク一覧",
        description: "現在のタスクを取得します。",
        inputSchema: { type: "object", properties: { folder: { type: "string", enum: ["inbox", "next", "remind", "waiting", "project", "wish"] }, status: { type: "string", enum: ["open", "completed", "all"] } }, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute(input = {}) {
          return state.data.tasks.filter((task) => (!input.folder || task.folder === input.folder) && (input.status === "all" || (input.status === "completed" ? task.completed : !task.completed))).map(({ id, title, folder, due, priority, completed }) => ({ id, title, folder, due, priority, completed }));
        }
      },
      {
        name: "complete_task",
        title: "タスクを完了",
        description: "指定したタスクを完了状態にします。",
        inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute(input) {
          const task = completeTask(input?.id, true);
          return { id: task.id, title: task.title, completed: true };
        }
      }
    ];
    tools.forEach((tool) => {
      try { Promise.resolve(context.registerTool(tool)).catch(() => {}); } catch (_) {}
    });
  }

  render();
  registerWebMCP();
})();
