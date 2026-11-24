// 옵시디언 볼트의 작업 노트를 훑어 「작업 목록.json」으로 적는다.
// 구글 서버가 폴더 수백 개를 매번 훑으면 느려서, PC가 목록을 만들어 두고 서버는 그 파일만 읽는다.
// 서버는 이 목록에 적힌 경로의 노트와 그림만 읽어 준다. 그래서 여기에 넣을 폴더가 곧 화면에 보일 범위다.
// 볼트는 읽기만 한다. 고친 시각과 크기가 그대로인 노트는 지난 목록의 내용을 다시 쓴다(드라이브에서 읽는 것이 느리다).
//
// 실행: node tools/sync-vault.js <볼트 폴더> <적을 파일> <훑을 폴더> [<훑을 폴더> ...]
//   예: node tools/sync-vault.js "Z:\볼트" "Z:\볼트\desk\작업 목록.json" entities career
const fs = require('node:fs');
const path = require('node:path');

const [vault, out, ...roots] = process.argv.slice(2);
const IMG = /\.(svg|png|jpe?g|gif|webp)$/i;
const SKIP = /(-MOC|_index|README|템플릿)\.md$/i;   // 색인과 양식은 작업이 아니다

/** 볼트 기준 경로(슬래시)로 파일을 모은다. */
function walk(rel, acc) {
  for (const e of fs.readdirSync(path.join(vault, rel), { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const r = rel + '/' + e.name;
    if (e.isDirectory()) walk(r, acc);
    else if (/\.md$/i.test(e.name) || IMG.test(e.name)) acc.push(r);
  }
  return acc;
}

/** 노트 글에서 목록에 적을 것을 뽑는다. 순수 함수라 점검에서 그대로 부른다. */
function describe(rel, text, imageByName) {
  const parts = rel.split('/'), file = parts[parts.length - 1].replace(/\.md$/i, '');
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text), head = fm ? fm[1] : '';
  const body = fm ? text.slice(fm[0].length) : text;
  const field = k => { const m = new RegExp('^' + k + ':\\s*(.+)$', 'm').exec(head); return m ? m[1].trim() : ''; };
  // 프로젝트: entities/<프로젝트>/<시스템>/... 는 폴더에서, 그 밖(경력 기록)은 머리말의 project에서
  const inEntities = parts[0] === 'entities';
  const p = inEntities ? parts[1] : (field('project') || parts[0]);
  const s = inEntities && parts.length > 3 ? parts[2] : (inEntities ? '' : parts[0]);
  const dated = /(\d{4}-\d{2}-\d{2})/.exec(file) || /(\d{4}-\d{2}-\d{2})/.exec(field('date') || field('created'));
  const t = file.replace(/^\d{4}-\d{2}-\d{2}\s+/, '').replace(new RegExp('^' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+—\\s+'), '');
  const lines = body.split(/\r?\n/);
  const sum = (lines.find(l => l.trim() && !/^(#|!\[|관련:|---|\||>|```|- |\* )/.test(l.trim())) || '').trim();
  const imgs = [];
  for (const m of body.matchAll(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) {
    const hit = imageByName[m[1].trim().split('/').pop().toLowerCase()];
    if (hit && !imgs.includes(hit)) imgs.push(hit);
  }
  return {
    p, s, t, d: dated ? dated[1] : '', path: rel, sum: sum.length > 140 ? sum.slice(0, 140) + '…' : sum,
    heads: lines.filter(l => /^## /.test(l)).map(l => l.slice(3).trim()).slice(0, 12), imgs,
  };
}

if (require.main === module) {
  if (!vault || !out || !roots.length) {
    console.error('사용법: node tools/sync-vault.js <볼트 폴더> <적을 파일> <훑을 폴더> ...');
    process.exit(1);
  }
  let old = {};
  try { JSON.parse(fs.readFileSync(out, 'utf8')).notes.forEach(n => { old[n.path] = n; }); } catch (e) { /* 처음이거나 깨졌으면 전부 다시 읽는다 */ }
  const files = roots.flatMap(r => walk(r, []));
  const imageByName = {};
  files.filter(f => IMG.test(f)).forEach(f => { imageByName[f.split('/').pop().toLowerCase()] = f; });
  let read = 0;
  const notes = files.filter(f => /\.md$/i.test(f) && !SKIP.test(f)).map(rel => {
    const st = fs.statSync(path.join(vault, rel)), m = Math.floor(st.mtimeMs), prev = old[rel];
    // 그림이 새로 생겼을 수 있으니, 지난번에 못 찾은 그림이 없던 노트만 다시 쓴다
    if (prev && prev.m === m && prev.z === st.size && prev.imgs.every(i => files.includes(i))) return prev;
    read++;
    const n = describe(rel, fs.readFileSync(path.join(vault, rel), 'utf8'), imageByName);
    if (!n.d) n.d = new Date(st.mtimeMs + 9 * 3600e3).toISOString().slice(0, 10);   // 날짜가 없으면 고친 날(서울)
    return Object.assign(n, { m, z: st.size });
  }).sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : a.path < b.path ? -1 : 1));
  fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), notes }));
  console.log(`작업 목록 ${notes.length}건(새로 읽은 것 ${read}건)을 적었다: ${out}`);
}

module.exports = { describe };
