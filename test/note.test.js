// Note.gs 점검. 실행: node test/note.test.js
const assert = require('node:assert');
require.extensions['.gs'] = require.extensions['.js'];
const N = require('../apps-script/Note.gs');

const T = [
  '서버가 모르는 글',
  '- [ ] 테두리 마무리 ^aaaaaa',
  '    날짜:: 2026-11-25',
  '    상태:: 진행 중',
  '    프로젝트:: 업무',
  '    손으로 쓴 메모 줄',
  '- [x] 끝낸 일 ^bbbbbb',
  '\t포트폴리오:: true',
  '- [ ] 손으로 쓴 일',
  '- [ ] ',
  '',
].join('\n');
const EMPTY = { d: null, s: '시작 전', p: null, y: null, r: null, c: null, k: null, star: null, detail: null, note: null, out: null, fin: null };

// 읽기: 항목 줄 + 들여쓴 "이름:: 값" 줄. 체크된 줄은 상태가 완료다. 쓰다 만 빈 체크 줄은 건너뛴다
const rows = N.listRecords(T, 'tasks');
assert.deepStrictEqual(rows, [
  { ...EMPTY, id: 'aaaaaa', t: '테두리 마무리', d: '2026-11-25', s: '진행 중', p: '업무' },
  { ...EMPTY, id: 'bbbbbb', t: '끝낸 일', s: '완료', star: true },
  { ...EMPTY, id: '', t: '손으로 쓴 일' },
]);

// 번호 붙이기: 번호 없는 줄만 바뀐다. 겹친 번호는 뒤쪽에 새 번호
const e = N.ensureIds(T, () => 'zzzzzz');
assert.strictEqual(e.text, T.replace('- [ ] 손으로 쓴 일', '- [ ] 손으로 쓴 일 ^zzzzzz'));
assert.strictEqual(N.ensureIds(e.text, () => 'q').changed, false);
const dup = N.ensureIds('- [ ] 원본 ^aaaaaa\n- [ ] 복제 ^aaaaaa\n', () => 'zzzzzz');
assert.deepStrictEqual(N.listRecords(dup.text, 'tasks').map(r => r.id), ['aaaaaa', 'zzzzzz']);
assert.strictEqual(N.listRecords('- [ ] 일 ^a1\n', 'tasks')[0].id, 'a1');   // 손으로 쓴 옵시디언 번호

// 고치기: 보낸 항목만 바뀐다. 손으로 쓴 메모 줄과 다른 줄은 그대로다
const u = N.updateRecord(T, 'tasks', 'aaaaaa', { s: '완료', r: '상', p: null });
assert.strictEqual(u, T.replace(
  '- [ ] 테두리 마무리 ^aaaaaa\n    날짜:: 2026-11-25\n    상태:: 진행 중\n    프로젝트:: 업무\n',
  '- [x] 테두리 마무리 ^aaaaaa\n    날짜:: 2026-11-25\n    우선순위:: 상\n'));
// 완료를 풀면 체크가 풀린다
assert.ok(N.updateRecord(u, 'tasks', 'aaaaaa', { s: '시작 전' }).includes('- [ ] 테두리 마무리 ^aaaaaa\n    날짜:: 2026-11-25\n    우선순위:: 상\n    손으로 쓴 메모 줄'));
// 제목만
assert.ok(N.updateRecord(T, 'tasks', 'aaaaaa', { t: ' 새 제목\n둘째 ^zzz ' }).includes('- [ ] 새 제목 둘째 ^aaaaaa\n    날짜:: 2026-11-25\n    상태:: 진행 중'));

// 값 모양: 여러 줄 글, 글자 'true', 참/거짓이 읽고 쓸 때 그대로 돌아온다
const v = N.updateRecord(T, 'tasks', 'aaaaaa', { detail: '첫 줄\n둘째 줄', note: 'true', star: true, out: '  앞 공백' });
assert.ok(v.includes('    세부:: "첫 줄\\n둘째 줄"\n'));
const back = N.listRecords(v, 'tasks')[0];
assert.deepStrictEqual([back.detail, back.note, back.star, back.out], ['첫 줄\n둘째 줄', 'true', true, '  앞 공백']);

