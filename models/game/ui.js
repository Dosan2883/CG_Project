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
    .g-cancel { margin-top: 8px !important; font-size: 12px; padding: 4px 10px; }
    .g-panel button:disabled { opacity: .4; cursor: default; }
    .g-hint { font-size: 11px; color: #aaa; margin-top: 8px; }
    .g-toast { position: absolute; left: 50%; top: 28%; transform: translate(-50%, -50%); font-size: 40px; font-weight: bold;
      text-shadow: 0 2px 8px #000, 0 0 2px #000; pointer-events: none !important; transition: opacity .3s; white-space: nowrap; }
  `;
  document.head.append(style);

  const overlay = document.createElement('div');
  overlay.id = 'gameOverlay';
  overlay.innerHTML = '<div class="g-board"></div><div class="g-panel"></div><div class="g-toast"></div>';
  document.body.append(overlay);
  const boardEl = overlay.querySelector('.g-board');
  const panelEl = overlay.querySelector('.g-panel');
  const toastEl = overlay.querySelector('.g-toast');

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
        const now = !state.over && state.inning === i + 1 && state.half === half;
        return `<td class="${now ? 'now' : ''}">${v ?? ''}</td>`;
      }).join('');
      return `<tr><td class="team">${name}</td>${cells}<td class="total">${state.score[team]}</td></tr>`;
    };
    const dots = (n, max, cls) => Array.from({ length: max }, (_, i) => `<span class="g-dot ${i < n ? cls : ''}"></span>`).join('');
    const base = (on, left, top) => `<span class="g-base ${on ? 'on' : ''}" style="left:${left}px;top:${top}px"></span>`;
    const halfText = state.over ? '경기 종료' : `${state.inning}회${state.half === 'top' ? '초 · 수비' : '말 · 공격'}`;
    boardEl.innerHTML = `
      <table><tr><th></th>${head}<th>R</th></tr>${row('cpu', 'CPU', 'top')}${row('me', '나', 'bottom')}</table>
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

  // 오른쪽 입력 패널: 수비면 칸 버튼, 공격이면 휘두르기/안 휘두르기 → 칸 버튼, 경기 끝이면 다시 시작
  function renderPanel(state) {
    const disabled = state.busy ? 'disabled' : '';
    if (state.over) {
      const { me, cpu } = state.score;
      panelEl.innerHTML = `<div class="g-title">경기 종료<br><b style="font-size:20px">나 ${me} : ${cpu} CPU</b></div>
        <button type="button" class="g-big g-swing" data-act="restart">다시 시작</button>`;
    } else if (state.half === 'top') {
      panelEl.innerHTML = `<div class="g-title">수비 · 던질 칸을 고르세요</div>${gridHtml(state, true)}
        <div class="g-hint">Q: 마지막 칸으로 다시 던지기</div>`;
    } else if (state.batMode === 'choose') {
      panelEl.innerHTML = `<div class="g-title">공격 · 어떻게 할까요?</div>
        <button type="button" class="g-big g-swing" data-act="swing" ${disabled}>배트 휘두르기</button>
        <button type="button" class="g-big g-take" data-act="take" ${disabled}>배트 안 휘두르기</button>`;
    } else {
      panelEl.innerHTML = `<div class="g-title">휘두를 칸을 고르세요</div>${gridHtml(state, false)}
        <button type="button" class="g-cancel" data-act="cancel" ${disabled}>취소</button>`;
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
      if (state.half === 'top') G.onPitchButton(b);
      else G.onSwingButton(b);
      return;
    }
    const act = button.dataset.act;
    if (act === 'restart') G.newGame();
    else if (act === 'take') G.onTake();
    else if (act === 'swing') { state.batMode = 'aim'; render(); }
    else if (act === 'cancel') { state.batMode = 'choose'; render(); }
  });

  // 점수판·패널·주자를 지금 상태(G.state)대로 다시 그림
  function render() {
    const state = G.state;
    if (!state) return;
    renderBoard(state);
    renderPanel(state);
    G.showRunners?.(state.over ? [] : state.bases, state.half === 'top' ? [220, 60, 60] : [40, 100, 220]);
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
  const prevUpdate = window.updateBaseballScene;
  window.updateBaseballScene = function (timeSec, dt) {
    if (typeof prevUpdate === 'function') prevUpdate(timeSec, dt);
    placeOverlay();
  };

  Object.assign(G, { toast, log, render });
})();
