// Code.gs 점검. 구글 서비스를 가짜로 끼워 PC에서 서버 코드를 그대로 돌린다.
// 실행: node test/server.test.js
const assert = require('node:assert');
const { makeContext, fakeFolder } = require('./fake-google');

const PASS = 'correct-horse-battery-staple';
const root = fakeFolder('todo');
const PROPS = { PASS: PASS, TODO_FOLDER: 'folderid0123456789abcdef' };
const logFile = { getBlob: () => ({ getDataAsString: () => '## 2026-11-23 어떤 작업\n고쳤다. 사용자 확인 대기.\n\n## 2026-11-24 다른 작업\n끝냈다.\n' }), setContent() { throw new Error('작업 로그는 읽기만 한다'); } };
const g = makeContext(root, PROPS, { 'logfileid0123456789abcd': logFile });
const ctx = g.ctx;

const post = (action, args, pass) =>
  JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ pass: pass === undefined ? PASS : pass, action, args }) } }).text);
const today = ctx.Utilities.formatDate(new Date());
const daysAgo = n => new Date(Date.parse(today) - n * 86400000).toISOString().slice(0, 10);
const fileOf = name => root._files.find(f => f.getName() === name);
const text = name => fileOf(name).getBlob().getDataAsString();

// 비밀번호: 틀리면 2초 쉬고 거절, 아무 파일도 안 만든다
let r = post('load', {}, 'wrong');
assert.deepStrictEqual([r.ok, r.auth, g.slept(), root._files.length], [false, true, 2000, 0]);
assert.strictEqual(JSON.parse(ctx.doPost({ postData: { contents: 'not json' } }).text).ok, false);
assert.strictEqual(JSON.parse(ctx.doPost({ postData: { contents: 'null' } }).text).ok, false);
// 서버 비밀번호가 9글자보다 짧으면 맞게 넣어도 받지 않는다
PROPS.PASS = '01234567';
assert.match(post('load', {}, '01234567').error, /9글자 이상/);
PROPS.PASS = '012345678';
assert.strictEqual(post('ping', {}, '012345678').ok, true);
PROPS.PASS = PASS;

// 내 계정이 만든 일정만 mine이다(메일 대소문자는 가리지 않는다). 남이 내 캘린더에 적은 일정은 false로 온다
g.ownCalendar(false);
assert.deepStrictEqual(post('load', {}).data.events.map(e => e.mine), [false, false]);
g.ownCalendar(true);

// 모르는 동작, 객체에 원래 있는 이름
assert.match(post('nope', {}).error, /알 수 없는 동작/);
assert.match(post('constructor', {}).error, /알 수 없는 동작/);

// 연결 확인
assert.deepStrictEqual(Object.keys(post('ping', {}).data).sort(), ['account', 'notion', 'v']);

// 처음 읽기: 파일을 만들지 않고 빈 목록을 준다. 화면이 기대하는 칸이 다 있다
r = post('load', {});
assert.strictEqual(r.ok, true, r.error);
assert.strictEqual(root._files.length, 0);
assert.deepStrictEqual([r.data.today, r.data.notion, r.data.tasks, r.data.memos], [today, true, [], []]);
['habits', 'jobs', 'att', 'months', 'leave', 'news', 'logs', 'sorries', 'scans'].forEach(k => assert.deepStrictEqual(r.data[k], [], k));
assert.deepStrictEqual(r.data.events, [
  { id: 'e1', t: '회의', all: false, s: '2026-11-24T05:00:00.000Z', e: '2026-11-24T06:00:00.000Z', cal: '내 캘린더', color: '#0a84ff', loc: '', mine: true },
  { id: 'e2', t: '마감', all: true, s: '2026-11-25', e: '2026-11-25', cal: '내 캘린더', color: '#0a84ff', loc: '', mine: true },
]);

// 추가: 화면이 준 항목 그대로 돌려주고 번호를 붙인다
r = post('add', { kind: 'tasks', fields: { t: '  첫 일\n둘째 줄 ', d: today, s: '시작 전', p: '업무', r: '상' } });
assert.strictEqual(r.ok, true, r.error);
const id = r.data.id;
assert.match(id, /^[a-z0-9]{6}$/);
assert.deepStrictEqual([r.data.t, r.data.d, r.data.s, r.data.p, r.data.r, r.data.u], ['첫 일 둘째 줄', today, '시작 전', '업무', '상', null]);
assert.strictEqual(text('할 일.md'), '- [ ] 첫 일 둘째 줄 ^' + id + '\n    날짜:: ' + today + '\n    프로젝트:: 업무\n    우선순위:: 상\n');
// 거절되는 추가
assert.strictEqual(post('add', { kind: 'gong', fields: { t: 'a' } }).ok, false);
assert.strictEqual(post('add', { kind: 'constructor', fields: { t: 'a' } }).ok, false);
assert.strictEqual(post('add', { kind: 'tasks', fields: { t: 'a', hack: 1 } }).ok, false);
assert.strictEqual(post('add', { kind: 'tasks', fields: { d: today } }).ok, false);
assert.strictEqual(post('add', { kind: 'tasks' }).ok, false);

