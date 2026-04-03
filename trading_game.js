const SUITS = ['♠','♥','♦','♣'];
const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const ALL_CARDS = [];
SUITS.forEach(s => RANKS.forEach(r => ALL_CARDS.push(r + s)));
const isRed  = c => c.endsWith('♥') || c.endsWith('♦');
const rankOf = c => c.replace(/[♠♥♦♣]/g, '');

const HOST_PIN      = '1234';
const TRADE_BONUS   = 10;
const TRADE_PENALTY = 50;
const MIN_TRADES    = 3;

let state         = { teams: {}, trades: [], tradingOpen: false, revealed: false, rankValues: {} };
let currentTeam   = null;
let isHost        = false;
let mySelCards    = [];
let theirSelCards = [];
let realtimeUnsub = null;

// ── Firebase persistence ───────────────────────────────────────────────────

async function save() {
  try {
    await STATE_REF.set(state);
  } catch(e) {
    console.error('Firebase save error:', e);
  }
}

async function load() {
  try {
    const snap = await STATE_REF.get();
    if (snap.exists()) state = snap.val();
    if (!state.trades)     state.trades     = [];
    if (!state.teams)      state.teams      = {};
    if (!state.rankValues) state.rankValues = {};
  } catch(e) {
    console.error('Firebase load error:', e);
  }
}

// ── Realtime listener ──────────────────────────────────────────────────────

function startPoll() {
  stopPoll();
  realtimeUnsub = STATE_REF.on('value', snap => {
    if (!snap.exists()) return;
    state = snap.val();
    if (!state.trades)     state.trades     = [];
    if (!state.teams)      state.teams      = {};
    if (!state.rankValues) state.rankValues = {};
    if (isHost)       refreshHostDashboard();
    else if (currentTeam) refreshTeamScreen();
  });
}

function stopPoll() {
  if (realtimeUnsub !== null) {
    STATE_REF.off('value', realtimeUnsub);
    realtimeUnsub = null;
  }
}

// ── Screen routing ─────────────────────────────────────────────────────────

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if (id === 'login-screen')   populateLoginTeams();
  if (id === 'host-screen')    refreshHostDashboard();
  if (id === 'setup-screen')   refreshSetupTeams();
  if (id === 'values-screen')  buildValueInputs();
  if (id === 'results-screen') buildResults();
}

// ── Card chip helper ───────────────────────────────────────────────────────

function makeChip(card, clickable, selected, onClick) {
  const chip = document.createElement('span');
  chip.className = 'card-chip'
    + (isRed(card) ? ' red'       : '')
    + (clickable   ? ' clickable' : '')
    + (selected    ? ' sel'       : '');
  chip.textContent = card;
  if (onClick) chip.addEventListener('click', onClick);
  return chip;
}

// ── Host login ─────────────────────────────────────────────────────────────

async function doHostLogin() {
  const pin = document.getElementById('host-pin-input').value;
  if (pin === HOST_PIN) {
    isHost = true;
    showScreen('setup-screen');
    startPoll();
  } else {
    document.getElementById('host-login-error').textContent = 'Incorrect PIN.';
  }
}

// ── Team login ─────────────────────────────────────────────────────────────

function populateLoginTeams() {
  const sel = document.getElementById('login-team-select');
  sel.innerHTML = '<option value="">— choose team —</option>';
  Object.keys(state.teams).forEach(n => {
    const o = document.createElement('option');
    o.value = n; o.textContent = n; sel.appendChild(o);
  });
}

async function doLogin() {
  await load();
  const name = document.getElementById('login-team-select').value;
  const pin  = document.getElementById('login-pin').value;
  const err  = document.getElementById('login-error');
  if (!name) { err.textContent = 'Select your team.'; return; }
  if (!state.teams[name]) { err.textContent = 'Team not found.'; return; }
  if (String(state.teams[name].pin) !== String(pin)) { err.textContent = 'Wrong PIN.'; return; }
  if (!state.tradingOpen) { err.textContent = 'Trading not open yet — check back soon.'; return; }
  currentTeam = name; isHost = false; err.textContent = '';
  showScreen('team-screen');
  refreshTeamScreen();
  startPoll();
}

