/**
 * desk 중간 서버 (Google Apps Script 웹 앱)
 *
 * 화면(index.html)은 이 주소로만 데이터를 주고받는다.
 * 화면이 쓰는 요청과 응답의 모양은 '햄찌스 데스크'와 같고, 원본만 노션 대신
 * 구글 드라이브 안 옵시디언 볼트의 todo/ 폴더 노트다.
 *
 * 설정(처음 1번) — 자세한 순서는 README.md
 *   스크립트 속성  PASS        = 비밀번호(16글자 이상)
 *                  TODO_FOLDER = 볼트 todo 폴더의 드라이브 ID
 *   배포 → 웹 앱 / 실행: 나 / 액세스: 모든 사용자
 */

const TZ = 'Asia/Seoul';
const VERSION = '2026-11-24c';
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
  if (real.length < 16) return '서버의 PASS(비밀번호)를 16글자 이상으로 정해 주세요';
  if (String(pass == null ? '' : pass) !== real) { Utilities.sleep(2000); return '비밀번호가 맞지 않습니다'; }
  return null;
}

function todoFolder_() {
  const id = PropertiesService.getScriptProperties().getProperty('TODO_FOLDER');
  if (!id) throw new Error('서버에 TODO_FOLDER(todo 폴더 ID)가 설정되지 않았습니다');
  return DriveApp.getFolderById(id);
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

function checkKind_(kind) {
  if (!Object.prototype.hasOwnProperty.call(KINDS, kind)) throw new Error('다룰 수 없는 종류입니다: ' + kind);
}

/* ───────── 구글 캘린더 ───────── */
function calendarEvents_(from, to) {
  const start = new Date(from + 'T00:00:00+09:00'), end = new Date(to + 'T23:59:59+09:00');
  const out = [];
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
    const texts = withLock_(function () { return { tasks: open_(folder, 'tasks'), memo: open_(folder, 'memo') }; });
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
      habits: [], jobs: [], att: [], months: [], leave: [], news: [], logs: [], sorries: [], scans: [],
    };
    // 캘린더를 못 읽어도 할 일은 보여야 한다
    try { out.events = calendarEvents_(addDays_(today, -45), addDays_(today, 90)); } catch (err) { out.calError = String(err && err.message || err); }
    return out;
  },

  history: function (a, folder) {
    const text = withLock_(function () { return open_(folder, 'tasks'); });
    return rows_(text, 'tasks').filter(function (t) { return t.s === DONE; })
      .sort(function (x, y) { return (x.d || '') < (y.d || '') ? -1 : (x.d || '') > (y.d || '') ? 1 : 0; })
      .map(function (o) { return { id: o.id, t: o.t, d: o.d, p: o.p, y: o.y, k: o.k, r: o.r, out: o.out, star: o.star, s: o.s }; });
  },

  add: function (a, folder) {
    checkKind_(a.kind);
    const fields = stampDone_(a.kind, Object.assign({}, a.fields));
    if (a.kind === 'memo') fields.at = new Date().toISOString();
    return withLock_(function () {
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

/** 할 일의 상태를 바꿀 때 끝낸 날을 같이 적는다(완료면 오늘, 아니면 지운다). 읽기 범위를 이 날짜로 센다. */
function stampDone_(kind, fields) {
  if (kind === 'tasks' && Object.prototype.hasOwnProperty.call(fields, 's')) fields.fin = fields.s === DONE ? ymd_(new Date()) : null;
  return fields;
}

/* ───────── 편집기에서 직접 실행 ───────── */

/** 연결 확인: 폴더 이름과 일정 개수를 찍는다. 처음 실행하면 드라이브, 캘린더 권한을 묻는다. */
function testConnection() {
  const today = ymd_(new Date());
  Logger.log('todo 폴더: ' + todoFolder_().getName());
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