// 추가: 파일 끝에 붙는다
assert.strictEqual(N.addRecord('', 'tasks', { t: 'x', d: '2026-11-24', s: '시작 전' }, 'nnnnnn'), '- [ ] x ^nnnnnn\n    날짜:: 2026-11-24\n');
assert.ok(N.addRecord(T, 'tasks', { t: '새 일' }, 'nnnnnn').endsWith('- [ ] \n- [ ] 새 일 ^nnnnnn\n'));
assert.strictEqual(N.listRecords(N.addRecord(T, 'tasks', { t: '- [ ] <b>::</b>' }, 'ssssss'), 'tasks')[3].t, '- [ ] <b>::</b>');

// 빼기(휴지통용): 항목 줄과 딸린 줄을 통째로 꺼낸다
const k = N.takeRecord(T, 'aaaaaa');
assert.strictEqual(k.block, '- [ ] 테두리 마무리 ^aaaaaa\n    날짜:: 2026-11-25\n    상태:: 진행 중\n    프로젝트:: 업무\n    손으로 쓴 메모 줄\n');
assert.strictEqual(k.text, '서버가 모르는 글\n- [x] 끝낸 일 ^bbbbbb\n\t포트폴리오:: true\n- [ ] 손으로 쓴 일\n- [ ] \n');

// 거절: 없는 번호, 모르는 항목 이름, 빈 제목, 모르는 종류
assert.throws(() => N.updateRecord(T, 'tasks', 'nope00', { s: '완료' }), /항목을 찾을 수 없습니다/);
assert.throws(() => N.takeRecord(T, 'nope00'), /항목을 찾을 수 없습니다/);
assert.throws(() => N.updateRecord(T, 'tasks', 'aaaaaa', { hack: 1 }), /알 수 없는 항목/);
assert.throws(() => N.updateRecord(T, 'tasks', 'aaaaaa', { __proto__: null, constructor: 1 }), /알 수 없는 항목/);
assert.throws(() => N.updateRecord(T, 'tasks', 'aaaaaa', { p: { a: 1 } }), /값 형식/);
assert.throws(() => N.updateRecord(T, 'tasks', 'aaaaaa', { t: '  ' }), /제목이 비었습니다/);
assert.throws(() => N.addRecord(T, 'tasks', { d: '2026-11-24' }, 'nnnnnn'), /제목이 비었습니다/);
assert.throws(() => N.listRecords(T, 'constructor'), /알 수 없는 종류/);

// 줄바꿈 종류 유지
assert.ok(N.updateRecord(T.replace(/\n/g, '\r\n'), 'tasks', 'bbbbbb', { s: '시작 전' }).includes('- [ ] 끝낸 일 ^bbbbbb\r\n'));

// 메모 종류: 체크 표시와 상태가 무관하다
const m = N.addRecord('', 'memo', { t: '생각', k: '아이디어', pin: true, at: '2026-11-24T05:00:00.000Z' }, 'mmmmmm');
assert.deepStrictEqual(N.listRecords(m, 'memo'), [{ id: 'mmmmmm', t: '생각', k: '아이디어', pin: true, st: null, at: '2026-11-24T05:00:00.000Z' }]);