// 고치기: 보낸 항목만 바뀐다
r = post('update', { kind: 'tasks', id, fields: { s: '완료' } });
assert.deepStrictEqual([r.data.id, r.data.s, r.data.p], [id, '완료', '업무']);
assert.ok(text('할 일.md').startsWith('- [x] 첫 일 둘째 줄 ^' + id + '\n'));
// 없는 번호: 거절하고 파일은 그대로다
const before = text('할 일.md');
r = post('update', { kind: 'tasks', id: 'nope00', fields: { s: '완료' } });
assert.deepStrictEqual([r.ok, r.error], [false, '항목을 찾을 수 없습니다']);
assert.strictEqual(text('할 일.md'), before);

// PC에서 손으로 쓴 줄: 읽을 때 번호가 붙고, 서버가 모르는 글은 그대로 남는다
fileOf('할 일.md').setContent(before + '\n그냥 적은 글\n- [ ] 손으로 쓴 일\n    손 메모\n');
r = post('load', {});
const hand = r.data.tasks.find(t => t.t === '손으로 쓴 일');
assert.match(hand.id, /^[a-z0-9]{6}$/);
assert.ok(text('할 일.md').includes('\n그냥 적은 글\n- [ ] 손으로 쓴 일 ^' + hand.id + '\n    손 메모\n'));
// 바뀐 게 없으면 다시 쓰지 않는다
let wrote = 0;
const f = fileOf('할 일.md'), realSet = f.setContent;
f.setContent = v => { wrote++; realSet(v); };
post('load', {});
assert.strictEqual(wrote, 0);
f.setContent = realSet;

// 읽기 범위: 안 끝난 일 전부 + 최근 60일에 끝낸 일 + 포트폴리오 표시. 완료 기록은 끝낸 일 전부
fileOf('할 일.md').setContent(text('할 일.md')
  + '- [x] 옛날에 끝낸 일 ^old001\n    날짜:: ' + daysAgo(100) + '\n    완료일:: ' + daysAgo(90) + '\n'
  + '- [x] 옛날에 끝낸 자랑 ^old002\n    날짜:: ' + daysAgo(100) + '\n    완료일:: ' + daysAgo(90) + '\n    포트폴리오:: true\n');
post('add', { kind: 'tasks', fields: { t: '옛날부터 밀린 일', d: daysAgo(100) } });
r = post('load', {});
assert.deepStrictEqual(r.data.tasks.map(t => t.t), ['첫 일 둘째 줄', '손으로 쓴 일', '옛날에 끝낸 자랑', '옛날부터 밀린 일']);
r = post('history', {});
assert.deepStrictEqual(r.data.map(t => t.t), ['옛날에 끝낸 일', '옛날에 끝낸 자랑', '첫 일 둘째 줄']);   // 날짜순
assert.deepStrictEqual(Object.keys(r.data[0]).sort(), ['d', 'id', 'k', 'out', 'p', 'r', 's', 'star', 't', 'y']);
// PC가 만든 작업 내역 파일이 있으면 끝낸 일 목록에 커밋을 얹어 준다. 서버는 그 파일을 읽기만 한다
const gitFile = root.createFile('작업 내역.md', '- 2020-01-01 a1b2c3d 게임 | feat : 아주 옛날 커밋\n');
gitFile.setContent = () => { throw new Error('작업 내역은 읽기만 한다'); };
r = post('history', {});
assert.deepStrictEqual(r.data.map(t => t.t), ['아주 옛날 커밋', '옛날에 끝낸 일', '옛날에 끝낸 자랑', '첫 일 둘째 줄']);
assert.deepStrictEqual([r.data[0].git, r.data[0].y, r.data[0].p], [true, '기능', '게임']);
root._files.splice(root._files.indexOf(gitFile), 1);

// 끝낸 날을 적고 그 날 기준으로 60일을 센다. 날짜가 없거나 오래 밀린 일을 오늘 끝내도 화면에서 사라지지 않는다
r = post('add', { kind: 'tasks', fields: { t: '날짜 없는 일' } });
const nd = r.data.id, late = post('load', {}).data.tasks.find(t => t.t === '옛날부터 밀린 일').id;
assert.strictEqual(post('update', { kind: 'tasks', id: nd, fields: { s: '완료' } }).data.fin, today);
post('update', { kind: 'tasks', id: late, fields: { s: '완료' } });
r = post('load', {});
assert.ok(r.data.tasks.some(t => t.id === nd && t.s === '완료') && r.data.tasks.some(t => t.id === late));
assert.strictEqual(post('update', { kind: 'tasks', id: nd, fields: { s: '시작 전' } }).data.fin, null);
post('trash', { kind: 'tasks', id: nd });
post('update', { kind: 'tasks', id: late, fields: { s: '시작 전' } });

