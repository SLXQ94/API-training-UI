/* ============================================================================
   Acropolis Chat: a WhatsApp-style client for the classroom chat API.
   Plain JavaScript, no libraries, no build step.

   How it talks to the API (every call here is one you built in Lecture 1):
     POST   /users                    register
     GET    /me                       "who am I?"  (also our login check)
     GET    /users                    the contact list
     GET    /messages?limit=100       first load + periodic full re-sync
     GET    /messages?after=<id>      polling: "anything newer than <id>?"
     GET    /messages?with=<chat>     history of one conversation
     POST   /messages                 send
     PATCH  /messages/:id             edit
     DELETE /messages/:id             delete

   Sections:  1 helpers · 2 API client · 3 session · 4 data & polling
              5 rendering · 6 actions (open/send/edit/delete) · 7 start-up
   ========================================================================== */
(() => {
  'use strict';

  const CFG = Object.assign(
    { API_BASE: '', POLL_MS: 4000, FULL_SYNC_MS: 20000, APP_NAME: 'Acropolis Chat' },
    window.CONFIG || {}
  );
  const API = String(CFG.API_BASE).replace(/\/+$/, '');
  const CLASS = 'class'; // the group chat's id, same as the API's "to: class"
  const MAX_TEXT = 500;
  const HIDDEN_POLL_MS = 15000;
  const USERS_SYNC_MS = 30000;
  const SESSION_KEY = 'acropolis.session';

  /* ------------------------------------------------------------------------
     1. HELPERS
     ------------------------------------------------------------------------ */
  const $ = (sel) => document.querySelector(sel);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // h('div', {class: 'x', onclick: fn}, child, child...)  ->  a real DOM element.
  // User text only ever goes in as text nodes / textContent, never as HTML,
  // so a message like "<img onerror=...>" is displayed literally and can't run anything.
  function h(tag, props = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  // Icons: tiny SVG paths (Material icon shapes)
  const ICONS = {
    send: 'M2.01 21 23 12 2.01 3 2 10l15 2-15 2z',
    back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
    check: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
    clock: 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z',
    error: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z',
    logout: 'M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z',
    refresh: 'M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
    group: 'M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z',
    chevron: 'M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z',
    close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
    search: 'M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
    chat: 'M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z',
  };
  function icon(name, size = 24) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'icon');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', ICONS[name]);
    path.setAttribute('fill', 'currentColor');
    svg.append(path);
    return svg;
  }

  // Avatars: a coloured circle with initials; the colour comes from hashing the id
  const PALETTE = ['#00a884', '#3b9ddd', '#d6559c', '#e8832a', '#8a5fd1', '#4f7df0', '#b88a12', '#d9534f', '#26a69a', '#6b7c85'];
  const hashStr = (s) => { let x = 0; for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) | 0; return Math.abs(x); };
  const colorOf = (key) => PALETTE[hashStr(key) % PALETTE.length];
  function initials(name) {
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }
  function avatarEl(id, name, small) {
    const cls = 'avatar' + (small ? ' sm' : '');
    if (id === CLASS) return h('div', { class: cls + ' group' }, icon('group', small ? 24 : 28));
    return h('div', { class: cls, style: { background: colorOf(id) }, text: initials(name) });
  }

  // Dates & times (always in the viewer's own timezone)
  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  const fmtTime = (iso) => timeFmt.format(new Date(iso));
  const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const daysAgo = (iso) => Math.round((dayStart(new Date()) - dayStart(new Date(iso))) / 86400000);
  function dayLabel(iso) {
    const n = daysAgo(iso), d = new Date(iso);
    if (n === 0) return 'Today';
    if (n === 1) return 'Yesterday';
    if (n > 1 && n < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  }
  function listTime(iso) {
    const n = daysAgo(iso);
    if (n === 0) return fmtTime(iso);
    if (n === 1) return 'Yesterday';
    return new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  const isDesktop = () => !!(window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches);

  function toast(text, ms = 3500) {
    const t = h('div', { class: 'toast', text });
    $('#toasts').append(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
  }
  function setStatus(text) {
    const el = $('#status');
    el.hidden = !text;
    el.textContent = text || '';
  }

  /* ------------------------------------------------------------------------
     2. API CLIENT
     Every failure becomes an ApiError with the status (0 = could not reach the server),
     the server's error code and message, and Retry-After (for 429).
     ------------------------------------------------------------------------ */
  class ApiError extends Error {
    constructor(status, code, message, retryAfter = 0) {
      super(message);
      this.status = status;
      this.code = code;
      this.retryAfter = retryAfter;
    }
  }

  // Basic auth header value:  base64("ROLLNO:password")   (TextEncoder keeps non-English passwords working)
  function basic(rollNo, password) {
    let bin = '';
    new TextEncoder().encode(`${rollNo}:${password}`).forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin);
  }

  const state = {
    me: null,                 // { rollNo, name }
    creds: null,              // the base64 string for the Authorization header
    users: new Map(),         // rollNo -> { rollNo, name }
    messages: new Map(),      // id -> message from the server
    pending: [],              // messages I'm sending right now (not on the server yet)
    tombstones: new Map(),    // id -> when I deleted it (so a slow, stale response can't resurrect it)
    active: null,             // open chat: 'class' or a roll number
    editingId: null,
    lastRead: {},             // chatId -> highest message id I've seen
    firstRun: false,
    history: new Set(),       // chats whose history we already fetched
    maxId: 0,                 // highest message id seen (for ?after=)
    pollTimer: null,
    polling: false,
    failures: 0,
    pausedUntil: 0,
    lastFullSync: 0,
    lastUsersSync: 0,
    sendChain: Promise.resolve(),
    tempCounter: 0,
  };

  async function api(path, { method = 'GET', body, auth = true } = {}) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && state.creds) headers.Authorization = 'Basic ' + state.creds;

    let res;
    try {
      res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) {
      // network down, server asleep, or the browser blocked the call (CORS)
      throw new ApiError(0, 'NETWORK', 'Cannot reach the server');
    }
    if (res.status === 204) return null;

    let data = null;
    try { data = await res.json(); } catch (e) { /* no JSON body */ }
    if (!res.ok) {
      const err = (data && data.error) || {};
      const retry = Number(res.headers.get('Retry-After')) || 0;
      throw new ApiError(res.status, err.code || 'HTTP_' + res.status, err.message || res.statusText, retry);
    }
    return data;
  }

  /* ------------------------------------------------------------------------
     3. SESSION  (sign in / register / sign out)
     ------------------------------------------------------------------------ */
  const store = {
    get() {
      try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY) || 'null'); }
      catch (e) { return null; }
    },
    set(session, remember) {
      this.clear();
      try { (remember ? localStorage : sessionStorage).setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) { /* storage blocked */ }
    },
    clear() {
      try { sessionStorage.removeItem(SESSION_KEY); localStorage.removeItem(SESSION_KEY); } catch (e) { /* storage blocked */ }
    },
  };
  const readKey = (roll) => `acropolis.lastRead.${roll}`;
  function loadLastRead() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(readKey(state.me.rollNo)) || 'null'); } catch (e) { /* ignore */ }
    state.firstRun = saved === null;
    state.lastRead = saved || {};
  }
  function saveLastRead() {
    try { localStorage.setItem(readKey(state.me.rollNo), JSON.stringify(state.lastRead)); } catch (e) { /* ignore */ }
  }

  function friendly(e) {
    if (e.status === 0) return 'Cannot reach the server. Check your internet connection, or the server may still be waking up. Try again in a moment.';
    if (e.status === 401) return 'Wrong roll number or password.';
    if (e.status === 429) return `Too many attempts. Try again in ${e.retryAfter || 10} seconds.`;
    return e.message || 'Something went wrong.';
  }

  let authMode = 'login';
  function setAuthMode(mode) {
    authMode = mode;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.mode === mode));
    $('#name-field').hidden = mode !== 'register';
    $('#name').required = mode === 'register';
    $('#password').setAttribute('autocomplete', mode === 'register' ? 'new-password' : 'current-password');
    $('#auth-submit').textContent = mode === 'register' ? 'Create account' : 'Sign in';
    $('#auth-error').textContent = '';
  }

  async function onAuthSubmit(e) {
    e.preventDefault();
    const rollNo = $('#rollNo').value.trim().toUpperCase();
    const password = $('#password').value;
    const name = $('#name').value.trim();
    const remember = $('#remember').checked;

    $('#auth-error').textContent = '';
    $('#auth-submit').disabled = true;
    const wake = setTimeout(() => { $('#auth-note').textContent = 'The server may be waking up. This can take up to a minute…'; }, 5000);

    try {
      if (authMode === 'register') {
        await api('/users', { method: 'POST', auth: false, body: { rollNo, name, password } });
      }
      state.creds = basic(rollNo, password);
      const me = await api('/me');
      store.set({ rollNo: me.rollNo, name: me.name, creds: state.creds }, remember);
      $('#password').value = '';
      await startApp(me);
    } catch (err) {
      state.creds = null;
      $('#auth-error').textContent = friendly(err);
    } finally {
      clearTimeout(wake);
      $('#auth-note').textContent = '';
      $('#auth-submit').disabled = false;
    }
  }

  function logout(message) {
    clearTimeout(state.pollTimer);
    state.me = null;
    state.creds = null;
    state.active = null;
    store.clear();
    closeMenu();
    setStatus(null);
    $('#app').hidden = true;
    $('#splash').hidden = true;
    $('#auth-screen').hidden = false;
    $('#auth-error').textContent = message || '';
    document.title = CFG.APP_NAME;
    if (isDesktop()) $('#rollNo').focus();
  }

  /* ------------------------------------------------------------------------
     4. DATA & POLLING
     The server can't push to us (that's a later lecture), so we ask again and again.
     ------------------------------------------------------------------------ */
  const chatOf = (m) => (m.to === CLASS ? CLASS : m.from === state.me.rollNo ? m.to : m.from);
  const nameOf = (roll) => (state.users.get(roll) || {}).name || roll;

  // Merge messages from a response into our store.
  // t0 = when that request STARTED. If we changed a message locally after t0 (sent, edited, deleted it),
  // the response is older than our change, so ours wins.
  function mergeMessages(list, t0) {
    for (const m of list) {
      if (state.tombstones.get(m.id) >= t0) continue;
      const mine = state.messages.get(m.id);
      if (!(mine && mine._localAt >= t0)) state.messages.set(m.id, m);
      if (m.id > state.maxId) state.maxId = m.id;
    }
  }

  async function fullSync() {
    const t0 = Date.now();
    const data = await api('/messages?limit=100');
    const seen = new Set(data.messages.map((m) => m.id));
    // If the server cut the list at 100, anything older than the oldest we got is simply "not in this window"
    const windowStart = data.total > data.count && data.messages.length ? data.messages[0].id : 0;
    for (const [id, m] of [...state.messages]) {
      if (id >= windowStart && !seen.has(id) && !(m._localAt >= t0)) state.messages.delete(id); // deleted by someone
    }
    mergeMessages(data.messages, t0);
    state.lastFullSync = Date.now();
    afterDataChange();
  }

  async function incrementalSync() {
    const t0 = Date.now();
    const data = await api(`/messages?after=${state.maxId}&limit=100`);
    if (data.messages.length) { mergeMessages(data.messages, t0); afterDataChange(); }
  }

  async function syncUsers() {
    const data = await api('/users');
    state.users = new Map(data.users.map((u) => [u.rollNo, u]));
    state.lastUsersSync = Date.now();
    afterDataChange();
  }

  async function loadHistory(chatId) {
    if (state.history.has(chatId)) return;
    state.history.add(chatId);
    try {
      const t0 = Date.now();
      const data = await api(`/messages?with=${encodeURIComponent(chatId)}&limit=100`);
      mergeMessages(data.messages, t0);
      afterDataChange();
    } catch (e) {
      state.history.delete(chatId); // try again next time
    }
  }

  function nextDelay() {
    let d = document.hidden ? HIDDEN_POLL_MS : CFG.POLL_MS;
    if (state.failures) d = Math.min(30000, CFG.POLL_MS * 2 ** state.failures); // back off while the server is unreachable
    return Math.max(d, state.pausedUntil - Date.now());                          // and respect Retry-After
  }
  function schedule(delay) {
    clearTimeout(state.pollTimer);
    state.pollTimer = setTimeout(poll, delay === undefined ? nextDelay() : delay);
  }

  async function poll() {
    if (!state.me || state.polling) return;
    state.polling = true;
    try {
      if (Date.now() - state.lastFullSync >= CFG.FULL_SYNC_MS) await fullSync();
      else await incrementalSync();
      if (Date.now() - state.lastUsersSync >= USERS_SYNC_MS) await syncUsers();
      state.failures = 0;
      setStatus(null);
    } catch (e) {
      onPollError(e);
    } finally {
      state.polling = false;
      if (state.me) schedule();
    }
  }

  function onPollError(e) {
    if (e.status === 401) return logout('Your session expired. Please sign in again.');
    if (e.status === 429) {
      const s = e.retryAfter || 10;
      state.pausedUntil = Date.now() + s * 1000;
      setStatus(`Too many requests. Pausing for ${s}s…`);
      return;
    }
    state.failures = Math.min(state.failures + 1, 4);
    setStatus('Connecting…');
  }

  /* ------------------------------------------------------------------------
     5. RENDERING
     We rebuild the DOM from `state`, but only when something actually changed
     (a "signature" string), so the screen doesn't flicker on every poll.
     ------------------------------------------------------------------------ */

  // chatId -> { msgs (sorted), last, unread }
  function buildIndex() {
    const me = state.me.rollNo;
    const idx = new Map();
    const entry = (id) => {
      if (!idx.has(id)) idx.set(id, { msgs: [], last: null, unread: 0 });
      return idx.get(id);
    };
    for (const m of state.messages.values()) entry(chatOf(m)).msgs.push(m);
    for (const e of idx.values()) {
      e.msgs.sort((a, b) => a.id - b.id);
      e.last = e.msgs[e.msgs.length - 1] || null;
    }
    for (const [id, e] of idx) {
      const seen = state.lastRead[id] || 0;
      e.unread = e.msgs.filter((m) => m.from !== me && m.id > seen).length;
    }
    for (const p of state.pending) {
      const e = entry(p.to);
      e.last = { ...p, from: me };
    }
    return idx;
  }

  function markRead(chatId) {
    const e = buildIndex().get(chatId);
    if (!e || !e.msgs.length) return;
    const top = e.msgs[e.msgs.length - 1].id;
    if ((state.lastRead[chatId] || 0) < top) { state.lastRead[chatId] = top; saveLastRead(); }
  }

  function afterDataChange() {
    if (!state.me) return;
    // first time on this device: don't show 100 old messages as "unread".
    // (Wait until the first message download has finished; the contact list can arrive before it.)
    if (state.firstRun && state.lastFullSync) {
      for (const [id, e] of buildIndex()) if (e.msgs.length) state.lastRead[id] = e.msgs[e.msgs.length - 1].id;
      state.firstRun = false;
      saveLastRead();
    }
    if (state.active && !document.hidden) markRead(state.active);
    renderList();
    renderConversation();
    updateTitle();
  }

  function updateTitle() {
    let n = 0;
    for (const e of buildIndex().values()) n += e.unread;
    document.title = (n ? `(${n}) ` : '') + CFG.APP_NAME;
  }

  const tickIcon = (status) => {
    if (status === 'sending') return h('span', { class: 'tick' }, icon('clock', 14));
    if (status === 'failed') return h('span', { class: 'tick failed' }, icon('error', 15));
    return h('span', { class: 'tick' }, icon('check', 16));
  };

  // ----- chat list (left) -----
  let listSig = '';
  function renderList(force) {
    if (!state.me) return;
    const q = $('#search').value.trim().toLowerCase();
    const idx = buildIndex();
    const me = state.me.rollNo;

    let items = [{ id: CLASS, name: 'Class group' }];
    for (const u of state.users.values()) if (u.rollNo !== me) items.push({ id: u.rollNo, name: u.name });
    for (const it of items) Object.assign(it, idx.get(it.id) || { msgs: [], last: null, unread: 0 });

    if (q) items = items.filter((it) => it.name.toLowerCase().includes(q) || it.id.toLowerCase().includes(q));

    const when = (it) => (it.last ? new Date(it.last.createdAt).getTime() : 0);
    items.sort((a, b) => {
      if (a.id === CLASS) return -1; // the class group stays pinned on top
      if (b.id === CLASS) return 1;
      return when(b) - when(a) || a.name.localeCompare(b.name);
    });

    const sig = JSON.stringify([q, state.active, items.map((it) => [
      it.id, it.name, it.unread, it.last && [it.last.id, it.last.tempId, it.last.text, it.last.editedAt, it.last.status],
    ])]);
    if (sig === listSig && !force) return;
    listSig = sig;

    $('#chat-list').replaceChildren(...items.map(chatRow));
  }

  function chatRow(it) {
    const me = state.me.rollNo;
    let preview = it.id === CLASS ? 'Message the whole class' : it.id; // before any message: show the roll number
    let tick = null;
    if (it.last) {
      const mine = it.last.from === me;
      if (it.id === CLASS) preview = (mine ? 'You' : nameOf(it.last.from).split(' ')[0]) + ': ' + it.last.text;
      else preview = it.last.text;
      if (mine && it.id !== CLASS) tick = tickIcon(it.last.status);
    }
    return h('li', {
      class: 'chat-item' + (it.id === state.active ? ' active' : ''),
      dataset: { chat: it.id }, role: 'button', tabindex: '0',
      onclick: () => openChat(it.id),
      onkeydown: (e) => { if (e.key === 'Enter') openChat(it.id); },
    },
      avatarEl(it.id, it.name),
      h('div', { class: 'chat-main' },
        h('div', { class: 'chat-top' },
          h('span', { class: 'chat-name', text: it.name }),
          it.last && h('span', { class: 'chat-time' + (it.unread ? ' unread' : ''), text: listTime(it.last.createdAt) })),
        h('div', { class: 'chat-bottom' },
          h('span', { class: 'chat-preview' }, tick, h('span', { class: 'ptext', text: preview })),
          it.unread ? h('span', { class: 'badge', text: it.unread > 99 ? '99+' : String(it.unread) }) : null))
    );
  }

  // ----- conversation (right) -----
  let msgSig = '';
  function chatMessages(chatId) {
    const e = buildIndex().get(chatId);
    const list = e ? e.msgs.slice() : [];
    for (const p of state.pending) if (p.to === chatId) list.push({ ...p, from: state.me.rollNo });
    return list;
  }

  function renderConversation(forceBottom) {
    if (!state.me) return;
    const chat = state.active;
    $('#empty-state').hidden = !!chat;
    $('#conversation').hidden = !chat;
    if (!chat) return;

    const msgs = chatMessages(chat);
    const sig = JSON.stringify([chat, state.users.size, msgs.map((m) => [m.id || 'p' + m.tempId, m.text, m.editedAt, m.status])]);
    if (sig === msgSig && !forceBottom) return;
    msgSig = sig;

    // header
    const me = state.me.rollNo;
    let name = 'Class group';
    let sub = Array.from(state.users.values()).map((u) => (u.rollNo === me ? 'You' : u.name)).join(', ');
    if (chat !== CLASS) { name = nameOf(chat); sub = chat; }
    $('#chat-avatar').replaceChildren(avatarEl(chat, name, true));
    $('#chat-name').textContent = name;
    $('#chat-sub').textContent = sub;

    // messages
    const box = $('#messages');
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    const prevTop = box.scrollTop;

    const nodes = [];
    let prev = null;
    for (const m of msgs) {
      const day = dayStart(new Date(m.createdAt));
      if (!prev || prev.day !== day) nodes.push(h('div', { class: 'day' }, h('span', { text: dayLabel(m.createdAt) })));
      const first = !prev || prev.day !== day || prev.from !== m.from;
      nodes.push(bubble(m, first));
      prev = { day, from: m.from };
    }
    box.replaceChildren(...nodes);
    box.scrollTop = forceBottom || nearBottom ? box.scrollHeight : prevTop;
  }

  function bubble(m, first) {
    const me = state.me.rollNo;
    const mine = m.from === me;
    const status = m.status || 'sent'; // sending | failed | sent
    const showSender = state.active === CLASS && !mine && first;

    const meta = h('span', { class: 'meta' },
      m.editedAt && h('span', { class: 'edited', text: 'edited' }),
      h('span', { text: fmtTime(m.createdAt) }),
      mine && tickIcon(status));

    const b = h('div', { class: 'bubble' + (first ? ' tail' : '') },
      showSender && h('div', { class: 'sender', style: { color: colorOf(m.from) } },
        h('span', { text: nameOf(m.from) }), h('span', { class: 'roll', text: ' ' + m.from })),
      h('div', { class: 'text' }, m.text, meta));

    if (mine && status !== 'sending') {
      const chev = h('button', {
        class: 'chev', type: 'button', 'aria-label': 'Message options',
        onclick: (e) => { e.stopPropagation(); openMenu(chev, m); },
      }, icon('chevron', 18));
      b.append(chev);
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); openMenu(chev, m); });
    }
    if (status === 'failed') b.addEventListener('click', () => retrySend(m));

    return h('div', { class: `row ${mine ? 'out' : 'in'}${first ? ' first' : ''}${status === 'failed' ? ' failed' : ''}` }, b);
  }

  // ----- the little message menu -----
  function openMenu(anchor, m) {
    const items = m.tempId
      ? [['Retry', () => retrySend(m)], ['Discard', () => discardPending(m)]]
      : [['Edit', () => startEdit(m)], ['Delete', () => deleteMessage(m)]];
    const menu = $('#menu');
    menu.replaceChildren(...items.map(([label, fn]) => h('button', { type: 'button', text: label, onclick: () => { closeMenu(); fn(); } })));
    menu.hidden = false;

    const r = anchor.getBoundingClientRect();
    const w = menu.offsetWidth || 150, hgt = menu.offsetHeight || 90;
    const left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8);
    let top = r.bottom + 4;
    if (top + hgt > window.innerHeight - 8) top = Math.max(8, r.top - hgt - 4);
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
  }
  function closeMenu() { $('#menu').hidden = true; }

  /* ------------------------------------------------------------------------
     6. ACTIONS
     ------------------------------------------------------------------------ */
  function openChat(id) {
    state.active = id;
    cancelEdit();
    markRead(id);
    $('#app').dataset.view = 'chat';
    msgSig = '';
    renderList(true);
    renderConversation(true);
    try { if (!(history.state && history.state.chat)) history.pushState({ chat: true }, ''); } catch (e) { /* ignore */ }
    if (isDesktop()) $('#input').focus();
    loadHistory(id);
    updateTitle();
  }

  function closeChat() {
    state.active = null;
    cancelEdit();
    $('#app').dataset.view = 'list';
    renderList(true);
    renderConversation();
  }

  function handleActionError(e, fallback) {
    if (e.status === 401) return logout('Your session expired. Please sign in again.');
    if (e.status === 429) return toast(`Slow down! Try again in ${e.retryAfter || 10}s.`);
    if (e.status === 0) return toast('No connection to the server.');
    toast(e.message || fallback);
  }

  function refresh() { renderConversation(); renderList(); }

  // ----- send -----
  function sendCurrent() {
    const input = $('#input');
    const text = input.value.trim();
    if (!text || !state.active) return;
    if (state.editingId) return submitEdit(text);

    const p = { tempId: ++state.tempCounter, to: state.active, text, createdAt: new Date().toISOString(), status: 'sending' };
    state.pending.push(p);
    input.value = '';
    autosize();
    renderList();
    renderConversation(true);
    input.focus();
    queueDelivery(p);
  }

  // One message at a time, so they arrive in the order they were typed
  function queueDelivery(p) {
    state.sendChain = state.sendChain.then(() => deliver(p)).catch(() => {});
  }

  async function deliver(p) {
    p.status = 'sending';
    refresh();
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const msg = await api('/messages', { method: 'POST', body: { to: p.to, text: p.text } });
        msg._localAt = Date.now();
        state.pending = state.pending.filter((x) => x !== p);
        state.messages.set(msg.id, msg);
        if (msg.id > state.maxId) state.maxId = msg.id;
        afterDataChange();
        return;
      } catch (e) {
        if (e.status === 401) return logout('Your session expired. Please sign in again.');
        if (e.status === 429 && attempt < 2) { // rate limited: wait as the server asks, then try again by itself
          const s = e.retryAfter || 10;
          toast(`Sending too fast. Retrying in ${s}s…`);
          await sleep(s * 1000 + 200);
          continue;
        }
        p.status = 'failed';
        toast(e.status === 0 ? 'No connection. Tap the message to retry.' : e.message);
        refresh();
        return;
      }
    }
  }

  function retrySend(p) {
    if (p.status === 'sending') return;
    p.status = 'sending';
    refresh();
    queueDelivery(p);
  }
  function discardPending(p) {
    state.pending = state.pending.filter((x) => x !== p);
    refresh();
  }

  // ----- edit -----
  function startEdit(m) {
    state.editingId = m.id;
    const input = $('#input');
    input.value = m.text;
    $('#edit-preview').textContent = m.text;
    $('#edit-banner').hidden = false;
    autosize();
    input.focus();
  }
  function cancelEdit() {
    if (state.editingId === null) return;
    state.editingId = null;
    $('#edit-banner').hidden = true;
    $('#input').value = '';
    autosize();
  }
  async function submitEdit(text) {
    const id = state.editingId;
    const old = state.messages.get(id);
    if (!old || old.text === text) return cancelEdit();
    try {
      const msg = await api(`/messages/${id}`, { method: 'PATCH', body: { text } });
      msg._localAt = Date.now();
      state.messages.set(id, msg);
      cancelEdit();
      afterDataChange();
    } catch (e) {
      handleActionError(e, 'Could not edit the message.'); // stay in edit mode so they can retry
    }
  }

  // ----- delete -----
  async function deleteMessage(m) {
    if (!window.confirm('Delete this message for everyone?')) return;
    try {
      await api(`/messages/${m.id}`, { method: 'DELETE' });
    } catch (e) {
      if (e.status !== 404) return handleActionError(e, 'Could not delete the message.');
    }
    state.tombstones.set(m.id, Date.now());
    state.messages.delete(m.id);
    afterDataChange();
  }

  // ----- composer niceties -----
  function autosize() {
    const input = $('#input');
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    $('#send').disabled = !input.value.trim();
    const n = input.value.length;
    $('#counter').hidden = n < 400;
    $('#counter').textContent = `${n}/${MAX_TEXT}`;
  }

  /* ------------------------------------------------------------------------
     7. START-UP
     ------------------------------------------------------------------------ */
  async function startApp(me) {
    state.me = me;
    state.users = new Map();
    state.messages = new Map();
    state.pending = [];
    state.tombstones = new Map();
    state.history = new Set();
    state.maxId = 0;
    state.active = null;
    state.editingId = null;
    state.failures = 0;
    state.pausedUntil = 0;
    state.lastFullSync = 0;
    state.lastUsersSync = 0;
    loadLastRead();
    listSig = '';
    msgSig = '';

    $('#me-name').textContent = me.name;
    $('#me-roll').textContent = me.rollNo;
    $('#me-avatar').replaceChildren(avatarEl(me.rollNo, me.name));
    $('#search').value = '';
    $('#auth-screen').hidden = true;
    $('#splash').hidden = true;
    $('#app').hidden = false;
    $('#app').dataset.view = 'list';
    renderList(true);
    renderConversation();

    try {
      await Promise.all([syncUsers(), fullSync()]);
    } catch (e) {
      if (e.status === 401) return logout('Your session expired. Please sign in again.');
      onPollError(e);
    }
    schedule();
  }

  function init() {
    document.querySelectorAll('[data-icon]').forEach((el) => el.prepend(icon(el.dataset.icon, Number(el.dataset.size) || 24)));

    document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => setAuthMode(t.dataset.mode)));
    $('#auth-form').addEventListener('submit', onAuthSubmit);

    $('#btn-logout').addEventListener('click', () => { if (window.confirm('Log out of Acropolis Chat?')) logout(); });
    $('#btn-refresh').addEventListener('click', () => { state.lastFullSync = 0; state.lastUsersSync = 0; setStatus(null); schedule(0); toast('Refreshing…', 1200); });
    $('#btn-back').addEventListener('click', () => { if (history.state && history.state.chat) history.back(); else closeChat(); });
    window.addEventListener('popstate', () => { if (state.me && !(history.state && history.state.chat)) closeChat(); });
    $('#search').addEventListener('input', () => renderList());

    const input = $('#input');
    input.addEventListener('input', autosize);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.editingId !== null) return cancelEdit();
      // On a computer Enter sends (Shift+Enter = new line). On a phone Enter is a new line; use the send button.
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && isDesktop()) { e.preventDefault(); sendCurrent(); }
    });
    $('#composer').addEventListener('submit', (e) => { e.preventDefault(); sendCurrent(); });
    $('#send').addEventListener('mousedown', (e) => e.preventDefault()); // keep the keyboard open
    $('#edit-cancel').addEventListener('click', cancelEdit);

    document.addEventListener('click', (e) => { if (!e.target.closest('#menu')) closeMenu(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
    $('#messages').addEventListener('scroll', closeMenu, { passive: true });
    window.addEventListener('resize', closeMenu);

    document.addEventListener('visibilitychange', () => { if (!document.hidden && state.me) { schedule(200); afterDataChange(); } });
    window.addEventListener('online', () => { if (state.me) { state.failures = 0; schedule(0); } });

    restoreSession();
  }

  async function restoreSession() {
    const saved = store.get();
    if (!saved || !saved.creds) {
      $('#splash').hidden = true;
      $('#auth-screen').hidden = false;
      return;
    }
    state.creds = saved.creds;
    try {
      await startApp(await api('/me'));
    } catch (e) {
      if (e.status === 401) { logout('Please sign in again.'); return; }
      await startApp({ rollNo: saved.rollNo, name: saved.name }); // offline/slow: open anyway, polling will keep retrying
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
