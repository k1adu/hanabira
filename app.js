'use strict';
/* Hanabira Flashcards èŠ±ã³ã‚‰ â€” spaced repetition PWA. Data lives in IndexedDB on the device.
   UI strings: i18n.js (t / tn). */

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ utils
const LIB = (document.currentScript ? document.currentScript.src.replace(/app\.js(\?.*)?$/, '') : '') + 'lib/';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DAY = 864e5, MIN = 6e4;
let _uidLast = 0;
const uid = () => { let t = Date.now() * 1000; if (t <= _uidLast) t = _uidLast + 1; return (_uidLast = t); };
const stripHtml = h => String(h || '')
  .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '').replace(/\[sound:[^\]]*\]/g, '')
  .replace(/<br\s*\/?>|<\/(div|p|li|tr)>/gi, ' ').replace(/<[^>]*>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();
const textToHtml = s => esc(s).replace(/\r?\n/g, '<br>');
const htmlToText = h => { const x = document.createElement('textarea'); x.innerHTML = String(h || '').replace(/<br\s*\/?>/gi, '\n'); return x.value; };
const loadScript = src => new Promise((res, rej) => {
  if ($(`script[src="${src}"]`)) return res();
  const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Failed to load ' + src));
  document.head.appendChild(s);
});
const abToB64 = ab => { const b = new Uint8Array(ab); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
const b64ToAb = b64 => { const s = atob(b64); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b.buffer; };
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', mp4: 'video/mp4', webm: 'video/webm' };
const mimeOf = n => MIME[(n.split('.').pop() || '').toLowerCase()] || 'application/octet-stream';

const ICON = {
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/></svg>',
  speak: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
  undo: '<svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>',
  play: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>',
};

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ storage
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('hanabira', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        for (const [n, k] of [['decks', 'id'], ['cards', 'id'], ['revlog', 'id'], ['media', 'name'], ['meta', 'k']]) d.createObjectStore(n, { keyPath: k });
      };
      r.onsuccess = () => { DB.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  run(store, mode, fn) {
    return new Promise((res, rej) => {
      const tx = DB.db.transaction(store, mode); let out;
      const r = fn(tx.objectStore(store));
      if (r) r.onsuccess = () => { out = r.result; };
      tx.oncomplete = () => res(out);
      tx.onerror = tx.onabort = () => rej(tx.error);
    });
  },
  all: s => DB.run(s, 'readonly', st => st.getAll()),
  get: (s, k) => DB.run(s, 'readonly', st => st.get(k)),
  put: (s, v) => DB.run(s, 'readwrite', st => { st.put(v); }),
  putMany: (s, arr) => DB.run(s, 'readwrite', st => { for (const v of arr) st.put(v); }),
  delMany: (s, keys) => DB.run(s, 'readwrite', st => { for (const k of keys) st.delete(k); }),
  clear: s => DB.run(s, 'readwrite', st => { st.clear(); }),
};

const DEFAULTS = {
  newPerDay: 20, revPerDay: 200, learnSteps: [1, 10], relearnSteps: [10], gradIvl: 1, easyIvl: 4,
  startEase: 2500, easyBonus: 1.3, hardMult: 1.2, ivlMult: 1, maxIvl: 36500, rollover: 4, learnAhead: 20,
  theme: 'dark', autoplay: true, lastDeck: null, lang: null, burySiblings: true,
};
let S = { ...DEFAULTS };
const decks = new Map();
const cards = new Map();
let revlog = [];

const saveSettings = () => DB.put('meta', { k: 'settings', v: S });
const saveCard = c => { c.mod = Date.now(); cards.set(c.id, c); return DB.put('cards', c); };
const saveDeck = d => { decks.set(d.id, d); return DB.put('decks', d); };

async function loadAll() {
  const [ds, cs, rl, st] = await Promise.all([DB.all('decks'), DB.all('cards'), DB.all('revlog'), DB.get('meta', 'settings')]);
  decks.clear(); cards.clear();
  ds.forEach(d => decks.set(d.id, d));
  cs.forEach(c => { linkNote(c); cards.set(c.id, c); });
  revlog = rl.sort((a, b) => a.id - b.id);
  S = { ...DEFAULTS, ...(st ? st.v : {}) };
}
// Cards made from the same note (e.g. frontâ†’back and backâ†’front of one word) share `nid`;
// `ord` is the card's template number. Older cards get it derived from their import id.
function linkNote(c) {
  if (c.nid != null) return c;
  const m = /^a:(.+):(\d+)$/.exec(c.src || '');
  if (m) { c.nid = 'a:' + m[1]; c.ord = +m[2]; } else { c.nid = c.id; c.ord = c.ord || 0; }
  return c;
}

function newCard(deckId, front, back, extra = {}) {
  const id = uid();
  return { id, nid: id, ord: 0, deckId, front, back, tags: '', type: 0, due: 0, ivl: 0, ease: S.startEase, step: 0, reps: 0, lapses: 0, susp: false, pos: id, mod: Date.now(), ...extra };
}

function deckByName(name) { for (const d of decks.values()) if (d.name === name) return d; return null; }
async function ensureDeck(name) {
  name = name.split('::').map(s => s.trim()).filter(Boolean).join('::') || t('deck_default');
  const parts = name.split('::'); let d;
  for (let i = 1; i <= parts.length; i++) {
    const n = parts.slice(0, i).join('::');
    d = deckByName(n);
    if (!d) { d = { id: uid(), name: n, created: Date.now() }; await saveDeck(d); }
  }
  return d;
}
function treeIds(deckId) {
  const d = decks.get(deckId); const ids = new Set();
  if (!d) return ids;
  ids.add(d.id);
  for (const x of decks.values()) if (x.name.startsWith(d.name + '::')) ids.add(x.id);
  return ids;
}
const sortedDecks = () => [...decks.values()].sort((a, b) => a.name.localeCompare(b.name, LANG));

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ scheduler (SM-2 based)
function dayNum(ts = Date.now()) {
  const d = new Date(ts - S.rollover * 36e5);
  return Math.floor((d.getTime() - d.getTimezoneOffset() * MIN) / DAY);
}
function nextDayStart() {
  const n = new Date(); const d = new Date(n);
  d.setHours(S.rollover, 0, 0, 0);
  if (d <= n) d.setDate(d.getDate() + 1);
  return d.getTime();
}
const fuzz = ivl => { if (ivl < 3) return ivl; const f = Math.max(1, Math.round(ivl * 0.05)); return ivl + Math.floor(Math.random() * (2 * f + 1)) - f; };

function schedule(c, r, preview = false) {
  const now = Date.now(), today = dayNum(now);
  const n = { ...c, reps: (c.reps || 0) + 1 };
  const lsteps = S.learnSteps.length ? S.learnSteps : [1];
  const rsteps = S.relearnSteps;
  const stepAt = (steps, i) => steps[Math.min(i, steps.length - 1)] * MIN;
  const hardAt = (steps, i) => {
    if (i === 0 && steps.length > 1) return (steps[0] + steps[1]) / 2 * MIN;
    if (steps.length === 1) return Math.min(steps[0] * 1.5, steps[0] + 1440) * MIN;
    return stepAt(steps, i);
  };
  const cap = v => Math.min(S.maxIvl, Math.max(1, Math.round(v)));
  const graduate = ivl => { n.type = 2; n.step = 0; n.ivl = preview ? ivl : fuzz(ivl); n.due = today + n.ivl; };

  if (c.type === 0 || c.type === 1) {
    if (c.type === 0) { n.type = 1; n.step = 0; n.ease = S.startEase; }
    if (r === 1) { n.step = 0; n.due = now + stepAt(lsteps, 0); }
    else if (r === 2) { n.due = now + hardAt(lsteps, n.step); }
    else if (r === 3) { n.step = n.step + 1; if (n.step >= lsteps.length) graduate(S.gradIvl); else n.due = now + stepAt(lsteps, n.step); }
    else graduate(S.easyIvl);
  } else if (c.type === 2) {
    if (r === 1) {
      n.lapses = (c.lapses || 0) + 1; n.ease = Math.max(1300, c.ease - 200); n.ivl = 1;
      if (rsteps.length) { n.type = 3; n.step = 0; n.due = now + rsteps[0] * MIN; }
      else n.due = today + 1;
    } else {
      const late = Math.max(0, today - c.due), ease = c.ease / 1000;
      const hard = cap(Math.max(c.ivl + 1, (c.ivl + late / 4) * S.hardMult * S.ivlMult));
      const good = cap(Math.max(hard + 1, (c.ivl + late / 2) * ease * S.ivlMult));
      const easy = cap(Math.max(good + 1, (c.ivl + late) * ease * S.easyBonus * S.ivlMult));
      let ivl = r === 2 ? hard : r === 3 ? good : easy;
      if (!preview) ivl = Math.min(S.maxIvl, fuzz(ivl));
      if (r === 2) n.ease = Math.max(1300, c.ease - 150);
      if (r === 4) n.ease = c.ease + 150;
      n.ivl = ivl; n.due = today + ivl;
    }
  } else if (c.type === 3) {
    const steps = rsteps.length ? rsteps : [10];
    if (r === 1) { n.step = 0; n.due = now + stepAt(steps, 0); }
    else if (r === 2) { n.due = now + hardAt(steps, c.step); }
    else if (r === 3) { n.step = c.step + 1; if (n.step >= steps.length) { n.type = 2; n.step = 0; n.due = today + n.ivl; } else n.due = now + stepAt(steps, n.step); }
    else { n.type = 2; n.step = 0; n.ivl = (c.ivl || 1) + 1; n.due = today + n.ivl; }
  }
  return n;
}

function fmtDays(d) { if (d < 30) return t('u_d', { n: Math.round(d) }); if (d < 365) return t('u_mo', { n: fmtNum(d / 30) }); return t('u_y', { n: fmtNum(d / 365) }); }
function fmtDur(ms) { const m = Math.round(ms / MIN); if (m < 1) return t('u_lt1'); if (m < 60) return t('u_min', { n: m }); const h = m / 60; if (h < 24) return t('u_h', { n: fmtNum(h) }); return fmtDays(h / 24); }
const ivlLabel = n => (n.type === 1 || n.type === 3) ? fmtDur(n.due - Date.now()) : fmtDays(n.ivl);

function todayDone(ids) {
  const td = dayNum(); let nw = 0, rv = 0;
  for (let i = revlog.length - 1; i >= 0; i--) {
    const r = revlog[i];
    if (r.day < td) break;
    if (r.day !== td || !ids.has(r.did)) continue;
    if (r.type === 0) nw++; else if (r.type === 2) rv++;
  }
  return { nw, rv };
}
function extraNew(ids) {
  const td = dayNum(); let x = 0;
  for (const id of ids) { const d = decks.get(id); if (d && d.extra && d.extra.day === td) x += d.extra.n; }
  return x;
}
function gather(ids) {
  const now = Date.now(), today = dayNum(now), eod = nextDayStart();
  // sibling burying: once any card of a note was answered today, its other new/review cards wait until tomorrow
  const seen = new Set();
  if (S.burySiblings) for (let i = revlog.length - 1; i >= 0 && revlog[i].day >= today; i--) {
    if (revlog[i].day !== today) continue;
    const c = cards.get(revlog[i].cid); if (c) seen.add(c.nid);
  }
  const nw = [], lrn = [], rev = [];
  for (const c of cards.values()) {
    if (c.susp || !ids.has(c.deckId)) continue;
    if (c.type === 0) { if (!seen.has(c.nid)) nw.push(c); }
    else if (c.type === 2) { if (c.due <= today && !seen.has(c.nid)) rev.push(c); }
    else if (c.due < eod) lrn.push(c);
  }
  const done = todayDone(ids);
  // new cards: first template of every note, then the reverse ones (so a word's reverse never follows right after it)
  nw.sort((a, b) => (a.ord || 0) - (b.ord || 0) || a.pos - b.pos);
  if (S.burySiblings) { const u = new Set(); for (let i = 0; i < nw.length; i++) { if (u.has(nw[i].nid)) { nw.splice(i--, 1); } else u.add(nw[i].nid); } }
  rev.sort((a, b) => a.due - b.due || a.id - b.id);
  lrn.sort((a, b) => a.due - b.due);
  const nLim = Math.max(0, S.newPerDay + extraNew(ids) - done.nw), rLim = Math.max(0, S.revPerDay - done.rv);
  return { nw: nw.slice(0, nLim), rev: rev.slice(0, rLim), lrn, now, newTotal: nw.length };
}
function pickNext(ids, lastId) {
  const g = gather(ids), now = g.now;
  const notLast = arr => arr.length > 1 && arr[0].id === lastId ? arr[1] : arr[0];
  const lrnDue = g.lrn.filter(c => c.due <= now);
  const nl = g.nw.length, rl = g.rev.length;
  if (lrnDue.length && !(lrnDue.length === 1 && lrnDue[0].id === lastId && (nl || rl))) return { card: notLast(lrnDue), g };
  if (nl || rl) {
    const pickNew = rl === 0 || (nl > 0 && Math.random() < nl / (nl + rl));
    return { card: pickNew ? g.nw[0] : g.rev[0], g };
  }
  if (lrnDue.length) return { card: lrnDue[0], g };
  const ahead = g.lrn.filter(c => c.due <= now + S.learnAhead * MIN);
  if (ahead.length) return { card: ahead[0], g };
  if (g.lrn.length) return { wait: g.lrn[0].due, g };
  return { g };
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ card rendering
const mediaUrls = new Map();
async function mediaUrl(name) {
  if (mediaUrls.has(name)) return mediaUrls.get(name);
  const m = await DB.get('media', name);
  const url = m ? URL.createObjectURL(new Blob([m.data], { type: m.type || mimeOf(name) })) : null;
  mediaUrls.set(name, url);
  return url;
}
const ttsBtn = (lang, text) => `<button class="sound" data-tts="${esc(String(lang || '').replace('_', '-'))}" data-text="${esc(text)}">${ICON.play}</button>`;
// inline speech tags produced by some deck exporters: [<tag>:tts lang=de_DE ...]text[/<tag>:tts]
const TTS_TAG = new RegExp('\\[' + 'an' + 'ki:tts([^\\]]*)\\]([\\s\\S]*?)\\[\\/' + 'an' + 'ki:tts\\]', 'g');
function sanitize(html) {
  html = String(html || '')
    .replace(/\[sound:([^\]]+)\]/g, (m, n) => `<button class="sound" data-sound="${esc(n)}">${ICON.play}</button>`)
    .replace(TTS_TAG, (m, attrs, text) => ttsBtn((/lang=([\w-]+)/.exec(attrs) || [])[1], stripHtml(text)));
  const doc = new DOMParser().parseFromString('<div id="r">' + html + '</div>', 'text/html');
  const root = doc.getElementById('r');
  root.querySelectorAll('script,style,iframe,object,embed,link,meta,base,form,input,textarea').forEach(e => e.remove());
  root.querySelectorAll('*').forEach(el => {
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase();
      if (n.startsWith('on') || ((n === 'href' || n === 'src' || n.endsWith(':href')) && /^\s*javascript:/i.test(a.value))) el.removeAttribute(a.name);
    }
    if (el.tagName === 'IMG' || el.tagName === 'AUDIO' || el.tagName === 'VIDEO' || el.tagName === 'SOURCE') {
      const src = el.getAttribute('src');
      if (src && !/^(https?:|data:|blob:)/i.test(src)) { let nm = src; try { nm = decodeURIComponent(src); } catch (e) {} el.setAttribute('data-media', nm); el.removeAttribute('src'); }
    }
    if (el.tagName === 'A') el.setAttribute('target', '_blank');
  });
  return root.innerHTML;
}
async function hydrate(el) {
  for (const m of $$('[data-media]', el)) { const u = await mediaUrl(m.dataset.media); if (u) m.src = u; }
  for (const b of $$('[data-sound]', el)) { const u = await mediaUrl(b.dataset.sound); b.dataset.url = u || ''; }
}
// One shared <audio> element: phones only allow sound after a user tap, and they remember that permission
// per element. The first tap anywhere "unlocks" both the player and speech synthesis.
const player = new Audio();
let audioUnlocked = false;
document.addEventListener('pointerdown', () => {
  if (audioUnlocked) return; audioUnlocked = true;
  player.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
  player.play().catch(() => {});
  if ('speechSynthesis' in window) { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); }
}, true);
let playToken = 0;
// items: elements with data-url (audio file) or data-tts + data-text (speech)
function playItems(els) {
  const token = ++playToken;
  player.pause();
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  const q = els.slice();
  const next = () => {
    if (token !== playToken) return;
    const el = q.shift(); if (!el) return;
    if (el.dataset.tts !== undefined) { speak(el.dataset.text, el.dataset.tts, next); return; }
    if (!el.dataset.url) return next();
    player.src = el.dataset.url; player.onended = next;
    player.play().catch(next);
  };
  next();
}
const answerHtml = c => c.fullBack ? c.back : `${c.front}<hr id="answer">${c.back}`;