function doLogout() {
  currentTeam = null; isHost = false;
  stopPoll();
  showScreen('login-screen');
}

// ── Setup ──────────────────────────────────────────────────────────────────

function addTeam() {
  const name = document.getElementById('new-team-name').value.trim();
  const pin  = document.getElementById('new-team-pin').value.trim();
  if (!name || !pin) return;
  if (state.teams[name]) { alert('Name already taken.'); return; }
  const cap = parseInt(document.getElementById('starting-capital').value) || 1500;
  state.teams[name] = { pin, cash: cap, cards: [...ALL_CARDS], trades: 0 };
  save(); refreshSetupTeams();
  document.getElementById('new-team-name').value = '';
  document.getElementById('new-team-pin').value  = '';
}

function refreshSetupTeams() {
  const list = document.getElementById('team-list');
  list.innerHTML = '';
  Object.entries(state.teams).forEach(([name, t]) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-top:0.5px solid var(--color-border-tertiary); font-size:13px;';
    row.innerHTML = `<span>${name}</span><span style="color:var(--color-text-secondary)">PIN: ${t.pin} &nbsp;·&nbsp; $${t.cash}</span>`;
    const btn = document.createElement('button');
    btn.className = 'btn'; btn.style.cssText = 'font-size:11px; padding:4px 8px;';
    btn.textContent = 'Remove';
    btn.addEventListener('click', () => removeTeam(name));
    row.appendChild(btn);
    list.appendChild(row);
  });
}

function removeTeam(name) { delete state.teams[name]; save(); refreshSetupTeams(); }

function applyCapital() {
  const cap = parseInt(document.getElementById('starting-capital').value);
  if (isNaN(cap)) return;
  Object.keys(state.teams).forEach(n => { state.teams[n].cash = cap; });
  save(); refreshSetupTeams();
}

function finalizeSetup() {
  if (!Object.keys(state.teams).length) {
    document.getElementById('setup-msg').textContent = 'Add at least one team first.';
    return;
  }
  state.tradingOpen = true; save();
  document.getElementById('setup-msg').textContent = 'Trading is now open!';
  setTimeout(() => showScreen('host-screen'), 800);
}

// ── Team screen ────────────────────────────────────────────────────────────

function refreshTeamScreen() {
  if (!currentTeam || !state.teams[currentTeam]) return;
  const t = state.teams[currentTeam];
  document.getElementById('team-screen-name').textContent  = currentTeam;
  document.getElementById('t-cash').textContent        = '$' + t.cash.toLocaleString();
  document.getElementById('t-card-count').textContent  = t.cards.length;
  document.getElementById('t-trade-count').textContent = t.trades || 0;

  if (state.revealed) {
    document.getElementById('team-screen-status').textContent = 'Trading closed — final results below';
    const banner = document.getElementById('team-results-banner');
    banner.style.display = 'block';
    const scores = calcAllScores();
    const mine   = scores.find(s => s.name === currentTeam);
    const rank   = scores.findIndex(s => s.name === currentTeam) + 1;
    const medals = ['1st','2nd','3rd'];
    banner.innerHTML = `<p style="font-size:15px; font-weight:500; margin-bottom:4px;">${medals[rank-1]||(rank+'th')} place — Final score: $${mine.total.toLocaleString()}</p>
      <p style="font-size:12px; color:var(--color-text-secondary);">Cash $${mine.cash.toLocaleString()} + Cards $${Math.round(mine.cardVal).toLocaleString()} + Bonuses $${mine.tradeBonuses}${mine.penalty?' − Penalty $'+mine.penalty:''}</p>`;
  }

  const grid = document.getElementById('my-cards-grid');
  grid.innerHTML = '';
  RANKS.forEach(r => {
    t.cards.filter(c => rankOf(c) === r).forEach(c => {
      grid.appendChild(makeChip(c, false, false, null));
    });
  });

  refreshOtherTeams();

  const pending = state.trades.filter(tr => tr.to === currentTeam && tr.status === 'pending').length;
  const badge   = document.getElementById('inbox-badge');
  if (pending > 0) { badge.style.display = 'inline'; badge.textContent = pending; }
  else badge.style.display = 'none';
}

