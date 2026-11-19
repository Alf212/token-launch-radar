// Token Launch Radar — the page. Reads window.RADAR (written beside this folder as data.js by
// main.ts), renders the ranked board, a detail view per protocol and the calibration set of
// protocols whose token already trades. No fetch, no network: everything is already on the page.
// Views live in the hash so a screenshot can name its state: #/ (board), #/board?cat=Lending,
// #/protocol/<slug> (detail), #/live (already trading).

'use strict';

const R = window.RADAR;
const app = document.getElementById('app');
const bySlug = new Map(R.rows.map((r) => [r.slug, r]));

/* ---------------- formatting ---------------- */

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function money(v) {
  if (v === null || v === undefined) return '—';
  const a = Math.abs(v);
  if (a >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
  return '$' + Math.round(v);
}

function moneyFull(v) {
  return '$' + Math.round(v).toLocaleString('en-US');
}

function pct(v) {
  if (v === null || v === undefined) return '<span class="flat">—</span>';
  const cls = v > 0.05 ? 'pos' : v < -0.05 ? 'neg' : 'flat';
  return '<span class="' + cls + '">' + (v > 0 ? '+' : '') + v.toFixed(1) + '%</span>';
}

function ageFmt(days) {
  if (days === null || days === undefined) return 'untracked';
  if (days >= 730) return (days / 365).toFixed(1) + ' yrs';
  if (days >= 60) return Math.round(days / 30.4) + ' mo';
  return days + ' d';
}

function mult(x) {
  return '×' + Number(x).toFixed(2);
}

/* ---------------- routing ---------------- */

function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, query] = h.split('?');
  const params = new URLSearchParams(query || '');
  if (path === '/live') return { view: 'live' };
  if (path.startsWith('/protocol/')) return { view: 'detail', slug: decodeURIComponent(path.slice('/protocol/'.length)) };
  return {
    view: 'board',
    q: params.get('q') || '',
    cat: params.get('cat') || 'all',
    chain: params.get('chain') || 'all',
    tier: params.get('tier') || 'all',
    signal: params.get('signal') || 'all',
    sort: params.get('sort') || 'rank',
  };
}

function boardHash(st) {
  const p = new URLSearchParams();
  if (st.q) p.set('q', st.q);
  if (st.cat !== 'all') p.set('cat', st.cat);
  if (st.chain !== 'all') p.set('chain', st.chain);
  if (st.tier !== 'all') p.set('tier', st.tier);
  if (st.signal !== 'all') p.set('signal', st.signal);
  if (st.sort !== 'rank') p.set('sort', st.sort);
  const s = p.toString();
  return '#/board' + (s ? '?' + s : '');
}

function setTab(view) {
  document.querySelectorAll('.tabs a').forEach((a) => {
    a.classList.toggle('on', a.dataset.tab === view || (view === 'detail' && a.dataset.tab === 'board'));
  });
}

/* ---------------- shared chrome ---------------- */

function statsStrip() {
  const top = R.rows[0];
  return (
    '<section class="stats">' +
    stat('Snapshot', R.as_of, 'sealed DefiLlama universe') +
    stat('Protocols scanned', String(R.universe_size), R.pre_token_size + ' record no token') +
    stat('On the board', String(R.board_size), 'every launch candidate, ranked') +
    stat('Watchlist covered', R.watchlist_size + ' / ' + R.watchlist_size, 'the $' + (R.floor_usd / 1e6) + 'M floor, all of it') +
    stat('Top of the board', top ? esc(top.name) : '—', top ? money(top.implied_value_usd) + ' implied' : '') +
    stat('Model', R.model_version, 'peer-calibrated, global ' + mult(R.global_multiple)) +
    '</section>'
  );
}

function stat(k, v, s) {
  return '<div class="stat"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div><div class="s">' + esc(s) + '</div></div>';
}

function modelStrip() {
  return (
    '<section class="model-strip"><strong>How a row earns its value (' + esc(R.model_version) + ').</strong> ' +
    'Protocols whose token already trades answer “what is a dollar of TVL worth in this category?” with their market cap ÷ TVL (each ratio capped at 3×, near the peer set’s 90th percentile). ' +
    'The radar takes that median per category, shrinks it toward the all-market median (' + mult(R.global_multiple) + ') when a category has few traded peers, ' +
    'and applies it to each pre-token protocol’s TVL — then adjusts for 7-day growth, for how long the protocol has run with no token, and for chain breadth. ' +
    'No name is scored by hand; the same function scores every row, and each row’s detail view shows its own arithmetic.' +
    '<span class="formula">implied = TVL × category multiple × growth factor × maturity factor × chain factor</span></section>'
  );
}

