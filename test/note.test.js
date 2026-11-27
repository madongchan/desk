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

/* ── 목록 값: 지원 서류가 어느 지원처의 것인지 번호 목록으로 든다 ── */
const dc = N.addRecord('', 'doc', { t: '자기소개서', kind: '자기소개서', st: '미착수', job: ['abc123', 'def456'], lim: 800, o: 2 }, 'dddddd');
assert.ok(dc.includes('    지원처:: abc123,def456\n'));
assert.deepStrictEqual(N.listRecords(dc, 'doc')[0].job, ['abc123', 'def456']);
assert.strictEqual(N.listRecords(dc, 'doc')[0].lim, 800);
const dc0 = N.updateRecord(dc, 'doc', 'dddddd', { job: [] });
assert.ok(!dc0.includes('지원처::'));
assert.deepStrictEqual(N.listRecords(dc0, 'doc')[0].job, []);
assert.throws(() => N.updateRecord(dc, 'doc', 'dddddd', { job: ['a b', '\n- [ ] 끼워넣기'] }), /값 형식/);
assert.throws(() => N.updateRecord(dc, 'doc', 'dddddd', { kind: ['목록이 아닌 항목'] }), /값 형식/);

/* ── 작업 로그 읽기: 날짜별 기록으로 나누고 정리 안 된 문장을 고른다 ── */
const LOG = ['머리말은 기록이 아니다', '', '## 2026-11-22 첫 기록', '', '고쳤다. 컴파일 에러 없음. 커밋은 안 함.', '',
  '## 2026-11-23 둘째 기록', '원인을 찾았다. 고칠지 사용자 확인 대기. 빌드에서는 확인하지 못했다.', '남은 문제: 강조가 꺼진다.', '',
  '## 제목만 있고 날짜가 없는 절', '이건 기록이 아니다', '', '## 2026-11-24 셋째 기록', '끝냈다.'].join('\n');
const lg = N.parseLog(LOG, 10);
assert.deepStrictEqual(lg.map(e => [e.d, e.t]), [['2026-11-24', '셋째 기록'], ['2026-11-23', '둘째 기록'], ['2026-11-22', '첫 기록']]);   // 최근 것부터
assert.deepStrictEqual(lg[1].open, ['고칠지 사용자 확인 대기.', '빌드에서는 확인하지 못했다.', '남은 문제: 강조가 꺼진다.']);
assert.deepStrictEqual(lg[2].open, []);                      // '커밋은 안 함'은 늘 붙는 말이라 세지 않는다
assert.strictEqual(lg[0].body, '끝냈다.');
assert.strictEqual(N.parseLog(LOG, 2).length, 2);
assert.deepStrictEqual(N.parseLog('', 10), []);
assert.ok(N.parseLog('## 2026-11-24 긴 기록\n' + '가'.repeat(5000), 10)[0].body.length <= 2001);

/* ── 작업 내역 읽기: PC가 깃 기록에서 만든 줄을 끝낸 일과 같은 모양으로 바꾼다 ── */
const GIT = ['# 작업 내역', '손으로 쓴 줄은 건너뛴다', '',
  '- 2026-11-24 a1b2c3d 게임 | feat : 창고 정렬 추가', '- 2026-11-23 b2c3d4e 게임 | FIX: 저장 순서 수정',
  '- 2026-11-23 c3d4e5f 게임 | local : 설명 문구 수정', '- 2026-11-22 d4e5f6a 도구 | 머리말 없는 제목', '- 날짜가 없는 줄'].join('\r\n');
const cm = N.parseCommits(GIT);
assert.deepStrictEqual(cm.map(c => [c.d, c.p, c.y, c.t]), [
  ['2026-11-24', '게임', '기능', '창고 정렬 추가'], ['2026-11-23', '게임', '버그', '저장 순서 수정'],
  ['2026-11-23', '게임', '기타', 'local : 설명 문구 수정'], ['2026-11-22', '도구', '기타', '머리말 없는 제목']]);   // 모르는 머리말은 제목에 남긴다
assert.deepStrictEqual([cm[0].id, cm[0].s, cm[0].git], ['git-a1b2c3d', '완료', true]);
assert.deepStrictEqual(N.parseCommits(''), []);

/* ── 공고 페이지 읽기: 주소 하나에서 받은 글을 지원처 칸으로 바꾼다 ── */
const PAGE = '<html><head><title>[경력] 게임 클라이언트 프로그래머</title><title>사이트 이름</title>' +
  '<meta property="og:title" content="[어느게임즈] [경력] 게임 클라이언트 프로그래머">' +
  '<script>var x = "<dt class=\\"recruit-data-title\\">가짜</dt>";</script></head><body>' +
  '<dl><dt class="recruit-data-title">경력</dt> <dd class="recruit-data-text">3년 이상</dd></dl>' +
  '<dl><dt class="recruit-data-title">모집분야</dt>\n<dd class="recruit-data-text">게임개발(클라이언트), <b>게임개발(모바일)</b></dd></dl>' +
  '<dl><dt class="recruit-data-title">마감일</dt><dd class="recruit-data-text"><p class="end-date">2026.12.05</p></dd></dl>' +
  '<a id="goArea" href="#">서울 &gt; 서초구</a></body></html>';
