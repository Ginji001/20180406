import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut } from "firebase/auth";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache, collection, doc, writeBatch, getDocs, onSnapshot, query, where, serverTimestamp, Timestamp } from "firebase/firestore";

const DATA_KEY = "hachiware-todo-gtd-v2";
const BASE_PREFIX = "hachiroku-sync-base-v1:";
const META_PREFIX = "hachiroku-sync-meta-v1:";
const FULL_INTERVAL = 3 * 24 * 60 * 60 * 1000; // 3日に1回は全件を読み直す
const config = { apiKey: "AIzaSyDMsMfo1LXhZ1exq1Kp8adV6LCFER1zwx4", authDomain: "hachiroku-4b828.firebaseapp.com", projectId: "hachiroku-4b828", storageBucket: "hachiroku-4b828.firebasestorage.app", messagingSenderId: "497615248083", appId: "1:497615248083:web:07ed04b665d2b4fed3d226" };
const MAP_COLS = ["budgets", "monthlyGoals"];
const SEP = "~";
const $ = (s) => document.querySelector(s);
const rawSetItem = Storage.prototype.setItem;
const st = { user: null, unsub: null, timer: null, ready: false, message: "", tone: "", internal: false, lastSyncedAt: "", session: 0 };

const app = initializeApp(config);
const auth = getAuth(app);
let db;
try { db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }); }
catch { db = initializeFirestore(app, { localCache: memoryLocalCache() }); }

function readData() { try { return JSON.parse(localStorage.getItem(DATA_KEY) || "{}") || {}; } catch { return {}; } }
function writeData(data) {
  st.internal = true;
  try { rawSetItem.call(localStorage, DATA_KEY, JSON.stringify(data)); }
  catch (e) { window.hachirokuApp?.notifySaveError?.(e); }
  finally { st.internal = false; }
  window.hachirokuApp?.replaceData?.(data);
}
const safeId = (id) => String(id).replace(/[\/]/g, "_").slice(0, 700);
function toMap(data) {
  const map = new Map();
  for (const [col, value] of Object.entries(data || {})) {
    if (Array.isArray(value)) value.forEach((item) => { if (item && typeof item === "object" && item.id != null) map.set(col + SEP + safeId(item.id), { col, id: String(item.id), json: JSON.stringify(item) }); });
    else if (MAP_COLS.includes(col) && value && typeof value === "object") for (const [k, v] of Object.entries(value)) map.set(col + SEP + safeId(k), { col, id: k, json: JSON.stringify(v), map: true });
  }
  return map;
}
function applyToData(data, entry, remove) {
  const { col, id } = entry;
  if (entry.map || MAP_COLS.includes(col)) {
    data[col] = data[col] && typeof data[col] === "object" && !Array.isArray(data[col]) ? data[col] : {};
    if (remove) delete data[col][id]; else data[col][id] = JSON.parse(entry.json);
    return;
  }
  data[col] = Array.isArray(data[col]) ? data[col] : [];
  const idx = data[col].findIndex((x) => x && String(x.id) === id);
  if (remove) { if (idx >= 0) data[col].splice(idx, 1); return; }
  const obj = JSON.parse(entry.json);
  if (idx >= 0) data[col][idx] = obj; else data[col].push(obj);
}
const stamp = (json) => { try { const o = JSON.parse(json); return Date.parse(o?.updatedAt || o?.completedAt || o?.createdAt || 0) || 0; } catch { return 0; } };
const baseKey = () => BASE_PREFIX + (st.user?.uid || "");
const metaKey = () => META_PREFIX + (st.user?.uid || "");
function loadBase() { try { return new Map(Object.entries(JSON.parse(localStorage.getItem(baseKey()) || "{}"))); } catch { return new Map(); } }
function saveBase(map) { try { rawSetItem.call(localStorage, baseKey(), JSON.stringify(Object.fromEntries(map))); } catch {} }
function loadMeta() { try { return JSON.parse(localStorage.getItem(metaKey()) || "null"); } catch { return null; } }
function saveMeta(meta) { try { rawSetItem.call(localStorage, metaKey(), JSON.stringify(meta)); } catch {} }
const itemsRef = () => collection(db, "users", st.user.uid, "items");
const serverMs = (d) => { const v = d?.serverAt; return v && typeof v.toMillis === "function" ? v.toMillis() : 0; };

async function commitAll(list) {
  for (let i = 0; i < list.length; i += 400) {
    const batch = writeBatch(db);
    list.slice(i, i + 400).forEach(([key, value]) => batch.set(doc(itemsRef(), key), value));
    await batch.commit();
  }
}

