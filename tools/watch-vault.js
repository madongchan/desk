// 볼트가 바뀌면 바로 목록(작업 목록, 문서 목록)을 다시 만든다. 로그인할 때 켜져 계속 돈다(예약 작업 「desk 볼트 감시」).
// 2분마다 도는 예약 작업 「desk 작업 내역 갱신」은 감시가 놓친 것을 잡는 보조다.
// 화면은 목록 파일의 판(드라이브에서 고친 시각)만 물어 보고 바뀌었을 때 새로 받으므로, 여기서 바로 쓰면 곧 화면에 보인다.
//
// 실행: node tools/watch-vault.js <볼트 폴더> <작업 목록 파일> <훑을 폴더> [...]   (sync-vault.js와 같은 인자)
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const WANT = /\.(md|svg|png|jpe?g|gif|webp)$/i;

/**
 * 거르는 것: 데이터 폴더(목록을 쓰는 곳이라 안 거르면 쓸 때마다 다시 돈다), 점으로 시작하는 숨김 폴더(.obsidian의 화면 상태 등),
 * graphify-out(기계 데이터), 노트와 그림이 아닌 파일. name은 볼트 기준 경로(fs.watch가 주는 그대로).
 */
function skip(name, dataTop) {
  const parts = name.split(/[\\/]/);
  return parts[0] === dataTop || parts[0] === 'graphify-out' || parts.some(s => s.startsWith('.')) || !WANT.test(name);
}

function main() {
  const [vault, out, ...roots] = process.argv.slice(2);
  if (!vault || !out || !roots.length) { console.error('사용법: node tools/watch-vault.js <볼트 폴더> <작업 목록 파일> <훑을 폴더> ...'); process.exit(1); }
  const dataTop = path.relative(vault, path.dirname(out)).split(path.sep)[0];
  const log = s => console.log(new Date().toLocaleString('ko-KR') + ' ' + s);
  let timer = null, running = false, again = false;

  function run() {
    if (running) { again = true; return; }   // 도는 중에 또 바뀌면 끝나고 한 번 더
    running = true;
    execFile(process.execPath, [path.join(__dirname, 'sync-vault.js'), vault, out, ...roots], { windowsHide: true }, (err, stdout, stderr) => {
      running = false;
      log(err ? '목록 만들기 실패: ' + (stderr || err.message).trim() : stdout.trim());
      if (again) { again = false; run(); }
    });
  }

  function start() {
    // 로그인 직후에는 구글 드라이브(Z:)가 아직 안 붙었을 수 있다
    if (!fs.existsSync(vault)) { setTimeout(start, 30000); return; }
    const w = fs.watch(vault, { recursive: true }, (ev, name) => {
      if (!name || skip(name, dataTop)) return;
      clearTimeout(timer); timer = setTimeout(run, 3000);   // 3초 동안 모아서 한 번(옵시디언은 저장할 때 여러 번 쓴다)
    });
    w.on('error', e => { log('감시가 끊겼다: ' + e.message); try { w.close(); } catch (_) { /* 이미 닫혔다 */ } setTimeout(start, 30000); });
    log('감시 시작: ' + vault);
    run();
  }
  start();
}

if (require.main === module) main();
module.exports = { skip };