function refreshOtherTeams() {
  const sel = document.getElementById('trade-target-team');
  const cur = sel.value;
  sel.innerHTML = '<option value="">— select team —</option>';
  Object.keys(state.teams).filter(n => n !== currentTeam).forEach(n => {
    const o = document.createElement('option'); o.value = n; o.textContent = n; sel.appendChild(o);
  });
  if (cur && state.teams[cur]) sel.value = cur;
}

// ── Trade proposal ─────────────────────────────────────────────────────────

function onTargetChange() {
  theirSelCards = [];
  refreshTheirCards();
  renderMyOfferCards();
}

function onCashInput() {
  const myCash    = parseInt(document.getElementById('my-offer-cash').value)    || 0;
  const theirCash = parseInt(document.getElementById('their-offer-cash').value) || 0;
  if (myCash > 0 && theirCash > 0) {
    document.getElementById('their-offer-cash').value = 0;
  }
}

function renderMyOfferCards() {
  const grid = document.getElementById('my-offer-cards');
  grid.innerHTML = '';
  const t = state.teams[currentTeam];
  if (!t) return;
  RANKS.forEach(r => {
    t.cards.filter(c => rankOf(c) === r).forEach(c => {
      const selected = mySelCards.includes(c);
      const chip = makeChip(c, true, selected, () => {
        const i = mySelCards.indexOf(c);
        if (i >= 0) mySelCards.splice(i, 1); else mySelCards.push(c);
        renderMyOfferCards();
      });
      grid.appendChild(chip);
    });
  });
}

function refreshTheirCards() {
  const team = document.getElementById('trade-target-team').value;
  const grid = document.getElementById('their-offer-cards');
  grid.innerHTML = '';
  if (!team || !state.teams[team]) return;
  RANKS.forEach(r => {
    state.teams[team].cards.filter(c => rankOf(c) === r).forEach(c => {
      const chip = makeChip(c, true, theirSelCards.includes(c), () => {
        const i = theirSelCards.indexOf(c);
        if (i >= 0) { theirSelCards.splice(i, 1); chip.classList.remove('sel'); }
        else         { theirSelCards.push(c);      chip.classList.add('sel');    }
      });
      grid.appendChild(chip);
    });
  });
}

function clearTrade() {
  mySelCards = []; theirSelCards = [];
  document.getElementById('my-offer-cash').value     = '';
  document.getElementById('their-offer-cash').value  = '';
  document.getElementById('trade-target-team').value = '';
  renderMyOfferCards(); refreshTheirCards();
  document.getElementById('trade-msg').textContent = '';
}

function setTradeMsg(text, isError) {
  const el = document.getElementById('trade-msg');
  el.style.color = isError ? 'var(--color-text-danger)' : 'var(--color-text-success)';
  el.textContent = text;
}

async function submitTrade() {
  const target    = document.getElementById('trade-target-team').value;
  const myCash    = parseInt(document.getElementById('my-offer-cash').value)    || 0;
  const theirCash = parseInt(document.getElementById('their-offer-cash').value) || 0;

  if (!target) { setTradeMsg('Select a team to trade with.', true); return; }
  if (state.revealed) { setTradeMsg('Trading is closed.', true); return; }

  const myCards    = mySelCards.length;
  const theirCards = theirSelCards.length;

  if (myCards === 0 && theirCards === 0)
    { setTradeMsg('Select at least one card to include.', true); return; }
  if (myCash > 0 && theirCash > 0)
    { setTradeMsg('Only one side can offer cash.', true); return; }
  if (myCards > 0 && theirCards > 0 && myCash === 0 && theirCash === 0)
    { setTradeMsg('Card-for-card trades are not allowed. One side must offer cash.', true); return; }
  if (myCards === 0 && theirCards === 0 && (myCash > 0 || theirCash > 0))
    { setTradeMsg('Cash-for-cash trades are not allowed.', true); return; }

  await load();
  const myTeam = state.teams[currentTeam];
  if (myCash > myTeam.cash) { setTradeMsg("You don't have enough cash.", true); return; }
  for (const c of mySelCards) {
    if (!myTeam.cards.includes(c)) { setTradeMsg(`You no longer hold ${c}.`, true); return; }
  }

  if (!state.trades) state.trades = [];
  state.trades.push({
    id: Date.now(),
    from: currentTeam, to: target,
    fromCards: [...mySelCards], toCards: [...theirSelCards],
    fromCash: myCash, toCash: theirCash,
    status: 'pending',
    time: new Date().toLocaleTimeString()
  });
  await save();
  setTradeMsg('Proposal sent!', false);
  clearTrade();
}

