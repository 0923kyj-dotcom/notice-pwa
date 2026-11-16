'use strict';
/* 공지 마감 알리미 (시연판) — 바닐라 JS, 외부 요청 없음.
   데이터는 같은 출처의 ./data/notices.json 만 읽는다. */

// ====== 날짜 유틸 (UTC 일수, source/dashboard.html 에서 옮김) ======
function dn(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return NaN;
  const [y, m, d] = s.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d), x = new Date(t);
  if (x.getUTCFullYear() !== y || x.getUTCMonth() !== m - 1 || x.getUTCDate() !== d) return NaN;
  return t / 864e5;
}
function ds(n) { return new Date(n * 864e5).toISOString().slice(0, 10); }
function dow(n) { return new Date(n * 864e5).getUTCDay(); } // 0=일
function mon(n) { return n - ((dow(n) + 6) % 7); }           // 그 주 월요일
const WD = '일월화수목금토';
function fmtD(n) { const s = ds(n); return `${+s.slice(5, 7)}/${+s.slice(8)}(${WD[dow(n)]})`; }
// 주는 월요일 시작, 그 주 목요일이 속한 달로 "○월 ○째 주"를 정한다
const ORD = ['첫째', '둘째', '셋째', '넷째', '다섯째'];
function weekLabel(w) {
  const th = ds(w + 3);
  return `${+th.slice(5, 7)}월 ${ORD[Math.ceil(+th.slice(8) / 7) - 1]} 주`;
}

// ====== 대시보드에서 옮긴 상수 ======
const BIZ_NAME = {
  '주거안정장학금지급요청서제출안내': '주거안정장학금 지급요청서', '주거안정장학금학생신청안내': '주거안정장학금 신청',
  '국가장학금신청일정및신청매뉴얼안내': '국가장학금 신청', '대학생청소년교육지원장학금출근부제출안내': '청소년교육지원장학 출근부',
  '국가근로출근부제출안내': '국가근로 출근부', '기말강의평가안내': '기말 강의평가', '중간강의평가안내': '중간 강의평가',
  '신편입학생교내교직장학선발안내': '신·편입 교내교직장학', '신편입학생보훈장학선발안내': '신·편입 보훈장학',
  '일반부복수전공신청및취소안내': '부·복수전공 신청', '학원교직장학신청안내': '학원교직장학', '청대가족장학신청안내': '청대가족장학',
  '융복합전공전공트랙신청및취소안내': '융복합전공·전공트랙 신청', '국가근로장학사업희망근로지신청안내': '국가근로 희망근로지 신청',
  '재학생등록금추가납부안내': '등록금 추가 납부',
};
// 주별 혼잡도 색 구간: 1~5 여유, 6~10 보통, 11 이상 혼잡
const HEAT = { mid: 6, high: 11 };
const HEAT_LABEL = { ok: '여유', mid: '보통', high: '혼잡' };
const heatOf = c => c >= HEAT.high ? 'high' : c >= HEAT.mid ? 'mid' : 'ok';
const COV_MIN = 0.8;

// ====== 공통 ======
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ====== 설정 (기기 localStorage 에만 저장) ======
const LS_KEY = 'mgam.settings.v1';
const DEFAULT_BASE = '2026-03-16';
const PRESETS = [
  { v: '2026-03-16', label: '가장 몰린 주' },
  { v: '2026-09-07', label: '2학기 혼잡 주' },
  { v: 'today', label: '실제 오늘' },
];
const CATS = [
  { v: 'all', label: '전체' },
  { v: '장학·대출', label: '장학·대출' },
  { v: '학사', label: '학사' },
];
const TABS = ['home', 'cal', 'rep', 'find'];

const state = { base: DEFAULT_BASE, cat: 'all', tab: 'home' };

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    if (s.base === 'today' || !isNaN(dn(s.base))) state.base = s.base;
    if (CATS.some(c => c.v === s.cat)) state.cat = s.cat;
  } catch (e) { /* 저장소를 못 쓰면 기본값 */ }
}
function saveSettings() {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ base: state.base, cat: state.cat })); } catch (e) { /* 무시 */ }
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const baseStr = () => state.base === 'today' ? todayStr() : state.base;
const baseN = () => dn(baseStr());

// ====== 데이터 ======
let META = null, COV = {}, ALL = [], BY_ID = new Map(), COLLECTED = NaN;

