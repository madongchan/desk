// 개발용 서버. 화면(index.html)과 서버 코드(Code.gs)를 PC에서 붙여 본다.
// 실행: node test/dev-server.js [노트를 둘 폴더]   →  http://localhost:5173
// 구글 드라이브 대신 디스크 폴더에 노트를 쓰고, 캘린더는 가짜 일정 두 개를 준다.
// 화면의 연결 주소 칸에는 /api, 비밀번호 칸에는 아래 DEV_PASS를 넣는다. 실제 배포와 무관한 시험용 값이다.
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { diskFolder, makeContext } = require('./fake-google');

const PORT = 5173;
const DEV_PASS = 'local-dev-only-password';
const ROOT = path.join(__dirname, '..');
const notes = process.argv[2] || path.join(os.tmpdir(), 'desk-dev-notes');
// 작업 기록 화면을 보려고 넣은 가짜 작업 로그
const devLog = '## 2026-11-23 저장 오류 수정\n저장 순서가 뒤바뀌던 것을 고쳤다. 점검 통과. 빌드에서는 확인하지 못했다.\n\n## 2026-11-24 설정 화면 정리\n글자가 겹치던 곳을 고쳤다. 색을 바꿀지 사용자 확인 대기.\n';
const g = makeContext(diskFolder(notes), { PASS: DEV_PASS, TODO_FOLDER: 'dev', LOG_FILE: 'dev-log' }, { 'dev-log': { getBlob: () => ({ getDataAsString: () => devLog }) } });
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'POST' && url.pathname === '/api') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(g.ctx.doPost({ postData: { contents: body } }).text);
    });
    return;
  }
  // 개발 중에는 서버 주소를 같은 곳의 /api로 돌린다(실제 config.js는 건드리지 않는다)
  if (url.pathname === '/config.js') {
    res.writeHead(200, { 'Content-Type': TYPES['.js'] });
    res.end('window.DESK = { url: "/api" };');
    return;
  }
  // 저장소 최상위의 화면 파일만 내준다. 하위 폴더와 숨김 파일은 주지 않는다
  const name = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  if (!/^[\w.-]+$/.test(name) || name.startsWith('.') || !TYPES[path.extname(name)]) { res.writeHead(404); res.end(); return; }
  fs.readFile(path.join(ROOT, name), (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(name)], 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(PORT, '127.0.0.1', () => console.log('http://localhost:' + PORT + '  노트 폴더: ' + notes));
