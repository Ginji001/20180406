
(() => {
  "use strict";

  const STORAGE_KEY = "hachiware-todo-gtd-v2";
  const SETTINGS_KEY = "hachiware-todo-settings-v2";
  const GOOGLE_CLIENT_ID = "238820536565-803hh23m11f37hhie8oimt9i2kv53tfa.apps.googleusercontent.com";
  const GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar.app.created";
  const CALENDAR_MARKER = "hachiroku-techo-dedicated-v1";
  const GOOGLE_API_BASE = "https://www.googleapis.com/calendar/v3";
  const GOOGLE_TYPE_PROPERTY = "hachiwareTechoType";
  const GOOGLE_ID_PROPERTY = "hachiwareTechoId";
  const GOOGLE_COMPLETED_PROPERTY = "hachiwareTechoCompleted";
  const SHARED_CALENDAR_KEY = "google-calendar"; // v82：端末間で同じ専用カレンダーを使う
  const TOKEN_KEY = "hachiroku-google-token-v1"; // v83：再読み込みしても接続を保つ（有効期限まで）
  const AUTO_SYNC_MS = 5 * 60 * 1000; // v83：開いている間は5分ごとにGoogle側の変更を取り込む
  const googleState = { token: null, expiresAt: 0, syncing: false, queued: false, statusMessage: "", statusTone: "", timer: null };
  googleState.calendarId = "";

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
    settings.google.clientId = GOOGLE_CLIENT_ID;
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
    data.sharedSettings = Array.isArray(data.sharedSettings) ? data.sharedSettings : [];
    return data;
  }

  function saveData(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      // v82：アプリ側の画面データも更新（古いデータで上書きされないように）
      window.hachirokuApp?.replaceData?.(data);
    } catch (error) {
      window.hachirokuApp?.notifySaveError?.(error);
      throw error;
    }
  }

  function saveToken() {
    try {
      if (googleState.token) localStorage.setItem(TOKEN_KEY, JSON.stringify({ token: googleState.token, expiresAt: googleState.expiresAt }));
      else localStorage.removeItem(TOKEN_KEY);
    } catch (_) {}
  }

  function restoreToken() {
    const saved = loadJSON(TOKEN_KEY, null);
    if (saved && saved.token && Number(saved.expiresAt) > Date.now() + 60000) {
      googleState.token = saved.token;
      googleState.expiresAt = Number(saved.expiresAt);
    }
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
    calendarInput.value = "ハチロク手帳（専用カレンダー）";
    const restoreInput = $("#googleDedicatedCalendarId");
    if (restoreInput && document.activeElement !== restoreInput) restoreInput.value = settings.google.dedicatedCalendarId || "";
    connectButton.disabled = googleState.syncing;
    disconnectButton.disabled = googleState.syncing;
    connectButton.textContent = connected() ? "接続を更新" : "Googleカレンダーに接続";
    syncButton.disabled = !connected() || googleState.syncing;
    disconnectButton.hidden = !googleState.token;
    if (googleState.syncing) {
      setStatus("同期中…", "syncing");
    } else if (googleState.statusTone === "syncing" && googleState.lastResult) {
      setStatus(googleState.lastResult, googleState.lastTone);
    } else if (connected() && !googleState.statusMessage) {
      setStatus("接続中。自動で同期します。", "connected");
    } else if (!connected() && googleState.token) {
      setStatus("期限切れ。もう一度接続してください。", "");
    } else if (!connected() && !googleState.statusMessage) {
      setStatus("未接続です。", "");
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
          include_granted_scopes: false,
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
            saveToken();
            const granted = appSettings();
            granted.google.consented = true;
            granted.google.autoSync = true;
            saveSettings(granted);
            resolve(response);
          }
        });
        client.requestAccessToken({ prompt: settings.google.consented ? "" : "consent" });
      } catch (error) {
        reject(error);
      }
    });
  }

  async function googleRequest(path, options) {
    if (!connected()) throw new Error("Googleカレンダーの接続が必要です");
    // Even a previously granted broad token must never reach the old primary calendar.
    if (path !== "/calendars" && !/^\/calendars\/[^/?]+(?:\/events(?:\/[^/?]+)?(?:\?.*)?)?$/.test(path)) throw new Error("許可されていないカレンダー操作です");
    if (path !== "/calendars" && !decodeURIComponent(path.split("/")[2]).endsWith("@group.calendar.google.com")) throw new Error("専用カレンダー以外にはアクセスできません");
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
        saveToken();
      }
      const error = new Error(body?.error?.message || "Googleカレンダーとの通信に失敗しました（" + response.status + "）");
      error.status = response.status;
      throw error;
    }
    return body;
  }

  function calendarPathFor(calendarId) {
    if (!String(calendarId || "").endsWith("@group.calendar.google.com")) throw new Error("専用カレンダーを先に接続してください");
    return "/calendars/" + encodeURIComponent(calendarId);
  }

  function calendarPath() {
    return calendarPathFor(googleState.calendarId);
  }

  function sharedCalendarId(data) {
    const entry = data.sharedSettings.find((item) => item && item.id === SHARED_CALENDAR_KEY);
    return String(entry?.calendarId || "");
  }

  function setSharedCalendarId(data, calendarId) {
    const now = new Date().toISOString();
    const entry = data.sharedSettings.find((item) => item && item.id === SHARED_CALENDAR_KEY);
    if (entry) { entry.calendarId = calendarId; entry.updatedAt = now; }
    else data.sharedSettings.push({ id: SHARED_CALENDAR_KEY, calendarId, updatedAt: now });
  }

  async function verifyCalendar(calendarId) {
    if (!calendarId.endsWith("@group.calendar.google.com")) throw new Error("専用カレンダーIDを確認してください");
    const calendar = await googleRequest("/calendars/" + encodeURIComponent(calendarId));
    if (calendar.id !== calendarId || !String(calendar.description || "").includes(CALENDAR_MARKER)) throw new Error("ハチロク手帳の専用カレンダーではありません");
  }

  // v82：専用カレンダーは全端末で1つ。IDは同期データ（sharedSettings）に置き、端末ごとに新しく作らない
  async function ensureDedicatedCalendar(data) {
    const settings = appSettings();
    const shared = sharedCalendarId(data);
    const local = String(settings.google.dedicatedCalendarId || "");
    let chosen = "";
    for (const candidate of [...new Set([shared, local].filter(Boolean))]) {
      try {
        await verifyCalendar(candidate);
        chosen = candidate;
        break;
      } catch (error) {
        if (error.status && error.status !== 403 && error.status !== 404) throw error;
      }
    }
    if (!chosen && (shared || local)) throw new Error("専用カレンダーに接続できません。同じアカウントで接続してください。");
    if (!chosen) {
      const calendar = await googleRequest("/calendars", { method: "POST", body: JSON.stringify({ summary: "ハチロク手帳", description: "ハチロク手帳の同期専用カレンダー。\n" + CALENDAR_MARKER, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Tokyo" }) });
      if (!calendar?.id?.endsWith("@group.calendar.google.com")) throw new Error("専用カレンダーの作成結果を確認できませんでした");
      chosen = calendar.id;
    }
    if (local && local !== chosen) {
      settings.google.oldCalendars = [...new Set([...(Array.isArray(settings.google.oldCalendars) ? settings.google.oldCalendars : []), local])];
    }
    settings.google.dedicatedCalendarId = chosen;
    saveSettings(settings);
    if (shared !== chosen) setSharedCalendarId(data, chosen);
    googleState.calendarId = chosen;
    return chosen;
  }

  // v82：以前この端末が使っていた別の「ハチロク手帳」カレンダーから、アプリが書いた重複分を消す
  async function cleanupOldCalendars(silent) {
    const settings = appSettings();
    const list = (Array.isArray(settings.google.oldCalendars) ? settings.google.oldCalendars : []).filter((id) => id && id !== googleState.calendarId);
    if (!list.length) return 0;
    let removed = 0;
    const left = [];
    for (const oldId of list) {
      try {
        await verifyCalendar(oldId);
      } catch (error) {
        if (error.status === 403 || error.status === 404 || !error.status) continue;
        left.push(oldId);
        continue;
      }
      const managed = (await Promise.all(["task", "event"].map((kind) => listManaged(kind, oldId)))).flat();
      if (managed.length) {
        if (silent || !window.confirm("別の「ハチロク手帳」カレンダーに、同じ予定・タスクが重複して" + managed.length + "件あります。重複分を削除しますか？（アプリの記録は消えません）")) {
          if (silent) left.push(oldId);
          continue;
        }
        for (const remote of managed) {
          await deleteRemote(remote.id, oldId);
          removed += 1;
        }
      }
      try {
        const rest = await googleRequest(calendarPathFor(oldId) + "/events?" + new URLSearchParams({ maxResults: "1", showDeleted: "false" }).toString());
        if (!(rest?.items || []).length) await googleRequest(calendarPathFor(oldId), { method: "DELETE" });
      } catch (error) {
        console.warn("古い専用カレンダーの削除に失敗", error);
      }
    }
    settings.google.oldCalendars = left;
    saveSettings(settings);
    return removed;
  }

  function migrateCalendarLinks(data, settings) {
    const id = googleState.calendarId;
    if (!id) throw new Error("専用カレンダーが未確認です");
    for (const item of [...data.tasks, ...data.events]) {
      if (item.googleEventId && item.googleCalendarId !== id) {
        item.googlePreviousLinks = Array.isArray(item.googlePreviousLinks) ? item.googlePreviousLinks : [];
        item.googlePreviousLinks.push({ calendarId: item.googleCalendarId || "primary", eventId: item.googleEventId, syncedAt: item.googleSyncedAt || "" });
        item.googlePreviousLinks = item.googlePreviousLinks.slice(-3);
        item.googleEventId = "";
        item.googleCalendarId = "";
        item.googleSyncedAt = "";
      }
    }
    if (settings.google.knownCalendarId !== id) {
      settings.google.previousKnown = settings.google.known;
      settings.google.known = [];
      settings.google.knownCalendarId = id;
    }
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
    data.events.filter((item) => item.date || item.googleEventId).forEach((item) => items.push({ kind: "event", id: item.id, item, date: item.date || "", time: /^\d{2}:\d{2}$/.test(item.time || "") ? item.time : "", title: item.title }));
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
    const memo = descriptor.kind === "task" ? descriptor.item.notes : descriptor.item.note;
    const notes = memo ? "\nメモ：" + memo : "";
    return {
      summary: symbol + " " + descriptor.title,
      description: "ハチロク手帳の" + label + "\nアプリと同期中" + notes,
      ...(descriptor.time ? timedRange(descriptor.date, descriptor.time) : { start: { date: descriptor.date }, end: { date: toISO(addDays(date, 1)) } }),
      extendedProperties: { private: {
        [GOOGLE_TYPE_PROPERTY]: descriptor.kind,
        [GOOGLE_ID_PROPERTY]: descriptor.id,
        [GOOGLE_COMPLETED_PROPERTY]: descriptor.kind === "task" && descriptor.item.completed ? "1" : "0"
      } }
    };
  }

  function timedRange(iso, time) {
    const [h, m] = time.split(":").map(Number);
    const start = fromISO(iso);
    start.setHours(h, m, 0, 0);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const stamp = (d) => toISO(d) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":00";
    return { start: { dateTime: stamp(start), timeZone: "Asia/Tokyo" }, end: { dateTime: stamp(end), timeZone: "Asia/Tokyo" } };
  }

  function sameWhen(a, b) {
    if (b?.dateTime) return String(a?.dateTime || "").slice(0, 16) === b.dateTime.slice(0, 16);
    return a?.date === b?.date && !a?.dateTime;
  }

  function remoteTime(remote) {
    return remote?.start?.dateTime ? remote.start.dateTime.slice(11, 16) : "";
  }

  async function listManaged(kind, calendarId) {
    const events = [];
    let pageToken = "";
    do {
      const params = new URLSearchParams({ showDeleted: "false", singleEvents: "true", maxResults: "2500", privateExtendedProperty: GOOGLE_TYPE_PROPERTY + "=" + kind });
      if (pageToken) params.set("pageToken", pageToken);
      const result = await googleRequest((calendarId ? calendarPathFor(calendarId) : calendarPath()) + "/events?" + params.toString());
      events.push(...(result?.items || []));
      pageToken = result?.nextPageToken || "";
    } while (pageToken);
    return events;
  }

  // v83：Googleカレンダーで直接入れた予定（アプリの印がないもの）。繰り返し予定があるので期間を区切る
  async function listUnmanaged() {
    const events = [];
    let pageToken = "";
    const from = addDays(new Date(), -90);
    const to = addDays(new Date(), 400);
    do {
      const params = new URLSearchParams({ showDeleted: "false", singleEvents: "true", maxResults: "2500", timeMin: from.toISOString(), timeMax: to.toISOString() });
      if (pageToken) params.set("pageToken", pageToken);
      const result = await googleRequest(calendarPath() + "/events?" + params.toString());
      events.push(...(result?.items || []).filter((remote) => !remoteKey(remote) && remote.status !== "cancelled"));
      pageToken = result?.nextPageToken || "";
    } while (pageToken);
    return events;
  }

  function matches(remote, body) {
    const props = remotePrivate(remote);
    const expected = body.extendedProperties.private;
    return remote.summary === body.summary && sameWhen(remote.start, body.start) && sameWhen(remote.end, body.end) && (remote.description || "") === body.description && props[GOOGLE_TYPE_PROPERTY] === expected[GOOGLE_TYPE_PROPERTY] && props[GOOGLE_ID_PROPERTY] === expected[GOOGLE_ID_PROPERTY] && props[GOOGLE_COMPLETED_PROPERTY] === expected[GOOGLE_COMPLETED_PROPERTY];
  }

  async function deleteRemote(eventId, calendarId) {
    try {
      await googleRequest((calendarId ? calendarPathFor(calendarId) : calendarPath()) + "/events/" + encodeURIComponent(eventId), { method: "DELETE" });
      return true;
    } catch (error) {
      if (error.status === 404 || error.status === 410) return true;
      throw error;
    }
  }

  // v83：Google側の説明文から手帳のメモを取り出す
  function remoteMemo(remote) {
    const text = String(remote?.description || "");
    if (!text.startsWith("ハチロク手帳の")) return text.trim();
    const index = text.indexOf("\nメモ：");
    return index >= 0 ? text.slice(index + 4).trim() : "";
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
      local.notes = remoteMemo(remote);
    } else {
      local.date = date;
      local.time = remoteTime(remote);
      const memo = remoteMemo(remote);
      if (memo) local.note = memo; else delete local.note;
    }
    local.googleEventId = remote.id;
    local.googleCalendarId = googleState.calendarId;
    local.googleSyncedAt = remote.updated || new Date().toISOString();
  }

  function importRemote(data, remote, kind) {
    const props = remotePrivate(remote);
    const id = props[GOOGLE_ID_PROPERTY] || uid();
    const date = remoteDate(remote);
    if (!date) return null;
    const now = remote.updated || new Date().toISOString();
    const title = remoteTitle(remote);
    if (kind === "task") {
      const completed = props[GOOGLE_COMPLETED_PROPERTY] === "1" || /^✓\s*/.test(String(remote.summary || ""));
      const task = { id, title, folder: "inbox", due: date, priority: "medium", tag: "", projectId: null, repeat: "", pinned: false, notes: remoteMemo(remote), completed, completedAt: completed ? now : null, order: Date.now(), createdAt: now, updatedAt: now, googleEventId: remote.id, googleCalendarId: googleState.calendarId, googleSyncedAt: now };
      data.tasks.push(task);
      return task;
    }
    const memo = remoteMemo(remote);
    const item = { id, date, time: remoteTime(remote), title, ...(memo ? { note: memo } : {}), createdAt: now, updatedAt: now, googleEventId: remote.id, googleCalendarId: googleState.calendarId, googleSyncedAt: now };
    data.events.push(item);
    return item;
  }

  async function syncGoogleCalendar(silent) {
    if (navigator.locks) return navigator.locks.request("hachiroku-google-sync", () => runGoogleSync(silent));
    return runGoogleSync(silent);
  }

  async function runGoogleSync(silent) {
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
    try {
      const data = appData();
      await ensureDedicatedCalendar(data);
      const settings = appSettings();
      migrateCalendarLinks(data, settings);
      const listed = (await Promise.all(["task", "event"].map((kind) => listManaged(kind)))).flat();
      // v82：同じ予定が専用カレンダー内に2件以上あれば、1件だけ残して消す
      const remoteEvents = [];
      const seenKeys = new Set();
      for (const remote of listed) {
        const key = remoteKey(remote);
        if (key && seenKeys.has(key)) { await deleteRemote(remote.id); stats.deleted += 1; continue; }
        if (key) seenKeys.add(key);
        remoteEvents.push(remote);
      }
      const remoteByKey = new Map(remoteEvents.map((remote) => [remoteKey(remote), remote]).filter(([key]) => key));
      // v83：Google側で追加された予定を手帳に取り込む（このあと手帳の印を付けて書き戻す）
      for (const remote of await listUnmanaged()) {
        const created = importRemote(data, remote, "event");
        if (!created) continue;
        remoteByKey.set("event:" + created.id, remote);
        stats.imported += 1;
      }
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
          const created = importRemote(data, remote, kind);
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
            local.item.googleCalendarId = googleState.calendarId;
          }
        }
      }

      // v83：Google側で削除されたもの（前回同期後に手帳で変更していないもの）は手帳からも消す
      const removedEvents = new Set();
      for (const descriptor of descriptors(data)) {
        const item = descriptor.item;
        const key = descriptor.kind + ":" + descriptor.id;
        if (!descriptor.date || remoteByKey.has(key)) continue;
        const wasSynced = item.googleEventId && item.googleCalendarId === googleState.calendarId && item.googleSyncedAt;
        const changedHere = item.updatedAt && item.updatedAt > item.googleSyncedAt;
        if (!wasSynced || changedHere) continue;
        if (descriptor.kind === "event") removedEvents.add(item.id);
        else item.due = "";
        item.googleEventId = "";
        item.googleCalendarId = "";
        item.googleSyncedAt = "";
        stats.pulled += 1;
      }
      if (removedEvents.size) data.events = data.events.filter((item) => !removedEvents.has(item.id));

      for (const descriptor of descriptors(data)) {
        const item = descriptor.item;
        if (!descriptor.date) {
          if (item.googleEventId && item.googleCalendarId === googleState.calendarId) {
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
            response = await googleRequest(calendarPath() + "/events/" + encodeURIComponent(remote.id), { method: "PUT", body: JSON.stringify(body) });
            stats.updated += 1;
          }
        } else if (item.googleEventId && item.googleCalendarId === googleState.calendarId) {
          try {
            response = await googleRequest(calendarPath() + "/events/" + encodeURIComponent(item.googleEventId), { method: "PUT", body: JSON.stringify(body) });
            stats.updated += 1;
          } catch (error) {
            if (error.status !== 404) throw error;
            response = await googleRequest(calendarPath() + "/events", { method: "POST", body: JSON.stringify(body) });
            stats.created += 1;
          }
        } else {
          response = await googleRequest(calendarPath() + "/events", { method: "POST", body: JSON.stringify(body) });
          stats.created += 1;
        }
        item.googleEventId = response?.id || item.googleEventId;
        item.googleCalendarId = googleState.calendarId;
        item.googleSyncedAt = response?.updated || new Date().toISOString();
      }

      saveData(data);
      settings.google.known = descriptors(data).filter((item) => item.item.googleEventId).map((item) => ({ kind: item.kind, id: item.id, googleEventId: item.item.googleEventId }));
      saveSettings(settings);
      stats.deleted += await cleanupOldCalendars(silent);
      const summary = "同期完了：追加" + stats.created + "・更新" + stats.updated + "・取り込み" + stats.imported + "・削除" + stats.deleted;
      googleState.lastResult = summary;
      googleState.lastTone = "connected";
      setStatus(summary, "connected");
      renderPanel();
      if (!silent) window.alert(summary);
      googleState.fingerprint = fingerprint();
      googleState.lastSyncAt = Date.now();
      if ((stats.imported || stats.pulled) && !window.hachirokuApp?.replaceData) window.setTimeout(() => window.location.reload(), 350);
      return true;
    } catch (error) {
      console.error("Googleカレンダー同期エラー", error);
      googleState.lastResult = "同期できませんでした：" + error.message;
      googleState.lastTone = "";
      setStatus(googleState.lastResult, "");
      renderPanel();
      if (!silent) window.alert("同期できませんでした：" + error.message);
      return false;
    } finally {
      googleState.syncing = false;
      renderPanel();
      renderResumeBar();
      if (googleState.queued) {
        googleState.queued = false;
        scheduleSync();
      }
    }
  }

  function scheduleSync(delay) {
    if (!connected()) { renderResumeBar(); return; }
    window.clearTimeout(googleState.timer);
    googleState.timer = window.setTimeout(() => syncGoogleCalendar(true), delay ?? 700);
  }

  // v83：同期の対象（期限付きタスク・予定）が手帳で変わったかを見る控え
  function fingerprint() {
    try {
      const data = appData();
      return JSON.stringify(descriptors(data).map((d) => [d.kind, d.id, d.date, d.time || "", d.title, d.item.completed ? 1 : 0, d.item.notes || d.item.note || ""]));
    } catch (_) {
      return "";
    }
  }

  // v83：接続の期限が切れたら、タップ1回で再接続できるバーを出す
  function renderResumeBar() {
    let bar = document.getElementById("googleResumeBar");
    const show = Boolean(appSettings().google.autoSync) && !connected() && !googleState.syncing;
    if (!bar && !show) return;
    if (!bar) {
      bar = document.createElement("button");
      bar.type = "button";
      bar.id = "googleResumeBar";
      bar.className = "google-resume-bar";
      bar.textContent = "Googleカレンダーと同期（タップ）";
      bar.addEventListener("click", async () => {
        bar.hidden = true;
        try {
          await requestGoogleAccessToken();
          await syncGoogleCalendar(true);
        } catch (error) {
          setStatus("接続できませんでした：" + error.message, "");
          renderResumeBar();
        }
      });
      document.body.appendChild(bar);
    }
    bar.hidden = !show;
  }

  function startAutoSync() {
    restoreToken();
    googleState.fingerprint = fingerprint();
    // 手帳で予定・タスクが変わったら少し待ってGoogleへ
    const rawSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      rawSetItem.call(this, key, value);
      if (this === window.localStorage && key === STORAGE_KEY && !googleState.syncing) {
        window.clearTimeout(googleState.changeTimer);
        googleState.changeTimer = window.setTimeout(() => {
          if (googleState.syncing) return;
          const next = fingerprint();
          if (next !== googleState.fingerprint) scheduleSync(300);
        }, 1200);
      }
    };
    // 開いたとき・戻ってきたとき・開いている間は定期的にGoogleの変更を取り込む
    const pull = () => {
      if (document.visibilityState !== "visible") return;
      if (!appSettings().google.autoSync) return;
      if (!connected()) { renderResumeBar(); return; }
      if (Date.now() - (googleState.lastSyncAt || 0) > 30000) scheduleSync(300);
    };
    document.addEventListener("visibilitychange", pull);
    window.setInterval(() => { googleState.lastSyncAt = 0; pull(); }, AUTO_SYNC_MS);
    window.setTimeout(pull, 1500);
  }

  function init() {
    const clientInput = $("#googleClientId");
    const connectButton = $("#googleConnectBtn");
    const syncButton = $("#googleSyncBtn");
    const disconnectButton = $("#googleDisconnectBtn");
    if (!clientInput || !connectButton || !syncButton || !disconnectButton) return;
    clientInput.value = appSettings().google.clientId;
    startAutoSync();
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
        saveToken();
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
      googleState.calendarId = "";
      saveToken();
      const stopped = appSettings();
      stopped.google.autoSync = false;
      saveSettings(stopped);
      renderResumeBar();
      googleState.statusMessage = "接続を解除しました。";
      googleState.statusTone = "";
      renderPanel();
    });
    $("#googleUseCalendarBtn")?.addEventListener("click", () => {
      if (googleState.syncing) return;
      const id = $("#googleDedicatedCalendarId").value.trim();
      if (!id.endsWith("@group.calendar.google.com")) { window.alert("Googleカレンダーの設定にある専用カレンダーIDを入力してください"); return; }
      const settings = appSettings();
      settings.google.dedicatedCalendarId = id;
      saveSettings(settings);
      const data = appData();
      setSharedCalendarId(data, id);
      saveData(data);
      googleState.calendarId = "";
      setStatus("IDを保存しました。", "");
      renderPanel();
    });
    renderPanel();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