/* ── 배포 전 검토에서 나온 것 ── */
const rows1 = t => N.listRecords(t, 'tasks');
// 줄바꿈이 섞인 파일도 읽는다. 옆 건을 삼키지 않는다
assert.strictEqual(rows1('- [ ] A ^a1\n- [ ] B ^b1\n\r\n- [ ] C ^c1\n').length, 3);
assert.strictEqual(N.takeRecord('- [ ] A ^a1\r\n    메모\r\n- [ ] B ^b1\n- [ ] C ^c1\r\n', 'a1').block.includes('B'), false);
// 손으로 쓴 [X]는 완료다. 무관한 수정에 표시가 바뀌지 않는다
assert.strictEqual(rows1('- [X] 손 ^a1\n')[0].s, '완료');
assert.ok(N.updateRecord('- [X] 손 ^a1\n', 'tasks', 'a1', { r: '상' }).startsWith('- [X] 손 ^a1\n'));
assert.ok(N.updateRecord('- [-] 취소 ^a1\n', 'tasks', 'a1', { r: '상' }).startsWith('- [-] 취소 ^a1\n'));
assert.ok(N.updateRecord('- [-] 취소 ^a1\n', 'tasks', 'a1', { s: '완료' }).startsWith('- [x] 취소 ^a1\n'));
assert.ok(N.updateRecord('- [X] 손 ^a1\n', 'tasks', 'a1', { s: '시작 전' }).startsWith('- [ ] 손 ^a1\n'));
// 손으로 쓴 값은 글자 그대로다. 숫자로 바뀌어 화면을 죽이거나 값이 변하지 않는다
const raw = '- [ ] 일 ^a1\n    프로젝트:: 2048\n    날짜:: 20261125\n    성과:: 12345678901234567890\n    세부:: 1e3\n    분류:: "인용"\n    비고:: null\n';
assert.deepStrictEqual([rows1(raw)[0].p, rows1(raw)[0].d, rows1(raw)[0].c, rows1(raw)[0].note], ['2048', '20261125', '"인용"', 'null']);
// 무관한 수정: 있던 줄은 순서와 글자가 그대로고, 새 항목만 마지막 항목 줄 뒤에 붙는다
assert.strictEqual(N.updateRecord(raw, 'tasks', 'a1', { r: '상' }), raw + '    우선순위:: 상\n');
assert.strictEqual(N.updateRecord('- [x] 일 ^a1\n\t상태:: 진행 중\n\t손 메모\n', 'tasks', 'a1', { r: '상' }), '- [x] 일 ^a1\n\t상태:: 진행 중\n    우선순위:: 상\n\t손 메모\n');
// 같은 이름 줄이 둘이면 둘 다 남는다
const twice = '- [ ] 일 ^a1\n    비고:: first\n    비고:: second\n';
const tw = N.updateRecord(twice, 'tasks', 'a1', { r: '상' });
assert.ok(tw.includes('비고:: first') && tw.includes('비고:: second'));
// 보이지 않는 줄 구분 문자(웹에서 복사할 때 딸려 온다)
assert.strictEqual(N.cleanTitle('a\u2028b\u2029c'), 'a b c');
assert.strictEqual(rows1(N.updateRecord('- [ ] 일 ^a1\n', 'tasks', 'a1', { note: 'x\u2028y' }))[0].note, 'x\u2028y');
// 파일 맨 앞 표식 글자(BOM)가 있어도 첫 줄을 읽고, 쓸 때 그대로 둔다
assert.strictEqual(rows1('\uFEFF- [ ] A ^a1\n')[0].id, 'a1');
assert.ok(N.updateRecord('\uFEFF- [ ] A ^a1\n', 'tasks', 'a1', { r: '상' }).startsWith('\uFEFF- [ ] A ^a1\n'));
// 객체에 원래 있는 이름과 같은 번호
assert.strictEqual(N.ensureIds('- [ ] A ^constructor\n- [ ] B ^toString\n', () => 'zzzzzz').changed, false);

/* ── 습관 종류: 제목 항목이 n이고, 숫자 항목과 꺼짐(false)을 그대로 지킨다 ── */
const hb = N.addRecord('', 'habit', { n: '물 마시기', i: '물', g: 7, on: true, o: 1 }, 'hhhhhh');
assert.strictEqual(hb, '- [ ] 물 마시기 ^hhhhhh\n    아이콘:: 물\n    순서:: 1\n    사용:: true\n    주간 목표:: 7\n');
assert.deepStrictEqual(N.listRecords(hb, 'habit'), [{ id: 'hhhhhh', n: '물 마시기', i: '물', o: 1, on: true, g: 7, dates: null }]);
const off = N.updateRecord(hb, 'habit', 'hhhhhh', { on: false, dates: '2026-11-23,2026-11-24', n: '물 2리터' });
assert.deepStrictEqual(N.listRecords(off, 'habit')[0], { id: 'hhhhhh', n: '물 2리터', i: '물', o: 1, on: false, g: 7, dates: '2026-11-23,2026-11-24' });
assert.throws(() => N.addRecord('', 'habit', { t: '제목 항목이 다르다' }, 'x'), /알 수 없는 항목/);
assert.throws(() => N.addRecord('', 'habit', { i: '물' }, 'x'), /제목이 비었습니다/);
// 할 일의 꺼진 표시(star:false)는 지금처럼 줄을 없앤다
assert.ok(!N.updateRecord('- [ ] 일 ^a1\n    포트폴리오:: true\n', 'tasks', 'a1', { star: false }).includes('포트폴리오'));

console.log('note.test.js 통과');