const BODY = '<html><head><title>채용공고 상세페이지</title><style>body{color:red}</style></head><body><h3>담당업무</h3>' +
  '<p>전투 시스템&nbsp;개발 &amp; 유지보수</p><ul><li>Unity 3년 이상</li><li>C#</li></ul><br><br><br>우대: 서버 경험&#39;</body></html>';
let jp = N.parseJobPage(PAGE, BODY);
assert.deepStrictEqual([jp.n, jp.role, jp.d], ['어느게임즈', '[경력] 게임 클라이언트 프로그래머', '2026-12-05']);
assert.strictEqual(jp.memo, '경력: 3년 이상 · 모집분야: 게임개발(클라이언트), 게임개발(모바일) · 마감일: 2026.12.05 · 근무지역: 서울 > 서초구');
assert.strictEqual(jp.post, "담당업무\n전투 시스템 개발 & 유지보수\nUnity 3년 이상\nC#\n우대: 서버 경험'");   // 머리말과 꾸밈은 빼고 줄만 남긴다
jp = N.parseJobPage(PAGE.replace('2026.12.05', '채용시 마감'), '<html><body><img src="a.png"><img src="b.png"></body></html>');
assert.deepStrictEqual([jp.d, jp.post], [null, '']);                              // 날짜가 아니면 비운다. 그림뿐인 본문에는 글이 없다
jp = N.parseJobPage('<html><title>제목만 있는 페이지</title></html>', '');
assert.deepStrictEqual([jp.n, jp.role, jp.memo], ['', '제목만 있는 페이지', '']);
assert.strictEqual(N.parseJobPage(PAGE, '<p>' + '가'.repeat(30000) + '</p>').post.length, 12000);    // 너무 긴 본문은 자른다
assert.deepStrictEqual(N.parseJobPage(PAGE, BODY).info, { '경력': '3년 이상', '모집분야': '게임개발(클라이언트), 게임개발(모바일)', '마감일': '2026.12.05', '근무지역': '서울 > 서초구' });
// 목록 페이지: 공고 한 줄마다 번호, 회사, 제목, 직무, 플랫폼, 근무지, 마감 표시를 뽑는다. 같은 공고가 두 번 나오면 한 번만
const ROW = (no, title, co, duty, plat, area, dday) => '<li><div class="company"><strong>' + co + '</strong></div><div class="description">' +
  '<a href="/Recruit/GI_Read/View?GI_No=' + no + '" onclick="GA_Application_Prdt(\'02_공고클릭\', \'Y\', \'' + title + '\', \'' + no + '\', \'' + co + '\', \'어느 채용관\', ' +
  'IsNullOrWhiteSpace(\'' + duty + '\'), IsNullOrWhiteSpace(\'' + plat + '\'), \'없음\', IsNullOrWhiteSpace(\'' + area + '\'));" target="_blank">' + title.slice(0, 8) + '...</a>' +
  (dday == null ? '' : ' <span class="dday">' + dday + '</span>') + '</div></li>';
const LIST = ROW(11, '[경력] Unity 클라이언트 프로그래머', '㈜어느게임즈', '게임개발(클라이언트), 게임개발(모바일)', '모바일게임', '서울 &gt; 서초구, ', '채용시') +
  ROW(12, '언리얼 엔진 프로그래머', '다른스튜디오', '게임개발(클라이언트)', '', '경기 &gt; 성남시 분당구, ', 'D-3') + ROW(11, '[경력] Unity 클라이언트 프로그래머', '㈜어느게임즈', 'x', 'x', 'x', '채용시') +
  ROW(13, '마감 표시 없는 공고', '셋째회사', '', '', '', null);
assert.deepStrictEqual(N.parseJobList(LIST), [
  { no: '11', n: '㈜어느게임즈', role: '[경력] Unity 클라이언트 프로그래머', duty: '게임개발(클라이언트), 게임개발(모바일)', plat: '모바일게임', area: '서울 > 서초구', end: '채용시' },
  { no: '12', n: '다른스튜디오', role: '언리얼 엔진 프로그래머', duty: '게임개발(클라이언트)', plat: '', area: '경기 > 성남시 분당구', end: 'D-3' },
  { no: '13', n: '셋째회사', role: '마감 표시 없는 공고', duty: '', plat: '', area: '', end: '' }]);