/* ---------------- board view ---------------- */

const SORTS = {
  rank: (a, b) => a.rank - b.rank,
  implied: (a, b) => b.implied_value_usd - a.implied_value_usd,
  tvl: (a, b) => b.tvl_usd - a.tvl_usd,
  growth: (a, b) => (b.change_7d ?? -Infinity) - (a.change_7d ?? -Infinity),
  age: (a, b) => (b.age_days ?? -1) - (a.age_days ?? -1),
  multiple: (a, b) => b.model.category_multiple - a.model.category_multiple,
};

function filteredRows(st) {
  const q = st.q.trim().toLowerCase();
  let rows = R.rows.filter((r) => {
    if (q && !(r.name.toLowerCase().includes(q) || r.slug.includes(q))) return false;
    if (st.cat !== 'all' && (r.category || '(none)') !== st.cat) return false;
    if (st.chain !== 'all' && !r.chains.includes(st.chain)) return false;
    if (st.tier === 'watchlist' && !r.watchlist) return false;
    if (st.tier === 'early' && r.watchlist) return false;
    if (st.signal !== 'all' && r.signal !== st.signal) return false;
    return true;
  });
  rows = rows.sort(SORTS[st.sort] || SORTS.rank);
  return rows;
}

function options(values, current, allLabel) {
  let s = '<option value="all">' + esc(allLabel) + '</option>';
  for (const v of values) s += '<option value="' + esc(v) + '"' + (v === current ? ' selected' : '') + '>' + esc(v) + '</option>';
  return s;
}

function boardView(st) {
  const cats = [...new Set(R.rows.map((r) => r.category || '(none)'))].sort();
  const chains = [...new Set(R.rows.flatMap((r) => r.chains))].sort();
  const rows = filteredRows(st);
  const head =
    '<tr><th class="num sortable" data-sort="rank">#</th><th>Protocol</th><th>Category</th><th>Chains</th>' +
    '<th class="num sortable" data-sort="tvl">TVL</th><th class="num sortable" data-sort="growth">7d</th>' +
    '<th class="num sortable" data-sort="age">Age</th><th class="num sortable" data-sort="multiple">Multiple</th>' +
    '<th class="num sortable" data-sort="implied">Implied value</th><th>Signal</th></tr>';
  const body = rows
    .map(
      (r) =>
        '<tr data-slug="' + esc(r.slug) + '"' + (r.rank <= 3 ? ' class="top"' : '') + '>' +
        '<td class="rank">' + r.rank + '</td>' +
        '<td class="name">' + esc(r.name) + (r.watchlist ? '<span class="wl">WATCHLIST</span>' : '') + '<span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td class="cat">' + esc(r.category || '—') + '</td>' +
        '<td class="chains">' + esc(r.chains.slice(0, 3).join(', ') || '—') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + ageFmt(r.age_days) + '</td>' +
        '<td class="num">' + mult(r.model.category_multiple) + '</td>' +
        '<td class="num implied">' + money(r.implied_value_usd) + '</td>' +
        '<td><span class="pill ' + r.signal.toLowerCase() + '">' + r.signal + '</span></td></tr>',
    )
    .join('');
  app.innerHTML =
    statsStrip() +
    modelStrip() +
    '<section class="controls">' +
    '<label>Search <input type="search" id="f-q" placeholder="name or slug" value="' + esc(st.q) + '"></label>' +
    '<label>Category <select id="f-cat">' + options(cats, st.cat, 'All categories') + '</select></label>' +
    '<label>Chain <select id="f-chain">' + options(chains, st.chain, 'All chains') + '</select></label>' +
    '<label>Tier <select id="f-tier">' +
    '<option value="all"' + (st.tier === 'all' ? ' selected' : '') + '>Whole board</option>' +
    '<option value="watchlist"' + (st.tier === 'watchlist' ? ' selected' : '') + '>Watchlist only</option>' +
    '<option value="early"' + (st.tier === 'early' ? ' selected' : '') + '>Early (below the floor)</option></select></label>' +
    '<label>Signal <select id="f-signal">' + options(['Strong', 'Watch', 'Early'], st.signal, 'Any signal') + '</select></label>' +
    '<label>Sort <select id="f-sort">' +
    [['rank', 'Rank'], ['implied', 'Implied value'], ['tvl', 'TVL'], ['growth', '7-day growth'], ['age', 'Age'], ['multiple', 'Multiple']]
      .map(([v, label]) => '<option value="' + v + '"' + (st.sort === v ? ' selected' : '') + '>' + label + '</option>')
      .join('') +
    '</select></label>' +
    '<span class="count-note">showing ' + rows.length + ' of ' + R.board_size + '</span></section>' +
    '<div class="board-wrap"><table class="board"><thead>' + head + '</thead><tbody>' +
    (body || '<tr><td colspan="10" class="empty-note">No protocol matches those filters. Loosen one and sweep again.</td></tr>') +
    '</tbody></table></div>' +
    '<p class="count-note" style="margin-top:10px">Click any row for its detail view: the model’s arithmetic for that protocol and its farm plan.</p>';
  wireBoard(st);
}