async function loadData() {
  const res = await fetch('./data/notices.json');
  if (!res.ok) throw new Error('data ' + res.status);
  const j = await res.json();
  META = j.meta; COV = j.coverage;
  COLLECTED = dn(META.collected);
  ALL = j.notices.map(o => ({ ...o, p: dn(o.post), d: dn(o.dl) }));
  BY_ID = new Map(ALL.map(r => [r.id, r]));
}
// 관심 분야 필터를 적용한 공지
const rows = () => state.cat === 'all' ? ALL : ALL.filter(r => r.cat === state.cat);
// 기준일 시점 재현: 기준일까지 게시된 공지만 (홈·알림·배지·찾기의 다가오는 마감에 사용)
const shown = (b = baseN()) => rows().filter(r => r.p <= b);

// ====== 상단 띠 · 칩 ======
function renderBand() {
  const b = baseN();
  $('bandText').innerHTML = `시연 기준일 <b>${esc(ds(b))}(${WD[dow(b)]})</b> <span class="nw">· 비공식 시연판</span>`;
  const after = b > COLLECTED;
  $('bandWarn').hidden = !after;
  $('bandWarn').textContent = after ? '수집 이후 기간이라 일부만 표시' : '';
}
function renderChips() {
  $('chips').innerHTML = CATS.map(c =>
    `<button type="button" class="chip" role="radio" aria-checked="${c.v === state.cat}" data-cat="${esc(c.v)}">${esc(c.label)}</button>`
  ).join('');
}

// ====== 마감 계산 ======
const TIGHT = 7;                                   // 안내 기간 7일 이하면 '촉박'
const byUrgency = (a, b) => a.d - b.d || a.len - b.len || a.id.localeCompare(b.id);
// 이번 주: 기준일이 속한 주(월~일) 가운데 기준일 당일 이후 마감. 다음 주: 그다음 월~일
function weekSets(b = baseN(), list = shown(b)) {
  const w = mon(b);
  return {
    w,
    thisWeek: list.filter(r => r.d >= b && r.d <= w + 6).sort(byUrgency),
    nextWeek: list.filter(r => r.d >= w + 7 && r.d <= w + 13).sort(byUrgency),
  };
}
// 기준일 이후 마감이 가장 가까운 공지 (알림 시연용)
function mostUrgent(b = baseN(), list = shown(b)) {
  return list.filter(r => r.d >= b).sort(byUrgency)[0] || null;
}
function ddText(diff) {
  if (diff < 0) return '마감';
  if (diff === 0) return '오늘';
  if (diff === 1) return '내일';
  return 'D-' + diff;
}
function ddChip(r, b = baseN()) {
  const diff = r.d - b;
  const cls = diff < 0 ? 'past' : diff <= 1 ? 'red' : diff <= 3 ? 'orange' : '';
  return `<span class="dd ${cls}">${ddText(diff)}</span>`;
}
const tightTag = r => r.len <= TIGHT ? '<span class="tag-tight">촉박</span>' : '';
const fmtFull = n => { const s = ds(n); return `${s.slice(0, 4)}.${+s.slice(5, 7)}.${+s.slice(8)}(${WD[dow(n)]})`; };

function itemHTML(r, b) {
  return `<li><button type="button" class="item" data-id="${esc(r.id)}">
    ${ddChip(r, b)}
    <span class="it-main"><span class="it-title">${esc(r.title)}</span>
    <span class="it-meta">${ds(r.d).slice(0, 4) !== ds(b).slice(0, 4) ? ds(r.d).slice(0, 4) + '. ' : ''}${fmtD(r.d)} 마감 · 게시~마감 ${r.len}일 ${tightTag(r)}</span></span></button></li>`;
}
function groupByDate(list, b) {
  const g = new Map();
  list.forEach(r => { if (!g.has(r.d)) g.set(r.d, []); g.get(r.d).push(r); });
  return [...g].map(([d, rs]) => `<h4 class="date-h">${fmtD(d)} <small>${rs.length}건</small></h4>
    <ul class="list">${rs.map(r => itemHTML(r, b)).join('')}</ul>`).join('');
}

