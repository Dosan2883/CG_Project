'use strict';

// [역할 3: 게임] 3/4 — 화면 UI (캔버스 위에 겹쳐 그림)
//   왼쪽 위 점수판(이닝별 점수·B/S/O·주자), 오른쪽 입력 패널, 가운데 알림 문구, 아래 상태 줄
//   버튼을 누르면 game.js의 입력 함수(G.onPitchButton 등)를 부릅니다.
(function () {
  const G = window.GAME_CONTROLLER;
  if (!G) return;
  const { RULES, ZONES } = G;

  const style = document.createElement('style');
  style.textContent = `
    #gameOverlay { position: absolute; pointer-events: none; z-index: 5; font-family: Arial, "Noto Sans KR", sans-serif; }
    #gameOverlay > * { pointer-events: auto; }
    #gameOverlay button { margin: 0; }
    .g-board { position: absolute; left: 10px; top: 10px; background: rgba(0,0,0,.65); border-radius: 6px; padding: 8px 10px; text-align: left; }
    .g-board table { border-collapse: collapse; font-size: 13px; }
    .g-board th, .g-board td { padding: 2px 7px; text-align: center; font-variant-numeric: tabular-nums; }
    .g-board th { color: #aaa; font-weight: normal; }
    .g-board td.team { text-align: left; font-weight: bold; }
    .g-board td.now { background: rgba(255,210,60,.25); }
    .g-board td.total { color: #ffd84a; font-weight: bold; border-left: 1px solid #555; }
    .g-situ { display: flex; align-items: center; gap: 14px; margin-top: 6px; font-size: 12px; }
    .g-count div { display: flex; align-items: center; gap: 4px; height: 16px; }
    .g-count b { width: 12px; display: inline-block; }
    .g-dot { width: 10px; height: 10px; border-radius: 50%; background: #444; display: inline-block; }
    .g-dot.b { background: #4cd964; } .g-dot.s { background: #ffcc00; } .g-dot.o { background: #ff3b30; }
    .g-diamond { position: relative; width: 44px; height: 44px; }
    .g-base { position: absolute; width: 13px; height: 13px; transform: rotate(45deg); border: 1px solid #aaa; background: #222; }
    .g-base.on { background: #ffd84a; border-color: #ffd84a; }
    .g-half { font-size: 13px; color: #9ecbff; font-weight: bold; }
    .g-panel { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); background: rgba(0,0,0,.65);
      border-radius: 6px; padding: 10px; width: 176px; }
    .g-title { font-size: 13px; color: #ddd; margin-bottom: 8px; }
    .g-grid { display: grid; grid-template-columns: 1fr; border: 2px solid #fff; margin: 0 auto; width: 130px; }
    .g-grid button { height: 54px; border: 1px solid rgba(255,255,255,.5); border-radius: 0; padding: 0;
      background: rgba(255,255,255,.1); color: #fff; font-size: 14px; }
    .g-grid button:hover:not(:disabled) { background: rgba(255,210,60,.6); color: #111; }
    .g-grid button.last { box-shadow: inset 0 0 0 2px rgba(255,210,60,.8); }
    .g-big { display: block; width: 100%; margin: 0 0 8px !important; padding: 10px 6px; font-size: 14px; font-weight: bold;
      border: 0; border-radius: 4px; }
    .g-swing { background: #ffd84a; color: #111; } .g-take { background: #3a7bd5; color: #fff; }
    .g-panel button:disabled { opacity: .4; cursor: default; }
    .g-hint { font-size: 11px; color: #aaa; margin-top: 8px; }
    .g-swing-now { font-size: 18px !important; padding: 16px 6px !important; }
    .g-timing { position: absolute; left: 50%; bottom: 18px; width: 360px; height: 18px; transform: translateX(-50%);
      background: rgba(0,0,0,.6); border: 1px solid rgba(255,255,255,.5); border-radius: 9px; display: none; pointer-events: none !important; }
    .g-tbar { position: absolute; inset: 0; border-radius: 9px; overflow: hidden; }
    .g-tbar span { position: absolute; top: 0; bottom: 0; }
    .g-tnow { position: absolute; top: -4px; bottom: -4px; width: 3px; background: #fff; box-shadow: 0 0 4px #000; }
    .g-tpress { position: absolute; top: -6px; bottom: -6px; width: 4px; background: #ff5050; display: none; }
    .g-tlabel { position: absolute; left: 0; right: 0; top: -22px; font-size: 13px; font-weight: bold; text-align: center;
      text-shadow: 0 1px 3px #000; }
    .g-toast { position: absolute; left: 50%; top: 28%; transform: translate(-50%, -50%); font-size: 40px; font-weight: bold;
      text-shadow: 0 2px 8px #000, 0 0 2px #000; pointer-events: none !important; transition: opacity .3s; white-space: nowrap; }
  `;
  document.head.append(style);

  const overlay = document.createElement('div');
  overlay.id = 'gameOverlay';
  overlay.innerHTML = '<div class="g-board"></div><div class="g-panel"></div><div class="g-toast"></div>' +
    '<div class="g-timing"><div class="g-tbar"></div><div class="g-tpress"></div><div class="g-tnow"></div><div class="g-tlabel"></div></div>';
  document.body.append(overlay);
  const boardEl = overlay.querySelector('.g-board');
  const panelEl = overlay.querySelector('.g-panel');
  const toastEl = overlay.querySelector('.g-toast');
  const timingEl = overlay.querySelector('.g-timing');
  const tBar = timingEl.querySelector('.g-tbar');
  const tNow = timingEl.querySelector('.g-tnow');
  const tPress = timingEl.querySelector('.g-tpress');
  const tLabel = timingEl.querySelector('.g-tlabel');

  // 화면 가운데 큰 알림 (ms 동안 보였다가 사라짐)
  let toastTimer = null;
  function toast(text, color = '#fff', ms = 1500) {
    toastEl.textContent = text;
    toastEl.style.color = color;
    toastEl.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.style.opacity = '0'; }, ms);
  }

  // 캔버스 아래 상태 줄 (투구 결과 한 줄 설명)
  function log(text) {
    const status = document.getElementById('status');
    if (status) status.textContent = text;
  }

  function renderBoard(state) {
    const head = Array.from({ length: RULES.innings }, (_, i) => `<th>${i + 1}</th>`).join('');
    const row = (team, name, half) => {
      const cells = state.line[team].map((v, i) => {
        const now = !state.over && !state.choosing && state.inning === i + 1 && state.half === half;
        return `<td class="${now ? 'now' : ''}">${v ?? ''}</td>`;
      }).join('');
      return `<tr><td class="team">${name}</td>${cells}<td class="total">${state.score[team]}</td></tr>`;
    };
    const dots = (n, max, cls) => Array.from({ length: max }, (_, i) => `<span class="g-dot ${i < n ? cls : ''}"></span>`).join('');
    const base = (on, left, top) => `<span class="g-base ${on ? 'on' : ''}" style="left:${left}px;top:${top}px"></span>`;
    const halfText = state.over ? '경기 종료' : state.choosing ? '경기 전'
      : `${state.inning}회${state.half === 'top' ? '초' : '말'} · ${G.playerBatting() ? '공격' : '수비'}`;
    // 위 줄 = 선공 팀(회 초에 공격), 아래 줄 = 후공 팀(회 말에 공격)
    const away = state.order === 'offense' ? 'me' : 'cpu', home = away === 'me' ? 'cpu' : 'me';
    // 팀을 고른 뒤에는 팀 이름(짧게), 고르기 전에는 나 / CPU
    const names = state.teams
      ? { me: `${G.TEAMS[state.teams.me].short}(나)`, cpu: G.TEAMS[state.teams.cpu].short }
      : { me: '나', cpu: 'CPU' };
    boardEl.innerHTML = `
      <table><tr><th></th>${head}<th>R</th></tr>${row(away, names[away], 'top')}${row(home, names[home], 'bottom')}</table>
      <div class="g-situ">
        <div class="g-count">
          <div><b>B</b>${dots(state.balls, 3, 'b')}</div>
          <div><b>S</b>${dots(state.strikes, 2, 's')}</div>
          <div><b>O</b>${dots(state.outs, 2, 'o')}</div>
        </div>
        <div class="g-diamond">${base(state.bases[1], 15, 2)}${base(state.bases[2], 2, 15)}${base(state.bases[0], 28, 15)}</div>
        <div class="g-half">${halfText}</div>
      </div>`;
  }

  function gridHtml(state, markLast) {
    return `<div class="g-grid">${ZONES.map((zone, b) =>
      `<button type="button" data-b="${b}" class="${markLast && b === state.lastPitchButton ? 'last' : ''}">${b + 1} · ${zone.label}</button>`).join('')}</div>`;
  }

  // 오른쪽 입력 패널: 수비면 칸 버튼, 공격이면 휘두르기/안 휘두르기 버튼, 경기 끝이면 다시 시작
  function renderPanel(state) {
    const disabled = state.busy ? 'disabled' : '';
    panelEl.style.display = state.choosing ? 'none' : '';
    if (state.over) {
      const { me, cpu } = state.score;
      panelEl.innerHTML = `<div class="g-title">경기 종료<br><b style="font-size:20px">나 ${me} : ${cpu} CPU</b></div>
        <button type="button" class="g-big g-swing" data-act="restart">다시 시작</button>`;
    } else if (state.choosing) {
      panelEl.innerHTML = ''; // 타이틀·팀 고르기 화면(intro.js)이 대신 보임
    } else if (!G.playerBatting()) {
      // 수비: 3칸 중 던질 칸 (확률은 일부러 보여 주지 않음)
      panelEl.innerHTML = `<div class="g-title">수비 · 던질 칸을 고르세요</div>${gridHtml(state, true)}
        <div class="g-hint">Q: 마지막 칸으로 다시 던지기</div>`;
    } else {
      // 공격(타이밍): 투구 받기 → 공이 오면 스윙
      const phase = state.batPhase;
      const canSwing = phase === 'pitch' && state.swingWindow?.press == null;
      const main = phase === 'ready'
        ? `<button type="button" class="g-big g-take" data-act="request" ${disabled}>투구 받기 (Enter)</button>`
        : `<button type="button" class="g-big g-swing g-swing-now" data-act="swing" ${canSwing ? '' : 'disabled'}>` +
          `${phase === 'windup' ? '준비…' : canSwing ? '스윙! (F)' : '…'}</button>`;
      panelEl.innerHTML = `<div class="g-title">공격 · 타이밍 맞춰 치기</div>${main}
        <div class="g-hint">공이 오면 F 키 또는 버튼으로 스윙</div>`;
    }
    panelEl.querySelectorAll('.g-grid button').forEach((button) => { button.disabled = state.busy; });
  }

  panelEl.addEventListener('click', (e) => {
    const button = e.target.closest('button');
    const state = G.state;
    if (!button || button.disabled || !state) return;
    button.blur(); // 버튼에 포커스가 남아 Space 등이 버튼을 누르지 않도록
    if (button.dataset.b != null) {
      const b = Number(button.dataset.b);
      if (!G.playerBatting()) G.onPitchButton(b);
      return;
    }
    const act = button.dataset.act;
    if (act === 'restart') G.newGame();
    else if (act === 'request') G.requestPitch();
    else if (act === 'swing') G.pressSwing();
  });

  // 점수판·패널·주자를 지금 상태(G.state)대로 다시 그림
  function render() {
    const state = G.state;
    if (!state) return;
    renderBoard(state);
    renderPanel(state);
    // 주자 = 공격 팀 유니폼 색
    const batting = G.battingTeamKey?.();
    G.showRunners?.(state.over || state.choosing ? [] : state.bases, batting ? G.TEAMS[batting].color : [200, 200, 200]);
    G.updateScoreboard?.(state); // 외야 전광판 (scoreboard.js)
  }

  // 오버레이를 캔버스 위에 정확히 겹침 (창 크기·스크롤이 바뀌어도 따라감)
  const canvas = document.getElementById('glCanvas');
  function placeOverlay() {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    overlay.style.left = `${rect.left + window.scrollX}px`;
    overlay.style.top = `${rect.top + window.scrollY}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
  }
  // ------------------------------------------------------------------
  // 타이밍 바 (공격할 때 화면 아래): 공이 나온 순간(왼쪽) → 도착 뒤 늦게 칠 수 있는 끝(오른쪽)
  //   색 구간 = 스윙 버튼을 누르기 좋은 때 (금색 완벽, 초록 좋음, 회색 아슬아슬)
  //   흰 선 = 지금 시각, 빨간 선 = 내가 누른 시각
  // ------------------------------------------------------------------
  const WINDOW_COLORS = { perfect: '#ffd23c', good: '#4cd964', edge: 'rgba(200,220,200,.55)' };
  let barFor = null; // 지금 그려 둔 색 구간이 어느 투구 것인지
  function updateTiming(now) {
    const state = G.state;
    const w = state?.swingWindow ?? state?.lastSwing;
    if (!w || !G.playerBatting()) { timingEl.style.display = 'none'; return; }
    timingEl.style.display = 'block';
    const windows = RULES.batting.windows;
    const end = w.ideal + windows[windows.length - 1].within;
    const span = end - w.start;
    const x = (t) => `${Math.max(0, Math.min(1, (t - w.start) / span)) * 100}%`;
    if (barFor !== w.start) { // 투구마다 색 구간을 한 번만 그림 (넓은 구간부터 깔고 좁은 구간을 위에)
      barFor = w.start;
      tBar.innerHTML = [...windows].reverse().map((win) =>
        `<span style="left:${x(w.ideal - win.within)};right:calc(100% - ${x(w.ideal + win.within)});background:${WINDOW_COLORS[win.key] ?? '#888'}"></span>`).join('');
    }
    tNow.style.left = x(state.swingWindow ? now : (w.press ?? end));
    tPress.style.display = w.press != null ? 'block' : 'none';
    if (w.press != null) tPress.style.left = x(w.press);
    if (state.swingWindow) tLabel.textContent = '';
    else if (w.press == null) tLabel.textContent = '스윙 안 함';
    else if (w.window) tLabel.textContent = `${w.window.label} (${w.error < 0 ? '-' : '+'}${Math.round(Math.abs(w.error) * 1000)}ms)`;
    else tLabel.textContent = `${w.error < 0 ? '너무 빨라요' : '너무 늦어요'} (${Math.round(Math.abs(w.error) * 1000)}ms)`;
  }

  const prevUpdate = window.updateBaseballScene;
  window.updateBaseballScene = function (timeSec, dt) {
    if (typeof prevUpdate === 'function') prevUpdate(timeSec, dt);
    placeOverlay();
    updateTiming(timeSec);
  };

  Object.assign(G, { toast, log, render });
})();
