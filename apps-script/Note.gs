/**
 * 노트 글자 다루기. 구글 서비스를 쓰지 않아 PC(Node)에서도 돈다.
 *
 * 한 건은 항목 줄 하나와 그 아래 들여쓴 줄들이다. 옵시디언에서 그대로 읽힌다.
 *
 *   - [ ] 설정 화면 글자 겹침 고치기 ^k3x9a2
 *       날짜:: 2026-11-25
 *       상태:: 진행 중
 *       손으로 쓴 메모 줄은 건드리지 않고 그대로 둔다
 *
 * 서버는 번호(^...)로 건을 찾아 바뀐 항목의 줄만 고친다. 나머지 줄은 읽은 그대로 돌려준다.
 */

// 종류별 파일과 항목 이름(화면이 쓰는 짧은 이름 → 노트에 적는 이름). 여기 없는 이름은 받지 않는다
const KINDS = {
  tasks: { file: '할 일.md', check: true,
    keys: { d: '날짜', s: '상태', p: '프로젝트', y: '유형', r: '우선순위', c: '분류', k: '핵심업무', star: '포트폴리오', detail: '세부', note: '비고', out: '성과', fin: '완료일' } },
  memo: { file: '메모.md', check: false,
    keys: { k: '종류', pin: '고정', st: '상태', at: '작성' } },
};
const DONE = '완료', TODO = '시작 전';
const MAX_TEXT = 20000;

const ITEM_RE = /^- \[(.)\]( .*)?$/;
// 옵시디언 블록 번호 모양 전부를 번호로 본다(서버가 만드는 것은 6글자지만 손으로 쓴 ^a1도 받아들인다)
const ID_RE = / \^([A-Za-z0-9-]+)\s*$/;
const INDENT_RE = /^(\t| {4})\s*\S/;
const FIELD_RE = /^(?:\t| {4})([^:\s][^:]*):: ?(.*)$/;
// 줄을 끊는 글자들. \u2028, \u2029는 웹에서 복사할 때 딸려 오는 보이지 않는 줄 구분 문자다
const BREAK_RE = /[\r\n\u2028\u2029]+/g;
const NOT_FOUND = '항목을 찾을 수 없습니다';
const has_ = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };

function kind_(kind) {
  if (!has_(KINDS, kind)) throw new Error('알 수 없는 종류입니다: ' + kind);
  return KINDS[kind];
}

/**
 * 글을 줄 배열로 쪼갠다. 줄바꿈 종류와 파일 맨 앞 표식 글자(BOM)를 기억해 쓸 때 그대로 쓴다.
 * 두 가지 줄바꿈이 섞인 파일도 줄 단위로 읽는다(쓸 때는 많이 쓰인 쪽 하나로 맞춘다).
 */
function splitLines_(text) {
  const bom = text.charAt(0) === '\uFEFF' ? '\uFEFF' : '';
  const body = bom ? text.slice(1) : text;
  const eol = body.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
  return { lines: body.split(/\r?\n/), eol: eol, bom: bom };
}

function join_(s) { return s.bom + s.lines.join(s.eol); }

/** 줄 배열에서 건을 찾는다. start는 항목 줄, end는 딸린 줄이 끝난 다음 줄 번호다. */
function scan_(lines) {
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    const m = ITEM_RE.exec(lines[i]);
    if (!m) continue;
    let rest = m[2] || '', id = '';
    const idM = ID_RE.exec(rest);
    if (idM) { id = idM[1]; rest = rest.slice(0, idM.index); }
    // 쓰다 만 빈 체크 줄은 건이 아니다. 건드리지 않고 지나간다
    if (!rest.trim()) continue;
    let end = i + 1;
    while (end < lines.length && INDENT_RE.test(lines[end])) end++;
    found.push({ id: id, mark: m[1], title: rest.trim(), start: i, end: end });
    i = end - 1;
  }
  return found;
}