// ====== 화면 ======
let homeExpanded = false;
const VIEWS = {
  home(el) {
    const b = baseN();
    const { w, thisWeek, nextWeek } = weekSets(b);
    const top = thisWeek.slice(0, 3);
    el.innerHTML = `
      <article class="card week" aria-label="이번 주 마감">
        <p class="wk-label">${esc(weekLabel(w))} · ${fmtD(w)}~${fmtD(w + 6)}</p>
        <p class="big">이번 주 마감 <strong>${thisWeek.length}</strong>건</p>
        <p class="sub">다음 주 ${nextWeek.length}건 · 기준일까지 게시된 공지</p>
        ${top.length ? `<ul class="list urgent">${top.map(r => itemHTML(r, b)).join('')}</ul>`
                     : '<p class="empty">이번 주 남은 마감이 없습니다</p>'}
        ${thisWeek.length + nextWeek.length ? `<button type="button" class="more" id="moreBtn" aria-expanded="${homeExpanded}" aria-controls="weekAll">
          ${homeExpanded ? '접기' : '전체 보기'}</button>` : ''}
      </article>
      <div class="week-all" id="weekAll" ${homeExpanded ? '' : 'hidden'}>
        <h3>이번 주 <small>${thisWeek.length}건</small></h3>
        ${thisWeek.length ? groupByDate(thisWeek, b) : '<p class="empty">없음</p>'}
        <h3>다음 주 <small>${nextWeek.length}건 · ${fmtD(w + 7)}~${fmtD(w + 13)}</small></h3>
        ${nextWeek.length ? groupByDate(nextWeek, b) : '<p class="empty">없음</p>'}
      </div>
      <div class="actions">
        <button type="button" class="btn-primary" id="notifyBtn">🔔 알림 시연</button>
        <button type="button" class="btn-sec" id="notifyLaterBtn">10초 뒤 알림</button>
      </div>
      <button type="button" class="btn-sec wide" id="installBtn" hidden>홈 화면에 추가</button>`;
  },
  cal(el) { renderCal(el); },
  rep(el) { renderRep(el); },
  find(el) { renderFind(el); },
};