// ── Inbox ──────────────────────────────────────────────────────────────────

function refreshInbox() {
  const list = document.getElementById('inbox-list');
  list.innerHTML = '';
  const incoming = state.trades.filter(tr => tr.to === currentTeam && tr.status === 'pending');
  if (!incoming.length) {
    const p = document.createElement('p');
    p.style.cssText = 'font-size:13px; color:var(--color-text-secondary);';
    p.textContent = 'No pending proposals.';
    list.appendChild(p); return;
  }
  incoming.forEach(trade => {
    const div  = document.createElement('div'); div.className = 'trade-row';
    const info = document.createElement('div');
    info.style.cssText = 'display:flex; justify-content:space-between; align-items:flex-start; gap:8px;';
    const details = document.createElement('div');
    details.innerHTML = `<p style="font-size:13px; font-weight:500; margin-bottom:4px;">From ${trade.from} <span style="font-weight:400; color:var(--color-text-secondary)">at ${trade.time}</span></p>
      <p style="font-size:12px; color:var(--color-text-secondary);">They give: ${trade.fromCards.join(' ')||'—'}${trade.fromCash?' + $'+trade.fromCash:''}</p>
      <p style="font-size:12px; color:var(--color-text-secondary);">You give:  ${trade.toCards.join(' ')  ||'—'}${trade.toCash ?' + $'+trade.toCash :''}</p>`;
    const btns = document.createElement('div');
    btns.style.cssText = 'display:flex; gap:6px; flex-shrink:0;';
    const accept = document.createElement('button');
    accept.className = 'btn btn-success'; accept.style.cssText = 'font-size:12px; padding:5px 10px;';
    accept.textContent = 'Accept';
    accept.addEventListener('click', () => respondTrade(trade.id, true));
    const reject = document.createElement('button');
    reject.className = 'btn btn-danger'; reject.style.cssText = 'font-size:12px; padding:5px 10px;';
    reject.textContent = 'Reject';
    reject.addEventListener('click', () => respondTrade(trade.id, false));
    btns.appendChild(accept); btns.appendChild(reject);
    info.appendChild(details); info.appendChild(btns);
    div.appendChild(info);
    list.appendChild(div);
  });
}

async function respondTrade(tradeId, accept) {
  await load();
  const trade = state.trades.find(t => t.id === tradeId);
  if (!trade || trade.status !== 'pending') return;
  if (accept) {
    const from = state.teams[trade.from];
    const to   = state.teams[trade.to];
    if (!from || !to) return;
    if (from.cash < trade.fromCash) { alert(`${trade.from} no longer has enough cash.`); return; }
    if (to.cash   < trade.toCash)   { alert("You don't have enough cash."); return; }
    for (const c of trade.fromCards) {
      if (!from.cards.includes(c)) { alert(`${trade.from} no longer holds ${c}.`); return; }
    }
    for (const c of trade.toCards) {
      if (!to.cards.includes(c)) { alert(`You no longer hold ${c}.`); return; }
    }
    from.cash = from.cash - trade.fromCash + trade.toCash + TRADE_BONUS;
    to.cash   = to.cash   - trade.toCash   + trade.fromCash + TRADE_BONUS;
    trade.fromCards.forEach(c => { from.cards.splice(from.cards.indexOf(c), 1); to.cards.push(c); });
    trade.toCards.forEach(c   => { to.cards.splice(to.cards.indexOf(c),     1); from.cards.push(c); });
    from.trades = (from.trades || 0) + 1;
    to.trades   = (to.trades   || 0) + 1;
    trade.status = 'accepted';
  } else {
    trade.status = 'rejected';
  }
  await save();
  refreshTeamScreen();
}