/** 값을 한 줄 글자로. 글자는 되도록 그대로 적고, 그대로 적으면 다르게 읽힐 것만 따옴표로 감싼다. */
function encode_(v) {
  if (typeof v !== 'string') return String(JSON.stringify(v));
  const plain = !/[\r\n\u2028\u2029]/.test(v) && v === v.trim() && v !== 'true' && v !== 'false' && v.charAt(0) !== '"';
  return plain ? v : JSON.stringify(v).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/**
 * 노트의 값 글자를 읽는다. 서버가 따옴표로 감싸 쓴 것과 true, false만 풀고, 나머지는 글자 그대로 둔다.
 * 손으로 쓴 2048이나 "인용"이 숫자로 바뀌거나 따옴표가 벗겨지지 않는다.
 */
function decode_(s) {
  try {
    const v = JSON.parse(s);
    if ((typeof v === 'string' || typeof v === 'boolean') && encode_(v) === s) return v;
  } catch (e) {}
  return s;
}

const isDone_ = function (mark) { return mark === 'x' || mark === 'X'; };
const blank_ = function (v) { return v === null || v === undefined || v === '' || v === false; };

/**
 * 건의 딸린 줄에서 항목을 읽는다. fields는 값, at은 그 항목이 적힌 줄 번호다.
 * 같은 이름이 또 나오면 첫 줄만 항목으로 보고 나머지는 손으로 쓴 줄로 둔다.
 */
function readBlock_(lines, f, K) {
  const byLabel = {};
  for (const key in K.keys) byLabel[K.keys[key]] = key;
  const fields = {}, at = {};
  for (let i = f.start + 1; i < f.end; i++) {
    const m = FIELD_RE.exec(lines[i]);
    const key = m && has_(byLabel, m[1].trim()) ? byLabel[m[1].trim()] : null;
    if (key && !has_(at, key)) { fields[key] = decode_(m[2]); at[key] = i; }
  }
  // 체크 표시가 완료 여부의 정본이다. 옵시디언에서 손으로 체크해도 완료로 읽힌다
  if (K.check) fields.s = isDone_(f.mark) ? DONE : (fields.s && fields.s !== DONE ? fields.s : TODO);
  return { fields: fields, at: at };
}

function fieldLine_(K, key, v) { return '    ' + K.keys[key] + ':: ' + encode_(v); }

/** 체크 종류에서 상태 줄을 따로 적지 않는 값인가(체크 표시가 대신 말한다). */
function impliedStatus_(K, key, v) { return K.check && key === 's' && (v === DONE || v === TODO); }

function itemLine_(mark, title, id) { return '- [' + mark + '] ' + title + (id ? ' ^' + id : ''); }

/** 화면이 보낸 항목을 검사한다. 모르는 이름과 엉뚱한 값은 노트에 닿기 전에 거절한다. */
function checkFields_(K, fields) {
  Object.keys(fields || {}).forEach(function (key) {
    if (key !== 't' && !has_(K.keys, key)) throw new Error('알 수 없는 항목입니다: ' + key);
    const v = fields[key];
    const ok = v === null || typeof v === 'boolean' || (typeof v === 'number' && isFinite(v)) || (typeof v === 'string' && v.length <= MAX_TEXT);
    if (!ok) throw new Error('값 형식이 잘못되었습니다: ' + key);
  });
}

/** 제목으로 쓸 수 있게 다듬는다: 줄바꿈은 공백으로, 끝의 번호 모양은 뺀다. */
function cleanTitle(s) {
  return String(s == null ? '' : s).replace(BREAK_RE, ' ').replace(ID_RE, '').trim();
}

/** 화면에 주는 모양: { id, t, 그리고 종류의 항목 전부(없으면 null) }. */
function listRecords(text, kind) {
  const K = kind_(kind), s = splitLines_(text);
  return scan_(s.lines).map(function (f) {
    const b = readBlock_(s.lines, f, K), o = { id: f.id, t: f.title };
    for (const key in K.keys) o[key] = has_(b.fields, key) ? b.fields[key] : null;
    return o;
  });
}

/** 번호 없는 항목 줄에 makeId()로 번호를 붙인다. 같은 번호가 또 나오면(줄 복제) 뒤쪽에 새 번호를 준다. */
function ensureIds(text, makeId) {
  const s = splitLines_(text);
  const seen = Object.create(null);
  let changed = false;
  scan_(s.lines).forEach(function (f) {
    if (f.id && !seen[f.id]) { seen[f.id] = true; return; }
    const id = makeId();
    seen[id] = true;
    s.lines[f.start] = s.lines[f.start].replace(ID_RE, '').replace(/\s+$/, '') + ' ^' + id;
    changed = true;
  });
  return { text: changed ? join_(s) : text, changed: changed };
}

/** 파일 끝에 한 건을 붙인다. fields.t가 제목이다. */
function addRecord(text, kind, fields, id) {
  const K = kind_(kind);
  checkFields_(K, fields);
  const title = cleanTitle(fields && fields.t);
  if (!title) throw new Error('제목이 비었습니다');
  const eol = splitLines_(text).eol;
  const block = [itemLine_(K.check && fields.s === DONE ? 'x' : ' ', title, id)];
  for (const key in K.keys) {
    if (!blank_(fields[key]) && !impliedStatus_(K, key, fields[key])) block.push(fieldLine_(K, key, fields[key]));
  }
  return text + (text && !/\n$/.test(text) ? eol : '') + block.join(eol) + eol;
}

/**
 * 보낸 항목의 줄만 제자리에서 고친다. 안 보낸 항목 줄, 손으로 쓴 메모 줄, 줄 순서는 그대로다.
 * 새로 생기는 항목은 마지막 항목 줄 뒤(없으면 항목 줄 바로 아래)에 붙는다.
 */
function updateRecord(text, kind, id, fields) {
  const K = kind_(kind);
  checkFields_(K, fields);
  const s = splitLines_(text);
  const f = find_(s.lines, id);
  const b = readBlock_(s.lines, f, K);
  const drop = [], append = [];
  let mark = f.mark, title = f.title;

  Object.keys(fields).forEach(function (key) {
    const v = fields[key];
    if (key === 't') {
      title = cleanTitle(v);
      if (!title) throw new Error('제목이 비었습니다');
      return;
    }
    // 완료 여부가 실제로 바뀔 때만 체크 표시를 새로 쓴다. 손으로 쓴 [X], [-]는 무관한 수정에 그대로 남는다
    if (K.check && key === 's' && (v === DONE) !== isDone_(mark)) mark = v === DONE ? 'x' : ' ';
    const gone = blank_(v) || impliedStatus_(K, key, v);
    if (has_(b.at, key)) {
      if (gone) drop.push(b.at[key]); else s.lines[b.at[key]] = fieldLine_(K, key, v);
    } else if (!gone) append.push(fieldLine_(K, key, v));
  });

  s.lines[f.start] = itemLine_(mark, title, f.id);
  let last = f.start;
  for (const key in b.at) if (drop.indexOf(b.at[key]) < 0 && b.at[key] > last) last = b.at[key];
  Array.prototype.splice.apply(s.lines, [last + 1, 0].concat(append));
  // 뒤에서부터 빼야 앞 줄 번호가 안 밀린다. last 뒤에 붙인 줄 수만큼 뒤쪽 번호를 옮긴다
  drop.sort(function (x, y) { return y - x; }).forEach(function (i) { s.lines.splice(i > last ? i + append.length : i, 1); });
  return join_(s);
}

/** 한 건을 통째로 꺼낸다(휴지통으로 옮길 때). block은 꺼낸 줄들이다. */
function takeRecord(text, id) {
  const s = splitLines_(text);
  const f = find_(s.lines, id);
  const block = s.lines.splice(f.start, f.end - f.start);
  return { text: join_(s), block: block.join(s.eol) + s.eol };
}

function find_(lines, id) {
  const hit = id ? scan_(lines).filter(function (f) { return f.id === id; })[0] : null;
  if (!hit) throw new Error(NOT_FOUND);
  return hit;
}

if (typeof module !== 'undefined') {
  module.exports = {
    KINDS: KINDS, listRecords: listRecords, ensureIds: ensureIds, addRecord: addRecord,
    updateRecord: updateRecord, takeRecord: takeRecord, cleanTitle: cleanTitle,
  };
}
