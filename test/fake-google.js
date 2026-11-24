// 구글 서비스(드라이브, 캘린더 등)를 흉내 내어 Note.gs와 Code.gs를 PC에서 그대로 돌린다.
// server.test.js(메모리 폴더)와 dev-server.js(실제 폴더)가 함께 쓴다.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const iter = a => { let i = 0; return { hasNext: () => i < a.length, next: () => a[i++] }; };

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
      const f = { getName: () => n, isTrashed: () => false, getLastUpdated: () => new Date(0), getBlob: () => ({ getDataAsString: () => text }), setContent: v => { text = v; } };
      files.push(f);
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
    getName: () => n, isTrashed: () => false, getLastUpdated: () => fs.statSync(path.join(dir, n)).mtime,
    getBlob: () => ({ getDataAsString: () => fs.readFileSync(path.join(dir, n), 'utf8') }),
    setContent: v => fs.writeFileSync(path.join(dir, n), v),
  });
  const names = dirs => fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory() === dirs).map(d => d.name);
  return {
    getName: () => path.basename(dir),
    getFiles: () => iter(names(false).map(file)),
    getFilesByName: n => iter(names(false).filter(x => x === n).map(file)),
    createFile: (n, t) => { fs.writeFileSync(path.join(dir, n), t); return file(n); },
    getFoldersByName: n => iter(names(true).filter(x => x === n).map(x => diskFolder(path.join(dir, x)))),
    createFolder: n => diskFolder(path.join(dir, n.replace(/[:]/g, '-'))),
  };
}

/** 가짜 서비스를 끼운 실행 환경에 Note.gs와 Code.gs를 올린다. */
function makeContext(root, props) {
  let slept = 0, broken = false;
  const created = [];
  const ev = (id, title, allDay, s, e) => ({
    getId: () => id, getTitle: () => title, isAllDayEvent: () => allDay, getLocation: () => '',
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
  const ctx = vm.createContext({
    console,
    DriveApp: { getFolderById: () => root },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: { sleep: ms => { slept += ms; }, formatDate: d => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10) },
    CalendarApp: { getAllCalendars: () => { if (broken) throw new Error('캘린더 권한이 없습니다'); return [cal]; }, getDefaultCalendar: () => cal },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'me@example.com' }) },
    ContentService: { createTextOutput: s => ({ text: s, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
    Logger: { log() {} },
  });
  const src = f => fs.readFileSync(path.join(__dirname, '..', 'apps-script', f), 'utf8');
  vm.runInContext(src('Note.gs') + '\n' + src('Code.gs') + '\nthis.doPost = doPost; this.selfCheck = selfCheck;', ctx);
  return { ctx, slept: () => slept, created: () => created, breakCalendar: b => { broken = b; } };
}

module.exports = { fakeFolder, diskFolder, makeContext };
