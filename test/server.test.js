// Code.gs 점검. 구글 서비스를 가짜로 끼워 PC에서 서버 코드를 그대로 돌린다.
// 실행: node test/server.test.js
const assert = require('node:assert');
const { makeContext, fakeFolder } = require('./fake-google');

const PASS = 'correct-horse-battery-staple';
const root = fakeFolder('todo');
const g = makeContext(root, { PASS: PASS, TODO_FOLDER: 'folder-id' });
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
  { id: 'e1', t: '회의', all: false, s: '2026-11-24T05:00:00.000Z', e: '2026-11-24T06:00:00.000Z', cal: '내 캘린더', color: '#0a84ff', loc: '' },
  { id: 'e2', t: '마감', all: true, s: '2026-11-25', e: '2026-11-25', cal: '내 캘린더', color: '#0a84ff', loc: '' },
]);

// 추가: 화면이 준 항목 그대로 돌려주고 번호를 붙인다
r = post('add', { kind: 'tasks', fields: { t: '  첫 일\n둘째 줄 ', d: today, s: '시작 전', p: '업무', r: '상' } });
assert.strictEqual(r.ok, true, r.error);
const id = r.data.id;
assert.match(id, /^[a-z0-9]{6}$/);
assert.deepStrictEqual([r.data.t, r.data.d, r.data.s, r.data.p, r.data.r, r.data.u], ['첫 일 둘째 줄', today, '시작 전', '업무', '상', null]);
assert.strictEqual(text('할 일.md'), '- [ ] 첫 일 둘째 줄 ^' + id + '\n    날짜:: ' + today + '\n    프로젝트:: 업무\n    우선순위:: 상\n');
// 거절되는 추가
assert.strictEqual(post('add', { kind: 'habit', fields: { n: 'a' } }).ok, false);
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