function wireBoard(st) {
  const go = (patch) => {
    const next = { ...st, ...patch };
    history.replaceState(null, '', boardHash(next));
    boardView(next);
  };
  const on = (id, ev, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(ev, fn);
  };
  on('f-q', 'input', (e) => go({ q: e.target.value }));
  on('f-cat', 'change', (e) => go({ cat: e.target.value }));
  on('f-chain', 'change', (e) => go({ chain: e.target.value }));
  on('f-tier', 'change', (e) => go({ tier: e.target.value }));
  on('f-signal', 'change', (e) => go({ signal: e.target.value }));
  on('f-sort', 'change', (e) => go({ sort: e.target.value }));
  app.querySelectorAll('th.sortable').forEach((th) => th.addEventListener('click', () => go({ sort: th.dataset.sort })));
  app.querySelectorAll('tbody tr[data-slug]').forEach((tr) =>
    tr.addEventListener('click', () => {
      location.hash = '#/protocol/' + encodeURIComponent(tr.dataset.slug);
    }),
  );
  const q = document.getElementById('f-q');
  if (q && document.activeElement !== q && st.q) {
    q.focus();
    q.setSelectionRange(q.value.length, q.value.length);
  }
}

/* ---------------- detail view ---------------- */

function splitStep(step) {
  const ci = step.lastIndexOf(' Cost: ');
  if (ci < 0) return { text: step, meta: '' };
  const head = step.slice(0, ci);
  const meta = step.slice(ci + 1); // "Cost: … . Time: … ."
  return { text: head, meta };
}

function bar(label, value, frac, teal) {
  const w = Math.max(3, Math.min(100, Math.round(frac * 100)));
  return (
    '<div class="factor"><div class="frow"><span>' + esc(label) + '</span><b>' + esc(value) + '</b></div>' +
    '<div class="bar' + (teal ? ' teal' : '') + '"><i style="width:' + w + '%"></i></div></div>'
  );
}

function whyList(r) {
  const out = [];
  out.push('<b>' + money(r.tvl_usd) + ' of TVL</b> already sits in ' + esc(r.name) + ' with no token issued — the raw material a launch would price.');
  if (r.watchlist) out.push('It clears the snapshot’s <b>watchlist floor</b> ($' + (R.floor_usd / 1e6) + 'M TVL, no token, not a wrapped or staked product), so it is on the board by the house’s own rule, not just the model’s.');
  else out.push('It sits <b>below the watchlist floor</b> — exactly the early rows a radar exists to catch before size alone makes them obvious.');
  if (r.change_7d !== null && r.change_7d >= 5) out.push('TVL grew <b>' + r.change_7d.toFixed(1) + '% in seven days</b>: usage is compounding before any token exists to reward it.');
  if (r.change_7d !== null && r.change_7d <= -10) out.push('TVL fell <b>' + Math.abs(r.change_7d).toFixed(1) + '% in seven days</b>, which is why the growth factor discounts it — check the plan’s hold step before committing.');
  if (r.age_days !== null && r.age_days >= 730) out.push('DefiLlama has tracked it for <b>' + ageFmt(r.age_days) + '</b> with no token: a long pre-token run is the maturity this model pays for.');
  if (r.chains.length > 1) out.push('It runs on <b>' + r.chains.length + ' chains</b> (' + esc(r.chains.slice(0, 4).join(', ')) + '), so one launch prices a multi-chain product, and the farm plan works two of them.');
  if (r.model.category_peers > 0) out.push('Its multiple is not a guess: <b>' + r.model.category_peers + ' traded ' + esc(r.category || '') + ' peer' + (r.model.category_peers === 1 ? '' : 's') + '</b> in the same snapshot set it, shrunk toward the market median by peer count.');
  else out.push('Its category has <b>no traded peers</b> in the snapshot, so it is scored at the all-market median multiple instead of a category figure.');
  return out;
}