// PC에서 방금 고친 파일에는 번호를 붙여 쓰지 않는다(옵시디언이 아직 쓰는 중일 수 있다). 2분 지나면 붙인다
const hf = fileOf('할 일.md'), mid0 = text('할 일.md');
hf.setContent(mid0 + '- [ ] 치는 중');
hf.getLastUpdated = () => new Date();
r = post('load', {});
assert.strictEqual(text('할 일.md'), mid0 + '- [ ] 치는 중');
assert.strictEqual(r.data.tasks.find(t => t.t === '치는 중').id, '');
hf.getLastUpdated = () => new Date(Date.now() - 5 * 60000);
assert.match(post('load', {}).data.tasks.find(t => t.t === '치는 중').id, /^[a-z0-9]{6}$/);
post('trash', { kind: 'tasks', id: post('load', {}).data.tasks.find(t => t.t === '치는 중').id });

// 지우기: 노트에서 빼서 휴지통 노트로 옮긴다(되살릴 수 있다)
r = post('trash', { kind: 'tasks', id: hand.id });
assert.deepStrictEqual(r.data, { id: hand.id });
assert.ok(!text('할 일.md').includes(hand.id) && text('할 일.md').includes('\n그냥 적은 글\n'));
assert.ok(text('휴지통.md').includes('- [ ] 손으로 쓴 일 ^' + hand.id + '\n    손 메모\n'));
assert.strictEqual(post('trash', { kind: 'tasks', id: hand.id }).ok, false);
assert.strictEqual(post('trash', { kind: 'nope', id }).ok, false);

// 메모, 메모를 할 일로
r = post('add', { kind: 'memo', fields: { t: '생각난 것', k: '아이디어' } });
const mid = r.data.id;
assert.ok(!isNaN(Date.parse(r.data.at)));
r = post('memoToTask', { id: mid, text: '생각난 것', date: today });
assert.deepStrictEqual([r.data.t, r.data.d, r.data.s], ['생각난 것', today, '시작 전']);
assert.deepStrictEqual(post('load', {}).data.memos, []);
assert.ok(text('메모.md').includes('    상태:: 옮김\n'));
// 없는 메모면 할 일을 만들기 전에 거절한다(다시 누르면 할 일이 겹치지 않게)
const tasksBefore = text('할 일.md');
assert.strictEqual(post('memoToTask', { id: 'nope00', text: '겹치면 안 됨', date: today }).ok, false);
assert.strictEqual(text('할 일.md'), tasksBefore);
// 휴지통 끝줄에 줄바꿈이 없어도 머리말이 그 줄에 붙지 않는다
fileOf('휴지통.md').setContent(text('휴지통.md') + '손으로 쓴 끝줄');
post('trash', { kind: 'memo', id: mid });
assert.ok(text('휴지통.md').includes('손으로 쓴 끝줄\n%% '));

// 습관: 추가, 읽기, 날짜 체크와 해제, 숨기기
r = post('add', { kind: 'habit', fields: { n: '운동', i: '운', g: 3, on: true } });
assert.strictEqual(r.ok, true, r.error);
const hid = r.data.id;
assert.deepStrictEqual([r.data.n, r.data.g, r.data.on, r.data.u], ['운동', 3, true, null]);
assert.strictEqual(post('habitToggle', { id: hid, date: today }).data.dates, today);
assert.strictEqual(post('habitToggle', { id: hid, date: daysAgo(1) }).data.dates, daysAgo(1) + ',' + today);
assert.strictEqual(post('habitToggle', { id: hid, date: today }).data.dates, daysAgo(1));
assert.strictEqual(post('habitToggle', { id: hid, date: '11/24' }).ok, false);
assert.strictEqual(post('habitToggle', { id: 'nope00', date: today }).ok, false);
post('habitToggle', { id: hid, date: daysAgo(500) });
assert.strictEqual(post('load', {}).data.habits[0].dates, daysAgo(1));          // 400일 넘은 체크는 버린다
assert.strictEqual(post('update', { kind: 'habit', id: hid, fields: { on: false } }).data.on, false);
assert.strictEqual(post('load', {}).data.habits[0].on, false);
assert.deepStrictEqual(post('trash', { kind: 'habit', id: hid }).data, { id: hid });
assert.deepStrictEqual(post('load', {}).data.habits, []);