// ====== 달력: 행=월, 열=1~5주, 칸=건수와 혼잡 색 ======
const coverage = w => { const v = COV[ds(w)]; return v == null ? 1 : v; };
let calSel = null;                                  // { base, w } 기준일이 바뀌면 기준 주로 돌아간다
function renderCal(el) {
  const b = baseN(), bw = mon(b), list = rows();
  if (!calSel || calSel.base !== b) calSel = { base: b, w: bw };
  const cnt = new Map();
  list.forEach(r => { const w = mon(r.d); cnt.set(w, (cnt.get(w) || 0) + 1); });
  // 주 축은 필터와 상관없이 전체 데이터 범위로 고정한다
  const all = ALL.map(r => mon(r.d)), lo = Math.min(...all), hi = Math.max(...all);
  const byM = new Map();
  for (let w = lo; w <= hi; w += 7) {
    const th = ds(w + 3), m = th.slice(0, 7);
    if (!byM.has(m)) byM.set(m, Array(5).fill(null));
    byM.get(m)[Math.ceil(+th.slice(8) / 7) - 1] = w;
  }
  const head = `<div class="cal-r cal-h"><span></span>${[1, 2, 3, 4, 5].map(i => `<span>${i}주</span>`).join('')}</div>`;
  const body = [...byM].map(([m, ws]) => `<div class="cal-r"><span class="cal-m">${m.slice(2).replace('-', '.')}</span>${ws.map(w => {
    if (w == null) return '<span class="cal-c none"></span>';
    const c = cnt.get(w) || 0, part = coverage(w) < COV_MIN;
    const cls = [c ? 'h-' + heatOf(c) : 'zero', part ? 'part' : '', w === bw ? 'base' : ''].join(' ');
    const lbl = `${weekLabel(w)} ${c}건${c ? ' ' + HEAT_LABEL[heatOf(c)] : ''}${part ? ', 일부만 집계' : ''}${w === bw ? ', 기준 주' : ''}`;
    return `<button type="button" class="cal-c ${cls}" data-w="${w}" aria-pressed="${w === calSel.w}" aria-label="${lbl}">
      <b>${c || ''}</b>${part ? '<small>일부</small>' : ''}</button>`;
  }).join('')}</div>`).join('');

  const w = calSel.w;
  const wl = list.filter(r => mon(r.d) === w).sort(byUrgency);
  el.innerHTML = `
    <div class="card cal-card">
      <div class="cal" role="group" aria-label="주별 마감 건수">${head}${body}</div>
      <p class="legend">
        <span><i class="sw h-ok"></i>1~5 여유</span><span><i class="sw h-mid"></i>6~10 보통</span>
        <span><i class="sw h-high"></i>11+ 혼잡</span><span><i class="sw part"></i>일부만 집계</span>
        <span><i class="sw base"></i>기준 주</span></p>
      <p class="legend">전체 기간 자료입니다 (기준일 이후 게시 공지 포함)</p>
    </div>
    <h3 class="sec-h">${esc(weekLabel(w))} <small>${fmtD(w)}~${fmtD(w + 6)} · ${wl.length}건${coverage(w) < COV_MIN ? ' · 일부만 집계' : ''}</small></h3>
    ${wl.length ? `<ul class="list card-list">${wl.map(r => itemHTML(r, b)).join('')}</ul>` : '<p class="empty">마감 공지 없음</p>'}`;
}
document.addEventListener('click', e => {
  const c = e.target.closest('.cal-c[data-w]');
  if (!c) return;
  calSel = { base: baseN(), w: +c.dataset.w };
  renderView();
  document.querySelector('#v-cal .sec-h')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// ====== 반복 공지: 사업마다 게시일~마감일 막대 ======
function renderRep(el) {
  const b = baseN(), list = rows();
  const groups = Object.keys(BIZ_NAME).map(k => {
    const g = list.filter(r => r.key === k).sort((x, y) => x.p - y.p);
    return g.length ? { name: BIZ_NAME[k], cat: g[0].cat, g, first: g[0].p } : null;
  }).filter(Boolean)
    .sort((x, y) => (x.cat === y.cat ? 0 : x.cat === '장학·대출' ? -1 : 1) || x.first - y.first);
  if (!groups.length) { el.innerHTML = '<p class="empty">이 분야의 반복 공지가 없습니다</p>'; return; }

  const lo = Math.min(...ALL.filter(r => BIZ_NAME[r.key]).map(r => r.p));
  const hi = Math.max(...ALL.filter(r => BIZ_NAME[r.key]).map(r => r.d), b);
  const ms = []; let [y, m] = ds(lo).split('-').map(Number);
  for (;;) { const d = dn(`${y}-${String(m).padStart(2, '0')}-01`); ms.push(d); if (d > hi) break; if (++m > 12) { m = 1; y++; } }
  const D0 = ms[0], D1 = ms[ms.length - 1], PX = 2.2;      // 하루 2.2px
  const RH = 44, TOP = 46, W = Math.round((D1 - D0) * PX) + 16, H = TOP + groups.length * RH + 6;
  const X = d => 8 + (d - D0) * PX;
  let s = '';
  ms.forEach((d, i) => {
    s += `<line x1="${X(d)}" x2="${X(d)}" y1="${TOP - 6}" y2="${H}" class="g-grid"/>`;
    if (i < ms.length - 1) s += `<text x="${(X(d) + X(ms[i + 1])) / 2}" y="${TOP - 10}" text-anchor="middle" class="g-ax">${ds(d).slice(2, 7).replace('-', '.')}</text>`;
  });
  let bars = 0;
  groups.forEach((o, i) => {
    const yc = TOP + i * RH + RH / 2;
    o.g.forEach(r => {
      bars++;
      const x = X(r.p), w = Math.max(X(r.d) - x, 3);
      s += `<g class="g-bar ${o.cat === '학사' ? 'c-hak' : 'c-jang'}" data-id="${esc(r.id)}" role="button" tabindex="0"
        aria-label="${esc(o.name)}, ${fmtFull(r.p)} 게시, ${fmtFull(r.d)} 마감">
        <rect class="hit" x="${(x + w / 2 - Math.max(w, 20) / 2).toFixed(1)}" y="${yc - RH / 2}" width="${Math.max(w, 20).toFixed(1)}" height="${RH}"/>
        <rect class="bar" x="${x.toFixed(1)}" y="${yc - 7}" width="${w.toFixed(1)}" height="14" rx="3"/></g>`;
    });
  });
  const bx = X(b);
  s += `<line x1="${bx}" x2="${bx}" y1="${TOP - 4}" y2="${H}" class="g-base"/>`;

  el.innerHTML = `
    <div class="card gantt-card">
      <div class="gantt">
        <ul class="g-names" style="padding-top:${TOP}px">${groups.map(o =>
          `<li style="height:${RH}px"><span>${esc(o.name)} <small>${o.g.length}회</small></span></li>`).join('')}</ul>
        <div class="g-scroll" id="gScroll" tabindex="0" aria-label="반복 공지 막대 그림, 가로로 스크롤">
          <svg viewBox="0 0 ${W} ${H}" style="width:${W}px;height:${H}px" role="img" aria-label="게시일부터 마감일까지 막대">${s}</svg>
          <span class="g-base-lbl" style="left:${bx}px">기준일 ${fmtD(b)}</span>
        </div>
      </div>
      <p class="legend"><span><i class="sw c-jang"></i>장학·대출</span><span><i class="sw c-hak"></i>학사</span>
        <span>막대 = 게시일~마감일</span><span>${groups.length}종 · ${bars}개</span></p>
    </div>`;
  // 기준일 세로선이 보이도록 가로 스크롤을 맞춘다
  const sc = $('gScroll');
  sc.scrollLeft = Math.max(0, bx - sc.clientWidth * 0.6);
}
document.addEventListener('keydown', e => {
  const g = e.target.closest && e.target.closest('.g-bar[data-id]');
  if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDetail(g.dataset.id); }
});

// ====== 찾기: 제목·부서 검색, 기준일 이후 마감이 가까운 순 (지난 공지는 뒤로) ======
let findQ = '';
function renderFind(el) {
  if (!$('findInput')) {
    el.innerHTML = `
      <label class="search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>
        <input type="search" id="findInput" placeholder="제목·부서 검색" autocomplete="off" enterkeyhint="search" aria-label="제목·부서 검색"></label>
      <p class="find-cap" id="findCap"></p>
      <ul class="list card-list" id="findList"></ul>`;
    $('findInput').value = findQ;
    $('findInput').addEventListener('input', e => { findQ = e.target.value; renderFindList(); });
  }
  renderFindList();
}
function renderFindList() {
  const b = baseN(), q = findQ.trim().toLowerCase().replace(/\s+/g, '');
  const hit = rows().filter(r => !q || (r.title + r.dept).toLowerCase().replace(/\s+/g, '').includes(q));
  const up = hit.filter(r => r.d >= b && r.p <= b).sort(byUrgency);
  const later = hit.filter(r => r.p > b).sort(byUrgency);
  const past = hit.filter(r => r.d < b).sort((x, y) => y.d - x.d || x.id.localeCompare(y.id));
  $('findCap').textContent = `${hit.length}건 · 다가오는 마감 ${up.length} · 지난 마감 ${past.length}${later.length ? ' · 기준일 이후 게시 ' + later.length : ''}`;
  $('findList').innerHTML = up.map(r => itemHTML(r, b)).join('')
    + (past.length ? `<li class="divider">지난 마감</li>` + past.map(r => itemHTML(r, b)).join('') : '')
    + (later.length ? `<li class="divider">기준일 이후 게시 (시연 기준일에는 아직 없던 공지)</li>` + later.map(r => itemHTML(r, b)).join('') : '')
    || '<li class="empty">검색 결과 없음</li>';
}

// ====== 정보 ======
function renderInfo() {
  const owner = { in: ALL.filter(r => r.owner === '교내').length, out: ALL.filter(r => r.owner === '외부').length };
  $('infoBody').innerHTML = `
    <ul class="info">
      <li><b>데이터</b> 청주대 공지(학사, 장학·대출) ${META.count}건 · 게시일 ${esc(META.period)} · 팀이 수기로 정리 (교내 마감 ${owner.in} · 외부 ${owner.out})</li>
      <li><b>시연판</b> 실제 학교 서비스가 아니며 실시간 공지를 받지 않습니다.</li>
      <li><b>확인</b> 마감일은 반드시 원문에서 확인하세요.</li>
      <li><b>평일 수</b> 공휴일은 반영하지 않았습니다.</li>
      <li><b>아이콘 숫자</b> 아이폰은 iOS 16.4+ 홈 화면 앱·알림 허용 시, PC는 Chrome·Edge 설치 앱에서 보입니다. 안드로이드는 알림이 있을 때 점으로 표시됩니다.</li>
    </ul>
    <p class="note">비공식 학생 프로젝트 · 시연판 · 설정은 이 기기에만 저장</p>`;
}

function renderView() {
  document.querySelectorAll('.view').forEach(v => { v.hidden = v.dataset.view !== state.tab; });
  document.querySelectorAll('.tabs a').forEach(a => {
    if (a.dataset.tab === state.tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  VIEWS[state.tab]($('v-' + state.tab));
  if (state.tab === 'home' && typeof syncInstallBtn === 'function') syncInstallBtn();
}

// 기준일·필터가 바뀌면 함께 갱신할 것들 (배지 등은 이후 단계에서 여기에 더한다)
const onChange = [];
function refresh() {
  renderBand();
  renderChips();
  renderView();
  onChange.forEach(fn => fn());
}

// ====== 탭 (주소의 #해시로 전환) ======
function tabFromHash() {
  const t = location.hash.slice(1);
  return TABS.includes(t) ? t : 'home';
}
window.addEventListener('hashchange', () => {
  state.tab = tabFromHash();
  renderView();
  window.scrollTo(0, 0);
});

// ====== 시트 ======
function openSheet(d) { if (!d.open) d.showModal(); }
document.querySelectorAll('dialog.sheet').forEach(d => {
  d.addEventListener('click', e => {
    if (e.target === d || e.target.closest('[data-close]')) d.close();   // 배경 또는 닫기 버튼
  });
});

function renderBaseSheet() {
  const today = todayStr();
  $('presetList').innerHTML = PRESETS.map(p => {
    const v = p.v === 'today' ? today : p.v;
    return `<button type="button" class="preset" role="radio" aria-checked="${p.v === state.base}" data-base="${p.v}">
      <span><b>${esc(p.label)}</b><small>${esc(v)}(${WD[dow(dn(v))]})</small></span></button>`;
  }).join('');
  $('baseDate').value = baseStr();
}
function setBase(v) {
  if (v !== 'today' && isNaN(dn(v))) return;
  state.base = v;
  saveSettings();
  refresh();
}

$('baseBtn').addEventListener('click', () => { renderBaseSheet(); openSheet($('baseSheet')); });
$('presetList').addEventListener('click', e => {
  const b = e.target.closest('[data-base]');
  if (!b) return;
  setBase(b.dataset.base);
  $('baseSheet').close();
});
$('baseDate').addEventListener('change', e => {
  const v = e.target.value;
  if (isNaN(dn(v))) return;
  setBase(v === todayStr() ? 'today' : v);
  renderBaseSheet();
});

$('chips').addEventListener('click', e => {
  const c = e.target.closest('[data-cat]');
  if (!c || c.dataset.cat === state.cat) return;
  state.cat = c.dataset.cat;
  saveSettings();
  refresh();
});

$('infoBtn').addEventListener('click', () => {
  if (META) renderInfo();
  openSheet($('infoSheet'));
});

// ====== 공지 상세 ======
function openDetail(id) {
  const r = BY_ID.get(String(id));
  if (!r) return false;
  const b = baseN();
  const biz = BIZ_NAME[r.key];
  const past = biz ? ALL.filter(x => x.key === r.key && x.d < r.d).length : 0;
  const diff = r.d - b;
  $('detailBody').innerHTML = `
    <div class="dt-top">${ddChip(r, b)}<span class="muted">${diff < 0 ? `기준일보다 ${-diff}일 전 마감` : `기준일 ${ds(b)} 기준`}</span></div>
    <h2 class="dt-title" id="detailTitle">${esc(r.title)}</h2>
    <p class="tags"><span class="tag">${esc(r.cat)}</span><span class="tag">${esc(r.dept)}</span>
      <span class="tag">${r.owner === '외부' ? '외부 기관 마감' : '교내 마감'}</span>${r.ext === '연장' ? '<span class="tag">연장됨</span>' : ''}</p>
    <dl class="facts">
      <div><dt>게시 → 마감</dt><dd>${fmtFull(r.p)} → <b>${fmtFull(r.d)}</b></dd></div>
      <div><dt>게시~마감</dt><dd>달력 ${r.len}일 · 평일 ${r.biz}일 ${tightTag(r)}</dd></div>
      ${biz ? `<div><dt>반복 공지</dt><dd>${esc(biz)} · 지난 회차 ${past}회</dd></div>` : ''}
    </dl>
    <a class="btn-primary wide" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">원문 보기</a>
    <p class="note">마감일은 반드시 원문에서 확인하세요.</p>`;
  openSheet($('detailSheet'));
  return true;
}
// 상세를 닫으면 주소의 ?id= 를 지운다 (새로고침 때 다시 열리지 않게)
$('detailSheet').addEventListener('close', () => {
  if (new URLSearchParams(location.search).has('id')) history.replaceState(null, '', './' + location.hash);
});

// 화면 어디서든 공지 항목을 누르면 상세
document.addEventListener('click', e => {
  const it = e.target.closest('.item[data-id], .g-bar[data-id]');
  if (it) { openDetail(it.dataset.id); return; }
  if (e.target.closest('#moreBtn')) {
    homeExpanded = !homeExpanded;
    renderView();
    if (homeExpanded) $('weekAll').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (e.target.closest('#notifyBtn')) onNotify(false);
  else if (e.target.closest('#notifyLaterBtn')) onNotify(true);
});

// ====== 짧은 안내 ======
let toastTimer = 0;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

// ====== 알림용 짧은 제목 ======
// "🍀2026년 1학기 국가장학금 2차 신청 일정 및 신청 매뉴얼 안내" → "국가장학금 2차 신청"
function shortTitle(t) {
  let s = String(t).replace(/\s+/g, ' ').trim();
  s = s.replace(/^[^\p{L}\p{N}\[(]+/u, '');                                  // 앞쪽 이모지·기호
  for (let i = 0; i < 4; i++) {
    const before = s;
    s = s.replace(/^\[[^\]]*\]\s*/, '').replace(/^\((종료|마감|재공지|수정|연장)\)\s*/, '')
      .replace(/^\d{4}(년|학년도)?(\s*-\s*\d(학기)?)?\s*/, '')
      .replace(/^(상반기|하반기|[12]학기|봄학기|가을학기|여름학기|겨울학기)\s*/, '')
      .replace(/^[^\p{L}\p{N}\[(]+/u, '');
    if (s === before) break;
  }
  for (let i = 0; i < 3; i++) s = s.replace(/\s*(일정\s*및.*|안내|공고|공지)\s*$/, '');
  s = s.replace(/[^\p{L}\p{N})\]]+$/u, '').trim() || String(t).trim();
  return s.length > 22 ? s.slice(0, 21) + '…' : s;
}
function notificationFor(r, b = baseN()) {
  const diff = r.d - b;
  const head = diff === 0 ? '오늘 마감' : diff === 1 ? '내일 마감' : `D-${diff}`;
  return {
    title: `${head} · ${shortTitle(r.title)}`,
    options: {
      body: `${fmtD(r.d)} 마감 · 게시~마감 ${r.len}일`,
      data: { id: r.id },
      tag: 'deadline-demo',
      renotify: true,
      icon: './icons/icon-192.png',
      lang: 'ko',
    },
  };
}

// ====== 아이콘 숫자 배지: 이번 주 남은 마감 수 (필터 적용) ======
function updateBadge() {
  if (!('setAppBadge' in navigator) || !ALL.length) return;     // 지원하지 않으면 조용히 넘어간다
  const n = weekSets().thisWeek.length;
  const p = n > 0 ? navigator.setAppBadge(n) : navigator.clearAppBadge();
  if (p && p.catch) p.catch(() => {});
}
onChange.push(updateBadge);

// ====== 알림 시연 ======
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

// 버튼 클릭 안에서 바로 호출해야 한다 (사용자 동작이 있어야 권한 창이 뜬다)
async function ensurePermission() {
  if (!('Notification' in window)) {
    if (isIOS && !isStandalone()) openIOSSheet(true);       // 아이폰 Safari: 홈 화면 앱에서만 알림 가능
    else toast('이 브라우저는 알림을 지원하지 않습니다');
    return false;
  }
  if (Notification.permission === 'denied') { toast('알림이 차단되어 있습니다. 브라우저 설정에서 허용해 주세요'); return false; }
  const p = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (p !== 'granted') { toast('알림을 허용해야 시연할 수 있습니다'); return false; }
  return true;
}
async function swReg() {
  if (!('serviceWorker' in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration()) || null;
}
async function showDemo(r) {
  const { title, options } = notificationFor(r);
  const reg = await swReg();
  if (reg) await reg.showNotification(title, options);
  else new Notification(title, options);                      // 서비스 워커가 없을 때 대비
}
async function onNotify(later) {
  const r = mostUrgent();
  if (!r) { toast('기준일 이후 마감 공지가 없습니다'); return; }
  if (!(await ensurePermission())) return;
  updateBadge();                                              // 아이폰은 알림 허용 뒤에야 배지가 보인다
  if (!later) { await showDemo(r); return; }
  // 10초 뒤: 앱을 내려도 오도록 서비스 워커가 기다렸다가 띄운다. 없으면 페이지 타이머.
  const reg = await swReg();
  const sw = reg && (reg.active || navigator.serviceWorker.controller);
  if (sw) {
    const { title, options } = notificationFor(r);
    sw.postMessage({ type: 'notify-later', delay: 10000, title, options });
  } else {
    setTimeout(() => showDemo(r), 10000);
  }
  toast('10초 뒤 알림이 옵니다. 홈 화면으로 나가 보세요');
}

// 알림을 눌렀을 때 이미 열린 앱 창은 서비스 워커가 메시지로 알려 준다
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', e => {
    const m = e.data || {};
    if (m.type !== 'open-notice' || !m.id) return;
    history.replaceState(null, '', './?id=' + encodeURIComponent(m.id) + location.hash);
    if (BY_ID.size) openDetail(m.id);
  });
}

// ====== 설치 안내 ======
// 안드로이드·PC(Chrome/Edge): beforeinstallprompt 를 저장해 두었다가 버튼에서 prompt()
// 아이폰: 설치 API가 없으므로 "공유 → 홈 화면에 추가" 안내 시트
let installEvt = null;
const canInstall = () => !isStandalone() && (!!installEvt || isIOS);
function syncInstallBtn() {
  const b = $('installBtn');
  if (b) b.hidden = !canInstall();
}
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();                 // 브라우저 기본 배너 대신 우리 버튼에서 띄운다
  installEvt = e;
  syncInstallBtn();
});
window.addEventListener('appinstalled', () => {
  installEvt = null;
  syncInstallBtn();
  toast('설치했습니다. 홈 화면 아이콘으로 실행하세요');
});
matchMedia('(display-mode: standalone)').addEventListener?.('change', syncInstallBtn);
onChange.push(syncInstallBtn);        // 홈 화면을 다시 그릴 때마다 버튼 표시를 맞춘다

async function onInstall() {
  if (installEvt) {
    const e = installEvt;
    installEvt = null;                // prompt()는 한 번만 쓸 수 있다
    e.prompt();
    try { await e.userChoice; } catch (_) { /* 무시 */ }
    syncInstallBtn();
  } else if (isIOS) {
    openIOSSheet(false);
  }
}
function openIOSSheet(forNotify) {
  $('iosNotifyNote').hidden = !forNotify;
  openSheet($('iosSheet'));
}
document.addEventListener('click', e => {
  if (e.target.closest('#installBtn')) onInstall();
});

// ====== 서비스 워커 (오프라인) ======
// http(s)에서만 등록된다. localhost 는 예외적으로 http 에서도 허용된다.
function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('./sw.js').catch(() => { /* 실패해도 앱은 동작 */ });
}

// ====== 시작 ======
(async function init() {
  registerSW();
  loadSettings();
  state.tab = tabFromHash();
  try {
    await loadData();
  } catch (e) {
    $('bandText').textContent = '데이터를 불러오지 못했습니다.';
    // 파일을 더블클릭해 file:// 로 열면 브라우저가 JSON 읽기를 막는다
    $('v-home').innerHTML = location.protocol === 'file:'
      ? `<div class="card notice-box"><p><b>파일로 직접 열면 동작하지 않습니다.</b></p>
         <p>notice-pwa 폴더에서 로컬 서버를 켠 뒤 열어 주세요.</p>
         <pre>python -m http.server 8000</pre><p>→ http://localhost:8000</p></div>`
      : '<div class="card notice-box"><p>데이터를 불러오지 못했습니다. 새로고침해 주세요.</p></div>';
    return;
  }
  refresh();
  const id = new URLSearchParams(location.search).get('id');   // 알림 클릭으로 열린 경우
  if (id && !openDetail(id)) history.replaceState(null, '', './' + location.hash);
})();
