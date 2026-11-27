/**
 * desk 중간 서버 (Google Apps Script 웹 앱)
 *
 * 화면(index.html)은 이 주소로만 데이터를 주고받는다.
 * 화면이 쓰는 요청과 응답의 모양은 '햄찌스 데스크'와 같고, 원본만 노션 대신
 * 구글 드라이브 안 옵시디언 볼트의 desk/ 폴더 노트다.
 *
 * 설정(처음 1번) — 자세한 순서는 README.md
 *   스크립트 속성  PASS        = 비밀번호(9글자 이상)
 *                  TODO_FOLDER = 볼트 desk 폴더의 위치. 경로(Z:\ObsidianFolder\desk)나 드라이브 번호
 *                  LOG_FILE    = (선택) 작업 로그 파일의 위치. 경로(Z:\ObsidianFolder\log.md)나 드라이브 번호
 *   배포 → 웹 앱 / 실행: 나 / 액세스: 모든 사용자
 */

const TZ = 'Asia/Seoul';
const VERSION = '2026-11-27b';
const WORK_FILE = '작업 목록.json';   // PC의 tools/sync-vault.js가 쓰는 파일. 서버는 읽기만 한다
const GIT_FILE = '작업 내역.md';   // PC의 tools/sync-git.js가 쓰는 파일. 서버는 읽기만 한다
// 지원 서류: PC의 portfolio 저장소 build.js가 desk 폴더에 쓰는 한 파일짜리 문서들. 서버는 이 이름들만, 읽기만 한다
const DOC_FILES = { '이력서': '이력서.html', '포트폴리오': '포트폴리오.html' };
// PC에서 고친 지 이만큼 안 지난 파일에는 읽으면서 번호를 붙여 쓰지 않는다. 옵시디언이 아직 쓰는 중일 수 있다
const FRESH_MS = 2 * 60 * 1000;
const TRASH = '휴지통.md';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_MS = 86400000;

/* ───────── 입구 ───────── */
function doGet() {
  return out_({ ok: true, hello: 'desk 서버가 켜져 있습니다', version: VERSION });
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { req = null; }
  if (!req || typeof req !== 'object') return out_({ ok: false, error: '요청 형식이 잘못되었습니다' });
  const gate = checkPass_(req.pass);
  if (gate) return out_({ ok: false, error: gate, auth: true });
  try {
    if (!Object.prototype.hasOwnProperty.call(ACTIONS, req.action)) throw new Error('알 수 없는 동작: ' + req.action);
    return out_({ ok: true, data: ACTIONS[req.action](req.args || {}, todoFolder_()) });
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err) });
  }
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * 비밀번호 확인. 문제가 있으면 사유 글자를, 맞으면 null을 돌려준다.
 * 잠금은 두지 않는다: 누가 보냈는지 알 수 없어 잠그면 주인까지 막힌다. 긴 비밀번호와 2초 지연으로 막는다.
 */
function checkPass_(pass) {
  const real = PropertiesService.getScriptProperties().getProperty('PASS');
  if (!real) return '서버에 PASS(비밀번호)가 설정되지 않았습니다';
  if (real.length < 9) return '서버의 PASS(비밀번호)를 9글자 이상으로 정해 주세요';
  if (String(pass == null ? '' : pass) !== real) { Utilities.sleep(2000); return '비밀번호가 맞지 않습니다'; }
  return null;
}

function todoFolder_() {
  const id = PropertiesService.getScriptProperties().getProperty('TODO_FOLDER');
  if (!id) throw new Error('서버에 TODO_FOLDER(desk 폴더 위치)가 설정되지 않았습니다');
  return locate_(id, false);
}

/**
 * 스크립트 속성에 적힌 위치를 드라이브에서 찾는다. 두 가지로 적을 수 있다.
 *   번호: 드라이브 주소에 보이는 긴 글자
 *   경로: 내 드라이브 맨 위부터의 이름. ObsidianFolder/desk. PC에서 보이는 Z:\ObsidianFolder\desk를 그대로 적어도 된다
 * 구글 서버는 PC의 드라이브 글자(Z:)를 모르므로 떼어 내고, 내 드라이브 맨 위에서 이름으로 찾아 들어간다.
 * 이름으로 찾는 것은 느려서 한 번 찾은 번호를 6시간 기억한다.
 */
function locate_(value, wantFile) {
  const v = String(value).trim();
  const open = function (id) { return wantFile ? DriveApp.getFileById(id) : DriveApp.getFolderById(id); };
  if (/^[A-Za-z0-9_-]{15,}$/.test(v)) return open(v);
  const cache = CacheService.getScriptCache(), key = 'loc:' + (wantFile ? 'f:' : 'd:') + v;
  const known = cache.get(key);
  if (known) { try { return open(known); } catch (err) { /* 옮겨졌거나 지워졌으면 다시 찾는다 */ } }
  const parts = v.replace(/^[A-Za-z]:/, '').split(/[\\/]+/).map(function (s) { return s.trim(); }).filter(function (s) { return s; });
  if (!parts.length) throw new Error('위치가 비어 있습니다');
  let at = DriveApp.getRootFolder();
  for (let i = 0; i < parts.length; i++) {
    const last = i === parts.length - 1;
    at = onlyOne_(wantFile && last ? at.getFilesByName(parts[i]) : at.getFoldersByName(parts[i]), parts[i]);
  }
  cache.put(key, at.getId(), 21600);
  return at;
}

