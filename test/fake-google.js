// 구글 서비스(드라이브, 캘린더 등)를 흉내 내어 Note.gs와 Code.gs를 PC에서 그대로 돌린다.
// server.test.js(메모리 폴더)와 dev-server.js(실제 폴더)가 함께 쓴다.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const iter = a => { let i = 0; return { hasNext: () => i < a.length, next: () => a[i++] }; };
const byId = {};   // 가짜 드라이브의 파일 번호 → 파일. 서버가 찾은 번호를 기억했다가 다시 열 때 쓴다

/** 메모리 안의 가짜 드라이브 폴더. */
function fakeFolder(name) {
  const files = [], subs = [];
  return {
    _files: files, _subs: subs,
    getName: () => name,
    getFiles: () => iter(files.slice()),
    getFilesByName: n => iter(files.filter(f => f.getName() === n)),
    createFile: (n, t) => {
      let text = t;
      // getLastUpdated는 기본으로 오래전이다. 점검에서 "방금 고친 파일"을 흉내 낼 때만 바꿔 끼운다
      const id = 'mem-' + Object.keys(byId).length;
      const f = { getName: () => n, getId: () => id, isTrashed: () => false, getLastUpdated: () => new Date(0), getBlob: () => ({ getDataAsString: () => text, getBytes: () => Buffer.from(text) }), setContent: v => { text = v; } };
      files.push(f);
      byId[id] = f;
      return f;
    },
    getFoldersByName: n => iter(subs.filter(s => s.getName() === n)),
    createFolder: n => { const s = fakeFolder(n); subs.push(s); return s; },
  };
}

/** 실제 디스크 폴더를 드라이브 폴더처럼 보이게 한다(dev-server용). */
function diskFolder(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = n => ({
    getName: () => n, getId: () => { const id = 'disk-' + path.join(dir, n); byId[id] = file(n); return id; }, isTrashed: () => false, getLastUpdated: () => fs.statSync(path.join(dir, n)).mtime,
    getBlob: () => ({ getDataAsString: () => fs.readFileSync(path.join(dir, n), 'utf8'), getBytes: () => fs.readFileSync(path.join(dir, n)) }),
    setContent: v => fs.writeFileSync(path.join(dir, n), v),
  });
  const names = dirs => fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory() === dirs).map(d => d.name);
  return {
    getName: () => path.basename(dir),
    getParents: () => iter([diskFolder(path.dirname(dir))]),
    getFiles: () => iter(names(false).map(file)),
    getFilesByName: n => iter(names(false).filter(x => x === n).map(file)),
    createFile: (n, t) => { fs.writeFileSync(path.join(dir, n), t); return file(n); },
    getFoldersByName: n => iter(names(true).filter(x => x === n).map(x => diskFolder(path.join(dir, x)))),
    createFolder: n => diskFolder(path.join(dir, n.replace(/[:]/g, '-'))),
  };
}