async function pushLocal() {
  if (!st.user || !st.ready) return;
  const base = loadBase(), local = toMap(readData()), list = [], now = Date.now();
  for (const [key, e] of local) if (base.get(key) !== e.json) { list.push([key, { col: e.col, id: e.id, map: !!e.map, json: e.json, deleted: false, updatedAt: now, serverAt: serverTimestamp() }]); base.set(key, e.json); }
  for (const key of [...base.keys()]) if (!local.has(key)) { const [col, ...rest] = key.split(SEP); list.push([key, { col, id: rest.join(SEP), map: MAP_COLS.includes(col), json: "", deleted: true, updatedAt: now, serverAt: serverTimestamp() }]); base.delete(key); }
  if (!list.length) return;
  saveBase(base);
  setStatus("", "syncing");
  commitAll(list).then(() => { st.lastSyncedAt = new Date().toISOString(); setStatus("", ""); }).catch((e) => setStatus(errorText(e), "error"));
}
function schedulePush(ms = 1200) { clearTimeout(st.timer); st.timer = setTimeout(pushLocal, ms); }
Storage.prototype.setItem = function (key, value) {
  rawSetItem.call(this, key, value);
  if (this === localStorage && key === DATA_KEY && !st.internal && st.user) schedulePush();
};

// 全件読み込み（初回・3日ごと）
async function fullSync(session) {
  const snap = await getDocs(itemsRef());
  if (session !== st.session) return null;
  const base = loadBase(), data = readData(), local = toMap(data), first = base.size === 0;
  let changed = false, seen = 0;
  snap.forEach((d) => {
    const r = d.data(), key = d.id, l = local.get(key);
    seen = Math.max(seen, serverMs(r));
    if (r.deleted) {
      if (!l) { base.delete(key); return; }
      const keepLocal = first ? stamp(l.json) > (r.updatedAt || 0) : base.get(key) !== l.json;
      if (!keepLocal) { applyToData(data, { col: r.col, id: r.id, map: r.map }, true); local.delete(key); changed = true; base.delete(key); }
      return;
    }
    if (!l) {
      if (!first && base.has(key)) return;
      applyToData(data, { col: r.col, id: r.id, map: r.map, json: r.json }, false); changed = true; base.set(key, r.json); return;
    }
    if (l.json === r.json) { base.set(key, r.json); return; }
    const keepLocal = first ? stamp(l.json) >= stamp(r.json) : base.get(key) !== l.json;
    if (!keepLocal) { applyToData(data, { col: r.col, id: r.id, map: r.map, json: r.json }, false); changed = true; base.set(key, r.json); }
  });
  if (first) for (const [key, e] of local) if (base.get(key) !== e.json) base.delete(key);
  saveBase(base);
  if (changed) writeData(data);
  return seen;
}

// 前回以降に変わった分だけを受信
function listen(since, session, onFirstServer) {
  st.unsub?.();
  let seen = since, gotServer = false;
  const q = query(itemsRef(), where("serverAt", ">", Timestamp.fromMillis(since)));
  st.unsub = onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
    if (session !== st.session) return;
    const changes = snap.docChanges().filter((c) => c.type !== "removed" && !c.doc.metadata.hasPendingWrites);
    if (changes.length) {
      const base = loadBase(), data = readData(), local = toMap(data);
      let changed = false;
      for (const c of changes) {
        const key = c.doc.id, r = c.doc.data({ serverTimestamps: "none" }), l = local.get(key);
        seen = Math.max(seen, serverMs(r));
        if (l ? base.get(key) !== l.json : base.has(key)) continue; // この端末で未送信の変更がある → こちらを優先
        if (r.deleted) { if (l) { applyToData(data, { col: r.col, id: r.id, map: r.map }, true); changed = true; } base.delete(key); }
        else { if (!l || l.json !== r.json) { applyToData(data, { col: r.col, id: r.id, map: r.map, json: r.json }, false); changed = true; } base.set(key, r.json); }
      }
      saveBase(base);
      if (changed) writeData(data);
    }
    if (!snap.metadata.fromCache) {
      const meta = loadMeta() || {};
      saveMeta({ ...meta, seen });
      st.lastSyncedAt = new Date().toISOString();
      if (!gotServer) { gotServer = true; onFirstServer?.(); }
      if (st.tone !== "error") setStatus("", st.tone === "syncing" && st.ready ? "syncing" : "");
    }
  }, (e) => {
    setStatus(errorText(e), "error");
    st.ready = false;
    setTimeout(() => { if (st.user && !st.ready && session === st.session) start(st.user); }, 15000);
  });
}

const RESYNC_FLAG = "hachiroku-sync-resync-v58:"; // v58：一度だけ全件を読み直して、足りない過去分を取り込む
function resetSyncState() { try { localStorage.removeItem(baseKey()); localStorage.removeItem(metaKey()); } catch {} }