// 근태: 야근과 휴가를 적으면 월별 합계와 남은 연차를 서버가 센다. 포괄임금 기준이라 수당은 없다
r = post('load', {});
assert.deepStrictEqual([r.data.att, r.data.months, r.data.leave], [[], [], []]);
r = post('add', { kind: 'att', fields: { type: '야근', d: today, h: 2.5, reason: '빌드', taxi: 18000 } });
const taxiId = r.data.id;
assert.deepStrictEqual([r.data.taxi, r.data.paid], [18000, null]);
assert.strictEqual(r.ok, true, r.error);
assert.deepStrictEqual([r.data.t, r.data.type, r.data.h, r.data.reason], ['야근', '야근', 2.5, '빌드']);
post('add', { kind: 'att', fields: { type: '야근', d: today, h: 1, taxi: 12000 } });                  // 같은 날 두 번 적어도 야근한 날은 하루다
post('add', { kind: 'att', fields: { type: '반차', d: today, days: 0.5 } });
post('add', { kind: 'att', fields: { type: '특별휴가', d: today, days: 1 } });
post('add', { kind: 'att', fields: { type: '대체휴가', d: today, days: 1 } });              // 연차에서 빼지 않는다
assert.strictEqual(post('add', { kind: 'att', fields: { type: '결근', d: today, days: 1 } }).ok, false);
assert.strictEqual(post('add', { kind: 'att', fields: { type: '야근', d: '11/24', h: 1 } }).ok, false);
assert.strictEqual(post('add', { kind: 'att', fields: { type: '야근', d: today } }).ok, false);          // 시간이 없다
assert.strictEqual(post('add', { kind: 'att', fields: { type: '야근', d: today, h: 30 } }).ok, false);   // 하루는 24시간
assert.strictEqual(post('add', { kind: 'att', fields: { type: '연차', d: today, days: -1 } }).ok, false);
r = post('load', {});
assert.strictEqual(r.data.att.length, 5);
const monthRow = { id: today.slice(0, 7), m: today.slice(0, 7).replace('-', '.'), days: 1, hours: 3.5, used: 2.5, taxi: 30000, unpaid: 30000 };
assert.deepStrictEqual(r.data.months, [monthRow]);
// 택시비: 내가 내고 회사에 청구한다. 받은 것을 표시하면 못 받은 합계에서 빠진다
assert.strictEqual(post('update', { kind: 'att', id: taxiId, fields: { paid: true } }).data.paid, true);
assert.deepStrictEqual(post('load', {}).data.months, [{ ...monthRow, unpaid: 12000 }]);
assert.strictEqual(post('add', { kind: 'att', fields: { type: '야근', d: today, h: 1, taxi: -5 } }).ok, false);
assert.strictEqual(post('add', { kind: 'att', fields: { type: '연차', d: today, days: 1, taxi: 5000 } }).data.taxi, null);   // 휴가에는 택시비가 없다
post('trash', { kind: 'att', id: post('load', {}).data.att.filter(x => x.type === '연차')[0].id });

// 급여: 평소 읽기(load)에는 넣지 않는다. 보기를 누를 때만 따로 받아 가고, 화면은 기기에 저장하지 않는다
r = post('add', { kind: 'pay', fields: { m: '2026.11', d: today, g: 3000000, ded: 400000, net: 2600000 } });
assert.strictEqual(r.ok, true, r.error);
assert.deepStrictEqual([r.data.m, r.data.net], ['2026.11', 2600000]);
post('add', { kind: 'pay', fields: { m: '2026.10', g: 3000000, ded: 400000, net: 2600000 } });
assert.strictEqual(post('add', { kind: 'pay', fields: { m: '11월', net: 1 } }).ok, false);
assert.strictEqual(post('add', { kind: 'pay', fields: { m: '2026.12', net: -1 } }).ok, false);
const loaded = JSON.stringify(post('load', {}).data);
assert.ok(!('pays' in post('load', {}).data) && !loaded.includes('2600000'));
assert.deepStrictEqual(post('pays', {}).data.map(p => p.m), ['2026.11', '2026.10']);
assert.deepStrictEqual(post('load', {}).data.leave, []);                                   // 총 연차를 아직 안 넣었다
const yy = today.slice(0, 4);
assert.strictEqual(post('leaveSet', { y: yy, total: 15, special: 3 }).ok, true);
r = post('load', {});
assert.deepStrictEqual(r.data.leave.map(l => [l.y, l.total, l.special, l.used, l.left]), [[yy, 15, 3, 1.5, 16.5]]);
post('leaveSet', { y: yy, total: 16, special: 3 });                                        // 다시 넣으면 그 해 줄을 고친다
r = post('load', {});
assert.deepStrictEqual(r.data.leave.map(l => [l.total, l.left]), [[16, 17.5]]);
assert.strictEqual(post('leaveSet', { y: '올해', total: 15 }).ok, false);
assert.strictEqual(post('leaveSet', { y: yy, total: -1 }).ok, false);
assert.strictEqual(post('leaveSet', { y: yy, total: 400 }).ok, false);

