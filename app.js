// app.js —— 晨报 App：读报告 + 持仓/观察股编辑 + 交易记录 + AI 问答（全部写回私有仓库）
const LS_TOKEN = 'bh_token', LS_REPO = 'bh_repo';
const state = {
  token: localStorage.getItem(LS_TOKEN) || '',
  repo: localStorage.getItem(LS_REPO) || 'QwQ-1025/daily-briefing',
};
let repoInfo = null;
let currentResearch = null;
let reportDates = [];
let reportDatesIdx = 0;

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const b64d = (b) => decodeURIComponent(escape(atob(b)));
const b64e = (s) => btoa(unescape(encodeURIComponent(s)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const toast = (m) => { const t = $('#toast'); t.textContent = m; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2800); };

// ---------- GitHub API ----------
async function gh(path, opts = {}) {
  const res = await fetch('https://api.github.com' + path, {
    ...opts,
    headers: {
      Authorization: 'Bearer ' + state.token,
      'User-Agent': 'briefing-web',
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (res.status === 401 || res.status === 403) { go('setup'); throw new Error('令牌无效或权限不足'); }
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}
async function readFile(path) {
  const f = await gh(`/repos/${state.repo}/contents/${path}`);
  return { text: b64d(f.content), sha: f.sha };
}
async function writeFile(path, content, message, sha) {
  return gh(`/repos/${state.repo}/contents/${path}`, {
    method: 'PUT', body: JSON.stringify({ message, content: b64e(content), sha }),
  });
}
async function dispatch(workflow, inputs) {
  return gh(`/repos/${state.repo}/actions/workflows/${workflow}/dispatches`, {
    method: 'POST', body: JSON.stringify({ ref: (repoInfo || {}).default_branch || 'main', ...(inputs ? { inputs } : {}) }),
  });
}
async function latestRun(nameFilter) {
  const j = await gh(`/repos/${state.repo}/actions/runs?per_page=5`);
  return (j.workflow_runs || []).find((r) => !nameFilter || r.name === nameFilter);
}
async function listDir(dir) {
  try { return await gh(`/repos/${state.repo}/contents/${dir}`); } catch (e) { return []; }
}

// ---------- YAML 块编辑工具（对 watchlist.yaml 做最小侵入编辑） ----------
function tickerBlocks(text) {
  const lines = text.split('\n');
  const starts = [];
  lines.forEach((l, i) => { if (/^\s*- ticker:\s*\S+/.test(l)) starts.push(i); });
  return starts.map((s, idx) => {
    const end = idx + 1 < starts.length ? starts[idx + 1] : lines.length;
    const block = lines.slice(s, end).join('\n');
    return { ticker: (block.match(/^\s*- ticker:\s*(\S+)/m) || [])[1], start: s, end, block };
  });
}
function setField(block, key, value) {
  const lines = block.split('\n');
  const idx = lines.findIndex((l) => l.trim().startsWith(key + ':'));
  const indent = '    ';
  const line = value == null ? null : `${indent}${key}: ${value}`;
  if (value == null) {
    if (idx >= 0) lines.splice(idx, 1);
    return lines.join('\n');
  }
  if (idx >= 0) { lines[idx] = line; return lines.join('\n'); }
  // 插入到 ticker 行之后
  const t = lines.findIndex((l) => /^\s*- ticker:/.test(l));
  lines.splice(t + 1, 0, line);
  return lines.join('\n');
}
function flowList(arr) { return '[' + (arr || []).map((x) => JSON.stringify(String(x).trim())).join(', ') + ']'; }
function updateTicker(text, ticker, fields) {
  const blocks = tickerBlocks(text);
  const b = blocks.find((x) => x.ticker === ticker);
  if (!b) throw new Error('找不到 ' + ticker);
  let nb = b.block;
  for (const [k, v] of Object.entries(fields)) nb = setField(nb, k, v);
  return text.slice(0, b.start) + nb + text.slice(b.end);
}
function deleteTicker(text, ticker) {
  const blocks = tickerBlocks(text);
  const b = blocks.find((x) => x.ticker === ticker);
  if (!b) throw new Error('找不到 ' + ticker);
  const before = text.slice(0, b.start).replace(/\n+$/, '\n');
  const after = text.slice(b.end).replace(/^\n+/, '');
  return before + after;
}

// ---------- 导航 ----------
const SCREENS = ['home', 'qa', 'board', 'watch', 'setup'];
function go(s) {
  SCREENS.forEach((x) => { $('#' + 'scr-' + x).classList.toggle('hidden', x !== s); $('#' + 'nav' + x[0].toUpperCase() + x.slice(1)).classList.toggle('on', x === s); });
  if (s === 'home') loadHome();
  if (s === 'qa') loadQa();
  if (s === 'board') loadBoard();
  if (s === 'watch') loadWatch();
  if (s === 'setup') $('#inRepo').value = state.repo;
}
function saveSetup() {
  state.repo = $('#inRepo').value.trim() || 'QwQ-1025/daily-briefing';
  state.token = $('#inToken').value.trim();
  localStorage.setItem(LS_REPO, state.repo);
  localStorage.setItem(LS_TOKEN, state.token);
  toast('已保存');
  init();
}
async function init() {
  $('#headSub').textContent = state.repo;
  if (!state.token) return go('setup');
  try {
    repoInfo = await gh(`/repos/${state.repo}`);
    $('#headSub').textContent = state.repo + (repoInfo.private ? ' 🔒私有' : '');
    reportDates = (await listDir('reports')).filter((f) => f.name.endsWith('.html')).map((f) => f.name.replace('.html', '')).sort().reverse();
    reportDatesIdx = 0;
    go('home');
  } catch (e) { toast('连接失败：' + e.message); go('setup'); }
}

// ---------- 今日报告 ----------
async function loadHome() {
  try {
    const d = reportDates[reportDatesIdx];
    if (!d) {
      $('#homeTitle').textContent = '今日报告（暂无）';
      $('#reportFrame').srcdoc = '<div style="padding:30px;text-align:center;color:#64748b">还没有报告，点"立即生成"。</div>';
    } else {
      $('#homeTitle').textContent = '📄 ' + d;
      const { text } = await readFile(`reports/${d}.html`);
      $('#reportFrame').srcdoc = text;
    }
    renderRunBadge();
  } catch (e) { toast('加载失败：' + e.message); }
}
function homeNav(dir) {
  const n = reportDatesIdx + dir;
  if (n < 0 || n >= reportDates.length) return;
  reportDatesIdx = n;
  loadHome();
}
async function renderRunBadge() {
  try {
    const r = await latestRun('Daily Market Briefing');
    if (!r) return;
    const cls = r.conclusion === 'success' ? 't-ok' : r.conclusion === 'failure' ? 't-fail' : 't-run';
    const txt = (r.status === 'in_progress' || r.status === 'queued') ? '⏳ 生成中…' : r.conclusion === 'success' ? '✅ 最近生成成功' : r.conclusion === 'failure' ? '❌ 最近生成失败' : '…';
    $('#runBadge').innerHTML = `<span class="tag ${cls}">${txt}</span> <a href="${r.html_url}" target="_blank">详情 ↗</a>`;
  } catch (e) { /* 忽略 */ }
}
async function triggerBriefing() {
  toast('已触发，约 3-5 分钟完成并推微信');
  try { await dispatch('daily-briefing.yml', { force: 'true' }); } catch (e) { toast('触发失败：' + e.message); return; }
  for (let i = 0; i < 30; i++) {
    await sleep(15000);
    const r = await latestRun('Daily Market Briefing').catch(() => null);
    if (r && r.status === 'completed') {
      toast(r.conclusion === 'success' ? '✅ 完成，已推微信' : '❌ 失败，见 GitHub');
      reportDates = (await listDir('reports')).filter((f) => f.name.endsWith('.html')).map((f) => f.name.replace('.html', '')).sort().reverse();
      reportDatesIdx = 0;
      await loadHome();
      return;
    }
  }
  toast('仍在运行，稍后下拉刷新');
}

// ---------- AI 问答 ----------
async function loadQa() {
  try {
    const list = (await listDir('qa')).filter((f) => f.name.endsWith('.json')).map((f) => f.name.replace('.json', '')).sort().reverse();
    $('#qaList').innerHTML = list.length
      ? list.map((id) => `<button class="btn sec sm" style="margin:3px 0" onclick="showQa('${id}')">💬 ${id}</button>`).join('')
      : '<div class="small">还没有问答记录</div>';
  } catch (e) { $('#qaList').innerHTML = '<div class="small">加载失败</div>'; }
}
async function showQa(id) {
  try {
    const j = JSON.parse((await readFile(`qa/${id}.json`)).text);
    $('#askResult').innerHTML = `<div class="item"><b>❓ ${esc(j.question)}</b><div class="answer">${esc(j.answer)}</div></div>`;
  } catch (e) { toast('加载失败：' + e.message); }
}
async function askAi() {
  const q = $('#inQuestion').value.trim();
  if (!q) return toast('先写问题');
  $('#btnAsk').disabled = true;
  $('#askResult').innerHTML = '<div class="small">⏳ 已提交，约 1-2 分钟（答案也会推到你微信）…</div>';
  try { await dispatch('qa.yml', { question: q }); } catch (e) { $('#askResult').innerHTML = `<div class="small">触发失败：${esc(e.message)}</div>`; $('#btnAsk').disabled = false; return; }
  const before = new Set((await listDir('qa')).map((f) => f.name));
  for (let i = 0; i < 25; i++) {
    await sleep(12000);
    const now = (await listDir('qa')).map((f) => f.name);
    const added = now.find((n) => !before.has(n) && n.endsWith('.json'));
    if (added) {
      await showQa(added.replace('.json', ''));
      await loadQa();
      $('#inQuestion').value = '';
      $('#btnAsk').disabled = false;
      return;
    }
    $('#askResult').innerHTML = `<div class="small">⏳ 思考中…（第 ${i + 1} 次检查）</div>`;
  }
  $('#askResult').innerHTML = '<div class="small">超时。答案稍后到微信，刷新可看。</div>';
  $('#btnAsk').disabled = false;
}

// ---------- 持仓看板 + 编辑 ----------
async function loadBoard() {
  const box = $('#boardCard');
  try {
    const dates = (await listDir('reports')).filter((f) => f.name.endsWith('.json')).map((f) => f.name.replace('.json', '')).sort().reverse();
    if (!dates.length) { box.innerHTML = '<div class="small">暂无数据</div>'; return; }
    const j = JSON.parse((await readFile(`reports/${dates[0]}.json`)).text);
    let html = `<h2>💰 持仓看板 <span class="small">（${esc(j.date)}）</span></h2><table>
<tr><th>持仓</th><th>现价</th><th>日涨跌</th><th>市值</th><th>浮盈</th><th>占比</th><th></th></tr>`;
    for (const r of j.snapshot?.rows || []) {
      const pnlCls = r.pnl > 0 ? 'pos' : r.pnl < 0 ? 'neg' : '';
      html += `<tr><td><b>${esc(r.name === r.ticker ? r.ticker : `${r.name}（${r.ticker}）`)}</b><div class="small">${r.shares} 股 @ $${Number(r.cost).toFixed(2)}</div></td>
<td>${r.price ?? '—'}</td><td class="${r.change_pct > 0 ? 'pos' : r.change_pct < 0 ? 'neg' : ''}">${r.change_pct == null ? '—' : (r.change_pct > 0 ? '+' : '') + Number(r.change_pct).toFixed(1) + '%'}</td>
<td>${r.mv == null ? '—' : '$' + r.mv.toLocaleString()}</td><td class="${pnlCls}">${r.pnl == null ? '—' : (r.pnl >= 0 ? '+' : '') + '$' + r.pnl.toLocaleString()}</td><td>${r.weight ?? '—'}%</td>
<td><button class="btn sec sm" onclick="editHolding('${esc(r.ticker)}')">✏️</button></td></tr>`;
    }
    html += '</table>';
    if (j.snapshot?.cash != null) html += `<div class="small" style="margin-top:6px">现金 $${j.snapshot.cash.toLocaleString()} ｜ 总资产 $${(j.snapshot.total || 0).toLocaleString()}</div>`;
    const byTicker = new Map((j.report?.tickers || []).map((t) => [t.ticker, t]));
    for (const r of j.snapshot?.rows || []) {
      const t = byTicker.get(r.ticker);
      if (t?.ai_advice) html += `<div class="advice"><b>💡 ${esc(r.ticker)}</b>　${esc(t.ai_advice)}</div>`;
    }
    const bad = j.health ? Object.entries(j.health).filter(([, v]) => String(v).startsWith('error')).length : 0;
    html += `<div class="small" style="margin-top:8px">数据源：${bad === 0 ? '全部正常' : bad + ' 项出错'}（详见当日报告）</div>`;
    box.innerHTML = html;
    // 交易表单股票选项
    const opts = (j.snapshot?.rows || []).map((r) => `<option value="${esc(r.ticker)}">${esc(r.ticker)}（${r.shares} 股）</option>`).join('');
    $('#tradeTicker').innerHTML = opts || '<option>暂无持仓</option>';
  } catch (e) { box.innerHTML = '<div class="small">看板加载失败：' + esc(e.message) + '</div>'; }
  loadTrades();
}
async function editHolding(ticker) {
  try {
    const { text } = await readFile('config/watchlist.yaml');
    const b = tickerBlocks(text).find((x) => x.ticker === ticker);
    if (!b) return toast('找不到 ' + ticker);
    const get = (key, dft) => ((b.block.match(new RegExp('^\\s*' + key + ':\\s*(.+)$', 'm')) || [])[1] || dft || '').trim();
    const board = $('#boardCard');
    board.insertAdjacentHTML('beforeend', `<div class="card" id="editHoldingBox"><h2>✏️ 编辑 ${esc(ticker)}</h2>
<label>股数</label><input id="ehShares" type="number" value="${esc(get('shares', '0'))}">
<label>成本价 $</label><input id="ehCost" type="number" step="0.01" value="${esc(get('cost_basis', '0'))}">
<label>计划/触发线</label><textarea id="ehPlan" rows="2">${esc(get('plan', ''))}</textarea>
<div class="row"><button class="btn" onclick="saveHolding('${esc(ticker)}')">保存</button><button class="btn sec" onclick="document.getElementById('editHoldingBox').remove()">取消</button></div></div>`);
  } catch (e) { toast('失败：' + e.message); }
}
async function saveHolding(ticker) {
  try {
    const shares = $('#ehShares').value, cost = $('#ehCost').value, plan = $('#ehPlan').value;
    const { text, sha } = await readFile('config/watchlist.yaml');
    const updated = updateTicker(text, ticker, { shares, cost_basis: cost, plan: plan ? `"${plan}"` : null });
    await writeFile('config/watchlist.yaml', updated, `edit holding ${ticker}`, sha);
    toast('✅ 已保存，下次报告生效');
    document.getElementById('editHoldingBox').remove();
  } catch (e) { toast('保存失败：' + e.message); }
}

// ---------- 交易记录 ----------
async function recordTrade() {
  const ticker = $('#tradeTicker').value, side = $('#tradeSide').value;
  const shares = parseInt($('#tradeShares').value, 10), price = parseFloat($('#tradePrice').value);
  const note = $('#tradeNote').value.trim();
  if (!ticker || !shares || shares <= 0 || !price || price <= 0) return toast('填写完整（股数/价格必须为正数）');
  try {
    // 1) 更新 watchlist 持仓
    const wl = await readFile('config/watchlist.yaml');
    const b = tickerBlocks(wl.text).find((x) => x.ticker === ticker);
    if (!b) return toast('该股不在观察名单（先在"观察"页加入）');
    const g = (key) => parseFloat(((b.block.match(new RegExp('^\\s*' + key + ':\\s*([\\d.]+)', 'm')) || [])[1] || '0'));
    const oldShares = g('shares'), oldCost = g('cost_basis');
    let newShares, newCost, cashDelta;
    if (side === 'buy') {
      newShares = oldShares + shares;
      newCost = oldShares > 0 ? Math.round((oldShares * oldCost + shares * price) / newShares * 10000) / 10000 : price;
      cashDelta = -(shares * price);
    } else {
      if (shares > oldShares) return toast(`卖出超出持仓（现有 ${oldShares} 股）`);
      newShares = oldShares - shares;
      newCost = oldCost;
      cashDelta = shares * price;
    }
    const wlNew = updateTicker(wl.text, ticker, { shares: String(newShares), cost_basis: String(newCost) });
    await writeFile('config/watchlist.yaml', wlNew, `trade ${side} ${shares} ${ticker}`, wl.sha);

    // 2) 更新现金（账户记忆文件）
    try {
      const md = await readFile('context/portfolio-summary.md');
      const m = md.text.match(/\*\*现金\*\*：\$([\d,]+)/);
      if (m) {
        const newCash = Math.round(parseInt(m[1].replace(/,/g, ''), 10) + cashDelta);
        const mdNew = md.text.replace(/\*\*现金\*\*：\$[\d,]+/, '**现金**：$' + newCash.toLocaleString('en-US'));
        await writeFile('context/portfolio-summary.md', mdNew, `update cash after ${side} ${ticker}`, md.sha);
      }
    } catch (e) { console.warn('现金更新失败', e); }

    // 3) 追加交易台账
    const entry = `  - date: "${new Date().toISOString().slice(0, 10)}"\n    ticker: ${ticker}\n    side: ${side}\n    shares: ${shares}\n    price: ${price}\n    note: "${note || ''}"\n`;
    let trades = null;
    try { trades = await readFile('trades.yaml'); } catch (e) { /* 不存在 */ }
    const newTrades = trades ? trades.text.replace(/\s*$/, '\n') + entry : 'trades:\n' + entry;
    await writeFile('trades.yaml', newTrades, `trade ${side} ${shares} ${ticker}`, trades ? trades.sha : undefined);

    toast(`✅ 已记录：${side === 'buy' ? '买入' : '卖出'} ${shares} 股 ${ticker} @ $${price}`);
    $('#tradeShares').value = ''; $('#tradePrice').value = ''; $('#tradeNote').value = '';
    loadBoard();
  } catch (e) { toast('记录失败：' + e.message); }
}
async function loadTrades() {
  try {
    const { text } = await readFile('trades.yaml');
    const entries = [...text.matchAll(/^\s*- date: "([^"]+)"\n\s+ticker: (\S+)\n\s+side: (\S+)\n\s+shares: (\d+)\n\s+price: ([\d.]+)(?:\n\s+note: "([^"]*)")?/gm)];
    $('#tradeList').innerHTML = entries.length
      ? entries.slice(-15).reverse().map((m) => `<div class="item"><b>${m[1]}</b> ${m[3] === 'buy' ? '🟢买' : '🔴卖'} <b>${esc(m[2])}</b> ${m[4]} 股 @ $${m[5]}${m[6] ? `<div class="small">${esc(m[6])}</div>` : ''}</div>`).join('')
      : '<div class="small">还没有交易记录</div>';
  } catch (e) { $('#tradeList').innerHTML = '<div class="small">还没有交易记录</div>'; }
}

// ---------- 观察名单 ----------
async function loadWatch() {
  const box = $('#watchList');
  try {
    const { text } = await readFile('config/watchlist.yaml');
    const blocks = tickerBlocks(text);
    if (!blocks.length) { box.innerHTML = '<div class="small">暂无条目</div>'; return; }
    box.innerHTML = blocks.map((b) => {
      const role = b.block.includes('role: holding') ? '持仓' : '观察';
      const g = (key, dft) => (((b.block.match(new RegExp('^\\s*' + key + ':\\s*(.+)$', 'm')) || [])[1] || dft || '').trim());
      const trig = g('plan') || g('entry_trigger');
      return `<div class="item"><div><span class="tag ${role === '持仓' ? 't-fail' : 't-run'}">${role}</span> <b>${esc(b.ticker)}</b> <span class="small">${esc(g('name'))}</span></div>
${trig ? `<div class="small" style="margin:3px 0">${esc(trig)}</div>` : ''}
<div class="row" style="margin-top:5px"><button class="btn sec sm" onclick="editWatch('${esc(b.ticker)}')">✏️ 编辑</button><button class="btn danger sm" onclick="removeWatch('${esc(b.ticker)}')">🗑 删除</button></div></div>`;
    }).join('');
  } catch (e) { box.innerHTML = '<div class="small">加载失败：' + esc(e.message) + '</div>'; }
}
async function editWatch(ticker) {
  try {
    const { text } = await readFile('config/watchlist.yaml');
    const b = tickerBlocks(text).find((x) => x.ticker === ticker);
    if (!b) return toast('找不到 ' + ticker);
    const isHolding = b.block.includes('role: holding');
    const g = (key) => (((b.block.match(new RegExp('^\\s*' + key + ':\\s*(.+)$', 'm')) || [])[1] || '').trim());
    const parseFlow = (s) => { const m = s.match(/^\[(.*)\]$/); return m ? m[1].split(',').map((x) => x.trim().replace(/^"|"$/g, '')).filter(Boolean).join('；') : s; };
    $('#watchList').insertAdjacentHTML('beforebegin', `<div class="card" id="editWatchBox"><h2>✏️ 编辑 ${esc(ticker)}</h2>
<label>名称</label><input id="ewName" value="${esc(g('name'))}">
<label>${isHolding ? '计划/触发线' : '关注理由'}</label><textarea id="ewReason" rows="2">${esc(isHolding ? g('plan') : g('reason'))}</textarea>
<label>${isHolding ? '（持仓股建议去"持仓"页编辑股数/成本）' : '入场触发条件'}</label>${isHolding ? '' : `<textarea id="ewTrig" rows="2">${esc(g('entry_trigger'))}</textarea>`}
<label>新闻检索关键词（逗号分隔）</label><input id="ewKw" value="${esc(parseFlow(g('chain_keywords')))}">
<label>观察点（用；分隔）</label><input id="ewWf" value="${esc(parseFlow(g('watch_for')))}">
<div class="row"><button class="btn" onclick="saveWatch('${esc(ticker)}')">保存</button><button class="btn sec" onclick="document.getElementById('editWatchBox').remove()">取消</button></div></div>`);
  } catch (e) { toast('失败：' + e.message); }
}
async function saveWatch(ticker) {
  try {
    const name = $('#ewName').value.trim();
    const reason = $('#ewReason').value.trim();
    const trig = ($('#ewTrig') || { value: '' }).value.trim();
    const kw = $('#ewKw').value.split(/[,，]/).map((x) => x.trim()).filter(Boolean);
    const wf = $('#ewWf').value.split(/[;；]/).map((x) => x.trim()).filter(Boolean);
    const { text, sha } = await readFile('config/watchlist.yaml');
    const b = tickerBlocks(text).find((x) => x.ticker === ticker);
    const isHolding = b.block.includes('role: holding');
    const fields = { name: name ? `"${name}"` : null, chain_keywords: flowList(kw), watch_for: flowList(wf) };
    if (isHolding) fields.plan = reason ? `"${reason}"` : null;
    else { fields.reason = reason ? `"${reason}"` : null; fields.entry_trigger = trig ? `"${trig}"` : null; }
    const updated = updateTicker(text, ticker, fields);
    await writeFile('config/watchlist.yaml', updated, `edit watch ${ticker}`, sha);
    toast('✅ 已保存，下次晨报生效');
    document.getElementById('editWatchBox').remove();
    loadWatch();
  } catch (e) { toast('保存失败：' + e.message); }
}
async function removeWatch(ticker) {
  if (!confirm(`确定把 ${ticker} 从观察名单删除？`)) return;
  try {
    const { text, sha } = await readFile('config/watchlist.yaml');
    const updated = deleteTicker(text, ticker);
    await writeFile('config/watchlist.yaml', updated, `remove ${ticker}`, sha);
    toast('✅ 已删除');
    loadWatch();
  } catch (e) { toast('删除失败：' + e.message); }
}

// ---------- 加股：自动调研 → 加入 ----------
async function startResearch() {
  const t = $('#inTicker').value.trim().toUpperCase();
  if (!t) return toast('先填股票代码');
  const box = $('#researchResult');
  $('#btnResearch').disabled = true;
  try {
    const existing = await readFile(`research/${t}.json`);
    currentResearch = JSON.parse(existing.text);
    renderResearchCard(currentResearch);
    $('#btnResearch').disabled = false;
    return;
  } catch (e) { /* 走工作流 */ }
  box.innerHTML = '<div class="small">已触发调研工作流（约 2-3 分钟，完成会推微信）…</div>';
  try { await dispatch('research.yml', { ticker: t }); } catch (e) { box.innerHTML = `<div class="small">触发失败：${esc(e.message)}</div>`; $('#btnResearch').disabled = false; return; }
  for (let i = 0; i < 25; i++) {
    await sleep(12000);
    try {
      const f = await readFile(`research/${t}.json`);
      currentResearch = JSON.parse(f.text);
      renderResearchCard(currentResearch);
      $('#btnResearch').disabled = false;
      return;
    } catch (e) { box.innerHTML = `<div class="small">⏳ 调研中…（第 ${i + 1} 次检查）</div>`; }
  }
  box.innerHTML = '<div class="small">调研超时，去 GitHub Actions 查看状态</div>';
  $('#btnResearch').disabled = false;
}
function renderResearchCard(c) {
  const box = $('#researchResult');
  box.innerHTML = `<div style="margin-top:10px">
<div style="font-size:15px;font-weight:800">🔍 ${esc(c.ticker)}　${esc(c.name || '')}</div>
<div class="small">${esc(c.industry || '')}${c.quote != null ? ` ｜ 现价 $${c.quote}` : ''}</div>
<div style="font-size:13px;margin:6px 0">${esc(c.business || '')}</div>
${(c.catalysts || []).length ? `<div style="font-size:12.5px;color:#475569;margin:4px 0"><b>催化剂</b>：${c.catalysts.map(esc).join('；')}</div>` : ''}
${(c.risks || []).length ? `<div style="font-size:12.5px;color:#475569;margin:4px 0"><b>风险</b>：${c.risks.map(esc).join('；')}</div>` : ''}
${c.entry_trigger_suggestion ? `<div class="advice"><b>建议入场触发</b>　${esc(c.entry_trigger_suggestion)}</div>` : ''}
<div style="font-size:11.5px;color:#94a3b8;margin:4px 0">产业链：${(c.supply_chain || []).map(esc).join('；')}</div>
<button class="btn" onclick="addToWatchlist()">✅ 加入观察名单</button>
<button class="btn sec" style="margin-top:6px" onclick="startResearch()">🔄 重新调研</button>
</div>`;
}
async function addToWatchlist() {
  const c = currentResearch;
  if (!c) return toast('先完成调研');
  try {
    const { text, sha } = await readFile('config/watchlist.yaml');
    const block = `
  - ticker: ${c.ticker}
    role: watch
    name: "${c.name || c.ticker}"
    reason: "${c.business || '待确认'}"
    entry_trigger: "${c.entry_trigger_suggestion || '待确认'}"
    chain_keywords: ${flowList(c.chain_keywords || [])}
    watch_for: ${flowList(c.watch_for || [])}
    events: []
`;
    await writeFile('config/watchlist.yaml', text.replace(/\s*$/, '\n') + block + '\n', `watch: add ${c.ticker} (researched)`, sha);
    toast('✅ 已加入观察名单，下次晨报生效');
    loadWatch();
  } catch (e) { toast('提交失败：' + e.message); }
}

init();