/** 가짜 서비스를 끼운 실행 환경에 Note.gs와 Code.gs를 올린다. */
function makeContext(root, props, files) {
  let slept = 0, broken = false, owned = true;
  const created = [];
  const ev = (id, title, allDay, s, e) => ({
    getId: () => id, getTitle: () => title, isAllDayEvent: () => allDay, getLocation: () => '', getCreators: () => [owned ? 'Me@Example.com' : 'other@example.com'],
    getStartTime: () => new Date(s), getEndTime: () => new Date(e),
    getAllDayStartDate: () => new Date(s), getAllDayEndDate: () => new Date(e),
  });
  const cal = {
    getName: () => '내 캘린더', getColor: () => '#0a84ff', isHidden: () => false,
    getEvents: () => {
      if (broken) throw new Error('캘린더 권한이 없습니다');
      return [ev('e1', '회의', false, '2026-11-24T05:00:00Z', '2026-11-24T06:00:00Z'),
              ev('e2', '마감', true, '2026-11-24T15:00:00Z', '2026-11-25T15:00:00Z')];   // 서울 11/25 종일
    },
    createAllDayEvent: (t, d) => created.push(['allDay', t, d.toISOString()]),
    createEvent: (t, s, e) => created.push(['timed', t, s.toISOString(), e.toISOString()]),
  };
  // 가짜 내 드라이브: 맨 위 > ObsidianFolder > (점검의 todo 폴더, log.md)
  const lookups = [], cache = {};
  const top = fakeFolder('내 드라이브'), vault = top.createFolder('ObsidianFolder');
  root.getId = () => 'todo-id';
  if (!root.getParents) root.getParents = () => iter([vault]);   // 메모리 폴더는 가짜 볼트 아래에 둔다
  vault._subs.push(root);
  if (files) Object.keys(files).forEach(id => vault._files.push(Object.assign({ getName: () => 'log.md', getId: () => id, isTrashed: () => false }, files[id])));
  // 가짜 지메일: 대화 두 개
  let mailBroken = false;
  const searches = [];
  const mk = (id, subj, from, unread) => {
    const th = { _unread: unread, _star: false, _archived: false,
      getId: () => id, getFirstMessageSubject: () => subj, getLastMessageDate: () => new Date('2026-11-24T01:00:00Z'),
      isUnread: () => th._unread, hasStarredMessages: () => th._star, isImportant: () => false, getMessageCount: () => 1,
      markRead() { th._unread = false; }, markUnread() { th._unread = true; }, moveToArchive() { th._archived = true; } };
    const msg = { getFrom: () => from, getTo: () => 'me@example.com', getCc: () => '', getDate: () => new Date('2026-11-24T01:00:00Z'), getSubject: () => subj,
      getPlainBody: () => '본문   ' + subj + '\n\n\n\n끝', star() { th._star = true; }, unstar() { th._star = false; } };
    th.getMessages = () => [msg];
    return th;
  };
  const threads = [mk('t1', '채용 공고 안내', '"어느 회사" <hr@example.com>', true), mk('t2', '', 'f@example.com', false)];
  // 가짜 바깥 웹과 가짜 글자 읽기(OCR). web에 주소 → { text } 또는 { bytes, type }을 넣어 두면 그 주소가 답한다
  const web = {}, ocr = { text: '', made: [], types: [], removed: [], fail: false };
  const ctx = vm.createContext({
    UrlFetchApp: { fetch: url => { const r = web[url];
      return { getResponseCode: () => (r ? 200 : 404), getContentText: () => (r && r.text) || '',
        getBlob: () => { let type = (r && r.type) || 'text/html';
          return { getBytes: () => (r && r.bytes) || Buffer.from((r && r.text) || ''), getContentType: () => type, setContentType(t) { type = t; return this; } }; } }; } },
    Drive: { Files: { create: (meta, blob, opt) => { if (ocr.fail) throw new Error('Request Too Large'); ocr.types.push(blob.getContentType()); ocr.made.push([meta.mimeType, blob.getBytes().length, opt && opt.ocrLanguage]); return { id: 'ocr-doc-' + ocr.made.length }; },
      remove: id => { ocr.removed.push(id); } } },
    DocumentApp: { openById: () => ({ getBody: () => ({ getText: () => ocr.text }) }) },
    GmailApp: {
      search: (q, start, max) => { if (mailBroken) throw new Error('메일 권한이 없습니다'); searches.push(q); return threads.filter(t => !t._archived).slice(0, max); },
      getThreadById: id => threads.find(t => t.getId() === id) || null,
    },
    console,
    // 번호로 찾기와, 내 드라이브 맨 위(getRootFolder)에서 이름으로 찾아 들어가기 둘 다 흉내 낸다
    DriveApp: { getFolderById: id => { lookups.push('id:' + id); return root; }, getRootFolder: () => { lookups.push('root'); return top; },
      getFileById: id => { const f = (files && files[id]) || byId[id]; if (!f) throw new Error('파일을 찾을 수 없습니다'); return f; } },
    CacheService: { getScriptCache: () => ({ get: k => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = v; } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: { base64Encode: b => Buffer.from(b).toString('base64'), sleep: ms => { slept += ms; }, formatDate: d => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10) },
    CalendarApp: { getAllCalendars: () => { if (broken) throw new Error('캘린더 권한이 없습니다'); return [cal]; }, getDefaultCalendar: () => cal },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'me@example.com' }) },
    ContentService: { createTextOutput: s => ({ text: s, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
    Logger: { log() {} },
  });
  const src = f => fs.readFileSync(path.join(__dirname, '..', 'apps-script', f), 'utf8');
  vm.runInContext(src('Note.gs') + '\n' + src('Code.gs') + '\nthis.doPost = doPost; this.selfCheck = selfCheck;', ctx);
  return { ctx, slept: () => slept, created: () => created, breakCalendar: b => { broken = b; }, ownCalendar: b => { owned = b; }, breakMail: b => { mailBroken = b; }, searches: () => searches, lookups: () => lookups, top: top, vault: vault, web: web, ocr: ocr };
}

module.exports = { fakeFolder, diskFolder, makeContext };