function detailView(slug) {
  const r = bySlug.get(slug);
  if (!r) {
    boardView(parseHash());
    return;
  }
  const m = r.model;
  const catStat = R.categories.find((c) => c.category === (r.category || '(none)'));
  const steps = r.farm_steps
    .map((s) => {
      const { text, meta } = splitStep(s);
      return '<li>' + esc(text) + (meta ? '<span class="meta">' + esc(meta) + '</span>' : '') + '</li>';
    })
    .join('');
  app.innerHTML =
    '<a class="back" href="#/">&larr; Back to the board</a>' +
    '<div class="detail-head"><h2>' + esc(r.name) + '</h2><span class="slug">' + esc(r.slug) + '</span>' +
    '<span class="pill ' + r.signal.toLowerCase() + '">' + r.signal + ' signal</span>' +
    (r.watchlist ? '<span class="pill watch">On the watchlist</span>' : '<span class="pill">Early — below the floor</span>') + '</div>' +
    '<p class="detail-sub">Rank #' + r.rank + ' of ' + R.board_size + ' · ' + esc(r.category || 'Uncategorised') + ' · records no token in the ' + esc(R.as_of) + ' snapshot</p>' +
    '<div class="detail-grid"><div>' +
    '<section class="card"><h3>Implied launch value</h3><div class="big-implied">' + moneyFull(r.implied_value_usd) + '</div>' +
    '<dl class="kv">' +
    '<dt>TVL (snapshot)</dt><dd>' + moneyFull(r.tvl_usd) + '</dd>' +
    '<dt>TVL change, 7 days</dt><dd>' + (r.change_7d === null ? '—' : r.change_7d.toFixed(1) + '%') + '</dd>' +
    '<dt>Tracked since</dt><dd>' + (r.listed_at || '—') + '</dd>' +
    '<dt>Age with no token</dt><dd>' + ageFmt(r.age_days) + '</dd>' +
    '<dt>Chains</dt><dd>' + esc(r.chains.join(', ') || '—') + '</dd>' +
    '</dl></section>' +
    '<section class="card"><h3>The model’s arithmetic (' + esc(R.model_version) + ')</h3>' +
    '<dl class="kv"><dt>Base: TVL × multiple</dt><dd>' + moneyFull(m.base_value_usd) + '</dd></dl>' +
    bar('Category multiple — ' + esc(r.category || 'none') + (catStat ? ', median of ' + catStat.peers + ' traded peer' + (catStat.peers === 1 ? '' : 's') : ', all-market median'), mult(m.category_multiple), m.category_multiple / 1.5, false) +
    bar('Growth factor — 7d ' + (r.change_7d === null ? 'unreported' : r.change_7d.toFixed(1) + '%'), '×' + m.growth_factor.toFixed(2), (m.growth_factor - 0.6) / 1.0, true) +
    bar('Maturity factor — ' + ageFmt(r.age_days) + ' with no token', '×' + m.maturity_factor.toFixed(2), (m.maturity_factor - 0.75) / 0.35, true) +
    bar('Chain factor — ' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's'), '×' + m.chain_factor.toFixed(2), (m.chain_factor - 1) / 0.2, true) +
    '<dl class="kv" style="margin-top:8px"><dt>Implied value</dt><dd>' + moneyFull(r.implied_value_usd) + '</dd></dl>' +
    '<p style="color:var(--muted);font-size:13px;margin:10px 0 0">Every factor comes from this protocol’s own row in the sealed snapshot. Change the snapshot and the board re-derives itself; no figure here is stored per protocol.</p></section>' +
    '<section class="card"><h3>Why it ranks here</h3><ul class="why">' + whyList(r).map((w) => '<li>' + w + '</li>').join('') + '</ul></section>' +
    '</div><div>' +
    '<section class="card"><h3>Farm plan — ' + r.farm_steps.length + ' steps</h3><ol class="steps">' + steps + '</ol>' +
    '<p style="color:var(--muted);font-size:13px;margin:4px 0 0">Steps are generated from the protocol’s category, chains, TVL and age — the same plan text the board hands in. Costs are estimates in USD; the capital stays yours and at risk, as with any farm.</p></section>' +
    '</div></div>';
  window.scrollTo(0, 0);
}

