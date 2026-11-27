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
    // 볼트 기준 전체 경로로 적었으면 그 파일을, 이름만 적었으면 같은 이름의 그림을 찾는다(01_xxx.png처럼 이름이 겹치는 캡처가 있다)
    const ref = m[1].trim(), hit = imageByName[ref.toLowerCase()] || imageByName[ref.split('/').pop().toLowerCase()];
    if (hit && !imgs.includes(hit)) imgs.push(hit);
  }
  return {
    p, s, t, d: dated ? dated[1] : '', path: rel, sum: sum.length > 140 ? sum.slice(0, 140) + '…' : sum,
    heads: lines.filter(l => /^## /.test(l)).map(l => l.slice(3).trim()).slice(0, 12), imgs,
  };
}

/** 노트 글에서 [[링크]]와 ![[그림]]의 대상 이름을 뽑는다(#절, ^블록, |별칭은 뗀다). */
function wikiRefs(text) {
  return [...new Set([...text.matchAll(/!?\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]/g)].map(m => m[1].trim()).filter(Boolean))];
}

/** 대상 이름 → 볼트 경로. 전체 경로면 그 파일, 이름만이면 같은 이름 가운데 경로가 가장 짧은 것(옵시디언과 같다). */
function resolver(paths) {
  const by = {};
  const put = (k, p) => { if (!by[k] || by[k].length > p.length) by[k] = p; };
  paths.forEach(p => {
    const full = p.toLowerCase(), name = full.split('/').pop();
    put(full, p); put(name, p);
    if (/\.md$/.test(full)) { put(full.slice(0, -3), p); put(name.slice(0, -3), p); }
  });
  return n => by[n.toLowerCase()] || null;
}

/** 문서 탭: 볼트 전체를 훑는다. 데이터 폴더(skipTop), graphify-out, 점으로 시작하는 숨김 폴더는 뺀다. */
function walkDocs(rel, skipTop, acc) {
  for (const e of fs.readdirSync(path.join(vault, rel), { withFileTypes: true })) {
    if (e.name.startsWith('.') || (!rel && (e.name === skipTop || e.name === 'graphify-out'))) continue;
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) walkDocs(r, skipTop, acc);
    else if (/\.md$/i.test(e.name) || IMG.test(e.name)) acc.push(r);
  }
  return acc;
}

/** 폴더를 훑은 뒤 읽기 전에 지워진 파일은 건너뛴다(볼트 감시가 지우는 도중에 돌릴 수 있다). 다른 오류는 그대로 낸다. */
function gone(fn) {
  try { return fn(); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}

/**
 * 내용이 바뀌었을 때만 쓴다(at은 마지막으로 바뀐 시각). 예약 작업이 2분마다 돌아도 드라이브에 같은 파일을 다시 올리지 않게.
 * 같은 데이터는 JSON.stringify 결과도 같다(키 순서를 이 프로그램이 정한다).
 */
function writeIfChanged(file, data) {
  let old = null;
  try { old = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { /* 없거나 깨졌으면 쓴다 */ }
  if (old) { delete old.at; if (JSON.stringify(old) === JSON.stringify(data)) return false; }
  fs.writeFileSync(file, JSON.stringify(Object.assign({ at: new Date().toISOString() }, data)));
  return true;
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
  files.filter(f => IMG.test(f)).forEach(f => { imageByName[f.split('/').pop().toLowerCase()] = f; imageByName[f.toLowerCase()] = f; });
  let read = 0;
  const notes = files.filter(f => /\.md$/i.test(f) && !SKIP.test(f)).map(rel => gone(() => {
    const st = fs.statSync(path.join(vault, rel)), m = Math.floor(st.mtimeMs), prev = old[rel];
    // 그림이 새로 생겼을 수 있으니, 지난번에 못 찾은 그림이 없던 노트만 다시 쓴다
    if (prev && prev.m === m && prev.z === st.size && prev.imgs.every(i => files.includes(i))) return prev;
    read++;
    const n = describe(rel, fs.readFileSync(path.join(vault, rel), 'utf8'), imageByName);
    if (!n.d) n.d = new Date(st.mtimeMs + 9 * 3600e3).toISOString().slice(0, 10);   // 날짜가 없으면 고친 날(서울)
    return Object.assign(n, { m, z: st.size });
  })).filter(Boolean).sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : a.path < b.path ? -1 : 1));
  // 그림 탭은 노트에 넣지 않은 그림까지 보여 준다. 서버는 이 목록에 있는 그림만 읽어 준다
  // 그림을 고친 시각(imgM). 화면은 이 값이 같으면 기기에 받아 둔 그림을 다시 쓰고, 다르면 새로 받는다
  const imgM = {};
  files.filter(f => IMG.test(f)).forEach(f => gone(() => { imgM[f] = Math.floor(fs.statSync(path.join(vault, f)).mtimeMs); }));
  const imgs = Object.keys(imgM).sort();
  const wrote = writeIfChanged(out, { notes, imgs, imgM });
  console.log(`작업 목록 ${notes.length}건, 그림 ${imgs.length}장(새로 읽은 노트 ${read}건): ${wrote ? '바뀌어 적었다' : '그대로라 안 적었다'}`);

  // 문서 탭: 볼트 전체의 노트와 노트끼리의 링크. 「문서 목록.json」을 작업 목록 옆에 적는다
  const docOut = path.join(path.dirname(out), '문서 목록.json');
  const dataTop = path.relative(vault, path.dirname(out)).split(path.sep)[0];   // 데이터 폴더(desk)는 문서 탭에 내놓지 않는다
  let oldDocs = {};
  try { JSON.parse(fs.readFileSync(docOut, 'utf8')).docs.forEach(d => { oldDocs[d.path] = d; }); } catch (e) { /* 처음이면 전부 읽는다 */ }
  const everything = walkDocs('', dataTop, []), resolve = resolver(everything);
  let dread = 0;
  const docs = everything.filter(f => /\.md$/i.test(f)).sort().map(rel => gone(() => {
    const st = fs.statSync(path.join(vault, rel)), m = Math.floor(st.mtimeMs), prev = oldDocs[rel];
    // 글이 그대로면 지난번에 뽑은 이름(refs)을 다시 쓰고, 경로 풀기만 새로 한다(그 사이 생긴 노트를 가리킬 수 있다)
    const refs = prev && prev.m === m && prev.z === st.size && prev.refs ? prev.refs : (dread++, wikiRefs(fs.readFileSync(path.join(vault, rel), 'utf8')));
    const hit = [...new Set(refs.map(resolve).filter(Boolean))];
    return { path: rel, m, z: st.size, refs, links: hit.filter(p => /\.md$/i.test(p) && p !== rel), imgs: hit.filter(p => IMG.test(p)) };
  })).filter(Boolean);
  const dwrote = writeIfChanged(docOut, { docs });
  console.log(`문서 목록 ${docs.length}건(새로 읽은 노트 ${dread}건): ${dwrote ? '바뀌어 적었다' : '그대로라 안 적었다'}`);
}

module.exports = { describe, wikiRefs, resolver };
