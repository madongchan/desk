// PC의 깃 저장소에서 내가 올린 커밋을 뽑아 볼트의 「작업 내역.md」로 적는다.
// 구글 서버는 PC의 깃을 볼 수 없어서, PC가 대신 적어 두면 서버가 그 파일을 읽는다.
// 저장소는 읽기만 한다(git log). 파일은 매번 통째로 다시 쓰므로 여러 번 돌려도 결과가 같다.
//
// 실행: node tools/sync-git.js <적을 파일> <이름표>=<저장소 폴더> [<이름표>=<저장소 폴더> ...] [--days=400]
//   예: node tools/sync-git.js "Z:\볼트\desk\작업 내역.md" 게임=C:\Project\game
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const args = process.argv.slice(2);
const days = +((args.find(a => a.startsWith('--days=')) || '--days=400').slice(7));
const [out, ...repos] = args.filter(a => !a.startsWith('--'));
if (!out || !repos.length || !(days > 0)) {
  console.error('사용법: node tools/sync-git.js <적을 파일> <이름표>=<저장소 폴더> ... [--days=400]');
  process.exit(1);
}

const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const rows = [];
for (const r of repos) {
  const at = r.indexOf('='), label = r.slice(0, at).trim(), dir = r.slice(at + 1);
  if (at < 1 || /\s|\|/.test(label)) throw new Error('이름표=저장소 폴더 모양이 아니거나 이름표에 빈칸이 있습니다: ' + r);
  const me = git(dir, 'config', 'user.email').trim();   // 그 저장소에서 내가 쓰는 메일로 내 커밋만 고른다
  if (!me) throw new Error('저장소에 user.email이 없습니다: ' + dir);
  git(dir, 'log', '--author=' + me, '--since=' + days + ' days ago', '--no-merges', '--date=short', '--format=%ad%x09%h%x09%s')
    .split('\n').filter(Boolean).forEach(line => {
      const [d, hash, ...subject] = line.split('\t');
      rows.push(`- ${d} ${hash} ${label} | ${subject.join(' ').trim()}`);
    });
}
rows.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));   // 날짜가 줄 맨 앞이라 글자순이 곧 최근순이다

const head = '# 작업 내역\n\n이 파일은 PC의 깃 기록에서 자동으로 만든다(desk의 tools/sync-git.js). 손으로 고쳐도 다음 실행 때 덮어쓴다.\n\n';
fs.writeFileSync(out, head + rows.join('\n') + '\n');
console.log(`작업 내역 ${rows.length}건을 적었다: ${out}`);