assert.deepStrictEqual(N.parseJobList('<html>공고 없음</html>'), []);
// 본문에 넣은 그림의 주소를 뽑는다. https만, 겹친 것은 한 번만, 네 장까지
assert.deepStrictEqual(N.jobImages('<img src="https://a.example/1.jpg" alt="x"><IMG class="k" src=\'//b.example/2.png\'><img src="http://c.example/3.jpg"><img src="https://a.example/1.jpg"><img src="/rel.png">'),
  ['https://a.example/1.jpg', 'https://b.example/2.png']);
assert.strictEqual(N.jobImages([1, 2, 3, 4, 5, 6].map(i => '<img src="https://a.example/' + i + '.jpg">').join('')).length, 4);
assert.deepStrictEqual(N.jobImages(''), []);

/* ── 볼트 목록 만들기(PC 프로그램): 노트 글에서 프로젝트, 시스템, 날짜, 요약, 그림 위치를 뽑는다 ── */
const { describe } = require('../tools/sync-vault.js');
const IMGS = { '구조.svg': 'entities/게임/저장/Docs/구조.svg', '화면.png': 'entities/게임/저장/화면.png' };
let nt = describe('entities/게임/저장/2026-11-20 게임 — 저장 순서 수정.md',
  '---\ntags:\n  - x\ndate: 2026-11-01\n---\n# 저장 순서 수정\n관련: [[다른 노트]]\n![[구조.svg]]\n\n저장이 뒤바뀌던 것을 고쳤다.\n\n## 원인\n글\n## 수정\n![[화면.png|400]]\n![[없는 그림.png]]\n![[구조.svg]]\n', IMGS);
assert.deepStrictEqual([nt.p, nt.s, nt.t, nt.d], ['게임', '저장', '저장 순서 수정', '2026-11-20']);   // 날짜는 파일 이름이 먼저다
assert.strictEqual(nt.sum, '저장이 뒤바뀌던 것을 고쳤다.');
assert.deepStrictEqual(nt.heads, ['원인', '수정']);
assert.deepStrictEqual(nt.imgs, ['entities/게임/저장/Docs/구조.svg', 'entities/게임/저장/화면.png']);     // 못 찾은 그림과 겹친 그림은 뺀다
nt = describe('career/2026-10-01 게임 — 종료 멈춤.md', '---\nproject: 게임\n---\n한 줄 요약이다.\n\n## Problem\n', {});
assert.deepStrictEqual([nt.p, nt.s, nt.t, nt.d, nt.sum], ['게임', 'career', '종료 멈춤', '2026-10-01', '한 줄 요약이다.']);
// 전체 경로로 적은 그림은 이름이 같은 다른 그림이 아니라 그 파일을 잡는다
nt = describe('entities/게임/시험/2026-11-25 시험.md', '![[entities/게임/시험/가/01_a.png]]\n', { '01_a.png': 'entities/게임/시험/나/01_a.png', 'entities/게임/시험/가/01_a.png': 'entities/게임/시험/가/01_a.png' });
assert.deepStrictEqual(nt.imgs, ['entities/게임/시험/가/01_a.png']);
// 문서 탭: 링크 이름 뽑기와 경로 풀기
const { wikiRefs, resolver } = require('../tools/sync-vault.js');
assert.deepStrictEqual(wikiRefs('[[가]] [[나|별칭]] ![[그림.png|300]] [[다#절]] [[가]] [[라^블록]] `[[코드]]`'), ['가', '나', '그림.png', '다', '라', '코드']);
const rs = resolver(['entities/게임/가.md', '가.md', 'entities/게임/Docs/그림.png', 'career/나.md']);
assert.deepStrictEqual(['가', 'entities/게임/가', '나', 'NA'.toLowerCase(), '그림.png', '없는 것'].map(rs), ['가.md', 'entities/게임/가.md', 'career/나.md', null, 'entities/게임/Docs/그림.png', null]);
// 볼트 감시: 노트와 그림만, 데이터 폴더·숨김 폴더·graphify-out은 거른다(데이터 폴더를 안 거르면 목록을 쓸 때마다 다시 돈다)
const { skip } = require('../tools/watch-vault.js');
[['entities\\wpc\\a.md', false], ['entities\\wpc\\Diagrams\\56-x.svg', false], ['log.md', false], ['desk\\작업 목록.json', true], ['desk\\할 일.md', true],
  ['.obsidian\\workspace.json', true], ['entities\\.git\\x.md', true], ['graphify-out\\a.md', true], ['entities\\a.tmp', true]]
  .forEach(([n, want]) => assert.strictEqual(skip(n, 'desk'), want, n));
nt = describe('entities/도구/메모 (2026-09-02).md', '글\n', {});
assert.deepStrictEqual([nt.p, nt.s, nt.t, nt.d], ['도구', '', '메모 (2026-09-02)', '2026-09-02']);

console.log('note.test.js 통과');