/* ---------------- live (calibration) view ---------------- */

function liveView() {
  const rows = R.live
    .map(
      (p) =>
        '<tr><td class="name">' + esc(p.name) + '<span class="slug">' + esc(p.slug) + '</span></td>' +
        '<td class="cat">' + esc(p.category || '—') + '</td>' +
        '<td class="num">' + money(p.mcap_usd) + '</td>' +
        '<td class="num">' + money(p.tvl_usd) + '</td>' +
        '<td class="num">' + (p.mcap_tvl === null ? '—' : mult(p.mcap_tvl)) + '</td>' +
        '<td class="num">' + pct(p.change_7d) + '</td></tr>',
    )
    .join('');
  const cats = R.categories
    .filter((c) => c.peers >= 2)
    .sort((a, b) => b.used_multiple - a.used_multiple)
    .map(
      (c) =>
        '<tr><td class="cat">' + esc(c.category) + '</td><td class="num">' + c.peers + '</td>' +
        '<td class="num">' + mult(c.median_multiple) + '</td><td class="num">' + mult(c.used_multiple) + '</td></tr>',
    )
    .join('');
  app.innerHTML =
    statsStrip() +
    '<section class="note-box"><strong>These already trade — they are never ranked.</strong> ' +
    'A protocol with a token has the market’s own valuation, so the board sets it aside. It still earns its place here: ' +
    'these protocols are the calibration set. Each one’s market cap ÷ TVL is a market-priced answer to what a category is worth, ' +
    'and the radar’s multiples are their medians. The biggest ' + R.live_size + ' by market cap are shown.</section>' +
    '<div class="board-wrap" style="max-height:none"><table class="board"><thead><tr><th>Protocol</th><th>Category</th>' +
    '<th class="num">Market cap</th><th class="num">TVL</th><th class="num">MCap ÷ TVL</th><th class="num">7d</th></tr></thead><tbody>' +
    rows + '</tbody></table></div>' +
    '<h2 style="font-size:19px;margin:26px 0 10px">The calibration table</h2>' +
    '<p style="color:var(--muted);margin:0 0 12px;max-width:820px">Every category with at least two traded peers in the snapshot. ' +
    'Medians are taken on ratios capped at 3× (the raw per-protocol figures in the table above are the market’s own, uncapped). ' +
    'The used multiple shrinks the category median toward the all-market median (' + mult(R.global_multiple) + ') by peer count, ' +
    'so a category priced by two thin peers cannot hand a pre-token protocol an extreme value.</p>' +
    '<div class="board-wrap" style="max-height:none"><table class="board"><thead><tr><th>Category</th><th class="num">Traded peers</th>' +
    '<th class="num">Median multiple</th><th class="num">Used multiple</th></tr></thead><tbody>' + cats + '</tbody></table></div>';
}

/* ---------------- boot ---------------- */

function render() {
  const route = parseHash();
  setTab(route.view);
  if (route.view === 'live') liveView();
  else if (route.view === 'detail') detailView(route.slug);
  else boardView(route);
  app.setAttribute('aria-busy', 'false');
  const foot = document.getElementById('foot-note');
  if (foot) {
    foot.textContent =
      'Data: ' + R.source + ' · ' + R.universe_size + ' protocols, ' + R.board_size + ' ranked by ' + R.model_version + '. ' +
      'Implied value is this radar’s own model claim, derived only from the snapshot’s figures; it is not a prediction that a token will be issued, and a protocol “records no token” in the snapshot — DefiLlama’s record is not proof it has none.';
  }
}

window.addEventListener('hashchange', render);
render();