// card template engine for .apkg import
function renderCloze(text, ord, side) {
  return text.replace(/\{\{c(\d+)::([\s\S]*?)(?:::([^}]*?))?\}\}/g, (m, n, ans, hint) => {
    if (+n !== ord) return ans;
    return side === 'q' ? `<span class="cloze">[${hint ? esc(hint) : 'â€¦'}]</span>` : `<span class="cloze">${ans}</span>`;
  });
}
function applyFilter(f, v, ctx) {
  if (f === 'cloze') return renderCloze(v, ctx.ord, ctx.side);
  if (f === 'text') return stripHtml(v);
  if (/^tts\s/.test(f)) return ttsBtn(f.split(/\s+/)[1], stripHtml(v));
  if (f === 'type' || f === 'tts') return '';
  if (f === 'furigana') return v.replace(/ ?([^ >\[]+?)\[(.+?)\]/g, '<ruby>$1<rt>$2</rt></ruby>');
  if (f === 'kana') return v.replace(/ ?([^ >\[]+?)\[(.+?)\]/g, '$2');
  if (f === 'kanji') return v.replace(/ ?([^ >\[]+?)\[(.+?)\]/g, '$1');
  return v;
}
function renderTemplate(tpl, fields, ctx) {
  const val = expr => {
    const parts = expr.split(':'); const name = parts.pop().trim();
    if (name === 'FrontSide') return ctx.front || '';
    if (name === 'Tags') return ctx.tags || '';
    if (name === 'Deck' || name === 'Subdeck') return ctx.deck || '';
    let v = fields[name]; if (v == null) return '';
    for (const f of parts.reverse()) v = applyFilter(f.trim(), v, ctx);
    return v;
  };
  const sec = /\{\{([#^])\s*([^}]+?)\s*\}\}([\s\S]*?)\{\{\/\s*\2\s*\}\}/g;
  let prev;
  do {
    prev = tpl;
    tpl = tpl.replace(sec, (m, ty, name, inner) => {
      let v = val(name);
      if (/cloze:/.test(name)) v = new RegExp(`\\{\\{c${ctx.ord}::`).test(fields[name.split(':').pop().trim()] || '') ? 'x' : '';
      const ne = stripHtml(v) !== '' || /<img/i.test(v);
      return (ty === '#' ? ne : !ne) ? inner : '';
    });
  } while (tpl !== prev);
  return tpl.replace(/\{\{(?![#^\/])([^}]+?)\}\}/g, (m, expr) => val(expr.trim()));
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ UI helpers
function toast(msg, ms = 2000) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('show'), ms);
}
function sheet(html, bind) {
  const bg = document.createElement('div'); bg.className = 'sheet-bg';
  bg.innerHTML = `<div class="sheet"><div class="grab"></div>${html}</div>`;
  const close = () => { bg.remove(); if (sheet.onclose) { const f = sheet.onclose; sheet.onclose = null; f(); } };
  bg.addEventListener('click', e => { if (e.target === bg) close(); });
  $('#sheet-root').appendChild(bg);
  if (bind) bind(bg.firstElementChild, close);
  return close;
}
function confirmSheet(title, text, ok = t('yes'), danger = false) {
  return new Promise(res => {
    let v = false;
    sheet.onclose = () => res(v);
    sheet(`<h3>${esc(title)}</h3>${text ? `<p class="muted">${esc(text)}</p>` : ''}
      <button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(ok)}</button><button class="btn" data-no>${t('cancel')}</button>`,
      (el, close) => { $('[data-ok]', el).onclick = () => { v = true; close(); }; $('[data-no]', el).onclick = close; });
  });
}
function promptSheet(title, value = '', placeholder = '', ok = t('save')) {
  return new Promise(res => {
    let v = null;
    sheet.onclose = () => res(v);
    sheet(`<h3>${esc(title)}</h3><input class="input" value="${esc(value)}" placeholder="${esc(placeholder)}">
      <button class="btn primary mt" data-ok>${esc(ok)}</button>`, (el, close) => {
      const inp = $('input', el); setTimeout(() => inp.focus(), 50);
      const done = () => { v = inp.value.trim() || null; close(); };
      $('[data-ok]', el).onclick = done;
      inp.onkeydown = e => { if (e.key === 'Enter') done(); };
    });
  });
}
function countsHtml(c, cur) {
  const s = (n, cls, k) => `<span class="${n ? cls : 'zero'} ${cur === k ? 'cur' : ''}">${n}</span>`;
  return `<div class="counts">${s(c.n, 'c-new', 'n')}${s(c.l, 'c-learn', 'l')}${s(c.r, 'c-due', 'r')}</div>`;
}
const countsOf = ids => { const g = gather(ids); return { n: g.nw.length, l: g.lrn.length, r: g.rev.length }; };
function deckOptions(sel) {
  return sortedDecks().map(d => `<option value="${d.id}" ${d.id === sel ? 'selected' : ''}>${esc(d.name.replace(/::/g, ' â€º '))}</option>`).join('');
}
function applyTheme() { document.documentElement.dataset.theme = S.theme; }
function applyLang() {
  setLang(S.lang);
  $$('#tabs [data-tab]').forEach(b => { $('span', b).textContent = t('tab_' + b.dataset.tab); });
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ router
let route = { v: 'decks' };
function go(v, p = {}) { route = { v, ...p }; render(); }
function render() {
  if (route.v !== 'study' && study) { clearTimeout(study.timer); study = null; }
  document.body.classList.toggle('studying', route.v === 'study');
  const tab = route.v === 'deck' || route.v === 'study' ? 'decks' : route.v;
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  const view = $('#view'); view.scrollTop = 0;
  VIEWS[route.v](view, route);
}

const VIEWS = {};

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ decks list
VIEWS.decks = view => {
  const all = sortedDecks();
  const tot = { n: 0, l: 0, r: 0 };
  all.filter(d => !d.name.includes('::')).forEach(d => { const c = countsOf(treeIds(d.id)); tot.n += c.n; tot.l += c.l; tot.r += c.r; });
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  let hint = '';
  try { if (isIOS && !standalone && !localStorage.getItem('hanabira-hint')) hint = `<div class="panel small" style="margin-bottom:16px">${t('install_hint')} <a href="#" data-hide style="color:var(--gold)">${t('hide')}</a></div>`; } catch (e) {}
  view.innerHTML = `
    <div class="top"><h1><span class="jp">èŠ±</span>Hanabira</h1></div>
    ${hint}
    <div class="summary">
      <div><b class="c-new">${tot.n}</b><span>${t('sum_new')}</span></div>
      <div><b class="c-learn">${tot.l}</b><span>${t('sum_learn')}</span></div>
      <div><b class="c-due">${tot.r}</b><span>${t('sum_due')}</span></div>
    </div>
    ${all.length ? `<div class="list">${all.map(d => {
      const depth = d.name.split('::').length - 1;
      const short = d.name.split('::').pop();
      return `<button class="row" data-deck="${d.id}" style="padding-left:${14 + depth * 18}px">
        <span class="name">${depth ? '<span class="indent">â€º </span>' : ''}${esc(short)}</span>${countsHtml(countsOf(treeIds(d.id)))}</button>`;
    }).join('')}</div>` : `
      <div class="empty"><div class="big">å§‹</div><p>${t('no_decks')}</p>
      <button class="btn primary" data-new>${t('create_deck')}</button>
      <button class="btn" data-demo>${t('demo_btn')}</button>
      <button class="btn" data-import>${t('import_apkg')}</button></div>`}
    <button class="fab" data-new aria-label="${t('new_deck')}">+</button>`;
  $$('[data-deck]', view).forEach(b => b.onclick = () => go('deck', { id: +b.dataset.deck }));
  $$('[data-new]', view).forEach(b => b.onclick = async () => {
    const n = await promptSheet(t('new_deck'), '', t('new_deck_ph'), t('create'));
    if (n) { const d = await ensureDeck(n); go('deck', { id: d.id }); }
  });
  const demo = $('[data-demo]', view); if (demo) demo.onclick = makeDemo;
  const imp = $('[data-import]', view); if (imp) imp.onclick = pickImportFile;
  const hide = $('[data-hide]', view); if (hide) hide.onclick = e => { e.preventDefault(); try { localStorage.setItem('hanabira-hint', '1'); } catch (er) {} render(); };
};

async function makeDemo() {
  const d = await ensureDeck(t('demo_deck_name'));
  d.tts = 'ja-JP'; await saveDeck(d);
  const pairs = [['ã‚', 'a'], ['ã„', 'i'], ['ã†', 'u'], ['ãˆ', 'e'], ['ãŠ', 'o'], ['ã‹', 'ka'], ['ã', 'ki'], ['ã', 'ku'], ['ã‘', 'ke'], ['ã“', 'ko'], ['ã•', 'sa'], ['ã—', 'shi'], ['ã™', 'su'], ['ã›', 'se'], ['ã', 'so']];
  const have = new Set([...cards.values()].map(c => c.src));
  const list = pairs.filter(([f]) => !have.has('demo:' + f)).map(([f, b]) => newCard(d.id, `<div style="font-size:72px">${f}</div>`, textToHtml(b), { src: 'demo:' + f }));
  list.forEach(c => cards.set(c.id, c));
  await DB.putMany('cards', list);
  go('deck', { id: d.id });
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ deck overview
VIEWS.deck = (view, { id }) => {
  const d = decks.get(id); if (!d) return go('decks');
  const ids = treeIds(id); const c = countsOf(ids);
  let total = 0, nw = 0, susp = 0;
  for (const x of cards.values()) if (ids.has(x.deckId)) { total++; if (x.type === 0) nw++; if (x.susp) susp++; }
  const any = c.n + c.l + c.r > 0;
  const info = [t('info_total', { cards: tn(total, 'cards') }), t('info_new', { n: nw })];
  if (susp) info.push(t('info_susp', { n: susp }));
  if (d.tts) info.push(t('info_tts', { lang: d.tts }));
  view.innerHTML = `
    <div class="top"><button class="icon-btn" data-back>${ICON.back}</button><h2>${esc(d.name.split('::').pop())}</h2><button class="icon-btn" data-more>${ICON.more}</button></div>
    ${d.name.includes('::') ? `<div class="muted small" style="margin:-8px 0 8px 50px">${esc(d.name.split('::').slice(0, -1).join(' â€º '))}</div>` : ''}
    <div class="overview">
      <div class="counts"><span class="${c.n ? 'c-new' : 'zero'}">${c.n}</span><span class="${c.l ? 'c-learn' : 'zero'}">${c.l}</span><span class="${c.r ? 'c-due' : 'zero'}">${c.r}</span></div>
      <div class="labels"><span>${t('lbl_new')}</span><span>${t('lbl_learn')}</span><span>${t('lbl_review')}</span></div>
    </div>
    <div class="mt2">
      ${any ? `<button class="btn primary" data-study>${t('study')}</button>` : `<div class="center muted" style="margin-bottom:14px">${total ? t('all_done_today') : t('deck_empty')}</div>`}
      ${!any && nw ? `<button class="btn" data-extra>${t('extra_new')}</button>` : ''}
      <button class="btn" data-add>${t('add_card')}</button>
      <button class="btn" data-browse>${t('cards_btn', { n: total })}</button>
    </div>
    <p class="muted small center mt">${esc(info.join(' Â· '))}</p>`;
  $('[data-back]', view).onclick = () => go('decks');
  const st = $('[data-study]', view); if (st) st.onclick = () => go('study', { id });
  const ex = $('[data-extra]', view); if (ex) ex.onclick = async () => {
    const td = dayNum(); d.extra = { day: td, n: (d.extra && d.extra.day === td ? d.extra.n : 0) + 10 }; await saveDeck(d); render();
  };
  $('[data-add]', view).onclick = () => { S.lastDeck = id; go('add'); };
  $('[data-browse]', view).onclick = () => go('browse', { deck: id });
  $('[data-more]', view).onclick = () => deckMenu(d);
};

function deckMenu(d) {
  sheet(`<h3>${esc(d.name)}</h3><div class="menu">
    <button class="btn" data-a="rename">${t('rename')}</button>
    <button class="btn" data-a="tts">${t('tts_menu')}${d.tts ? ` (${esc(d.tts)})` : ''}</button>
    <button class="btn" data-a="share">${t('share_deck')}</button>
    <button class="btn" data-a="reset">${t('reset_progress')}</button>
    <button class="btn danger" data-a="del">${t('delete_deck')}</button></div>`, (el, close) => {
    el.onclick = async e => {
      const a = e.target.closest('[data-a]'); if (!a) return; close();
      const act = a.dataset.a;
      if (act === 'rename') {
        const n = await promptSheet(t('rename'), d.name);
        if (n && n !== d.name) {
          if (deckByName(n)) return toast(t('deck_exists'));
          const old = d.name; const list = [];
          for (const x of decks.values()) if (x.name === old || x.name.startsWith(old + '::')) { x.name = n + x.name.slice(old.length); list.push(x); }
          await DB.putMany('decks', list); render();
        }
      } else if (act === 'tts') ttsSheet(d);
      else if (act === 'share') exportDeck(d);
      else if (act === 'reset') {
        if (await confirmSheet(t('reset_q'), t('reset_text'), t('reset_btn'), true)) {
          const ids = treeIds(d.id); const list = [];
          for (const c of cards.values()) if (ids.has(c.deckId)) { Object.assign(c, { type: 0, due: 0, ivl: 0, ease: S.startEase, step: 0, reps: 0, lapses: 0, mod: Date.now() }); list.push(c); }
          await DB.putMany('cards', list); toast(t('reset_done')); render();
        }
      } else if (act === 'del') {
        const ids = treeIds(d.id); const cids = [...cards.values()].filter(c => ids.has(c.deckId)).map(c => c.id);
        if (await confirmSheet(t('del_deck_q'), t('del_deck_text', { name: d.name, cards: tn(cids.length, 'cardsAcc') }), t('del'), true)) {
          cids.forEach(i => cards.delete(i)); [...ids].forEach(i => decks.delete(i));
          await DB.delMany('cards', cids); await DB.delMany('decks', [...ids]); go('decks');
        }
      }
    };
  });
}

const TTS_LANGS = [['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['ja-JP', 'æ—¥æœ¬èªž'], ['de-DE', 'Deutsch'], ['fr-FR', 'FranÃ§ais'], ['es-ES', 'EspaÃ±ol'], ['it-IT', 'Italiano'], ['pl-PL', 'Polski'], ['uk-UA', 'Ð£ÐºÑ€Ð°Ñ—Ð½ÑÑŒÐºÐ°'], ['zh-CN', 'ä¸­æ–‡'], ['ko-KR', 'í•œêµ­ì–´'], ['pt-BR', 'PortuguÃªs']];
function ttsSheet(d) {
  const opts = [['', t('tts_off')], ...TTS_LANGS];
  sheet(`<h3>${t('tts_title')}</h3><p class="muted small">${t('tts_text')}</p>
    <select class="input">${opts.map(([v, n]) => `<option value="${v}" ${v === (d.tts || '') ? 'selected' : ''}>${n}</option>`).join('')}</select>
    <button class="btn primary mt" data-ok>${t('save')}</button>`, (el, close) => {
    $('[data-ok]', el).onclick = async () => { d.tts = $('select', el).value || null; await saveDeck(d); close(); render(); };
  });
}
function speak(text, lang, done) {
  const fin = () => { if (done) { const d = done; done = null; d(); } };
  if (!('speechSynthesis' in window) || !text) return fin();
  const u = new SpeechSynthesisUtterance(text); u.lang = lang || '';
  const base = (lang || '').toLowerCase().slice(0, 2);
  const voices = speechSynthesis.getVoices();
  const v = voices.find(x => x.lang.replace('_', '-').toLowerCase() === (lang || '').toLowerCase()) || voices.find(x => x.lang.toLowerCase().startsWith(base));
  if (v) u.voice = v;
  u.onend = fin; u.onerror = fin;
  setTimeout(fin, 1500 + text.length * 180);   // some engines never fire onend
  speechSynthesis.speak(u);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ study
let study = null;
VIEWS.study = (view, { id }) => {
  study = { deckId: id, ids: treeIds(id), lastId: null, undo: null, timer: null, session: 0, card: null, shown: false };
  nextStudy();
};
function nextStudy() {
  if (!study) return;
  clearTimeout(study.timer);
  const p = pickNext(study.ids, study.lastId);
  if (study.forceId) { const fc = cards.get(study.forceId); study.forceId = null; if (fc) { p.card = fc; p.wait = null; } }
  const g = p.g; const counts = { n: g.nw.length, l: g.lrn.length, r: g.rev.length };
  study.card = p.card || null; study.shown = false;
  const view = $('#view');
  const deck = decks.get(study.deckId);
  const cardDeck = study.card ? decks.get(study.card.deckId) : null;
  const tts = (cardDeck && cardDeck.tts) || (deck && deck.tts);
  const cur = !study.card ? '' : study.card.type === 0 ? 'n' : study.card.type === 2 ? 'r' : 'l';
  view.innerHTML = `<div class="study">
    <div class="study-bar">
      <button class="icon-btn" data-close>${ICON.close}</button>
      ${countsHtml(counts, cur)}
      ${study.undo ? `<button class="icon-btn" data-undo title="${t('undo')}">${ICON.undo}</button>` : ''}
      ${tts && study.card ? `<button class="icon-btn" data-speak>${ICON.speak}</button>` : ''}
      ${study.card ? `<button class="icon-btn" data-more>${ICON.more}</button>` : ''}
    </div>
    ${study.card ? `<div class="card-area" id="cardArea"></div><div class="answer-bar" id="answerBar"></div>` : doneHtml(p)}
  </div>`;
  $('[data-close]', view).onclick = () => go('deck', { id: study.deckId });
  const u = $('[data-undo]', view); if (u) u.onclick = undoAnswer;
  if (!study.card) {
    const back = $('[data-done]', view); if (back) back.onclick = () => go('deck', { id: study.deckId });
    if (p.wait) study.timer = setTimeout(nextStudy, Math.max(1000, p.wait - Date.now() - S.learnAhead * MIN));
    return;
  }
  const sp = $('[data-speak]', view);
  if (sp) sp.onclick = () => {
    // replay the card's own audio if it has any, otherwise read the visible side with the deck's voice
    const items = sideItems(study.shown);
    if (items.length) playItems(items);
    else { playToken++; speechSynthesis.cancel(); speak(stripHtml(study.shown ? study.card.back : study.card.front), tts); }
  };
  $('[data-more]', view).onclick = studyMenu;
  showSide(false);
}
function doneHtml(p) {
  const later = p.g.lrn.length;
  const parts = [];
  if (study.session) parts.push(t('done_reviewed', { cards: tn(study.session, 'cardsAcc') }));
  parts.push(later ? t('done_later', { n: later, time: fmtDur(p.wait - Date.now()) }) : t('done_tomorrow'));
  return `<div class="done"><div class="big">å®Œ</div><h2>${t('done_title')}</h2>
    <p class="muted">${esc(parts.join(' '))}</p>
    <button class="btn primary mt" data-done style="max-width:260px;margin:24px auto 0">${t('done_btn')}</button></div>`;
}
async function showSide(answer) {
  const c = study.card; const area = $('#cardArea'), bar = $('#answerBar');
  if (!area) return;
  study.shown = answer;
  area.innerHTML = sanitize(answer ? answerHtml(c) : c.front);
  area.scrollTop = 0;
  if (answer) {
    const a = $('#answer', area); if (a && area.scrollHeight > area.clientHeight) a.scrollIntoView({ block: 'start' });
    const L = [t('again'), t('hard'), t('good'), t('easy')];
    bar.innerHTML = `<div class="ease">${[1, 2, 3, 4].map(r => `<button class="e${r}" data-r="${r}">${L[r - 1]}<small>${ivlLabel(schedule(c, r, true))}</small></button>`).join('')}</div>`;
    $$('[data-r]', bar).forEach(b => b.onclick = () => answerCard(+b.dataset.r));
  } else {
    study.t0 = Date.now();
    bar.innerHTML = `<button class="btn primary" data-show>${t('show_answer')}</button>`;
    $('[data-show]', bar).onclick = () => showSide(true);
  }
  area.onclick = e => {
    const b = e.target.closest('[data-sound],[data-tts]');
    if (b) { playItems([b]); return; }
    if (!study.shown && !e.target.closest('a')) showSide(true);
  };
  await hydrate(area);
  if (study && study.card === c && study.shown === answer) {
    const items = sideItems(answer);
    const sp = $('[data-speak]');
    if (items.length && !sp) {   // card has its own audio: show the replay button even if the deck has no voice set
      $('[data-more]').insertAdjacentHTML('beforebegin', `<button class="icon-btn" data-speak>${ICON.speak}</button>`);
      $('[data-speak]').onclick = () => playItems(sideItems(study.shown));
    }
    if (S.autoplay && items.length) playItems(items);
  }
}
// playable elements of the current side; on the answer side only those after the divider (the answer part)
function sideItems(answer) {
  const area = $('#cardArea'); if (!area) return [];
  let els = $$('[data-sound],[data-tts]', area);
  const hr = $('#answer', area);
  if (answer && hr) els = els.filter(b => hr.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  return els;
}
async function answerCard(r) {
  const c = study && study.card; if (!c || !study.shown) return;
  const n = schedule(c, r);
  const rl = { id: uid(), cid: c.id, did: c.deckId, ease: r, type: c.type, ivl: n.type === 2 ? n.ivl : -Math.round((n.due - Date.now()) / 1000), last: c.ivl || 0, time: Math.min(60000, Date.now() - study.t0), day: dayNum() };
  study.undo = { prev: { ...c }, rl: rl.id };
  revlog.push(rl); study.session++; study.lastId = c.id;
  await Promise.all([saveCard(n), DB.put('revlog', rl)]);
  nextStudy();
}
async function undoAnswer() {
  if (!study || !study.undo) return;
  const { prev, rl } = study.undo; study.undo = null;
  revlog = revlog.filter(x => x.id !== rl);
  await Promise.all([saveCard(prev), DB.delMany('revlog', [rl])]);
  study.session = Math.max(0, study.session - 1);
  study.forceId = prev.id;
  nextStudy();
}
function studyMenu() {
  const c = study.card;
  sheet(`<h3>${t('card_title')}</h3><div class="menu">
    <button class="btn" data-a="edit">${t('edit')}</button>
    <button class="btn" data-a="bury">${t('bury')}</button>
    <button class="btn" data-a="susp">${t('suspend')}</button>
    <button class="btn danger" data-a="del">${t('del')}</button></div>`, (el, close) => {
    el.onclick = async e => {
      const a = e.target.closest('[data-a]'); if (!a) return; close();
      if (a.dataset.a === 'edit') editCard(c, () => { if (study) { study.card = cards.get(c.id); if (study.card) showSide(study.shown); else nextStudy(); } });
      if (a.dataset.a === 'bury') {
        if (c.type === 2) c.due = dayNum() + 1; else if (c.type === 0) c.pos = uid(); else c.due = nextDayStart();
        await saveCard(c); study.lastId = c.id; toast(c.type === 0 ? t('moved_end') : t('buried')); nextStudy();
      }
      if (a.dataset.a === 'susp') { c.susp = true; await saveCard(c); toast(t('suspended_t')); nextStudy(); }
      if (a.dataset.a === 'del') { if (await confirmSheet(t('del_card_q'), '', t('del'), true)) { cards.delete(c.id); await DB.delMany('cards', [c.id]); nextStudy(); } }
    };
  });
}
document.addEventListener('keydown', e => {
  if (!study || !study.card || $('.sheet-bg') || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  if (!study.shown && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); showSide(true); }
  else if (study.shown && /^[1-4]$/.test(e.key)) answerCard(+e.key);
  else if (study.shown && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); answerCard(3); }
  else if ((e.ctrlKey || e.metaKey) && e.key === 'z') undoAnswer();
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ add / edit
VIEWS.add = view => {
  if (!decks.size) {
    view.innerHTML = `<div class="top"><h1>${t('add_title')}</h1></div><div class="empty"><p>${t('create_deck_first')}</p><button class="btn primary" data-new>${t('create_deck')}</button></div>`;
    $('[data-new]', view).onclick = async () => { const n = await promptSheet(t('new_deck'), '', t('new_deck_ph'), t('create')); if (n) { const d = await ensureDeck(n); S.lastDeck = d.id; saveSettings(); render(); } };
    return;
  }
  const sel = decks.has(S.lastDeck) ? S.lastDeck : sortedDecks()[0].id;
  view.innerHTML = `<div class="top"><h1>${t('add_title')}</h1></div>
    <label class="f">${t('deck')}</label><select class="input" id="aDeck">${deckOptions(sel)}</select>
    <label class="f">${t('front')}</label><textarea class="input" id="aFront" placeholder="${esc(t('front_ph'))}"></textarea>
    <label class="f">${t('back')}</label><textarea class="input" id="aBack" placeholder="${esc(t('back_ph'))}"></textarea>
    <label class="f">${t('tags_lbl')}</label><input class="input" id="aTags">
    <label class="check"><input type="checkbox" id="aRev"> ${t('also_reverse')}</label>
    <button class="btn primary" id="aAdd">${t('add_btn')}</button>
    <p class="muted small center" id="aInfo"></p>`;
  const f = $('#aFront'), b = $('#aBack');
  $('#aDeck').onchange = e => { S.lastDeck = +e.target.value; saveSettings(); };
  $('#aAdd').onclick = async () => {
    if (!f.value.trim()) { f.focus(); return toast(t('fill_front')); }
    const deckId = +$('#aDeck').value; const tags = $('#aTags').value.trim();
    const list = [newCard(deckId, textToHtml(f.value.trim()), textToHtml(b.value.trim()), { plain: true, tags })];
    if ($('#aRev').checked && b.value.trim()) list.push(newCard(deckId, textToHtml(b.value.trim()), textToHtml(f.value.trim()), { plain: true, tags, nid: list[0].id, ord: 1 }));
    list.forEach(c => cards.set(c.id, c)); await DB.putMany('cards', list);
    S.lastDeck = deckId; saveSettings();
    f.value = ''; b.value = ''; f.focus();
    toast(list.length > 1 ? t('added2') : t('added'));
    const cnt = [...cards.values()].filter(c => c.deckId === deckId).length;
    $('#aInfo').textContent = t('deck_now', { deck: decks.get(deckId).name, cards: tn(cnt, 'cards') });
  };
};

function editCard(c, after) {
  const plain = !!c.plain;
  const val = h => plain ? htmlToText(h) : h;
  const state = c.type === 0 ? t('st_new') : c.type === 2 ? t('st_review', { ivl: fmtDays(c.ivl), ease: Math.round(c.ease / 10) }) : t('st_learn');
  sheet(`<h3>${t('edit_title')}</h3>
    ${plain ? '' : `<p class="muted small">${t('html_note')}</p>`}
    <label class="f">${t('deck')}</label><select class="input" data-deck>${deckOptions(c.deckId)}</select>
    <label class="f">${t('front_s')}</label><textarea class="input" data-front>${esc(val(c.front))}</textarea>
    <label class="f">${t('back_s')}</label><textarea class="input" data-back>${esc(val(c.back))}</textarea>
    <label class="f">${t('tags')}</label><input class="input" data-tags value="${esc(c.tags || '')}">
    <p class="muted small">${esc(state)} Â· ${esc(t('reps_info', { r: c.reps || 0, l: c.lapses || 0 }))}</p>
    <button class="btn primary" data-save>${t('save')}</button>
    <div class="btn-row mt"><button class="btn" data-susp>${c.susp ? t('unsuspend') : t('suspend')}</button><button class="btn" data-reset>${t('make_new')}</button></div>
    <button class="btn danger mt" data-del>${t('del_card')}</button>`, (el, close) => {
    const conv = v => plain ? textToHtml(v.trim()) : v;
    $('[data-save]', el).onclick = async () => {
      c.front = conv($('[data-front]', el).value); c.back = conv($('[data-back]', el).value);
      c.tags = $('[data-tags]', el).value.trim(); c.deckId = +$('[data-deck]', el).value;
      await saveCard(c); close(); toast(t('saved')); after && after();
    };
    $('[data-susp]', el).onclick = async () => { c.susp = !c.susp; await saveCard(c); close(); toast(c.susp ? t('suspended_t') : t('unsuspended')); after && after(); };
    $('[data-reset]', el).onclick = async () => { Object.assign(c, { type: 0, due: 0, ivl: 0, ease: S.startEase, step: 0, reps: 0, lapses: 0 }); await saveCard(c); close(); toast(t('is_new_again')); after && after(); };
    $('[data-del]', el).onclick = async () => { close(); if (await confirmSheet(t('del_card_q'), '', t('del'), true)) { cards.delete(c.id); await DB.delMany('cards', [c.id]); after && after(); } };
  });
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ browse
VIEWS.browse = (view, p) => {
  view.innerHTML = `<div class="top"><h1>${t('browse_title')}</h1></div>
    <div class="search"><input class="input" id="q" placeholder="${esc(t('search_ph'))}" value="${esc(p.q || '')}">
    <select class="input" id="bDeck"><option value="">${t('all_decks')}</option>${deckOptions(p.deck)}</select></div>
    <div id="bList"></div>`;
  const draw = () => {
    const q = $('#q').value.trim().toLowerCase(); const dk = +$('#bDeck').value || null;
    route.q = q; route.deck = dk;
    const ids = dk ? treeIds(dk) : null; const today = dayNum();
    const flags = q.match(/is:\w+/g) || []; const text = q.replace(/is:\w+/g, '').trim();
    let list = [];
    for (const c of cards.values()) {
      if (ids && !ids.has(c.deckId)) continue;
      if (flags.includes('is:new') && c.type !== 0) continue;
      if (flags.includes('is:susp') && !c.susp) continue;
      if (flags.includes('is:learn') && !(c.type === 1 || c.type === 3)) continue;
      if (flags.includes('is:due') && !(c.type === 2 && c.due <= today || (c.type === 1 || c.type === 3))) continue;
      if (text) { const hay = (stripHtml(c.front) + ' ' + stripHtml(c.back) + ' ' + (c.tags || '')).toLowerCase(); if (!hay.includes(text)) continue; }
      list.push(c);
    }
    list.sort((a, b) => b.id - a.id);
    const total = list.length; list = list.slice(0, 300);
    $('#bList').innerHTML = total ? `<p class="muted small">${tn(total, 'cards')}${total > 300 ? t('shown300') : ''}</p>
      <div class="list">${list.map(c => {
        const due = c.type === 0 ? t('due_new') : c.type === 2 ? (c.due <= today ? t('due_today') : t('due_in', { t: fmtDays(c.due - today) })) : t('due_learn');
        return `<button class="crow ${c.susp ? 'susp' : ''}" data-c="${c.id}"><div class="q">${esc(stripHtml(c.front)) || `<i class="muted">${t('media_only')}</i>`}</div>
        <div class="a">${esc(stripHtml(c.fullBack ? c.back.replace(c.front, '') : c.back))}</div>
        <div class="meta"><span>${esc((decks.get(c.deckId) || {}).name || '?')}</span><span>${due}</span>${c.susp ? `<span>${t('suspended_s')}</span>` : ''}${c.tags ? `<span class="tag">${esc(c.tags)}</span>` : ''}</div></button>`;
      }).join('')}</div>` : `<div class="empty">${t('nothing')}</div>`;
    $$('[data-c]', $('#bList')).forEach(b => b.onclick = () => editCard(cards.get(+b.dataset.c), draw));
  };
  let tm; $('#q').oninput = () => { clearTimeout(tm); tm = setTimeout(draw, 150); };
  $('#bDeck').onchange = draw;
  draw();
};

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ stats
VIEWS.stats = view => {
  const today = dayNum();
  const byDay = new Map(); let todayN = 0, todayT = 0, todayOk = 0;
  for (const r of revlog) {
    byDay.set(r.day, (byDay.get(r.day) || 0) + 1);
    if (r.day === today) { todayN++; todayT += r.time || 0; if (r.ease > 1) todayOk++; }
  }
  let streak = 0; for (let d = byDay.has(today) ? today : today - 1; byDay.has(d); d--) streak++;
  let nNew = 0, nLrn = 0, nYoung = 0, nMature = 0, nSusp = 0;
  const fc = new Array(14).fill(0);
  for (const c of cards.values()) {
    if (c.susp) { nSusp++; continue; }
    if (c.type === 0) nNew++;
    else if (c.type === 2) { if (c.ivl >= 21) nMature++; else nYoung++; const k = Math.max(0, c.due - today); if (k < 14) fc[k]++; }
    else { nLrn++; fc[0]++; }
  }
  const total = cards.size || 1;
  const weeks = 18; const wd = (new Date(Date.now() - S.rollover * 36e5).getDay() + 6) % 7;
  const start = today - (weeks - 1) * 7 - wd; const max = Math.max(1, ...[...byDay.values()]);
  let cells = '';
  for (let d = start; d < start + weeks * 7; d++) {
    const n = byDay.get(d) || 0; const lvl = d > today ? '' : n ? 'l' + Math.min(4, Math.ceil(4 * n / max)) : '';
    cells += `<i class="${lvl}" ${d > today ? 'style="opacity:.25"' : ''} title="${n}"></i>`;
  }
  const fmax = Math.max(1, ...fc);
  const split = [[nNew, 'var(--new)', t('leg_new')], [nLrn, 'var(--learn)', t('leg_learn')], [nYoung, 'color-mix(in srgb, var(--due) 55%, var(--line))', t('leg_young')], [nMature, 'var(--due)', t('leg_mature')], [nSusp, 'var(--muted)', t('leg_susp')]];
  view.innerHTML = `<div class="top"><h1>${t('stats_title')}</h1></div>
    <div class="stat-cards">
      <div><b>${todayN}</b><span>${t('st_reviews_today')}</span></div>
      <div><b>${t('u_min', { n: Math.round(todayT / MIN) })}</b><span>${t('st_time')}</span></div>
      <div><b>${todayN ? Math.round(todayOk / todayN * 100) + '%' : 'â€”'}</b><span>${t('st_correct')}</span></div>
      <div><b>${tn(streak, 'days')}</b><span>${t('st_streak')}</span></div>
    </div>
    <div class="section-title">${t('activity')}</div>
    <div class="panel"><div class="heat">${cells}</div><p class="muted small" style="margin:10px 0 0">${t('total_reviews', { n: revlog.length })}</p></div>
    <div class="section-title">${t('forecast')}</div>
    <div class="panel"><div class="bars">${fc.map((n, i) => `<div>${n ? `<em>${n}</em>` : ''}<i style="height:${n / fmax * 80}%"></i><span>${i === 0 ? t('today_s') : i === 1 ? t('tomorrow_s') : '+' + i}</span></div>`).join('')}</div></div>
    <div class="section-title">${t('cards_n', { n: cards.size })}</div>
    <div class="panel"><div class="split">${split.map(([n, col]) => n ? `<i style="width:${n / total * 100}%;background:${col}"></i>` : '').join('')}</div>
    <div class="legend">${split.map(([n, col, l]) => `<span><i style="background:${col}"></i>${l}: ${n}</span>`).join('')}</div></div>`;
};

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ settings
VIEWS.settings = view => {
  const row = (k, label, hint, numeric = true) => `<div class="setting"><div class="lbl">${t(label)}${hint ? `<small>${t(hint)}</small>` : ''}</div><input class="input" data-k="${k}" type="text" inputmode="${numeric ? 'decimal' : 'text'}" value="${esc(Array.isArray(S[k]) ? S[k].join(' ') : S[k])}"></div>`;
  view.innerHTML = `<div class="top"><h1>${t('settings_title')}</h1></div>
    <div class="section-title">${t('s_look')}</div>
    <div class="list">
      <div class="setting"><div class="lbl">${t('s_lang')}</div><select class="input" data-lang>${Object.entries(LANGS).map(([k, n]) => `<option value="${k}" ${k === LANG ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      <div class="setting"><div class="lbl">${t('s_theme')}</div><select class="input" data-theme><option value="dark">${t('th_dark')}</option><option value="light">${t('th_light')}</option><option value="auto">${t('th_auto')}</option></select></div>
      <div class="setting"><div class="lbl">${t('s_auto')}<small>${t('s_auto_h')}</small></div><input type="checkbox" data-auto style="width:22px;height:22px;accent-color:var(--gold)" ${S.autoplay ? 'checked' : ''}></div>
    </div>
    <div class="section-title">${t('s_limits')}</div>
    <div class="list">${row('newPerDay', 's_newday', 's_perdeck')}${row('revPerDay', 's_revday', 's_maxdeck')}
      <div class="setting"><div class="lbl">${t('s_bury')}<small>${t('s_bury_h')}</small></div><input type="checkbox" data-bury style="width:22px;height:22px;accent-color:var(--gold)" ${S.burySiblings ? 'checked' : ''}></div></div>
    <div class="section-title">${t('s_intervals')}</div>
    <div class="list">
      ${row('learnSteps', 's_lsteps', 's_minutes', false)}
      ${row('relearnSteps', 's_rsteps', 's_minutes', false)}
      ${row('gradIvl', 's_grad', 's_grad_h')}
      ${row('easyIvl', 's_easy', 's_easy_h')}
      ${row('startEase', 's_ease', 's_ease_h')}
      ${row('easyBonus', 's_bonus', 's_bonus_h')}
      ${row('ivlMult', 's_mult', 's_mult_h')}
      ${row('maxIvl', 's_max', 's_days')}
      ${row('rollover', 's_roll', 's_roll_h')}
    </div>
    <div class="section-title">${t('s_data')}</div>
    <button class="btn" data-import>${t('s_import')}</button>
    <p class="muted small">${t('s_import_h')}</p>
    <button class="btn" data-backup>${t('s_backup')}</button>
    <button class="btn" data-demo>${t('s_demo')}</button>
    <p class="muted small" id="storage"></p>
    <div class="section-title">${t('s_install')}</div>
    <div class="panel small">${t('s_install_body')}</div>
    <p class="muted small center mt2">Hanabira Flashcards èŠ±ã³ã‚‰ Â· v1.1 Â· <a href="https://github.com/k1adu/hanabira" target="_blank" style="color:var(--gold)">GitHub</a></p>`;
  $('[data-lang]', view).onchange = e => { S.lang = e.target.value; saveSettings(); applyLang(); render(); };
  $('[data-theme]', view).value = S.theme;
  $('[data-theme]', view).onchange = e => { S.theme = e.target.value; applyTheme(); saveSettings(); };
  $('[data-auto]', view).onchange = e => { S.autoplay = e.target.checked; saveSettings(); };
  $('[data-bury]', view).onchange = e => { S.burySiblings = e.target.checked; saveSettings(); };
  $$('[data-k]', view).forEach(inp => inp.onchange = () => {
    const k = inp.dataset.k; const v = inp.value.replace(',', '.');
    if (Array.isArray(DEFAULTS[k])) { const arr = v.split(/[\s,;]+/).map(Number).filter(x => x > 0); if (k === 'learnSteps' && !arr.length) return toast(t('need_step')); S[k] = arr; }
    else { let n = parseFloat(v); if (!isFinite(n) || n < 0) { inp.value = k === 'startEase' ? S[k] / 10 : S[k]; return toast(t('bad_value')); } if (k === 'startEase') n = Math.round(Math.max(130, n) * 10); S[k] = n; }
    saveSettings(); toast(t('saved'));
    if (k === 'startEase') inp.value = S.startEase / 10;
  });
  $('[data-k="startEase"]', view).value = S.startEase / 10;
  $('[data-import]', view).onclick = pickImportFile;
  $('[data-backup]', view).onclick = exportBackup;
  $('[data-demo]', view).onclick = makeDemo;
  if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then(e => {
    const mb = x => fmtNum(x / 1048576) + ' ' + t('mb');
    const el = $('#storage'); if (el) el.textContent = t('s_storage', { used: mb(e.usage || 0) }) + (e.quota ? t('s_quota', { q: mb(e.quota) }) : '');
  });
};

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ import / export
function pickImportFile() {
  const inp = document.createElement('input'); inp.type = 'file';
  inp.onchange = () => { const f = inp.files[0]; if (f) importFile(f); };
  inp.click();
}
function progressSheet(title) {
  let el;
  const close = sheet(`<h3>${esc(title)}</h3><p class="muted small" data-msg>${t('preparing')}</p><div class="progress"><i></i></div>`, e => { el = e; });
  return {
    set(msg, frac) { $('[data-msg]', el).textContent = msg; if (frac != null) $('.progress i', el).style.width = Math.round(frac * 100) + '%'; },
    close,
  };
}
async function importFile(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  try {
    if (ext === 'apkg' || ext === 'colpkg' || ext === 'zip') await importApkg(file);
    else if (ext === 'json') await importJson(await file.text());
    else await importText(await file.text(), file.name);
  } catch (e) {
    console.error(e);
    $$('.sheet-bg').forEach(x => x.remove());
    sheet(`<h3>${t('import_failed')}</h3><p class="muted">${esc(e.message || e)}</p><button class="btn" data-x>${t('close')}</button>`, (el, close) => { $('[data-x]', el).onclick = close; });
  }
}

function pbRead(buf) {
  const out = {}; let i = 0;
  const varint = () => { let r = 0, s = 0, b; do { b = buf[i++]; r += (b & 0x7f) * 2 ** s; s += 7; } while (b & 0x80 && i < buf.length); return r; };
  while (i < buf.length) {
    const key = varint(); const f = Math.floor(key / 8), wt = key & 7; let v;
    if (wt === 0) v = varint();
    else if (wt === 2) { const len = varint(); v = buf.subarray(i, i + len); i += len; }
    else if (wt === 1) { i += 8; continue; }
    else if (wt === 5) { i += 4; continue; }
    else break;
    (out[f] || (out[f] = [])).push(v);
  }
  return out;
}
const pbStr = b => b ? new TextDecoder().decode(b) : '';
const isZstd = b => b && b[0] === 0x28 && b[1] === 0xb5 && b[2] === 0x2f && b[3] === 0xfd;
let SQLlib = null;

async function importApkg(file) {
  const pr = progressSheet(t('importing', { name: file.name }));
  pr.set(t('loading_libs'), 0.02);
  await loadScript(LIB + 'jszip.min.js'); await loadScript(LIB + 'fzstd.js'); await loadScript(LIB + 'sql-wasm.js');
  if (!SQLlib) SQLlib = await initSqlJs({ locateFile: f => LIB + f });
  pr.set(t('unpacking'), 0.06);
  const zip = await JSZip.loadAsync(file);
  const COL = 'collection.an' + 'ki2';   // file names inside the .apkg container
  const f21b = zip.file(COL + '1b'), f21 = zip.file(COL + '1'), f2 = zip.file(COL);
  let bytes;
  if (f21b) bytes = fzstd.decompress(await f21b.async('uint8array'));
  else if (f21) bytes = await f21.async('uint8array');
  else if (f2) bytes = await f2.async('uint8array');
  else throw new Error(t('no_collection'));
  const db = new SQLlib.Database(bytes);
  const q = sql => { const r = db.exec(sql); if (!r.length) return []; const { columns, values } = r[0]; return values.map(v => Object.fromEntries(columns.map((c, i) => [c, v[i]]))); };
  const hasTable = n => q(`select name from sqlite_master where type='table' and name='${n}'`).length > 0;
  const models = {}, deckNames = {};
  if (hasTable('notetypes')) {
    for (const nt of q('select id,name,config from notetypes')) { const cfg = pbRead(nt.config || new Uint8Array()); models[nt.id] = { cloze: (cfg[1] ? cfg[1][0] : 0) === 1, flds: [], tmpls: [] }; }
    for (const f of q('select ntid,ord,name from fields order by ntid,ord')) if (models[f.ntid]) models[f.ntid].flds.push(f.name);
    for (const tp of q('select ntid,ord,config from templates order by ntid,ord')) {
      const cfg = pbRead(tp.config || new Uint8Array());
      if (models[tp.ntid]) models[tp.ntid].tmpls[tp.ord] = { q: pbStr(cfg[1] && cfg[1][0]), a: pbStr(cfg[2] && cfg[2][0]) };
    }
    for (const d of q('select id,name from decks')) deckNames[d.id] = d.name.replace(/\x1f/g, '::');
  } else {
    const col = q('select models,decks from col')[0];
    for (const [id, m] of Object.entries(JSON.parse(col.models))) models[id] = {
      cloze: m.type === 1,
      flds: m.flds.slice().sort((a, b) => a.ord - b.ord).map(f => f.name),
      tmpls: m.tmpls.slice().sort((a, b) => a.ord - b.ord).map(x => ({ q: x.qfmt, a: x.afmt })),
    };
    for (const [id, d] of Object.entries(JSON.parse(col.decks))) deckNames[id] = d.name;
  }
  const notes = new Map(); for (const n of q('select id,guid,mid,flds,tags from notes')) notes.set(n.id, n);
  const rows = q('select id,nid,did,ord,queue from cards order by nid,ord');
  db.close();
  if (!rows.length) throw new Error(t('empty_col'));
  const base = file.name.replace(/\.[^.]+$/, '');
  const existing = new Map(); for (const c of cards.values()) if (c.src) existing.set(c.src, c);
  const deckCache = {}; const out = []; const updated = []; let skipped = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]; const note = notes.get(r.nid); const m = note && models[note.mid];
    if (!m) continue;
    const src = `a:${note.guid}:${r.ord}`;
    const old = existing.get(src);
    const vals = note.flds.split('\x1f'); const fields = {}; m.flds.forEach((n, k) => { fields[n] = vals[k] || ''; });
    const tpl = m.cloze ? m.tmpls[0] : m.tmpls[r.ord]; if (!tpl) continue;
    let dn = deckNames[r.did] || base; if (/^(Default|Ð—Ð° Ð·Ð°Ð¼Ð¾Ð²Ñ‡ÑƒÐ²Ð°Ð½Ð½ÑÐ¼|Standard|DomyÅ›lna|Predeterminado|ãƒ‡ãƒ•ã‚©ãƒ«ãƒˆ)$/.test(dn)) dn = base;
    const ctx = { ord: r.ord + 1, tags: note.tags.trim(), deck: dn.split('::').pop() };
    const front = renderTemplate(tpl.q, fields, { ...ctx, side: 'q' });
    const back = renderTemplate(tpl.a, fields, { ...ctx, side: 'a', front });
    if (!stripHtml(front) && !/<img|\[sound:|data-tts/i.test(front)) continue;
    if (old) {
      // already imported: refresh the content (e.g. newly supported audio), keep the learning progress
      if (old.front !== front || old.back !== back || old.nid !== 'a:' + note.guid) { Object.assign(old, { front, back, fullBack: true, nid: 'a:' + note.guid, ord: r.ord }); updated.push(old); } else skipped++;
      continue;
    }
    if (!deckCache[dn]) deckCache[dn] = await ensureDeck(dn);
    out.push(newCard(deckCache[dn].id, front, back, { fullBack: true, src, nid: 'a:' + note.guid, ord: r.ord, tags: ctx.tags, susp: r.queue === -1 }));
    if (i % 500 === 0) pr.set(t('p_cards', { i, n: rows.length }), 0.1 + 0.4 * i / rows.length);
  }
  pr.set(t('p_saving'), 0.5);
  for (let i = 0; i < out.length; i += 1000) await DB.putMany('cards', out.slice(i, i + 1000));
  for (let i = 0; i < updated.length; i += 1000) await DB.putMany('cards', updated.slice(i, i + 1000));
  out.forEach(c => cards.set(c.id, c));
  const mf = zip.file('media'); let map = {};
  if (mf) {
    let b = await mf.async('uint8array');
    if (b[0] === 0x7b) map = JSON.parse(new TextDecoder().decode(b));
    else {
      if (isZstd(b)) b = fzstd.decompress(b);
      (pbRead(b)[1] || []).forEach((e, i) => { const m = pbRead(e); map[String(m[255] ? m[255][0] : i)] = pbStr(m[1] && m[1][0]); });
    }
  }
  const entries = Object.entries(map); let batch = [];
  for (let i = 0; i < entries.length; i++) {
    const [zn, name] = entries[i]; const zf = zip.file(zn); if (!zf || !name) continue;
    let data = await zf.async('uint8array'); if (isZstd(data)) data = fzstd.decompress(data);
    batch.push({ name, type: mimeOf(name), data: data.slice().buffer });
    if (batch.length >= 40) { await DB.putMany('media', batch); batch = []; pr.set(t('p_media', { i: i + 1, n: entries.length }), 0.55 + 0.45 * i / entries.length); }
  }
  if (batch.length) await DB.putMany('media', batch);
  mediaUrls.clear();
  pr.close();
  toast(t('imported', { cards: tn(out.length, 'cardsAcc') }) + (updated.length ? t('updated_n', { n: updated.length }) : '') + (skipped ? t('skipped_dups', { n: skipped }) : ''), 4000);
  const first = Object.values(deckCache)[0] || (updated[0] && decks.get(updated[0].deckId));
  if (first) go('deck', { id: (deckByName(first.name.split('::')[0]) || first).id }); else render();
}

function parseDelimited(text) {
  let sep = null, isHtml = null; const lines = text.replace(/^ï»¿/, '').split(/\r?\n/);
  while (lines.length && lines[0].startsWith('#')) {
    const h = lines.shift(); const m = h.match(/^#separator:(\w+)/i);
    if (m) sep = { tab: '\t', semicolon: ';', comma: ',', pipe: '|', space: ' ', colon: ':' }[m[1].toLowerCase()] || null;
    if (/^#html:true/i.test(h)) isHtml = true;
  }
  const body = lines.join('\n');
  if (!sep) { const first = lines.find(l => l.trim()) || ''; sep = first.includes('\t') ? '\t' : first.includes(';') ? ';' : first.includes(',') ? ',' : '\t'; }
  const rows = []; let row = [], cell = '', inQ = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inQ) { if (ch === '"') { if (body[i + 1] === '"') { cell += '"'; i++; } else inQ = false; } else cell += ch; }
    else if (ch === '"' && cell === '') inQ = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  row.push(cell); rows.push(row);
  return { rows: rows.filter(r => r.length >= 1 && r[0].trim()), isHtml };
}
async function importText(text, name) {
  const { rows, isHtml } = parseDelimited(text);
  if (!rows.length) throw new Error(t('text_empty'));
  const conv = s => (isHtml || /<[a-z][^>]*>/i.test(s)) ? s.trim() : textToHtml(s.trim());
  const base = name.replace(/\.[^.]+$/, '');
  sheet(`<h3>${t('text_import')}</h3><p class="muted small">${esc(t('found_rows', { rows: tn(rows.length, 'rows') }))}</p>
    <div class="panel small" style="margin-bottom:10px"><b>${esc(stripHtml(rows[0][0]))}</b> â†’ ${esc(stripHtml(rows[0][1] || ''))}</div>
    <label class="f">${t('deck_existing_new')}</label><input class="input" data-name list="dlist" value="${esc(base)}">
    <datalist id="dlist">${sortedDecks().map(d => `<option value="${esc(d.name)}">`).join('')}</datalist>
    <label class="check"><input type="checkbox" data-rev> ${t('also_reverse_pl')}</label>
    <button class="btn primary" data-ok>${t('import_btn')}</button>`, (el, close) => {
    $('[data-ok]', el).onclick = async () => {
      const d = await ensureDeck($('[data-name]', el).value || base); const rev = $('[data-rev]', el).checked;
      const list = [];
      for (const r of rows) {
        const f = conv(r[0]), b = conv(r[1] || ''), tags = (r[2] || '').trim();
        const fc = newCard(d.id, f, b, { tags, plain: !isHtml }); list.push(fc);
        if (rev && b) list.push(newCard(d.id, b, f, { tags, plain: !isHtml, nid: fc.id, ord: 1 }));
      }
      list.forEach(c => cards.set(c.id, c)); await DB.putMany('cards', list);
      close(); toast(t('imported', { cards: tn(list.length, 'cardsAcc') })); go('deck', { id: d.id });
    };
  });
}

function mediaRefs(html) {
  const s = new Set(); String(html).replace(/<(?:img|audio|source|video)[^>]+src=["']([^"']+)["']/gi, (m, n) => { if (!/^(https?:|data:|blob:)/.test(n)) { try { s.add(decodeURIComponent(n)); } catch (e) { s.add(n); } } });
  String(html).replace(/\[sound:([^\]]+)\]/g, (m, n) => s.add(n)); return s;
}
async function collectMedia(names) {
  const out = [];
  for (const n of names) { const m = await DB.get('media', n); if (m) out.push({ name: m.name, type: m.type, b64: abToB64(m.data) }); }
  return out;
}
function offerFile(fileName, json, title) {
  const file = new File([json], fileName, { type: 'application/json' });
  const kb = Math.max(1, Math.round(file.size / 1024));
  sheet(`<h3>${esc(title)}</h3><p class="muted small">${esc(fileName)} Â· ${kb > 1024 ? fmtNum(kb / 1024) + ' ' + t('mb') : kb + ' ' + t('kb')}</p>
    ${navigator.canShare && navigator.canShare({ files: [file] }) ? `<button class="btn primary" data-share>${t('share_send')}</button>` : ''}
    <button class="btn" data-dl>${t('download')}</button>`, (el, close) => {
    const sh = $('[data-share]', el);
    if (sh) sh.onclick = async () => { try { await navigator.share({ files: [file], title: fileName }); close(); } catch (e) { if (e.name !== 'AbortError') toast(t('failed', { e: e.message })); } };
    $('[data-dl]', el).onclick = () => {
      const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = fileName;
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000); close();
    };
  });
}
const stamp = () => new Date().toISOString().slice(0, 10);
async function exportDeck(d) {
  const ids = treeIds(d.id); const list = [...cards.values()].filter(c => ids.has(c.deckId));
  const names = new Set(); list.forEach(c => { mediaRefs(c.front).forEach(n => names.add(n)); mediaRefs(c.back).forEach(n => names.add(n)); });
  const data = {
    app: 'hanabira', kind: 'deck', v: 1,
    decks: [...ids].map(i => decks.get(i)).map(x => ({ name: x.name, tts: x.tts || null })),
    cards: list.map(c => ({ deck: decks.get(c.deckId).name, front: c.front, back: c.back, fullBack: !!c.fullBack, plain: !!c.plain, tags: c.tags || '', src: c.src || 'k:' + c.id, nid: String(c.nid), ord: c.ord || 0 })),
    media: await collectMedia(names),
  };
  const safe = d.name.replace(/::/g, '-').replace(/[\\/:*?"<>|]/g, '').trim() || 'deck';
  offerFile(`${safe}.hanabira.json`, JSON.stringify(data), t('share_deck'));
}
async function exportBackup() {
  const media = await DB.all('media');
  const data = {
    app: 'hanabira', kind: 'backup', v: 1, date: Date.now(), settings: S,
    decks: [...decks.values()], cards: [...cards.values()], revlog,
    media: media.map(m => ({ name: m.name, type: m.type, b64: abToB64(m.data) })),
  };
  offerFile(`hanabira-backup-${stamp()}.json`, JSON.stringify(data), t('backup_title'));
}
async function importJson(text) {
  let data; try { data = JSON.parse(text); } catch (e) { throw new Error(t('bad_json')); }
  if (!data || data.app !== 'hanabira') throw new Error(t('not_hanabira'));
  if (data.kind === 'backup') {
    if (!await confirmSheet(t('restore_q'), t('restore_text', { date: new Date(data.date).toLocaleString(LANG) }), t('restore_btn'), true)) return;
    const pr = progressSheet(t('restoring'));
    for (const s of ['decks', 'cards', 'revlog', 'media']) await DB.clear(s);
    await DB.putMany('decks', data.decks || []);
    for (let i = 0; i < (data.cards || []).length; i += 1000) await DB.putMany('cards', data.cards.slice(i, i + 1000));
    for (let i = 0; i < (data.revlog || []).length; i += 2000) await DB.putMany('revlog', data.revlog.slice(i, i + 2000));
    const media = data.media || [];
    for (let i = 0; i < media.length; i += 40) { await DB.putMany('media', media.slice(i, i + 40).map(m => ({ name: m.name, type: m.type, data: b64ToAb(m.b64) }))); pr.set(t('p_media', { i, n: media.length }), i / media.length); }
    await DB.put('meta', { k: 'settings', v: { ...DEFAULTS, ...data.settings } });
    await loadAll(); mediaUrls.clear(); applyTheme(); applyLang(); pr.close(); toast(t('restored')); go('decks');
    return;
  }
  if (data.kind !== 'deck') throw new Error(t('unknown_type'));
  const existing = new Set(); for (const c of cards.values()) if (c.src) existing.add(c.src);
  for (const x of data.decks || []) { const d = await ensureDeck(x.name); if (x.tts && !d.tts) { d.tts = x.tts; await saveDeck(d); } }
  const list = []; let skipped = 0;
  for (const c of data.cards || []) {
    if (c.src && existing.has(c.src)) { skipped++; continue; }
    const d = await ensureDeck(c.deck);
    const extra = { fullBack: c.fullBack, plain: c.plain, tags: c.tags, src: c.src };
    const m = /^a:(.+):(\d+)$/.exec(c.src || '');
    if (m) { extra.nid = 'a:' + m[1]; extra.ord = +m[2]; }
    else if (c.nid != null) { extra.nid = 'f:' + c.nid; extra.ord = c.ord || 0; }
    list.push(newCard(d.id, c.front, c.back, extra));
  }
  await DB.putMany('cards', list); list.forEach(c => cards.set(c.id, c));
  const media = data.media || [];
  for (let i = 0; i < media.length; i += 40) await DB.putMany('media', media.slice(i, i + 40).map(m => ({ name: m.name, type: m.type, data: b64ToAb(m.b64) })));
  mediaUrls.clear();
  toast(t('added_cards', { cards: tn(list.length, 'cardsAcc') }) + (skipped ? t('already', { n: skipped }) : ''), 3500);
  const root = data.decks && data.decks[0] ? deckByName(data.decks[0].name) : null;
  root ? go('deck', { id: root.id }) : go('decks');
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ boot
$$('#tabs button').forEach(b => b.onclick = () => go(b.dataset.tab));
// refresh due counts when the app returns to the foreground (only on screens without user input)
document.addEventListener('visibilitychange', () => { if (!document.hidden && (route.v === 'decks' || route.v === 'deck' || route.v === 'stats') && !$('.sheet-bg')) render(); });
(async () => {
  setLang(null);
  try {
    await DB.open(); await loadAll(); applyTheme(); applyLang(); render();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  } catch (e) {
    $('#view').innerHTML = `<div class="empty"><p>${t('storage_fail')}</p><p class="small">${esc(e.message || e)}</p></div>`;
  }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