// ── Host dashboard ─────────────────────────────────────────────────────────

function refreshHostDashboard() {
  const pf = document.getElementById('host-portfolios');
  pf.innerHTML = '';
  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid; grid-template-columns:repeat(auto-fill, minmax(240px,1fr)); gap:10px; margin-bottom:12px;';
  Object.entries(state.teams).forEach(([name, t]) => {
    const card = document.createElement('div');
    card.className = 'section-card'; card.style.marginBottom = '0';
    const ok      = (t.trades||0) >= MIN_TRADES;
    const pending = state.trades.filter(tr => tr.status === 'pending' && (tr.from === name || tr.to === name)).length;
    const cardsDiv = document.createElement('div');
    cardsDiv.className = 'cards-grid';
    cardsDiv.style.cssText = 'max-height:80px; overflow:auto; margin-top:6px;';
    RANKS.forEach(r => {
      t.cards.filter(c => rankOf(c) === r).forEach(c => cardsDiv.appendChild(makeChip(c, false, false, null)));
    });
    card.innerHTML = `<p style="font-weight:500; margin-bottom:6px;">${name}</p>
      <p style="font-size:13px; margin-bottom:2px;">Cash: <strong>$${t.cash.toLocaleString()}</strong></p>
      <p style="font-size:13px; margin-bottom:6px;">Trades: <strong>${t.trades||0}</strong>
        <span class="badge ${ok?'badge-accepted':'badge-pending'}">${ok?'qualified':(MIN_TRADES-(t.trades||0))+' more needed'}</span>
        ${pending?`<span class="badge badge-pending">${pending} pending</span>`:''}</p>`;
    card.appendChild(cardsDiv);
    grid.appendChild(card);
  });
  pf.appendChild(grid);

  const log = document.getElementById('host-tx-log');
  log.innerHTML = '';
  const done = [...state.trades].reverse();
  if (!done.length) {
    const p = document.createElement('p');
    p.style.cssText = 'font-size:13px; color:var(--color-text-secondary);';
    p.textContent = 'No trades yet.'; log.appendChild(p); return;
  }
  done.forEach(tr => {
    const row = document.createElement('div'); row.className = 'trade-row';
    row.innerHTML = `<span class="badge badge-${tr.status}" style="margin-right:6px;">${tr.status}</span>
      <span style="font-size:13px;">${tr.from} → ${tr.to} &nbsp; [give: ${tr.fromCards.join(' ')||'—'}${tr.fromCash?' +$'+tr.fromCash:''}] ↔ [receive: ${tr.toCards.join(' ')||'—'}${tr.toCash?' +$'+tr.toCash:''}]</span>
      <span style="font-size:12px; color:var(--color-text-secondary); margin-left:6px;">${tr.time}</span>`;
    log.appendChild(row);
  });
}

// ── Card values ────────────────────────────────────────────────────────────

function buildValueInputs() {
  const area = document.getElementById('rank-value-inputs');
  area.innerHTML = '';
  RANKS.forEach(r => {
    const wrap = document.createElement('div');
    const lbl  = document.createElement('label');
    lbl.style.cssText = 'font-size:12px; color:var(--color-text-secondary); display:block; margin-bottom:3px; font-weight:500;';
    lbl.textContent = r;
    const inp = document.createElement('input');
    inp.type = 'number'; inp.id = 'rv-' + r; inp.placeholder = '0'; inp.min = '0';
    inp.value = state.rankValues[r] !== undefined ? state.rankValues[r] : '';
    wrap.appendChild(lbl); wrap.appendChild(inp);
    area.appendChild(wrap);
  });
}

