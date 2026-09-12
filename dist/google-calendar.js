
(() => {
  "use strict";

  const STORAGE_KEY = "hachiware-todo-gtd-v2";
  const SETTINGS_KEY = "hachiware-todo-settings-v2";
  const GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar.events";
  const GOOGLE_API_BASE = "https://www.googleapis.com/calendar/v3";
  const GOOGLE_TYPE_PROPERTY = "hachiwareTechoType";
  const GOOGLE_ID_PROPERTY = "hachiwareTechoId";
  const GOOGLE_COMPLETED_PROPERTY = "hachiwareTechoCompleted";
  const googleState = { token: null, expiresAt: 0, syncing: false, queued: false, statusMessage: "", statusTone: "", timer: null };

  const $ = (selector) => document.querySelector(selector);
  const pad = (value) => String(value).padStart(2, "0");
  const toISO = (date) => date ? date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) : "";
  const fromISO = (value) => {
    if (!value) return null;
    const parts = value.split("-").map(Number);
    const date = new Date(parts[0], parts[1] - 1, parts[2]);
    return Number.isNaN(date.getTime()) ? null : date;
  };
  const addDays = (base, amount) => {
    const date = new Date(base);
    date.setDate(date.getDate() + amount);
    return date;
  };
  const uid = () => window.crypto?.randomUUID?.() || Date.now() + "-" + Math.random().toString(16).slice(2);

  function loadJSON(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function appSettings() {
    const value = loadJSON(SETTINGS_KEY, {});
    const settings = value && typeof value === "object" ? value : {};
    settings.google = settings.google && typeof settings.google === "object" ? settings.google : {};
    settings.google.clientId = typeof settings.google.clientId === "string" ? settings.google.clientId : "";
    settings.google.calendarId = "primary";
    settings.google.known = Array.isArray(settings.google.known) ? settings.google.known : [];
    return settings;
  }

  function saveSettings(settings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  function appData() {
    const value = loadJSON(STORAGE_KEY, {});
    const data = value && typeof value === "object" ? value : {};
    data.tasks = Array.isArray(data.tasks) ? data.tasks : [];
    data.events = Array.isArray(data.events) ? data.events : [];
    return data;
  }

  function saveData(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function connected() {
    return Boolean(googleState.token && googleState.expiresAt > Date.now() + 5000);
  }

  function setStatus(message, tone) {
    googleState.statusMessage = message;
    googleState.statusTone = tone || "";
    const status = $("#googleCalendarStatus");
    const badge = $("#googleCalendarBadge");
    if (status) status.textContent = message;
    if (badge) {
      badge.className = "google-calendar-badge " + (tone || "");
      badge.textContent = tone === "connected" ? "接続中" : tone === "syncing" ? "同期中" : "未接続";
    }
  }

  function renderPanel() {
    const settings = appSettings();
    const clientInput = $("#googleClientId");
    const calendarInput = $("#googleCalendarId");
    const connectButton = $("#googleConnectBtn");
    const syncButton = $("#googleSyncBtn");
    const disconnectButton = $("#googleDisconnectBtn");
    if (!clientInput || !calendarInput || !connectButton || !syncButton || !disconnectButton) return;
    if (document.activeElement !== clientInput) clientInput.value = settings.google.clientId;
    calendarInput.value = "主カレンダー";
    connectButton.textContent = connected() ? "接続を更新" : "Googleカレンダーに接続";
    syncButton.disabled = !connected() || googleState.syncing;
    disconnectButton.hidden = !googleState.token;
    if (googleState.syncing) {
      setStatus("Googleカレンダーと同期しています…", "syncing");
    } else if (connected() && !googleState.statusMessage) {
      setStatus("接続中です。「今すぐ同期」で予定を反映します。", "connected");
    } else if (!connected() && googleState.token) {
      setStatus("接続の有効期限が切れました。もう一度接続してください。", "");
    } else if (!connected() && !googleState.statusMessage) {
      setStatus("未接続です。接続すると、期限のあるタスクと予定を同期できます。", "");
    }
  }

  function googleIdentityReady() {
    return Boolean(window.google?.accounts?.oauth2?.initTokenClient);
  }

  function waitForGoogleIdentity() {
    if (googleIdentityReady()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let checks = 0;
      const timer = window.setInterval(() => {
        checks += 1;
        if (googleIdentityReady()) {
          window.clearInterval(timer);
          resolve();
        } else if (checks >= 100) {
          window.clearInterval(timer);
          reject(new Error("Google認証の準備ができていません。ページを再読み込みしてください。"));
        }
      }, 50);
    });
  }

  function requestGoogleAccessToken() {
    return new Promise(async (resolve, reject) => {
      try {
        await waitForGoogleIdentity();
        const settings = appSettings();
        const client = window.google.accounts.oauth2.initTokenClient({
          client_id: settings.google.clientId,
          scope: GOOGLE_SCOPE,
          callback: (response) => {
            if (!response || response.error || !response.access_token) {
              reject(new Error(response?.error_description || "Googleの接続が許可されませんでした"));
              return;
            }
            const hasScope = window.google.accounts.oauth2.hasGrantedAllScopes;
            if (hasScope && !hasScope(response, GOOGLE_SCOPE)) {
              reject(new Error("Googleカレンダーへの許可が確認できませんでした"));
              return;
            }
            googleState.token = response.access_token;
            googleState.expiresAt = Date.now() + Math.max(60, Number(response.expires_in) || 3600) * 1000;
            resolve(response);
          }
        });
        client.requestAccessToken({ prompt: googleState.token ? "" : "consent" });
      } catch (error) {
        reject(error);
      }
    });
  }

  async function googleRequest(path, options) {
    if (!connected()) throw new Error("Googleカレンダーの接続が必要です");
    const requestOptions = options || {};
    const headers = new Headers(requestOptions.headers || {});
    headers.set("Authorization", "Bearer " + googleState.token);
    if (requestOptions.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const response = await fetch(GOOGLE_API_BASE + path, { ...requestOptions, headers });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (_) {}
    if (!response.ok) {
      if (response.status === 401) {
        googleState.token = null;
        googleState.expiresAt = 0;
      }
      const error = new Error(body?.error?.message || "Googleカレンダーとの通信に失敗しました（" + response.status + "）");
      error.status = response.status;
      throw error;
    }
    return body;
  }

  function remoteDate(remote) {
    return remote?.start?.date || remote?.start?.dateTime?.slice(0, 10) || "";
  }

  function remotePrivate(remote) {
    return remote?.extendedProperties?.private || {};
  }

  function remoteKey(remote) {
    const props = remotePrivate(remote);
    return props[GOOGLE_TYPE_PROPERTY] && props[GOOGLE_ID_PROPERTY] ? props[GOOGLE_TYPE_PROPERTY] + ":" + props[GOOGLE_ID_PROPERTY] : "";
  }

  function remoteTitle(remote) {
    return String(remote?.summary || "").replace(/^[・○✓]\s*/, "").trim() || "Googleカレンダーの予定";
  }

  function descriptors(data) {
    const items = [];
    data.tasks.filter((item) => item.due || item.googleEventId).forEach((item) => items.push({ kind: "task", id: item.id, item, date: item.due || "", title: item.title }));
    data.events.filter((item) => item.date || item.googleEventId).forEach((item) => items.push({ kind: "event", id: item.id, item, date: item.date || "", title: item.title }));
    return items;
  }

  function localItem(data, kind, id) {
    return kind === "task" ? data.tasks.find((item) => item.id === id) : data.events.find((item) => item.id === id);
  }

  function eventBody(descriptor) {
    const date = fromISO(descriptor.date);
    if (!date) return null;
    const symbol = descriptor.kind === "task" ? (descriptor.item.completed ? "✓" : "・") : "○";
    const label = descriptor.kind === "task" ? "タスク" : "予定";
    const notes = descriptor.kind === "task" && descriptor.item.notes ? "\nメモ：" + descriptor.item.notes : "";
    return {
      summary: symbol + " " + descriptor.title,
      description: "ハチロク手帳の" + label + "\nアプリと同期中" + notes,
      start: { date: descriptor.date },
      end: { date: toISO(addDays(date, 1)) },
      extendedProperties: { private: {
        [GOOGLE_TYPE_PROPERTY]: descriptor.kind,
        [GOOGLE_ID_PROPERTY]: descriptor.id,
        [GOOGLE_COMPLETED_PROPERTY]: descriptor.kind === "task" && descriptor.item.completed ? "1" : "0"
      } }
    };
  }

  async function listManaged(kind) {
    const events = [];
    let pageToken = "";
    do {
      const params = new URLSearchParams({ showDeleted: "false", singleEvents: "true", maxResults: "2500", privateExtendedProperty: GOOGLE_TYPE_PROPERTY + "=" + kind });
      if (pageToken) params.set("pageToken", pageToken);
      const result = await googleRequest("/calendars/primary/events?" + params.toString());
      events.push(...(result?.items || []));
      pageToken = result?.nextPageToken || "";
    } while (pageToken);
    return events;
  }

  function matches(remote, body) {
    const props = remotePrivate(remote);
    const expected = body.extendedProperties.private;
    return remote.summary === body.summary && remote.start?.date === body.start.date && remote.end?.date === body.end.date && (remote.description || "") === body.description && props[GOOGLE_TYPE_PROPERTY] === expected[GOOGLE_TYPE_PROPERTY] && props[GOOGLE_ID_PROPERTY] === expected[GOOGLE_ID_PROPERTY] && props[GOOGLE_COMPLETED_PROPERTY] === expected[GOOGLE_COMPLETED_PROPERTY];
  }

  async function deleteRemote(eventId) {
    try {
      await googleRequest("/calendars/primary/events/" + encodeURIComponent(eventId), { method: "DELETE" });
      return true;
    } catch (error) {
      if (error.status === 404) return true;
      throw error;
    }
  }

  function applyRemote(remote, kind, local) {
    const date = remoteDate(remote);
    if (!date || !local) return;
    local.title = remoteTitle(remote);
    if (kind === "task") {
      local.due = date;
      const props = remotePrivate(remote);
      const completed = props[GOOGLE_COMPLETED_PROPERTY] === "1" || /^✓\s*/.test(String(remote.summary || ""));
      local.completed = completed;
      local.completedAt = completed ? (local.completedAt || remote.updated || new Date().toISOString()) : null;
    } else {
      local.date = date;
    }
    local.googleEventId = remote.id;
    local.googleCalendarId = "primary";
    local.googleSyncedAt = remote.updated || new Date().toISOString();
  }

  function importRemote(remote, kind) {
    const props = remotePrivate(remote);
    const id = props[GOOGLE_ID_PROPERTY] || uid();
    const date = remoteDate(remote);
    if (!date) return null;
    const now = remote.updated || new Date().toISOString();
    const title = remoteTitle(remote);
    if (kind === "task") {
      const completed = props[GOOGLE_COMPLETED_PROPERTY] === "1" || /^✓\s*/.test(String(remote.summary || ""));
      const task = { id, title, folder: "inbox", due: date, priority: "medium", tag: "", projectId: null, repeat: "", pinned: false, notes: "", completed, completedAt: completed ? now : null, order: Date.now(), createdAt: now, updatedAt: now, googleEventId: remote.id, googleCalendarId: "primary", googleSyncedAt: now };
      data.tasks.push(task);
      return task;
    }
    const item = { id, date, title, createdAt: now, updatedAt: now, googleEventId: remote.id, googleCalendarId: "primary", googleSyncedAt: now };
    data.events.push(item);
    return item;
  }

  async function syncGoogleCalendar(silent) {
    if (!connected()) {
      if (!silent) window.alert("先にGoogleカレンダーへ接続してください");
      return false;
    }
    if (googleState.syncing) {
      googleState.queued = true;
      return false;
    }
    googleState.syncing = true;
    renderPanel();
    const stats = { created: 0, updated: 0, imported: 0, deleted: 0, pulled: 0 };
    const data = appData();
    const settings = appSettings();
    try {
      const remoteEvents = (await Promise.all(["task", "event"].map((kind) => listManaged(kind)))).flat();
      const remoteByKey = new Map(remoteEvents.map((remote) => [remoteKey(remote), remote]).filter(([key]) => key));
      const localKeys = new Set(descriptors(data).map((item) => item.kind + ":" + item.id));
      const known = settings.google.known;
      for (const knownItem of known) {
        if (!localKeys.has(knownItem.kind + ":" + knownItem.id)) {
          const remote = remoteByKey.get(knownItem.kind + ":" + knownItem.id);
          if (remote) {
            await deleteRemote(remote.id);
            remoteByKey.delete(knownItem.kind + ":" + knownItem.id);
            stats.deleted += 1;
          }
        }
      }

      const localByKey = new Map(descriptors(data).map((item) => [item.kind + ":" + item.id, item]));
      for (const remote of remoteEvents) {
        const key = remoteKey(remote);
        if (!key || !remoteByKey.has(key)) continue;
        const separator = key.indexOf(":");
        const kind = key.slice(0, separator);
        const id = key.slice(separator + 1);
        let local = localByKey.get(key);
        if (!local) {
          const created = importRemote(remote, kind);
          if (created) {
            local = { kind, id: created.id, item: created, date: kind === "task" ? created.due : created.date, title: created.title };
            localByKey.set(key, local);
            stats.imported += 1;
          }
        } else {
          const syncAt = local.item.googleSyncedAt;
          const localChanged = Boolean(local.item.updatedAt && syncAt && local.item.updatedAt > syncAt);
          const remoteChanged = Boolean(remote.updated && syncAt && remote.updated > syncAt);
          if (!localChanged && (remoteChanged || !syncAt)) {
            applyRemote(remote, kind, local.item);
            stats.pulled += 1;
          } else {
            local.item.googleEventId = remote.id;
            local.item.googleCalendarId = "primary";
          }
        }
      }

      for (const descriptor of descriptors(data)) {
        const item = descriptor.item;
        if (!descriptor.date) {
          if (item.googleEventId) {
            await deleteRemote(item.googleEventId);
            item.googleEventId = "";
            item.googleCalendarId = "";
            item.googleSyncedAt = "";
            stats.deleted += 1;
          }
          continue;
        }
        const key = descriptor.kind + ":" + descriptor.id;
        const remote = remoteByKey.get(key);
        const body = eventBody(descriptor);
        let response = remote;
        if (remote) {
          if (!matches(remote, body)) {
            response = await googleRequest("/calendars/primary/events/" + encodeURIComponent(remote.id), { method: "PUT", body: JSON.stringify(body) });
            stats.updated += 1;
          }
        } else if (item.googleEventId && item.googleCalendarId === "primary") {
          try {
            response = await googleRequest("/calendars/primary/events/" + encodeURIComponent(item.googleEventId), { method: "PUT", body: JSON.stringify(body) });
            stats.updated += 1;
          } catch (error) {
            if (error.status !== 404) throw error;
            response = await googleRequest("/calendars/primary/events", { method: "POST", body: JSON.stringify(body) });
            stats.created += 1;
          }
        } else {
          response = await googleRequest("/calendars/primary/events", { method: "POST", body: JSON.stringify(body) });
          stats.created += 1;
        }
        item.googleEventId = response?.id || item.googleEventId;
        item.googleCalendarId = "primary";
        item.googleSyncedAt = response?.updated || new Date().toISOString();
      }

      saveData(data);
      settings.google.known = descriptors(data).filter((item) => item.item.googleEventId).map((item) => ({ kind: item.kind, id: item.id, googleEventId: item.item.googleEventId }));
      saveSettings(settings);
      const summary = "同期完了：追加" + stats.created + "・更新" + stats.updated + "・取り込み" + stats.imported + "・削除" + stats.deleted;
      setStatus(summary, "connected");
      renderPanel();
      if (!silent) window.alert(summary);
      if (stats.imported || stats.pulled) window.setTimeout(() => window.location.reload(), 350);
      return true;
    } catch (error) {
      console.error("Googleカレンダー同期エラー", error);
      setStatus("同期できませんでした：" + error.message, "");
      renderPanel();
      if (!silent) window.alert("同期できませんでした：" + error.message);
      return false;
    } finally {
      googleState.syncing = false;
      renderPanel();
      if (googleState.queued) {
        googleState.queued = false;
        scheduleSync();
      }
    }
  }

  function scheduleSync() {
    if (!connected()) return;
    window.clearTimeout(googleState.timer);
    googleState.timer = window.setTimeout(() => syncGoogleCalendar(true), 700);
  }

  function init() {
    const clientInput = $("#googleClientId");
    const connectButton = $("#googleConnectBtn");
    const syncButton = $("#googleSyncBtn");
    const disconnectButton = $("#googleDisconnectBtn");
    if (!clientInput || !connectButton || !syncButton || !disconnectButton) return;
    clientInput.value = appSettings().google.clientId;
    clientInput.addEventListener("change", (event) => {
      const settings = appSettings();
      const value = event.target.value.trim();
      if (settings.google.clientId === value) return;
      settings.google.clientId = value;
      saveSettings(settings);
      googleState.token = null;
      googleState.expiresAt = 0;
      googleState.statusMessage = "";
      googleState.statusTone = "";
      renderPanel();
    });
    connectButton.addEventListener("click", async () => {
      const value = clientInput.value.trim();
      if (!value) {
        setStatus("クライアントIDを入力してください。", "");
        window.alert("クライアントIDを入力してください");
        return;
      }
      if (!value.endsWith(".apps.googleusercontent.com")) {
        setStatus("クライアントIDの形式を確認してください。", "");
        window.alert("クライアントIDの形式を確認してください");
        return;
      }
      const settings = appSettings();
      settings.google.clientId = value;
      saveSettings(settings);
      try {
        setStatus("Googleの認証画面を開いています…", "syncing");
        renderPanel();
        await requestGoogleAccessToken();
        await syncGoogleCalendar(false);
      } catch (error) {
        googleState.token = null;
        googleState.expiresAt = 0;
        setStatus("接続できませんでした：" + error.message, "");
        renderPanel();
        window.alert("接続できませんでした：" + error.message);
      }
    });
    syncButton.addEventListener("click", () => syncGoogleCalendar(false));
    disconnectButton.addEventListener("click", () => {
      if (googleState.token && window.google?.accounts?.oauth2?.revoke) window.google.accounts.oauth2.revoke(googleState.token, () => {});
      googleState.token = null;
      googleState.expiresAt = 0;
      googleState.statusMessage = "接続を解除しました。Googleカレンダーの予定は削除していません。";
      googleState.statusTone = "";
      renderPanel();
    });
    renderPanel();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
