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
    version: 2,
    tasks: [],
    projects: [],
    documents: [],
    habits: []
  });

  function normalizeData(value) {
    const base = emptyData();
    if (!value || typeof value !== "object") return base;
    return {
      version: 2,
      tasks: Array.isArray(value.tasks) ? value.tasks : [],
      projects: Array.isArray(value.projects) ? value.projects : [],
      documents: Array.isArray(value.documents) ? value.documents : [],
      habits: Array.isArray(value.habits) ? value.habits : []
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

  const state = {
    data: normalizeData(loadJSON(STORAGE_KEY, emptyData())),
    view: "today",
    mode: "list",
    projectId: null,
    search: "",
    tag: "all",
    priority: "all",
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
    inbox: "受信箱",
    next: "Next Action",
    remind: "Remind",
    waiting: "Waiting",
    project: "Projects",
    wish: "Wish List"
  };
  const viewNames = {
    today: "今日",
    week: "次の7日間",
    all: "すべてのタスク",
    inbox: "受信箱",
    next: "Next Action",
    remind: "Remind",
    waiting: "Waiting",
    projects: "Projects",
    wish: "Wish List",
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

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
  }

  function escapeHTML(value = "") {
    return String(value).replace(/[&<>'"]/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    }[char]));
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
          <span class="pill">${folderNames[task.folder] || "受信箱"}</span>
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
        ["Pinned", tasks.filter((task) => task.pinned)],
        ["Inbox", tasks.filter((task) => !task.pinned && task.folder === "inbox")],
        ["Project / Action", tasks.filter((task) => !task.pinned && task.folder !== "inbox")]
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
    return `<table class="task-table"><thead><tr><th>タスク</th><th>フォルダー</th><th>期限</th><th>残り</th><th>タグ</th><th>優先度</th></tr></thead><tbody>${tasks.map((task) => `<tr data-id="${task.id}"><td>${escapeHTML(task.title)}</td><td>${folderNames[task.folder] || "受信箱"}</td><td>${formatDate(task.due)}</td><td>${daysText(task.due)}</td><td>${tagNames[task.tag] || "—"}</td><td>${priorityNames[task.priority] || "中"}</td></tr>`).join("")}</tbody></table>`;
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
    return '<div class="empty-state"><strong>タスクはありません</strong><span>思いついたことを受信箱へ追加してください。</span></div>';
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
    Object.entries(counts).forEach(([key, value]) => $$('[data-count="' + key + '"]').forEach((node) => { node.textContent = value; }));
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
    elements.viewTitle.textContent = project ? project.name : viewNames[state.view] || "今日";
    elements.viewDescription.textContent = project ? "このプロジェクトの未完了タスクです。" : descriptions[state.view] || "";
    elements.dateLabel.textContent = new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(today);
  }

  function renderNavigation() {
    $$("[data-view]").forEach((button) => button.classList.toggle("active", !state.projectId && button.dataset.view === state.view));
    $$("[data-mode]").forEach((button) => button.classList.toggle("active", button.dataset.mode === state.mode));
  }

  function renderOverview() {
    const tasks = state.data.tasks;
    const open = tasks.filter((task) => !task.completed);
    const dueToday = open.filter((task) => task.due && task.due <= todayISO).length;
    const completedToday = tasks.filter((task) => task.completedAt && toISO(new Date(task.completedAt)) === todayISO).length;
    $("#overviewGrid").innerHTML = [
      ["未完了", open.length],
      ["今日まで", dueToday],
      ["受信箱", open.filter((task) => task.folder === "inbox").length],
      ["今日の完了", completedToday],
      ["Next Action", open.filter((task) => task.folder === "next").length],
      ["Waiting", open.filter((task) => task.folder === "waiting").length],
      ["Projects", open.filter((task) => task.folder === "project").length],
      ["Wish List", open.filter((task) => task.folder === "wish").length]
    ].map(([label, value]) => `<article class="overview-card"><span>${label}</span><strong>${value}</strong></article>`).join("");
  }

  function renderDocuments() {
    $("#documentList").innerHTML = state.data.documents.map((item) => `<article class="simple-item">${item.url ? `<a href="${escapeHTML(item.url)}" target="_blank" rel="noopener">${escapeHTML(item.title)}</a>` : `<strong>${escapeHTML(item.title)}</strong>`}<button data-delete-document="${item.id}">削除</button></article>`).join("") || emptyState();
  }

  function renderHabits() {
    $("#habitList").innerHTML = state.data.habits.map((item) => {
      const done = Array.isArray(item.dates) && item.dates.includes(todayISO);
      return `<article class="habit-item"><input type="checkbox" data-habit="${item.id}" ${done ? "checked" : ""} aria-label="${escapeHTML(item.name)}を今日完了" /><label>${escapeHTML(item.name)}</label><button data-delete-habit="${item.id}">削除</button></article>`;
    }).join("") || emptyState();
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
    const special = ["overview", "documents", "habits"].includes(state.view);
    elements.taskWorkspace.hidden = special;
    elements.overviewWorkspace.hidden = state.view !== "overview";
    elements.documentsWorkspace.hidden = state.view !== "documents";
    elements.habitsWorkspace.hidden = state.view !== "habits";
    if (state.view === "overview") renderOverview();
    else if (state.view === "documents") renderDocuments();
    else if (state.view === "habits") renderHabits();
    else {
      renderHeading();
      renderTasks();
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
    $("#taskFolder").value = task?.folder || (state.view === "projects" ? "project" : folderNames[state.view] ? state.view : "inbox");
    $("#taskDue").value = task?.due || "";
    $("#taskPriority").value = task?.priority || "medium";
    $("#taskTag").value = task?.tag || "";
    $("#taskProject").value = task?.projectId || state.projectId || "";
    $("#taskRepeat").value = task?.repeat || "";
    $("#taskPinned").checked = Boolean(task?.pinned);
    $("#taskNotes").value = task?.notes || "";
    $("#dialogKicker").textContent = task ? folderNames[task.folder] || "TASK" : "INBOX";
    $("#dialogTitle").textContent = task ? "タスクを編集" : "タスクを追加";
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
    createTask({ title: $("#quickTaskInput").value, priority: $("#quickPriority").value, folder: "inbox" });
    $("#quickTaskInput").value = "";
    showToast("受信箱へ追加しました");
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
    state.data.tasks.forEach((task) => { if (state.selected.has(task.id)) task.folder = folder; });
    state.selected.clear();
    event.target.value = "";
    persist();
    render();
    showToast("フォルダーを移動しました");
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
    if (!["overview", "documents", "habits"].includes(state.view)) renderTasks();
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
  });
  $("#habitList").addEventListener("click", (event) => {
    const id = event.target.closest("[data-delete-habit]")?.dataset.deleteHabit;
    if (!id || !window.confirm("この習慣を削除しますか？")) return;
    state.data.habits = state.data.habits.filter((item) => item.id !== id);
    persist();
    renderHabits();
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
    link.download = `hachiware-todo-backup-${todayISO}.json`;
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

  if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js"));

  function registerWebMCP() {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const tools = [
      {
        name: "create_task",
        title: "タスクを受信箱へ追加",
        description: "ハチワレTODOの受信箱へ新しいタスクを追加します。",
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
