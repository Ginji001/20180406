(() => {
  "use strict";

  const STORAGE_KEY = "hachiware-todo-v1";
  const SETTINGS_KEY = "hachiware-todo-settings-v1";
  const pad = (value) => String(value).padStart(2, "0");
  const toISO = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const fromISO = (value) => {
    if (!value) return null;
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  };
  const addDays = (base, amount) => {
    const value = new Date(base);
    value.setDate(value.getDate() + amount);
    return value;
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = toISO(today);

  const initialData = {
    projects: [
      { id: "personal", name: "暮らし", color: "#ffb84d" },
      { id: "beauty", name: "美容・スキンケア", color: "#d84a7f" },
      { id: "training", name: "筋トレ", color: "#6c7cff" }
    ],
    tasks: [
      { id: crypto.randomUUID(), title: "今日やることを3つに絞る", due: todayISO, priority: "high", projectId: "personal", notes: "最重要のタスクから始める", completed: false, completedAt: null, order: 1 },
      { id: crypto.randomUUID(), title: "スキンケアの使用感を記録", due: todayISO, priority: "medium", projectId: "beauty", notes: "刺激・ベタつき・翌朝の状態", completed: false, completedAt: null, order: 2 },
      { id: crypto.randomUUID(), title: "次回のトレーニング重量を確認", due: toISO(addDays(today, 1)), priority: "low", projectId: "training", notes: "", completed: false, completedAt: null, order: 3 }
    ]
  };

  const loadData = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved?.tasks && saved?.projects) return saved;
    } catch (error) {
      console.warn("保存データを読み込めませんでした", error);
    }
    return initialData;
  };

  const state = {
    data: loadData(),
    view: "today",
    selectedDate: todayISO,
    projectId: null,
    statusFilter: "open",
    priorityFilter: "all",
    search: "",
    draggedId: null
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const elements = {
    taskList: $("#taskList"), emptyState: $("#emptyState"), visibleCount: $("#visibleCount"),
    viewTitle: $("#viewTitle"), listTitle: $("#listTitle"), todayLabel: $("#todayLabel"),
    quickTaskInput: $("#quickTaskInput"), quickDate: $("#quickDate"), quickPriority: $("#quickPriority"),
    quickProject: $("#quickProject"), editProject: $("#editProject"), projectList: $("#projectList"),
    taskDialog: $("#taskDialog"), projectDialog: $("#projectDialog"), toast: $("#toast"),
    progressRing: $("#progressRing"), progressValue: $("#progressValue"), progressText: $("#progressText"),
    weekStrip: $("#weekStrip")
  };

  const persist = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
  const escapeHTML = (value = "") => value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
  const projectById = (id) => state.data.projects.find((project) => project.id === id);
  const priorityLabel = { high: "高", medium: "普通", low: "低" };
  const viewNames = { today: "今日", inbox: "受信箱", upcoming: "今後の予定", all: "すべて", completed: "完了" };

  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => elements.toast.classList.remove("show"), 1800);
  }

  function formatDate(value) {
    const date = fromISO(value);
    if (!date) return "期限なし";
    if (value === todayISO) return "今日";
    if (value === toISO(addDays(today, 1))) return "明日";
    return `${date.getMonth() + 1}/${date.getDate()}（${"日月火水木金土"[date.getDay()]}）`;
  }

  function filterTasks() {
    let tasks = [...state.data.tasks];
    if (state.projectId) tasks = tasks.filter((task) => task.projectId === state.projectId);
    else if (state.view === "today") tasks = tasks.filter((task) => task.due === state.selectedDate);
    else if (state.view === "inbox") tasks = tasks.filter((task) => !task.projectId);
    else if (state.view === "upcoming") tasks = tasks.filter((task) => task.due && task.due > todayISO);
    else if (state.view === "completed") tasks = tasks.filter((task) => task.completed);

    if (state.view !== "completed" && state.statusFilter === "open") tasks = tasks.filter((task) => !task.completed);
    if (state.priorityFilter !== "all") tasks = tasks.filter((task) => task.priority === state.priorityFilter);
    if (state.search) {
      const query = state.search.toLocaleLowerCase("ja");
      tasks = tasks.filter((task) => `${task.title} ${task.notes || ""}`.toLocaleLowerCase("ja").includes(query));
    }
    return tasks.sort((a, b) => (a.completed - b.completed) || ((a.order || 0) - (b.order || 0)));
  }

  function renderProjects() {
    elements.projectList.innerHTML = state.data.projects.map((project) => {
      const count = state.data.tasks.filter((task) => task.projectId === project.id && !task.completed).length;
      return `<button class="project-button ${state.projectId === project.id ? "active" : ""}" data-project="${project.id}"><span class="project-dot" style="background:${project.color}"></span><span>${escapeHTML(project.name)}</span><span class="count">${count}</span></button>`;
    }).join("");

    const options = `<option value="">受信箱</option>${state.data.projects.map((project) => `<option value="${project.id}">${escapeHTML(project.name)}</option>`).join("")}`;
    elements.quickProject.innerHTML = options;
    elements.editProject.innerHTML = options;
  }

  function renderWeek() {
    const start = addDays(today, -3);
    const taskDates = new Set(state.data.tasks.filter((task) => !task.completed).map((task) => task.due));
    elements.weekStrip.innerHTML = Array.from({ length: 7 }, (_, index) => addDays(start, index)).map((date) => {
      const iso = toISO(date);
      return `<button class="day-button ${state.view === "today" && state.selectedDate === iso ? "active" : ""} ${taskDates.has(iso) ? "has-task" : ""}" data-date="${iso}"><span class="day-name">${"日月火水木金土"[date.getDay()]}</span><span class="day-num">${date.getDate()}</span><span class="day-dot"></span></button>`;
    }).join("");
  }

  function renderCounts() {
    const tasks = state.data.tasks;
    const counts = {
      today: tasks.filter((task) => task.due === todayISO && !task.completed).length,
      inbox: tasks.filter((task) => !task.projectId && !task.completed).length,
      upcoming: tasks.filter((task) => task.due && task.due > todayISO && !task.completed).length,
      all: tasks.filter((task) => !task.completed).length,
      completed: tasks.filter((task) => task.completed).length
    };
    Object.entries(counts).forEach(([key, count]) => {
      const item = document.querySelector(`[data-count="${key}"]`);
      if (item) item.textContent = count;
    });
  }

  function renderProgress() {
    const tasks = state.data.tasks.filter((task) => task.due === todayISO);
    const done = tasks.filter((task) => task.completed).length;
    const percent = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
    elements.progressRing.style.setProperty("--progress", `${percent * 3.6}deg`);
    elements.progressValue.textContent = `${percent}%`;
    elements.progressText.textContent = `${tasks.length}件中${done}件完了`;
  }

  function renderTasks() {
    const tasks = filterTasks();
    elements.visibleCount.textContent = `${tasks.length}件`;
    elements.taskList.innerHTML = tasks.map((task) => {
      const project = projectById(task.projectId);
      return `<article class="task-card ${task.completed ? "completed" : ""}" draggable="true" data-id="${task.id}">
        <input class="task-check" type="checkbox" ${task.completed ? "checked" : ""} aria-label="${escapeHTML(task.title)}を完了にする" />
        <div class="task-main" tabindex="0" role="button" aria-label="${escapeHTML(task.title)}を編集">
          <p class="task-title">${escapeHTML(task.title)}</p>
          <div class="task-meta"><span>${formatDate(task.due)}</span>${project ? `<span class="meta-pill"><span class="project-dot" style="display:inline-block;margin-right:5px;background:${project.color}"></span>${escapeHTML(project.name)}</span>` : ""}<span class="meta-pill ${task.priority === "high" ? "priority-high" : ""}">優先度 ${priorityLabel[task.priority]}</span>${task.notes ? "<span>メモあり</span>" : ""}</div>
        </div>
        <button class="task-menu" aria-label="タスクを編集">•••</button>
      </article>`;
    }).join("");
    elements.emptyState.hidden = tasks.length > 0;
  }

  function updateHeading() {
    const date = fromISO(state.selectedDate);
    const dateLabel = new Intl.DateTimeFormat("ja-JP", { month: "long", day: "numeric", weekday: "long" }).format(date || today);
    elements.todayLabel.textContent = dateLabel;
    const project = projectById(state.projectId);
    const title = project ? project.name : viewNames[state.view];
    elements.viewTitle.textContent = title;
    elements.listTitle.textContent = state.search ? "検索結果" : `${title}のタスク`;
  }

  function renderNavigation() {
    $$('[data-view]').forEach((button) => button.classList.toggle("active", !state.projectId && button.dataset.view === state.view));
  }

  function render() {
    renderProjects();
    renderWeek();
    renderCounts();
    renderProgress();
    renderTasks();
    renderNavigation();
    updateHeading();
  }

  function setView(view) {
    state.view = view;
    state.projectId = null;
    if (view === "today") state.selectedDate = todayISO;
    document.body.classList.remove("menu-open");
    render();
  }

  function addTask(title, options = {}) {
    const cleanTitle = String(title || "").trim();
    if (!cleanTitle) throw new Error("タスク名を入力してください");
    const task = {
      id: crypto.randomUUID(), title: cleanTitle, due: options.due ?? state.selectedDate,
      priority: ["high", "medium", "low"].includes(options.priority) ? options.priority : "medium",
      projectId: options.projectId || null, notes: String(options.notes || ""), completed: false,
      completedAt: null, order: Date.now()
    };
    state.data.tasks.push(task);
    persist();
    render();
    return task;
  }

  function toggleTask(id, completed) {
    const task = state.data.tasks.find((item) => item.id === id);
    if (!task) throw new Error("タスクが見つかりません");
    task.completed = completed;
    task.completedAt = completed ? new Date().toISOString() : null;
    persist();
    render();
    return task;
  }

  function openTaskDialog(id) {
    const task = state.data.tasks.find((item) => item.id === id);
    if (!task) return;
    $("#editId").value = task.id;
    $("#editTitle").value = task.title;
    $("#editDate").value = task.due || "";
    $("#editPriority").value = task.priority;
    $("#editProject").value = task.projectId || "";
    $("#editNotes").value = task.notes || "";
    elements.taskDialog.showModal();
  }

  $("#quickAddForm").addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      addTask(elements.quickTaskInput.value, { due: elements.quickDate.value || state.selectedDate, priority: elements.quickPriority.value, projectId: elements.quickProject.value || null });
      elements.quickTaskInput.value = "";
      showToast("タスクを追加しました");
    } catch (error) { showToast(error.message); }
  });

  document.addEventListener("click", (event) => {
    const viewButton = event.target.closest("[data-view]");
    if (viewButton) setView(viewButton.dataset.view);

    const projectButton = event.target.closest("[data-project]");
    if (projectButton) {
      state.projectId = projectButton.dataset.project;
      state.view = "all";
      document.body.classList.remove("menu-open");
      render();
    }

    const dayButton = event.target.closest("[data-date]");
    if (dayButton) {
      state.view = "today";
      state.projectId = null;
      state.selectedDate = dayButton.dataset.date;
      elements.quickDate.value = state.selectedDate;
      render();
    }

    const card = event.target.closest(".task-card");
    if (card && event.target.matches(".task-check")) {
      toggleTask(card.dataset.id, event.target.checked);
      showToast(event.target.checked ? "完了しました" : "未完了に戻しました");
    } else if (card && (event.target.closest(".task-main") || event.target.closest(".task-menu"))) {
      openTaskDialog(card.dataset.id);
    }
  });

  elements.taskList.addEventListener("keydown", (event) => {
    if ((event.key === "Enter" || event.key === " ") && event.target.classList.contains("task-main")) openTaskDialog(event.target.closest(".task-card").dataset.id);
  });

  elements.taskList.addEventListener("dragstart", (event) => {
    const card = event.target.closest(".task-card");
    if (!card) return;
    state.draggedId = card.dataset.id;
    card.classList.add("dragging");
  });
  elements.taskList.addEventListener("dragend", (event) => {
    event.target.closest(".task-card")?.classList.remove("dragging");
    state.draggedId = null;
  });
  elements.taskList.addEventListener("dragover", (event) => event.preventDefault());
  elements.taskList.addEventListener("drop", (event) => {
    event.preventDefault();
    const targetCard = event.target.closest(".task-card");
    if (!targetCard || !state.draggedId || targetCard.dataset.id === state.draggedId) return;
    const visible = filterTasks();
    const from = visible.findIndex((task) => task.id === state.draggedId);
    const to = visible.findIndex((task) => task.id === targetCard.dataset.id);
    const [moved] = visible.splice(from, 1);
    visible.splice(to, 0, moved);
    visible.forEach((task, index) => task.order = index + 1);
    persist();
    render();
  });

  $("#saveTask").addEventListener("click", (event) => {
    event.preventDefault();
    const task = state.data.tasks.find((item) => item.id === $("#editId").value);
    const title = $("#editTitle").value.trim();
    if (!task || !title) return;
    task.title = title;
    task.due = $("#editDate").value;
    task.priority = $("#editPriority").value;
    task.projectId = $("#editProject").value || null;
    task.notes = $("#editNotes").value.trim();
    persist(); render(); elements.taskDialog.close(); showToast("変更を保存しました");
  });

  $("#deleteTask").addEventListener("click", () => {
    if (!window.confirm("このタスクを削除しますか？")) return;
    const id = $("#editId").value;
    state.data.tasks = state.data.tasks.filter((task) => task.id !== id);
    persist(); render(); elements.taskDialog.close(); showToast("タスクを削除しました");
  });

  $("#newProjectBtn").addEventListener("click", () => elements.projectDialog.showModal());
  $("#projectForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const name = $("#projectName").value.trim();
    if (!name) return;
    state.data.projects.push({ id: crypto.randomUUID(), name, color: $("#projectColor").value });
    $("#projectName").value = "";
    persist(); render(); elements.projectDialog.close(); showToast("プロジェクトを追加しました");
  });

  $("#statusFilters").addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter]");
    if (!button) return;
    state.statusFilter = button.dataset.filter;
    $$("[data-filter]").forEach((item) => item.classList.toggle("active", item === button));
    renderTasks();
  });
  $("#priorityFilter").addEventListener("change", (event) => { state.priorityFilter = event.target.value; renderTasks(); });
  $("#searchInput").addEventListener("input", (event) => { state.search = event.target.value.trim(); renderTasks(); updateHeading(); });
  $("#mobileMenu").addEventListener("click", () => document.body.classList.toggle("menu-open"));
  $("#mobileAdd").addEventListener("click", () => { elements.quickTaskInput.scrollIntoView({ behavior: "smooth", block: "center" }); setTimeout(() => elements.quickTaskInput.focus(), 250); });

  let settings = {};
  try {
    settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  } catch (error) {
    console.warn("表示設定を読み込めませんでした", error);
  }
  if (settings.dark) document.body.classList.add("dark");
  $("#themeBtn").addEventListener("click", () => {
    document.body.classList.toggle("dark");
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ dark: document.body.classList.contains("dark") }));
  });

  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault(); $("#searchInput").focus();
    }
  });

  let installPrompt;
  const installBtn = $("#installBtn");
  window.addEventListener("beforeinstallprompt", (event) => { event.preventDefault(); installPrompt = event; installBtn.hidden = false; });
  installBtn.addEventListener("click", async () => { if (!installPrompt) return; installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; installBtn.hidden = true; });

  if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js"));

  function registerWebMCP() {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const safeDate = (value) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value);
    const tools = [
      {
        name: "create_task", title: "タスクを追加", description: "ハチワレTODOに新しいタスクを追加します。",
        inputSchema: { type: "object", properties: { title: { type: "string" }, due: { type: "string" }, priority: { type: "string", enum: ["high", "medium", "low"] }, notes: { type: "string" } }, required: ["title"], additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute(input) { if (!input || typeof input.title !== "string" || !safeDate(input.due)) throw new Error("入力内容が正しくありません"); const task = addTask(input.title, input); return { id: task.id, title: task.title, due: task.due }; }
      },
      {
        name: "list_tasks", title: "タスク一覧", description: "現在のタスクを取得します。",
        inputSchema: { type: "object", properties: { status: { type: "string", enum: ["open", "completed", "all"] } }, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute(input = {}) { return state.data.tasks.filter((task) => input.status === "all" || (input.status === "completed" ? task.completed : !task.completed)).map(({ id, title, due, priority, completed }) => ({ id, title, due, priority, completed })); }
      },
      {
        name: "complete_task", title: "タスクを完了", description: "指定したタスクを完了状態にします。",
        inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute(input) { const task = toggleTask(input?.id, true); return { id: task.id, title: task.title, completed: true }; }
      }
    ];
    tools.forEach((tool) => { try { Promise.resolve(context.registerTool(tool)).catch(() => {}); } catch (_) {} });
  }

  elements.quickDate.value = todayISO;
  render();
  registerWebMCP();
})();