async function saveCardValues() {
  RANKS.forEach(r => {
    const v = parseFloat(document.getElementById('rv-' + r).value);
    state.rankValues[r] = isNaN(v) ? 0 : v;
  });
  await save();
  const msg = document.getElementById('values-save-msg');
  msg.textContent = 'Values saved.';
  setTimeout(() => { msg.textContent = ''; }, 2000);
}

// ── Scoring & results ──────────────────────────────────────────────────────

function calcAllScores() {
  return Object.entries(state.teams).map(([name, t]) => {
    const cardVal      = t.cards.reduce((sum, c) => sum + (state.rankValues[rankOf(c)] || 0), 0);
    const tradeBonuses = (t.trades||0) * TRADE_BONUS;
    const penalty      = (t.trades||0) < MIN_TRADES ? TRADE_PENALTY : 0;
    const total        = t.cash + cardVal + tradeBonuses - penalty;
    return { name, cash: t.cash, cardVal, trades: t.trades||0, tradeBonuses, penalty, total };
  }).sort((a,b) => b.total - a.total);
}

async function doReveal() {
  await saveCardValues();
  state.revealed = true;
  await save();
  showScreen('results-screen');
}

function buildResults() {
  const scores  = calcAllScores();
  const content = document.getElementById('results-content');
  content.innerHTML = '';

  const rankTable = document.createElement('div');
  rankTable.className = 'section-card'; rankTable.style.marginBottom = '12px';
  rankTable.innerHTML = '<p style="font-weight:500; margin-bottom:10px;">Card values revealed</p>';
  const rg = document.createElement('div');
  rg.style.cssText = 'display:grid; grid-template-columns:repeat(4,1fr); gap:6px;';
  RANKS.forEach(r => {
    const cell = document.createElement('div');
    cell.style.cssText = 'font-size:13px; padding:6px 8px; background:var(--color-background-secondary); border-radius:var(--border-radius-md); display:flex; justify-content:space-between;';
    cell.innerHTML = `<span style="font-weight:500;">${r}</span><span style="color:var(--color-text-secondary);">$${state.rankValues[r]||0}</span>`;
    rg.appendChild(cell);
  });
  rankTable.appendChild(rg); content.appendChild(rankTable);

  const scoreCard = document.createElement('div');
  scoreCard.className = 'section-card';
  scoreCard.innerHTML = '<p style="font-weight:500; margin-bottom:10px;">Final standings</p>';
  const medals = ['1st','2nd','3rd'];
  scores.forEach((s, i) => {
    const row = document.createElement('div'); row.className = 'trade-row';
    row.innerHTML = `<div style="display:flex; justify-content:space-between; align-items:center; ${i===0?'background:var(--color-background-warning); margin:-4px -8px; padding:8px; border-radius:var(--border-radius-md);':''}">
      <span style="font-size:14px; font-weight:500;">${medals[i]||(i+1)+'th'} — ${s.name}</span>
      <span style="font-size:16px; font-weight:500;">$${s.total.toLocaleString()}</span>
    </div>
    <p style="font-size:12px; color:var(--color-text-secondary); margin-top:4px;">Cash $${s.cash.toLocaleString()} + Cards $${Math.round(s.cardVal).toLocaleString()} + Bonuses $${s.tradeBonuses}${s.penalty?' − Penalty $'+s.penalty:''}</p>`;
    scoreCard.appendChild(row);
  });
  content.appendChild(scoreCard);
}

// ── Tabs ───────────────────────────────────────────────────────────────────

function switchTab(tabId, el) {
  ['portfolio-tab','propose-tab','inbox-tab'].forEach(id => {
    document.getElementById(id).style.display = id === tabId ? 'block' : 'none';
  });
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  if (tabId === 'propose-tab') { renderMyOfferCards(); refreshTheirCards(); }
  if (tabId === 'inbox-tab')   refreshInbox();
}

// ── Boot ───────────────────────────────────────────────────────────────────

(async () => {
  await load();
  document.getElementById('loading-overlay').style.display = 'none';
  showScreen('login-screen');
})();