/** 그 이름이 정확히 하나일 때만 돌려준다. 없거나 둘 이상이면 서버가 고르지 않고 멈춘다. */
function onlyOne_(it, name) {
  let found = null;
  while (it.hasNext()) {
    const x = it.next();
    if (x.isTrashed && x.isTrashed()) continue;
    if (found) throw new Error('드라이브에 같은 이름이 둘 이상입니다: ' + name);
    found = x;
  }
  if (!found) throw new Error('드라이브에서 찾을 수 없습니다: ' + name);
  return found;
}

function ymd_(d) { return Utilities.formatDate(d, TZ, 'yyyy-MM-dd'); }
function addDays_(s, n) { return ymd_(new Date(new Date(s + 'T00:00:00+09:00').getTime() + n * DAY_MS)); }

/* ───────── 드라이브 파일 ───────── */
function findFile_(folder, name) {
  const it = folder.getFilesByName(name);
  let found = null;
  while (it.hasNext()) {
    const f = it.next();
    if (f.isTrashed()) continue;
    // 어느 쪽이 원본인지 서버가 고르지 않는다
    if (found) throw new Error('같은 이름의 노트가 둘 이상입니다: ' + name);
    found = f;
  }
  return found;
}

/** 없으면 null. */
function readText_(folder, name) {
  const f = findFile_(folder, name);
  return f ? f.getBlob().getDataAsString('UTF-8') : null;
}

function writeText_(folder, name, text) {
  const f = findFile_(folder, name);
  if (f) f.setContent(text);
  else folder.createFile(name, text, 'text/markdown');
}