// 커리어: 지원처와 지원 서류
r = post('add', { kind: 'job', fields: { n: '어느 게임 회사', role: '클라이언트', st: '관심', d: today, post: 'Unity C# 클라이언트 개발\n우대: Steam 출시 경험' } });
assert.strictEqual(r.ok, true, r.error);
const jid = r.data.id;
assert.deepStrictEqual([r.data.n, r.data.st, r.data.post], ['어느 게임 회사', '관심', 'Unity C# 클라이언트 개발\n우대: Steam 출시 경험']);
r = post('add', { kind: 'doc', fields: { t: '이력서', kind: '이력서', st: '미착수', job: [jid], o: 1 } });
assert.deepStrictEqual([r.data.t, r.data.job, r.data.o], ['이력서', [jid], 1]);
post('add', { kind: 'doc', fields: { t: '공통 포트폴리오', kind: '포트폴리오', st: '초안', job: [] } });
assert.strictEqual(post('update', { kind: 'job', id: jid, fields: { st: '서류 준비', chk: '0,1' } }).data.st, '서류 준비');
r = post('load', {});
assert.deepStrictEqual(r.data.jobs.map(j => [j.n, j.st, j.chk]), [['어느 게임 회사', '서류 준비', '0,1']]);
assert.deepStrictEqual(r.data.docs.map(d => [d.t, d.job]), [['이력서', [jid]], ['공통 포트폴리오', []]]);
assert.deepStrictEqual(post('trash', { kind: 'job', id: jid }).data, { id: jid });
assert.deepStrictEqual(post('load', {}).data.jobs, []);