async function start(user) {
  const session = ++st.session;
  st.unsub?.(); st.unsub = null;
  st.user = user; st.ready = false;
  try { if (!localStorage.getItem(RESYNC_FLAG + user.uid)) { resetSyncState(); rawSetItem.call(localStorage, RESYNC_FLAG + user.uid, "1"); } } catch {}
  setStatus("記録を同期しています…", "syncing");
  try {
    const meta = loadMeta(), base = loadBase(), now = Date.now();
    const needFull = base.size === 0 || !meta || !meta.full || now - meta.full > FULL_INTERVAL;
    if (needFull) {
      const seen = await fullSync(session);
      if (seen === null) return;
      saveMeta({ full: now, seen: Math.max(seen, meta?.seen || 0) });
      st.ready = true;
      await pushLocal();
      listen(Math.max(seen, meta?.seen || 0), session);
      st.lastSyncedAt = new Date().toISOString();
      setStatus("", "");
    } else {
      listen(meta.seen || 0, session, () => { st.ready = true; pushLocal(); });
    }
  } catch (e) {
    setStatus(errorText(e), "error");
    setTimeout(() => { if (st.user && !st.ready && session === st.session) start(st.user); }, 15000);
  }
}

// 手動：クラウドの記録を全部読み込み直す（この端末の記録は消さずに合わせる）
function resyncAll() {
  if (!st.user) return;
  resetSyncState();
  start(st.user);
}

function errorText(e) {
  const c = e?.code || "";
  if (c.includes("permission-denied")) return "同期の権限がありません。いったんログアウトして、もう一度ログインしてください。";
  if (c.includes("unavailable")) return "オフラインです。通信が戻ると自動で同期します。";
  if (c.includes("popup-closed") || c.includes("cancelled-popup")) return "ログインが中断されました。";
  if (c.includes("unauthorized-domain")) return "このURLではログインできません。公開URLから開いてください。";
  if (c.includes("resource-exhausted")) return "本日の同期上限に達しました。明日また自動で同期します。";
  return "同期できませんでした" + (c ? "（" + c + "）" : "");
}
async function login() {
  const p = new GoogleAuthProvider();
  p.setCustomParameters({ prompt: "select_account" });
  setStatus("Googleのログイン画面を開いています…", "syncing");
  try { await signInWithPopup(auth, p); }
  catch (e) {
    if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment"].includes(e?.code)) { await signInWithRedirect(auth, p); return; }
    setStatus(errorText(e), "error");
  }
}
async function logout() {
  if (!window.confirm("この端末で同期をやめてログアウトしますか？\nこの端末の記録と、ほかの端末の記録は消えません。")) return;
  st.session++; st.unsub?.(); st.unsub = null;
  try { localStorage.removeItem(baseKey()); localStorage.removeItem(metaKey()); } catch {}
  await signOut(auth);
}
function fmt(iso) { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; }
function setStatus(message, tone) { st.message = message; st.tone = tone; render(); }
function render() {
  const status = $("#cloudSyncStatus"), badge = $("#cloudSyncBadge"), btn = $("#cloudSyncBtn"), stop = $("#cloudSyncStopBtn"), account = $("#cloudSyncAccount"), pill = $("#cloudSyncPill");
  const on = !!st.user;
  let msg = st.message;
  if (!msg) msg = on ? (navigator.onLine ? "自動で同期しています。" + (st.lastSyncedAt ? "最終同期：" + fmt(st.lastSyncedAt) : "") : "オフラインです。入力は保存され、通信が戻ると自動で同期します。") : "オフです。Googleでログインすると、iPhone・Mac・Windowsで同じ記録を使えます。";
  if (status) { status.textContent = msg; status.dataset.tone = st.tone || ""; }
  if (badge) { badge.textContent = st.tone === "syncing" ? "同期中" : st.tone === "error" ? "要確認" : on ? "オン" : "オフ"; badge.className = "cloud-sync-badge " + (st.tone === "syncing" ? "syncing" : st.tone === "error" ? "waiting" : on ? "connected" : ""); }
  if (btn) btn.hidden = on;
  if (stop) stop.hidden = !on;
  const resync = $("#cloudSyncResyncBtn");
  if (resync) resync.hidden = !on;
  if (account) { account.hidden = !on; account.textContent = on ? "ログイン中：" + (st.user.email || "Googleアカウント") : ""; }
  if (pill) { pill.hidden = st.tone !== "error"; pill.textContent = "⚠ 同期を確認"; }
}
function init() {
  $("#cloudSyncBtn")?.addEventListener("click", login);
  $("#cloudSyncStopBtn")?.addEventListener("click", logout);
  $("#cloudSyncResyncBtn")?.addEventListener("click", resyncAll);
  $("#cloudSyncPill")?.addEventListener("click", () => document.querySelector('[data-view="data"]')?.click());
  window.addEventListener("online", () => { render(); if (st.user && !st.ready) start(st.user); });
  window.addEventListener("offline", render);
  getRedirectResult(auth).catch((e) => setStatus(errorText(e), "error"));
  onAuthStateChanged(auth, (user) => {
    st.session++; st.unsub?.(); st.unsub = null;
    if (user) start(user); else { st.user = null; st.ready = false; setStatus("", ""); }
  });
  render();
}
window.hachirokuSync = { toMap, applyToData };
document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", init) : init();