function makeId_() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 6; i++) id += chars.charAt(Math.floor(Math.random() * chars.length));
  return id;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  // 「모두 오늘로」처럼 요청 여러 개가 한꺼번에 오면 줄을 서야 한다. 넉넉히 기다린다
  lock.waitLock(30000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/**
 * 종류의 노트 글을 연다. 없으면 빈 글이다(파일은 처음 쓸 때 생긴다).
 * PC에서 손으로 쓴 줄에 번호가 없으면 붙여서 저장한다. 바뀐 게 없으면 쓰지 않는다.
 */
function open_(folder, kind) {
  const f = findFile_(folder, KINDS[kind].file);
  if (!f) return '';
  const was = f.getBlob().getDataAsString('UTF-8');
  const e = ensureIds(was, makeId_);
  if (!e.changed) return was;
  // 방금 손으로 고친 파일이면 번호 붙이기를 다음으로 미룬다. 번호 없는 건은 화면에 보이기만 한다
  if (Date.now() - f.getLastUpdated().getTime() < FRESH_MS) return was;
  f.setContent(e.text);
  return e.text;
}

/** 화면에 주는 한 건. u는 노션 주소가 들어가던 자리라 비워 둔다. */
function rows_(text, kind) {
  return listRecords(text, kind).map(function (r) { r.u = null; return r; });
}

function one_(text, kind, id) {
  return rows_(text, kind).filter(function (r) { return r.id === id; })[0];
}

// 게임잡 공고 한 장의 주소. 주소 끝까지 맞아야 하고(다른 사이트 주소에 끼워 넣은 것을 막는다) 번호는 숫자만 받는다
const JOB_URL_RE = /^https?:\/\/(?:www\.)?gamejob\.co\.kr\/Recruit\/GI_Read\/View\?(?:[^#\s]*&)?GI_No=(\d{1,12})(?:[&#][^\s]*)?$/i;

const JOB_VIEW_URL = 'https://www.gamejob.co.kr/Recruit/GI_Read/View?GI_No=';
const JOB_LIST_URL = 'https://www.gamejob.co.kr/Recruit/joblist?menucode=duty&duty=';
// 화면에서 고를 수 있는 직무 번호(게임잡의 분류): 1 클라이언트, 2 모바일, 3 게임AI, 12 플랫폼 개발, 16 서버, 18 엔진
const JOB_DUTIES = [1, 2, 3, 12, 16, 18];

/** 바깥 웹 페이지 한 장을 글로 받는다. */
function webText_(url) {
  const r = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) return '';
  return r.getContentText('UTF-8');
}

/**
 * 그림 한 장에서 글자를 읽는다(OCR). 구글 드라이브에 그림을 올리면서 구글 문서로 바꿔 달라고 하면 글자를 읽어 준다.
 * 읽으려고 만든 임시 문서는 바로 지운다. 30KB보다 작은 그림(로고, 배너)과 6MB보다 큰 그림은 읽지 않는다.
 */
function ocr_(url) {
  const r = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error('그림을 받지 못했습니다');
  const blob = r.getBlob(), bytes = blob.getBytes(), size = bytes.length;
  if (size < 30 * 1024) return '';
  // 서버가 붙인 표시(Content-Type)는 믿지 않는다. 그림인데 표시 없이 보내는 곳도, 반대인 곳도 있다. 파일 앞머리로 가린다
  const b = function (i) { return bytes[i] & 0xFF; };
  const type = b(0) === 0xFF && b(1) === 0xD8 ? 'image/jpeg' : b(0) === 0x89 && b(1) === 0x50 ? 'image/png'
    : b(0) === 0x47 && b(1) === 0x49 ? 'image/gif' : null;
  if (!type) throw new Error('그림 파일이 아닙니다');
  blob.setContentType(type);
  if (size > 6 * 1024 * 1024) throw new Error('그림이 너무 큽니다(6MB 초과)');
  const doc = Drive.Files.create({ name: 'desk 공고 글자 읽기(임시)', mimeType: 'application/vnd.google-apps.document' }, blob, { ocrLanguage: 'ko' });
  try {
    return DocumentApp.openById(doc.id).getBody().getText().split('\n').map(function (l) { return l.replace(/\s+/g, ' ').trim(); })
      .filter(function (l) { return l; }).join('\n');
  } finally {
    try { Drive.Files.remove(doc.id); } catch (err) { /* 못 지워도 읽은 글은 준다. 드라이브에 임시 문서가 남는다 */ }
  }
}

/** 작업 목록에 적힌 그림 하나를 읽는다. 목록 밖 경로와 그림이 아닌 파일은 거절한다(드라이브의 다른 파일을 읽는 길이 되지 않게). */
function workImg_(idx, folder, path) {
  if ((idx.imgs || []).indexOf(path) < 0 && !idx.notes.some(function (n) { return (n.imgs || []).indexOf(path) >= 0; })) throw new Error('작업 목록에 없는 그림입니다');
  const ext = path.split('.').pop().toLowerCase();
  const mime = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }[ext];
  if (!mime) throw new Error('그림 파일이 아닙니다');
  const bytes = under_(vault_(folder), path).getBlob().getBytes();
  if (bytes.length > 8 * 1024 * 1024) throw new Error('그림이 너무 큽니다(8MB 초과)');
  return { mime: mime, b64: Utilities.base64Encode(bytes) };
}

/** PC가 만든 작업 목록을 읽는다. */
function workIndex_(folder) {
  const text = readText_(folder, WORK_FILE);
  if (!text) throw new Error('작업 목록이 없습니다. PC에서 tools/sync-vault.js를 돌려 주세요');
  const idx = JSON.parse(text);
  if (!idx || !Array.isArray(idx.notes)) throw new Error('작업 목록 파일의 모양이 잘못되었습니다');
  return idx;
}

/** 볼트 폴더. 데이터 폴더(desk)의 바로 위다. */
function vault_(folder) {
  const it = folder.getParents();
  if (!it.hasNext()) throw new Error('데이터 폴더의 위 폴더(볼트)를 찾을 수 없습니다');
  return it.next();
}

/**
 * 폴더 아래의 경로(슬래시)를 이름으로 따라가 파일을 찾는다.
 * 한 번 찾은 파일의 번호를 6시간 기억해 다음에는 바로 연다.
 * 실측(2026-11-24): 노트 하나에 4초쯤 걸리는데 대부분 Apps Script의 기본 시간(1.4초)과 파일 읽기라, 이 기억으로 줄어드는 폭은 작다.
 */
function under_(base, rel) {
  const cache = CacheService.getScriptCache(), key = 'u:' + rel;
  const known = key.length <= 240 ? cache.get(key) : null;   // 캐시 열쇠는 250자까지다. 더 긴 경로는 매번 찾는다
  if (known) { try { return DriveApp.getFileById(known); } catch (err) { /* 옮겨졌거나 지워졌으면 다시 찾는다 */ } }
  const parts = rel.split('/').filter(function (s) { return s; });
  let at = base;
  for (let i = 0; i < parts.length; i++) {
    at = onlyOne_(i === parts.length - 1 ? at.getFilesByName(parts[i]) : at.getFoldersByName(parts[i]), parts[i]);
  }
  if (key.length <= 240) cache.put(key, at.getId(), 21600);
  return at;
}

function checkKind_(kind) {
  if (!Object.prototype.hasOwnProperty.call(KINDS, kind)) throw new Error('다룰 수 없는 종류입니다: ' + kind);
}

/* ───────── 구글 캘린더 ───────── */
function calendarEvents_(from, to) {
  const start = new Date(from + 'T00:00:00+09:00'), end = new Date(to + 'T23:59:59+09:00');
  const out = [], me = account_().toLowerCase();
  CalendarApp.getAllCalendars().forEach(function (cal) {
    if (cal.isHidden && cal.isHidden()) return;
    let evs = [];
    try { evs = cal.getEvents(start, end); } catch (e) { return; }
    evs.forEach(function (ev) {
      const all = ev.isAllDayEvent();
      out.push({
        id: ev.getId(), t: ev.getTitle(), all: all,
        s: all ? ymd_(ev.getAllDayStartDate()) : ev.getStartTime().toISOString(),
        e: all ? ymd_(new Date(ev.getAllDayEndDate().getTime() - 1)) : ev.getEndTime().toISOString(),
        cal: cal.getName(), color: cal.getColor(), loc: ev.getLocation() || '',
        // 내 계정이 만든 일정인가. 가족이 내 캘린더에 직접 적은 일정을 화면이 따로 가르고 끌 수 있게 한다.
        // 캘린더의 주인으로는 가를 수 없다(남이 적어도 내 캘린더의 일정이다)
        mine: ev.getCreators().some(function (c) { return String(c).toLowerCase() === me; }),
      });
    });
  });
  return out.sort(function (a, b) { return a.s < b.s ? -1 : 1; });
}

function account_() {
  try { return Session.getEffectiveUser().getEmail(); } catch (e) { return ''; }
}

/* ───────── 동작 ───────── */
const ACTIONS = {
  // 연결 확인용. notion은 화면이 "원본이 연결됐다"는 뜻으로 보는 값이다
  ping: function () {
    return { account: account_(), notion: true, v: VERSION };
  },

  load: function (a, folder) {
    const today = ymd_(new Date());
    const since = addDays_(today, -60);
    const texts = withLock_(function () {
      const t = {};
      ['tasks', 'memo', 'habit', 'att', 'leave', 'job', 'doc', 'cat'].forEach(function (k) { t[k] = open_(folder, k); });
      return t;
    });
    const work = attendance_(rows_(texts.att, 'att'), rows_(texts.leave, 'leave'), today);
    const out = {
      today: today, at: new Date().toISOString(), account: account_(), notion: true, v: VERSION,
      // 안 끝난 일 전부 + 최근 60일에 끝낸 일 + 포트폴리오 표시. 나머지 끝낸 일은 history가 준다.
      // 끝낸 날(완료일)로 센다. 없으면 날짜로, 둘 다 없으면(손으로 체크한 날짜 없는 일) 보여 준다
      tasks: rows_(texts.tasks, 'tasks').filter(function (t) {
        const when = t.fin || t.d;
        return t.s !== DONE || t.star || !when || when >= since;
      }),
      memos: rows_(texts.memo, 'memo').filter(function (m) { return m.st !== '옮김'; }),
      events: [], calError: null, mail: null, mailError: null,
      // 화면이 목록으로 기대하는 칸들. 이 서버는 다루지 않아 비워 둔다
      habits: rows_(texts.habit, 'habit'),
      att: work.att, months: work.months, leave: work.leave,
      jobs: rows_(texts.job, 'job'), docs: rows_(texts.doc, 'doc'), cats: rows_(texts.cat, 'cat'),
      news: [], logs: [], sorries: [], scans: [],
    };
    // 캘린더나 메일을 못 읽어도 할 일은 보여야 한다
    try { out.mail = mailList_(); } catch (err) { out.mailError = String(err && err.message || err); }
    try { out.events = calendarEvents_(addDays_(today, -45), addDays_(today, 90)); } catch (err) { out.calError = String(err && err.message || err); }
    return out;
  },

  /**
   * 급여 기록. load에는 넣지 않는다: 화면이 load 결과를 기기에 저장해 두기 때문이다.
   * 화면에서 「보기」를 누를 때만 이 동작으로 받아 가고, 받은 것은 기기에 저장하지 않는다.
   */
  pays: function (a, folder) {
    const text = withLock_(function () { return open_(folder, 'pay'); });
    return rows_(text, 'pay').sort(function (x, y) { return String(x.m) < String(y.m) ? 1 : String(x.m) > String(y.m) ? -1 : 0; });
  },

  history: function (a, folder) {
    const text = withLock_(function () { return open_(folder, 'tasks'); });
    // PC가 깃 기록에서 만든 작업 내역 파일이 있으면 커밋도 끝낸 일로 얹는다. 그 파일은 읽기만 한다
    const commits = parseCommits(readText_(folder, GIT_FILE) || '');
    return rows_(text, 'tasks').filter(function (t) { return t.s === DONE; })
      .map(function (o) { return { id: o.id, t: o.t, d: o.d, p: o.p, y: o.y, k: o.k, r: o.r, out: o.out, star: o.star, s: o.s }; })
      .concat(commits)
      .sort(function (x, y) { return (x.d || '') < (y.d || '') ? -1 : (x.d || '') > (y.d || '') ? 1 : 0; });
  },

  add: function (a, folder) {
    checkKind_(a.kind);
    const fields = stampDone_(a.kind, Object.assign({}, a.fields));
    if (a.kind === 'memo') fields.at = new Date().toISOString();
    if (a.kind === 'att') checkAtt_(fields);
    if (a.kind === 'pay') checkPay_(fields);
    return withLock_(function () {
      // 카테고리는 이름이 곧 정체다. 이미 있으면 새로 적지 않고 있는 것을 돌려준다(저장이 겹쳐 두 번 청해도 하나만 남게)
      if (a.kind === 'cat') {
        const had = rows_(open_(folder, 'cat'), 'cat').filter(function (c) { return c.n === cleanTitle(fields.n); })[0];
        if (had) return had;
      }
      const id = makeId_();
      const text = addRecord(open_(folder, a.kind), a.kind, fields, id);
      writeText_(folder, KINDS[a.kind].file, text);
      return one_(text, a.kind, id);
    });
  },

  update: function (a, folder) {
    checkKind_(a.kind);
    return withLock_(function () {
      const text = updateRecord(open_(folder, a.kind), a.kind, a.id, stampDone_(a.kind, Object.assign({}, a.fields)));
      writeText_(folder, KINDS[a.kind].file, text);
      return one_(text, a.kind, a.id);
    });
  },

  /**
   * 카테고리 지우기. 한 번의 잠금 안에서 그 이름의 카테고리 줄을 모두 휴지통으로 옮기고, 그 이름을 쓰던 업무는 카테고리만 비운다.
   * 업무를 하나씩 따로 고치면 수십 번 요청하는 동안 화면이 다시 읽혀 이름이 되살아난다.
   */
  catDelete: function (a, folder) {
    const n = cleanTitle(a.n);
    if (!n) throw new Error('카테고리 이름이 비어 있습니다');
    return withLock_(function () {
      let cats = open_(folder, 'cat'), tasks = open_(folder, 'tasks'), bin = readText_(folder, TRASH) || '', nc = 0, nt = 0;
      if (bin && !/\n$/.test(bin)) bin += '\n';
      rows_(cats, 'cat').filter(function (c) { return c.n === n; }).forEach(function (c) {
        const k = takeRecord(cats, c.id);
        cats = k.text; nc++;
        bin += '%% ' + ymd_(new Date()) + ' ' + KINDS.cat.file + '에서 지움 %%\n' + k.block;
      });
      rows_(tasks, 'tasks').filter(function (t) { return t.p === n; }).forEach(function (t) { tasks = updateRecord(tasks, 'tasks', t.id, { p: null }); nt++; });
      // 휴지통을 먼저 쓴다. 중간에 끊겨도 건이 두 곳에 보일 뿐 사라지지 않는다
      if (nc) { writeText_(folder, TRASH, bin); writeText_(folder, KINDS.cat.file, cats); }
      if (nt) writeText_(folder, KINDS.tasks.file, tasks);
      return { cats: nc, tasks: nt };
    });
  },

  /** 노트에서 빼서 휴지통 노트 끝에 붙인다. 파일도 줄도 없애지 않으므로 손으로 되살릴 수 있다. */
  trash: function (a, folder) {
    checkKind_(a.kind);
    return withLock_(function () {
      const k = takeRecord(open_(folder, a.kind), a.id);
      let bin = readText_(folder, TRASH) || '';
      if (bin && !/\n$/.test(bin)) bin += '\n';
      // 휴지통을 먼저 쓴다. 중간에 끊겨도 건이 두 곳에 보일 뿐 사라지지 않는다
      writeText_(folder, TRASH, bin + '%% ' + ymd_(new Date()) + ' ' + KINDS[a.kind].file + '에서 지움 %%\n' + k.block);
      writeText_(folder, KINDS[a.kind].file, k.text);
      return { id: a.id };
    });
  },

  /**
   * 옵시디언 작업 로그(log.md)를 읽어 최근 기록과 정리 안 된 문장을 준다. 읽기만 하고 고치지 않는다.
   * desk 폴더 밖의 파일이라 스크립트 속성 LOG_FILE에 그 파일 하나의 ID를 따로 적어야 한다.
   * 작업 내용이 들어 있으므로 load에는 넣지 않는다. 화면이 열 때만 받아 가고 기기에 저장하지 않는다.
   */
  /** 작업 화면의 목록. PC의 tools/sync-vault.js가 볼트를 훑어 만든 파일을 그대로 준다. */
  works: function (a, folder) {
    const idx = workIndex_(folder);
    return { at: idx.at, notes: idx.notes.map(function (n) { const o = Object.assign({}, n); delete o.m; delete o.z; return o; }),   // m, z는 PC 프로그램만 쓰는 값
      imgs: idx.imgs || [], imgM: idx.imgM || {} };   // 그림 탭: 노트에 넣지 않은 그림까지. imgM은 그림을 고친 시각(화면 캐시가 낡았는지 가린다)
  },

  /** 노트 하나의 글. 목록에 적힌 경로만 읽는다(드라이브의 다른 파일을 읽는 길이 되지 않게). */
  workNote: function (a, folder) {
    const path = String(a.path || '');
    if (!workIndex_(folder).notes.some(function (n) { return n.path === path; })) throw new Error('작업 목록에 없는 노트입니다');
    const text = under_(vault_(folder), path).getBlob().getDataAsString('UTF-8');
    return { text: text.length > 200000 ? text.slice(0, 200000) + '\n\n…(너무 길어 여기까지만 보여 줍니다)' : text };
  },

  /** 그림 하나. 작업 목록에 적힌 그림(노트가 쓰는 것, 또는 PC가 훑은 그림 목록)일 때만 읽는다. */
  workImg: function (a, folder) {
    return workImg_(workIndex_(folder), folder, String(a.path || ''));
  },

  /** 그림 여러 장을 한 번에(요청 한 번에 드는 시간이 길어서 묶는다). 한 장이 실패해도 나머지는 준다. */
  workImgs: function (a, folder) {
    const idx = workIndex_(folder), out = {};
    let total = 0;
    (Array.isArray(a.paths) ? a.paths : []).slice(0, 8).forEach(function (p) {
      p = String(p);
      try {
        if (total > 20 * 1024 * 1024) throw new Error('한 번에 받을 양을 넘었습니다');
        out[p] = workImg_(idx, folder, p); total += out[p].b64.length;
      } catch (e) { out[p] = { err: e.message }; }
    });
    return { imgs: out };
  },

  /**
   * 지원 서류 한 개(그림까지 한 파일에 든 HTML). 연락처와 재직 중인 회사 내용이 있어 load에는 넣지 않는다.
   * 화면에서 열 때만 받아 가고 기기에 저장하지 않는다. 정해 둔 이름만 읽는다(다른 파일을 읽는 길이 되지 않게).
   */
  doc: function (a, folder) {
    const name = String(a.name || '');
    if (!Object.prototype.hasOwnProperty.call(DOC_FILES, name)) throw new Error('모르는 문서입니다: ' + name);
    const html = readText_(folder, DOC_FILES[name]);
    if (!html) throw new Error(name + ' 파일이 없습니다. PC에서 portfolio 저장소의 build.js를 돌려 주세요');
    return { html: html };
  },

  worklog: function () {
    const id = PropertiesService.getScriptProperties().getProperty('LOG_FILE');
    if (!id) throw new Error('서버에 LOG_FILE(작업 로그 파일 위치)이 설정되지 않았습니다');
    const text = locate_(id, true).getBlob().getDataAsString('UTF-8');
    return { entries: parseLog(text, 80), at: new Date().toISOString() };
  },

  /** 메일 대화에 읽음, 안 읽음, 보관, 별표 처리를 한다. 지우기는 없다. */
  mailAct: function (a) {
    const th = thread_(a.id);
    if (a.op === 'read') th.markRead();
    else if (a.op === 'unread') th.markUnread();
    else if (a.op === 'archive') th.moveToArchive();
    else if (a.op === 'star') th.getMessages().slice(-1)[0].star();
    else if (a.op === 'unstar') th.getMessages().forEach(function (m) { m.unstar(); });
    else throw new Error('알 수 없는 메일 동작');
    return { id: a.id, op: a.op };
  },

  /** 대화의 마지막 세 통을 글자로 준다. */
  mailBody: function (a) {
    return thread_(a.id).getMessages().slice(-3).map(function (m) {
      return { from: m.getFrom(), to: m.getTo(), cc: m.getCc(), date: m.getDate().toISOString(), subject: m.getSubject(),
        body: m.getPlainBody().replace(/\n{3,}/g, '\n\n').slice(0, 6000) };
    });
  },

  /** 최근 30일 메일에서 채용 공고를 찾는다. 받은편지함 밖(보관, 라벨)도 본다. q는 화면에서 바꾼 검색 조건이다. */
  jobMail: function (a) {
    const q = String(a.q || '').replace(/\s+/g, ' ').trim().slice(0, 200) || JOB_MAIL_QUERY;
    return GmailApp.search('newer_than:30d ' + q, 0, 40).map(mailRow_);
  },

  /**
   * 게임잡에서 고른 직무(기본은 게임 클라이언트)의 목록 한 장을 읽어 공고 요약 목록으로 돌려준다. 저장하지 않는다.
   * 목록에는 회사, 제목, 직무, 근무지, 마감 표시만 있다. 경력·키워드·고용형태 같은 조건은 공고 페이지의 요약 칸에 있어서
   * 공고마다 한 장씩 읽되, 다섯 장씩 끊어 받고 한 번 읽은 것은 6시간 기억한다(사이트에 한꺼번에 몰아 청하지 않는다). 본문과 그림은 읽지 않는다.
   */
  jobList: function (a) {
    const duty = JOB_DUTIES.indexOf(Number(a.duty)) >= 0 ? Number(a.duty) : 1;
    const rows = parseJobList(webText_(JOB_LIST_URL + duty));
    if (!rows.length) throw new Error('게임잡 목록을 읽지 못했습니다');
    const cache = CacheService.getScriptCache(), need = [];
    rows.forEach(function (r) {
      const c = cache.get('gj:' + r.no);
      if (c) r.info = JSON.parse(c); else need.push(r);
      r.link = JOB_VIEW_URL + r.no;
    });
    for (let i = 0; i < need.length; i += 5) {
      const part = need.slice(i, i + 5);
      if (i) Utilities.sleep(300);
      UrlFetchApp.fetchAll(part.map(function (r) { return { url: r.link, muteHttpExceptions: true }; })).forEach(function (resp, k) {
        const info = resp.getResponseCode() === 200 ? parseJobPage(resp.getContentText('UTF-8'), '').info : {};
        part[k].info = info;
        if (Object.keys(info).length) cache.put('gj:' + part[k].no, JSON.stringify(info), 21600);
      });
    }
    return { at: new Date().toISOString(), rows: rows };
  },

  /**
   * 사용자가 붙여 넣은 게임잡 공고 주소 한 장을 읽어 지원처 칸으로 돌려준다. 저장은 하지 않는다(화면이 받아서 추가한다).
   * 공고 번호만 뽑아 주소를 서버가 다시 만든다. 사용자가 준 주소를 그대로 읽지 않으므로 다른 곳을 읽어 주는 길이 되지 않는다.
   * 사이트를 훑지 않는다. 누를 때 그 한 장(공고 페이지, 본문 틀, 본문에 넣은 그림)만 읽는다.
   */
  jobFetch: function (a) {
    const m = JOB_URL_RE.exec(String(a.url || '').trim());
    if (!m) throw new Error('게임잡 공고 주소만 가져올 수 있습니다(…gamejob.co.kr/Recruit/GI_Read/View?GI_No=번호)');
    const link = JOB_VIEW_URL + m[1];
    const body = webText_('https://www.gamejob.co.kr/Recruit/GI_Read_Comt_Ifrm?gno=' + m[1]);
    const job = parseJobPage(webText_(link), body);
    if (!job.n && !job.role) throw new Error('공고를 읽지 못했습니다. 마감됐거나 주소가 바뀌었을 수 있습니다');
    // 공고를 그림으로 올린 회사가 많고 그쪽이 더 정확하다. 그림에서 읽은 글을 앞에 둔다
    const read = [], errors = [];
    jobImages(body).forEach(function (u) {
      try { const t = ocr_(u); if (t) read.push(t); } catch (err) { errors.push(err.message); }
    });
    const post = read.length && job.post ? read.join('\n') + '\n\n── 글로 적힌 부분 ──\n' + job.post : read.join('\n') || job.post;
    return { fields: { n: job.n, role: job.role, d: job.d, link: link, memo: job.memo, post: post.slice(0, JOB_POST_MAX), st: '관심' },
      read: { text: job.post.length, images: read.length, failed: errors.length, error: errors[0] || null } };
  },

  /** 그 해의 총 연차와 특별휴가 일수를 정한다. 그 해 줄이 있으면 고치고 없으면 만든다. */
  leaveSet: function (a, folder) {
    const y = String(a.y);
    if (!/^\d{4}$/.test(y)) throw new Error('연도 형식이 잘못되었습니다');
    const fields = { total: dayCount_(a.total, '총 연차'), special: dayCount_(a.special == null ? 0 : a.special, '특별휴가') };
    return withLock_(function () {
      const was = open_(folder, 'leave');
      const cur = rows_(was, 'leave').filter(function (r) { return String(r.y) === y; })[0];
      const text = cur ? updateRecord(was, 'leave', cur.id, fields) : addRecord(was, 'leave', Object.assign({ y: y }, fields), makeId_());
      writeText_(folder, KINDS.leave.file, text);
      return { y: y, total: fields.total, special: fields.special };
    });
  },

  /** 습관의 그 날짜 체크를 켜거나 끈다. 체크한 날짜는 쉼표로 이어 한 줄에 적고, 400일 넘은 것은 버린다. */
  habitToggle: function (a, folder) {
    if (!DATE_RE.test(String(a.date))) throw new Error('날짜 형식이 잘못되었습니다');
    return withLock_(function () {
      const was = open_(folder, 'habit');
      const cur = one_(was, 'habit', a.id);
      if (!cur) throw new Error('항목을 찾을 수 없습니다');
      const days = String(cur.dates || '').split(',').map(function (s) { return s.trim(); }).filter(function (s) { return DATE_RE.test(s); });
      const at = days.indexOf(a.date);
      if (at >= 0) days.splice(at, 1); else days.push(a.date);
      const oldest = addDays_(ymd_(new Date()), -400);
      const keep = days.filter(function (d) { return d >= oldest; }).sort();
      const text = updateRecord(was, 'habit', a.id, { dates: keep.join(',') });
      writeText_(folder, KINDS.habit.file, text);
      return one_(text, 'habit', a.id);
    });
  },

  memoToTask: function (a, folder) {
    if (!cleanTitle(a.text)) throw new Error('제목이 비었습니다');
    // 메모부터 옮김으로 바꾼다. 없는 메모면 여기서 끝나 할 일이 생기지 않는다(다시 눌러도 겹치지 않는다)
    ACTIONS.update({ kind: 'memo', id: a.id, fields: { st: '옮김' } }, folder);
    return ACTIONS.add({ kind: 'tasks', fields: { t: a.text, d: a.date || null, s: TODO } }, folder);
  },

  eventAdd: function (a) {
    const title = cleanTitle(a.title).slice(0, 500);
    if (!title) throw new Error('일정 제목이 비었습니다');
    if (!DATE_RE.test(String(a.date))) throw new Error('날짜 형식이 잘못되었습니다');
    [a.start, a.end].forEach(function (t) { if (t && !TIME_RE.test(String(t))) throw new Error('시각 형식이 잘못되었습니다'); });
    const cal = CalendarApp.getDefaultCalendar();
    if (!a.start) cal.createAllDayEvent(title, new Date(a.date + 'T00:00:00+09:00'));
    else {
      const start = new Date(a.date + 'T' + a.start + ':00+09:00');
      let end = new Date(a.date + 'T' + (a.end || a.start) + ':00+09:00');
      // 밤 11시대에 넣으면 화면이 끝 시각을 00시대로 보낸다. 끝이 시작보다 앞서면 다음 날이다
      if (end < start) end = new Date(end.getTime() + DAY_MS);
      cal.createEvent(title, start, end);
    }
    return { ok: true };
  },
};

/* ───────── 지메일 ───────── */
const JOB_MAIL_QUERY = 'subject:(채용 OR 공고 OR 면접 OR 서류전형 OR 입사지원)';

/** 화면에 주는 메일 대화 한 줄. 본문은 앞 140글자만 넣는다. */
function mailRow_(th) {
  const m = th.getMessages().slice(-1)[0];
  return { id: th.getId(), subj: th.getFirstMessageSubject() || '(제목 없음)',
    from: m.getFrom().replace(/<.*>/, '').replace(/"/g, '').trim() || m.getFrom(),
    at: th.getLastMessageDate().toISOString(), snip: m.getPlainBody().replace(/\s+/g, ' ').slice(0, 140),
    unread: th.isUnread(), star: th.hasStarredMessages(), imp: th.isImportant(), n: th.getMessageCount() };
}

function mailList_() { return GmailApp.search('in:inbox', 0, 30).map(mailRow_); }

function thread_(id) {
  const th = GmailApp.getThreadById(String(id));
  if (!th) throw new Error('메일을 찾지 못했습니다');
  return th;
}

/* ───────── 근태 ───────── */
const ATT_TYPES = ['야근', '연차', '반차', '특별휴가', '대체휴가'];

function dayCount_(v, what) {
  const n = Number(v);
  if (v === '' || v === null || !isFinite(n) || n < 0 || n > 366) throw new Error(what + ' 일수가 잘못되었습니다');
  return n;
}

/** 근태 기록 한 건을 검사하고 다듬는다. 야근은 시간이, 휴가는 일수가 있어야 한다. */
function checkAtt_(f) {
  if (ATT_TYPES.indexOf(f.type) < 0) throw new Error('알 수 없는 근태 유형입니다: ' + f.type);
  if (!DATE_RE.test(String(f.d))) throw new Error('날짜 형식이 잘못되었습니다');
  if (f.type === '야근') {
    const h = Number(f.h);
    if (f.h == null || f.h === '' || !isFinite(h) || h <= 0 || h > 24) throw new Error('야근 시간은 0보다 크고 24 이하여야 합니다');
    f.h = h; f.days = null;
    f.taxi = f.taxi == null || f.taxi === '' ? null : money_(f.taxi, '택시비');
  } else {
    f.days = dayCount_(f.days, '휴가');
    if (f.days <= 0) throw new Error('휴가 일수가 잘못되었습니다');
    f.h = null; f.taxi = null;      // 휴가에는 택시비가 없다
  }
  f.paid = null;                    // 받음 표시는 나중에 고쳐서 붙인다
  if (!f.t) f.t = f.type;
}

function money_(v, what) {
  const n = Number(v);
  if (v === '' || v === null || !isFinite(n) || n < 0 || n > 1e9) throw new Error(what + ' 금액이 잘못되었습니다');
  return Math.round(n);
}

/** 급여 한 줄을 검사한다. 월은 2026.11 모양이다. */
function checkPay_(f) {
  if (!/^\d{4}\.(0[1-9]|1[0-2])$/.test(String(f.m))) throw new Error('월은 2026.11처럼 적어 주세요');
  if (f.d != null && f.d !== '' && !DATE_RE.test(String(f.d))) throw new Error('날짜 형식이 잘못되었습니다');
  ['g', 'ded', 'net'].forEach(function (k) { if (f[k] != null && f[k] !== '') f[k] = money_(f[k], '급여'); });
}

/**
 * 근태 기록에서 월별 합계와 연도별 남은 연차를 센다. 포괄임금 기준이라 수당은 계산하지 않는다.
 * 남은 연차 = 총 연차 + 특별휴가 − (연차, 반차, 특별휴가로 쓴 일수). 대체휴가는 연차에서 빼지 않는다.
 */
function attendance_(att, leaveRows, today) {
  const round = function (n) { return Math.round(n * 100) / 100; };
  const byMonth = {}, usedByYear = {};
  att.forEach(function (r) {
    const d = String(r.d || '');
    if (!DATE_RE.test(d)) return;
    const ym = d.slice(0, 7);
    const m = byMonth[ym] || (byMonth[ym] = { id: ym, m: ym.replace('-', '.'), nights: {}, hours: 0, used: 0, taxi: 0, unpaid: 0 });
    if (r.type === '야근') {
      m.nights[d] = true; m.hours += Number(r.h) || 0;
      // 택시비는 내가 먼저 내고 회사에 청구한다. 받음 표시가 없는 것이 아직 못 받은 돈이다
      const taxi = Number(r.taxi) || 0;
      m.taxi += taxi;
      if (r.paid !== true) m.unpaid += taxi;
    }
    else {
      m.used += Number(r.days) || 0;
      if (r.type !== '대체휴가') usedByYear[d.slice(0, 4)] = (usedByYear[d.slice(0, 4)] || 0) + (Number(r.days) || 0);
    }
  });
  const months = Object.keys(byMonth).sort().reverse().map(function (k) {
    const m = byMonth[k];
    return { id: m.id, m: m.m, days: Object.keys(m.nights).length, hours: round(m.hours), used: round(m.used), taxi: m.taxi, unpaid: m.unpaid };
  });
  const leave = leaveRows.map(function (l) {
    const used = round(usedByYear[String(l.y)] || 0);
    return { id: l.id, y: String(l.y), total: l.total || 0, special: l.special || 0, used: used, left: round((l.total || 0) + (l.special || 0) - used) };
  });
  const oldest = addDays_(today, -400);
  const recent = att.filter(function (r) { return String(r.d || '') >= oldest; })
    .sort(function (x, y) { return String(x.d) < String(y.d) ? 1 : String(x.d) > String(y.d) ? -1 : 0; });
  return { att: recent, months: months, leave: leave };
}

/** 할 일의 상태를 바꿀 때 끝낸 날을 같이 적는다(완료면 오늘, 아니면 지운다). 읽기 범위를 이 날짜로 센다. */
function stampDone_(kind, fields) {
  if (kind === 'tasks' && Object.prototype.hasOwnProperty.call(fields, 's')) fields.fin = fields.s === DONE ? ymd_(new Date()) : null;
  return fields;
}

/* ───────── 편집기에서 직접 실행 ───────── */

/** 연결 확인: 폴더 이름과 일정 개수를 찍는다. 처음 실행하면 드라이브, 캘린더 권한을 묻는다. */
function testConnection() {
  const today = ymd_(new Date());
  Logger.log('desk 폴더: ' + todoFolder_().getName() + ' (번호 ' + todoFolder_().getId() + ')');
  Logger.log('앞으로 7일 일정: ' + calendarEvents_(today, addDays_(today, 7)).length + '개');
}

/**
 * 동작 점검. TODO_FOLDER 안의 _점검/<실행 시각> 폴더에서만 돌고 실제 노트는 건드리지 않는다.
 * 하나라도 어긋나면 Error를 낸다. 동작별 걸린 시간도 찍는다.
 */
function selfCheck() {
  const root = todoFolder_();
  const subs = root.getFoldersByName('_점검');
  const base = subs.hasNext() ? subs.next() : root.createFolder('_점검');
  // 폴더 이름에 ':'를 쓰지 않는다. 윈도우(RaiDrive)에서 못 쓰는 글자다
  const folder = base.createFolder(Utilities.formatDate(new Date(), TZ, 'yyyyMMdd-HHmmss'));
  const must = function (ok, what) { if (!ok) throw new Error('점검 실패: ' + what); };
  const timed = function (name, args) {
    const t0 = Date.now();
    const r = ACTIONS[name](args, folder);
    Logger.log(name + ': ' + (Date.now() - t0) + 'ms');
    return r;
  };
  const today = ymd_(new Date());

  const made = timed('add', { kind: 'tasks', fields: { t: '점검용 할 일', d: today, p: '점검' } });
  must(made.id && made.t === '점검용 할 일' && made.s === TODO, '추가한 건이 번호와 함께 돌아온다');
  must(timed('update', { kind: 'tasks', id: made.id, fields: { s: DONE } }).s === DONE, '완료로 바뀐다');
  must(timed('load', {}).tasks.filter(function (t) { return t.id === made.id && t.s === DONE && t.p === '점검'; }).length === 1, '읽으면 그 건이 완료로 보이고 안 고친 항목은 그대로다');
  must(timed('history', {}).length === 1, '완료 기록에 한 건 있다');
  timed('trash', { kind: 'tasks', id: made.id });
  must(timed('load', {}).tasks.length === 0 && readText_(folder, TRASH).indexOf(made.id) > 0, '지우면 휴지통 노트로 옮겨진다');

  let missing = '';
  try { ACTIONS.update({ kind: 'tasks', id: 'nope00', fields: { s: DONE } }, folder); } catch (err) { missing = String(err.message); }
  must(missing === '항목을 찾을 수 없습니다', '없는 번호는 거절한다');

  Logger.log('점검 통과 (서버 ' + VERSION + ')');
}