// 지메일: 받은편지함 목록은 읽기에 딸려 오고, 본문과 처리와 공고 검색은 따로 요청한다
r = post('load', {});
assert.deepStrictEqual(r.data.mail.map(m => [m.id, m.subj, m.from, m.unread, m.n]), [['t1', '채용 공고 안내', '어느 회사', true, 1], ['t2', '(제목 없음)', 'f@example.com', false, 1]]);
assert.strictEqual(r.data.mail[0].snip, '본문 채용 공고 안내 끝');
assert.strictEqual(r.data.mailError, null);
assert.deepStrictEqual(post('mailAct', { id: 't1', op: 'read' }).data, { id: 't1', op: 'read' });
assert.strictEqual(post('load', {}).data.mail[0].unread, false);
post('mailAct', { id: 't1', op: 'star' });
assert.strictEqual(post('load', {}).data.mail[0].star, true);
assert.strictEqual(post('mailAct', { id: 't1', op: 'delete' }).ok, false);          // 지우기는 없다
assert.strictEqual(post('mailAct', { id: 'nope', op: 'read' }).ok, false);
r = post('mailBody', { id: 't1' });
assert.deepStrictEqual([r.data.length, r.data[0].subject, r.data[0].body], [1, '채용 공고 안내', '본문   채용 공고 안내\n\n끝']);
assert.strictEqual(post('mailBody', { id: 'nope' }).ok, false);
post('jobMail', {});
assert.match(g.searches().slice(-1)[0], /^newer_than:30d subject:\(/);
post('jobMail', { q: '채용\n' + 'x'.repeat(500) });
assert.ok(g.searches().slice(-1)[0].length <= 220 && !g.searches().slice(-1)[0].includes('\n'));
post('mailAct', { id: 't2', op: 'archive' });
assert.deepStrictEqual(post('load', {}).data.mail.map(m => m.id), ['t1']);
// 메일을 못 읽어도 할 일은 나온다
g.breakMail(true);
r = post('load', {});
assert.ok(r.ok && r.data.tasks.length > 0 && r.data.mail === null && /권한/.test(r.data.mailError));
g.breakMail(false);

// 작업 기록: 옵시디언 작업 로그를 읽기만 한다. 평소 읽기(load)에는 넣지 않는다
assert.match(post('worklog', {}).error, /LOG_FILE/);                               // 설정 전에는 안내만 한다
PROPS.LOG_FILE = 'logfileid0123456789abcd';
r = post('worklog', {});
assert.strictEqual(r.ok, true, r.error);
assert.deepStrictEqual(r.data.entries.map(e => [e.d, e.t, e.open]), [['2026-11-24', '다른 작업', []], ['2026-11-23', '어떤 작업', ['사용자 확인 대기.']]]);
assert.ok(!JSON.stringify(post('load', {}).data).includes('어떤 작업'));
PROPS.LOG_FILE = 'nope';
assert.strictEqual(post('worklog', {}).ok, false);
delete PROPS.LOG_FILE;

// 스크립트 속성에 번호 대신 경로를 적어도 된다. PC에서 보이는 경로(Z:\\...)를 그대로 적어도 된다
const before2 = JSON.stringify(post('load', {}).data.tasks);
['ObsidianFolder/todo', 'Z:\\ObsidianFolder\\todo', ' /ObsidianFolder/todo/ '].forEach(p => {
  PROPS.TODO_FOLDER = p;
  r = post('load', {});
  assert.strictEqual(r.ok, true, p + ' -> ' + r.error);
  assert.strictEqual(JSON.stringify(r.data.tasks), before2, p);
});
// 한 번 찾은 경로는 기억해 두고 다음부터는 번호로 바로 연다(이름으로 찾아 들어가는 것은 느리다)
const n0 = g.lookups().filter(x => x === 'root').length;
post('load', {}); post('load', {});
assert.strictEqual(g.lookups().filter(x => x === 'root').length, n0);
PROPS.TODO_FOLDER = 'ObsidianFolder/없는 폴더';
assert.match(post('load', {}).error, /찾을 수 없습니다: 없는 폴더/);
g.top.createFolder('ObsidianFolder');                                             // 같은 이름 폴더가 둘이면 고르지 않는다
PROPS.TODO_FOLDER = 'ObsidianFolder/todo2';
assert.match(post('load', {}).error, /둘 이상/);
g.top._subs.pop();
PROPS.TODO_FOLDER = 'folderid0123456789abcdef';
PROPS.LOG_FILE = 'Z:\\ObsidianFolder\\log.md';
assert.deepStrictEqual(post('worklog', {}).data.entries.map(e => e.t), ['다른 작업', '어떤 작업']);
PROPS.LOG_FILE = 'ObsidianFolder/없는 파일.md';
assert.match(post('worklog', {}).error, /찾을 수 없습니다/);
delete PROPS.LOG_FILE;

// 작업 화면: PC가 만든 목록을 주고, 목록에 적힌 노트와 그림만 읽어 준다. 볼트는 읽기만 한다
assert.match(post('works', {}).error, /작업 목록이 없습니다/);
const wk = g.vault.createFolder('entities').createFolder('게임');
wk.createFile('저장 수정.md', '# 저장 수정\n![[구조.svg]]\n').setContent = () => { throw new Error('노트는 읽기만 한다'); };
wk.createFolder('Docs').createFile('구조.svg', '<svg/>');
wk.createFile('목록에 없는 노트.md', '비밀');
const idx = root.createFile('작업 목록.json', JSON.stringify({ at: 'T', notes: [
  { p: '게임', s: '', t: '저장 수정', d: '2026-11-20', path: 'entities/게임/저장 수정.md', sum: '요약', heads: [], imgs: ['entities/게임/Docs/구조.svg'], m: 1, z: 2 }] }));
r = post('works', {});
assert.deepStrictEqual([r.data.at, r.data.notes.length, r.data.notes[0].t, 'm' in r.data.notes[0]], ['T', 1, '저장 수정', false]);
assert.strictEqual(post('workNote', { path: 'entities/게임/저장 수정.md' }).data.text, '# 저장 수정\n![[구조.svg]]\n');
// 한 번 찾은 노트는 번호를 기억해, 다음에는 폴더를 이름으로 찾아 내려가지 않는다
const walk = wk.getFilesByName;
wk.getFilesByName = () => { throw new Error('다시 찾아 내려갔다'); };
assert.strictEqual(post('workNote', { path: 'entities/게임/저장 수정.md' }).data.text, '# 저장 수정\n![[구조.svg]]\n');
wk.getFilesByName = walk;
assert.match(post('workNote', { path: 'entities/게임/목록에 없는 노트.md' }).error, /목록에 없는/);
assert.match(post('workNote', { path: '../desk/급여.md' }).error, /목록에 없는/);
r = post('workImg', { path: 'entities/게임/Docs/구조.svg' });
assert.deepStrictEqual([r.data.mime, Buffer.from(r.data.b64, 'base64').toString()], ['image/svg+xml', '<svg/>']);
assert.match(post('workImg', { path: 'entities/게임/저장 수정.md' }).error, /목록에 없는/);       // 노트를 그림으로 읽을 수 없다
root._files.splice(root._files.indexOf(idx), 1);

// 지원 서류(이력서, 포트폴리오): PC가 desk 폴더에 써 둔 한 파일짜리 HTML을 읽기만 해서 준다. 비공개라 load에는 넣지 않는다
assert.match(post('doc', { name: '이력서' }).error, /이력서 파일이 없습니다/);
const cvFile = root.createFile('이력서.html', '<!doctype html><p>이력서 본문</p>');
const pfFile = root.createFile('포트폴리오.html', '<!doctype html><p>포트폴리오 본문</p>');
cvFile.setContent = pfFile.setContent = () => { throw new Error('지원 서류는 읽기만 한다'); };
assert.strictEqual(post('doc', { name: '이력서' }).data.html, '<!doctype html><p>이력서 본문</p>');
assert.strictEqual(post('doc', { name: '포트폴리오' }).data.html, '<!doctype html><p>포트폴리오 본문</p>');
assert.match(post('doc', { name: '급여.md' }).error, /모르는 문서/);            // 정해 둔 두 이름 말고는 읽지 않는다
assert.match(post('doc', { name: '../이력서' }).error, /모르는 문서/);
assert.ok(!/이력서 본문|포트폴리오 본문/.test(JSON.stringify(post('load', {}).data)));
root._files.splice(root._files.indexOf(cvFile), 1);
root._files.splice(root._files.indexOf(pfFile), 1);

// 공고 주소 하나 가져오기: 게임잡 공고 주소만 받고, 번호만 뽑아 서버가 주소를 다시 만든다(아무 주소나 읽어 주는 길이 되지 않게)
['https://evil.example/Recruit/GI_Read/View?GI_No=1', 'https://www.gamejob.co.kr.evil.example/Recruit/GI_Read/View?GI_No=1',
  'https://www.gamejob.co.kr/Login/x?GI_No=1', 'file:///etc/passwd', '', 'https://www.gamejob.co.kr/Recruit/GI_Read/View?GI_No=abc'].forEach(u =>
  assert.match(post('jobFetch', { url: u }).error, /게임잡 공고 주소만/, u));
const GJ = 'https://www.gamejob.co.kr';
g.web[GJ + '/Recruit/GI_Read/View?GI_No=77'] = { text: '<meta property="og:title" content="[어느게임즈] 클라이언트 프로그래머"><dl><dt class="recruit-data-title">마감일</dt><dd class="recruit-data-text">2026.12.05</dd></dl>' };
g.web[GJ + '/Recruit/GI_Read_Comt_Ifrm?gno=77'] = { text: '<body><p>글로 적은 본문</p></body>' };
r = post('jobFetch', { url: ' http://gamejob.co.kr/Recruit/GI_Read/View?utm=x&GI_No=77&from=mail ' });   // 꼬리표가 붙은 주소도 번호만 쓴다
assert.strictEqual(r.ok, true, r.error);
assert.deepStrictEqual(r.data.fields, { n: '어느게임즈', role: '클라이언트 프로그래머', d: '2026-12-05', link: GJ + '/Recruit/GI_Read/View?GI_No=77',
  memo: '마감일: 2026.12.05', post: '글로 적은 본문', st: '관심' });
assert.deepStrictEqual([r.data.read.images, r.data.read.failed, g.ocr.made.length], [0, 0, 0]);
// 그림으로 올린 공고: 그림에서 읽은 글을 앞에, 글로 적힌 부분을 뒤에 둔다. 작은 그림(로고, 배너)은 읽지 않는다
const big = Buffer.alloc(50 * 1024); big[0] = 0xFF; big[1] = 0xD8;   // JPEG 앞머리
g.web[GJ + '/Recruit/GI_Read_Comt_Ifrm?gno=77'] = { text: '<body><img src="https://cdn.example/poster.jpg"><img src="//cdn.example/logo.png"><img src="https://cdn.example/없는그림.jpg"><p>바로 지원하기</p></body>' };
g.web['https://cdn.example/poster.jpg'] = { bytes: big, type: 'binary/octet-stream' };   // 그림이라고 표시하지 않고 보내는 서버가 있다. 앞머리로 가린다
g.web['https://cdn.example/logo.png'] = { bytes: Buffer.alloc(900), type: 'image/png' };
g.ocr.text = '담당 업무\n  전투 시스템 개발  \n\n자격 요건\nUnity 3년';
r = post('jobFetch', { url: GJ + '/Recruit/GI_Read/View?GI_No=77' });
assert.strictEqual(r.data.fields.post, '담당 업무\n전투 시스템 개발\n자격 요건\nUnity 3년\n\n── 글로 적힌 부분 ──\n바로 지원하기');
assert.deepStrictEqual([r.data.read.images, r.data.read.failed], [1, 1]);                      // 없는 그림 하나는 실패로 센다
assert.deepStrictEqual(g.ocr.made, [['application/vnd.google-apps.document', 50 * 1024, 'ko']]);
assert.deepStrictEqual(g.ocr.types, ['image/jpeg']);                                          // 드라이브에는 그림이라고 표시해서 올린다
g.web['https://cdn.example/notimage.jpg'] = { bytes: Buffer.alloc(50 * 1024), type: 'image/jpeg' };   // 표시는 그림인데 내용이 그림이 아니면 읽지 않는다
g.web[GJ + '/Recruit/GI_Read_Comt_Ifrm?gno=78'] = { text: '<body><img src="https://cdn.example/notimage.jpg"></body>' };
g.web[GJ + '/Recruit/GI_Read/View?GI_No=78'] = g.web[GJ + '/Recruit/GI_Read/View?GI_No=77'];
assert.match(post('jobFetch', { url: GJ + '/Recruit/GI_Read/View?GI_No=78' }).data.read.error, /그림 파일이 아닙니다/);
assert.deepStrictEqual(g.ocr.removed, ['ocr-doc-1']);                                         // 읽으려고 만든 임시 문서는 지운다
g.ocr.fail = true;                                                                            // 글자 읽기가 실패해도 기본 정보는 준다
r = post('jobFetch', { url: GJ + '/Recruit/GI_Read/View?GI_No=77' });
assert.deepStrictEqual([r.ok, r.data.fields.n, r.data.fields.post, r.data.read.images, r.data.read.failed], [true, '어느게임즈', '바로 지원하기', 0, 2]);
assert.match(r.data.read.error, /Request Too Large/);
g.ocr.fail = false;
assert.match(post('jobFetch', { url: GJ + '/Recruit/GI_Read/View?GI_No=404' }).error, /공고를 읽지 못했습니다/);

// 공고 목록: 목록 한 장을 읽고, 공고별 조건 요약은 다섯 장씩 끊어 받아 기억해 둔다. 저장은 하지 않는다
assert.match(post('jobList', {}).error, /목록을 읽지 못했습니다/);
const row = no => '<a href="/Recruit/GI_Read/View?GI_No=' + no + '" onclick="GA_Application_Prdt(\'02_공고클릭\', \'Y\', \'공고 ' + no + '\', \'' + no + '\', \'회사 ' + no + '\', \'관\', ' +
  'IsNullOrWhiteSpace(\'게임개발(클라이언트)\'), IsNullOrWhiteSpace(\'모바일게임\'), \'없음\', IsNullOrWhiteSpace(\'서울 &gt; 강남구, \'));" target="_blank">공고</a> <span class="dday">~12/20</span>';
const nos = [101, 102, 103, 104, 105, 106, 107];
g.web[GJ + '/Recruit/joblist?menucode=duty&duty=1'] = { text: nos.map(row).join('') };
nos.slice(0, 6).forEach(no => { g.web[GJ + '/Recruit/GI_Read/View?GI_No=' + no] = { text: '<dl><dt class="recruit-data-title">경력</dt><dd class="recruit-data-text">경력 ' + (no - 100) + '년 이상</dd></dl>' }; });
g.ocr.batches.length = 0;
r = post('jobList', {});
assert.strictEqual(r.ok, true, r.error);
assert.deepStrictEqual(r.data.rows.map(x => [x.no, x.n, x.area, x.end, x.info['경력'] || null]).slice(0, 2), [['101', '회사 101', '서울 > 강남구', '~12/20', '경력 1년 이상'], ['102', '회사 102', '서울 > 강남구', '~12/20', '경력 2년 이상']]);
assert.deepStrictEqual([r.data.rows.length, r.data.rows[6].info, r.data.rows[0].link], [7, {}, GJ + '/Recruit/GI_Read/View?GI_No=101']);   // 못 읽은 공고도 목록에는 남긴다
assert.deepStrictEqual(g.ocr.batches, [5, 2]);                                                 // 다섯 장씩 끊어 받는다
g.ocr.batches.length = 0;
post('jobList', {});
assert.deepStrictEqual(g.ocr.batches, [1]);                                                    // 읽은 것은 기억해 두고, 못 읽은 한 장만 다시 청한다
// 직무를 골라 읽는다. 정해 둔 직무 번호만 받고, 그 밖의 값은 클라이언트(1)로 본다(주소에 아무 글자나 끼워 넣지 못하게)
g.web[GJ + '/Recruit/joblist?menucode=duty&duty=16'] = { text: row(201) };
assert.deepStrictEqual(post('jobList', { duty: 16 }).data.rows.map(x => x.no), ['201']);
['999', '1&x=1', null, 'duty'].forEach(d => assert.strictEqual(post('jobList', { duty: d }).data.rows.length, 7, String(d)));

// 일정 추가: 입력을 검사한 뒤 캘린더에 쓴다
assert.strictEqual(post('eventAdd', { title: '회의', date: '11/25' }).ok, false);
assert.strictEqual(post('eventAdd', { title: ' ', date: today }).ok, false);
assert.strictEqual(post('eventAdd', { title: '회의', date: today, start: '3시' }).ok, false);
assert.strictEqual(g.created().length, 0);
assert.strictEqual(post('eventAdd', { title: '종일 행사', date: '2026-11-25' }).ok, true);
assert.strictEqual(post('eventAdd', { title: '회의', date: '2026-11-25', start: '15:00', end: '16:00' }).ok, true);
assert.deepStrictEqual(g.created(), [
  ['allDay', '종일 행사', '2026-11-24T15:00:00.000Z'],
  ['timed', '회의', '2026-11-25T06:00:00.000Z', '2026-11-25T07:00:00.000Z'],
]);
// 밤 11시대 일정: 화면이 끝 시각을 00:30으로 보낸다. 끝이 시작보다 앞서면 다음 날로 본다
post('eventAdd', { title: '늦은 일', date: '2026-11-25', start: '23:30', end: '00:30' });
assert.deepStrictEqual(g.created()[2], ['timed', '늦은 일', '2026-11-25T14:30:00.000Z', '2026-11-25T15:30:00.000Z']);

// 캘린더를 못 읽어도 할 일은 나온다
g.breakCalendar(true);
r = post('load', {});
assert.ok(r.ok && r.data.tasks.length > 0 && r.data.events.length === 0 && /권한/.test(r.data.calError));
g.breakCalendar(false);

// 같은 이름 노트가 둘이면 고르지 않고 거절한다
root.createFile('할 일.md', '');
assert.match(post('load', {}).error, /둘 이상/);
root._files.pop();

// 편집기용 점검: _점검 하위 폴더 안에서만 돌고 실제 노트는 안 건드린다
const snapshot = root._files.map(x => x.getName() + x.getBlob().getDataAsString()).join('\u0000');
ctx.selfCheck();
assert.strictEqual(root._files.map(x => x.getName() + x.getBlob().getDataAsString()).join('\u0000'), snapshot);
assert.strictEqual(root._subs[0].getName(), '_점검');

console.log('server.test.js 통과');
