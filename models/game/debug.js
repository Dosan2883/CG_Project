'use strict';

// [역할 3: 게임] 디버그 — 게임을 시작하지 않고 투수·타자 모션 확인
//   시작 화면(게임 시작 버튼이 보일 때)에만 캔버스 오른쪽 아래에 디버그 패널이 나옴 (왼쪽은 타자가 보이는 자리)
//   역할 2의 모션 함수(pitcher_batter/motion.js)를 그대로 부름:
//     preparePitch(와인드업 시간) → triggerPitch(도착점, 비행 시간, 시작 시각) / startSwing(공 위치, 임팩트까지 시간, 시작 시각) / resetPose()
(function () {
  const G = window.GAME_CONTROLLER;
  const pb = window.PITCHER_BATTER;
  const overlay = document.getElementById('gameOverlay');
  if (!G || !pb || !overlay) return;
  const { ZONES } = G;

  const WINDUP = 0.7;     // 와인드업 시간 (초) — 게임과 같은 값
  const TRAVEL = 0.65;    // 공 비행 시간 (초)
  const timers = [];
  const later = (sec, fn) => timers.push(setTimeout(fn, sec * 1000));
  function stopAll() {
    while (timers.length) clearTimeout(timers.pop());
  }

  // 투구 모션: 와인드업 → 릴리스 → 공이 zone 칸으로 날아감 → 잠시 뒤 공 숨김
  function debugPitch(zone = 1, thenSwing = false) {
    stopAll();
    pb.resetPose();
    pb.preparePitch(WINDUP);
    later(WINDUP, () => {
      const start = G.nowSec();
      const target = ZONES[zone].target;
      pb.triggerPitch(target, TRAVEL, start);
      if (thenSwing) pb.startSwing(target, TRAVEL, start); // 공이 도착하는 순간 배트가 공 위치를 지나도록
      later(TRAVEL + 1.4, () => { pb.finishPitch(); pb.ball.visible = false; });
    });
  }

  // 스윙 모션: 지금 바로 zone 높이로 휘두름
  function debugSwing(zone = 1) {
    stopAll();
    pb.startSwing(ZONES[zone].target, pb.swingLead);
  }

  function debugReset() {
    stopAll();
    pb.resetPose();
  }

  // ------------------------------------------------------------------
  // 패널
  // ------------------------------------------------------------------
  const style = document.createElement('style');
  style.textContent = `
    .d-panel { position: absolute; right: 10px; bottom: 10px; background: rgba(0,0,0,.7); border: 1px solid #556;
      border-radius: 6px; padding: 8px 10px; text-align: left; font-size: 12px; max-width: 300px; }
    .d-panel .d-title { font-weight: bold; color: #ffd84a; margin-bottom: 6px; }
    .d-panel .d-status { color: #9ecbff; font-weight: normal; margin-left: 6px; }
    .d-panel .d-row { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 5px; align-items: center; }
    .d-panel .d-row span { color: #aab; width: 42px; }
    .d-panel button { margin: 0 !important; padding: 4px 8px; font-size: 12px; }
  `;
  document.head.append(style);

  const panel = document.createElement('div');
  panel.className = 'd-panel';
  panel.innerHTML = `
    <div class="d-title">디버그 · 모션 확인 <span class="d-status"></span></div>
    <div class="d-row"><span>투구</span>${ZONES.map((z, i) => `<button type="button" data-pitch="${i}">${z.label}</button>`).join('')}</div>
    <div class="d-row"><span>스윙</span>${ZONES.map((z, i) => `<button type="button" data-swing="${i}">${z.label}</button>`).join('')}</div>
    <div class="d-row"><span>둘 다</span><button type="button" data-both="1">투구 + 스윙 (가운데)</button></div>
    <div class="d-row"><span>시점</span>
      <button type="button" data-cam="pitcher">투수 뒤</button>
      <button type="button" data-cam="catcher">포수 뒤</button>
      <button type="button" data-cam="batter">타자 뒤</button>
      <button type="button" data-cam="overview">전체</button>
    </div>
    <div class="d-row"><button type="button" data-reset="1">자세 초기화</button>
      <button type="button" data-title="1">가운데 시작 창 숨기기</button></div>
  `;
  overlay.append(panel);

  // 시작 화면은 멀리서 보는 '전체' 시점이라 선수가 작아서 모션이 잘 안 보임
  //   → 시점을 따로 고르지 않았으면 모션 버튼을 누를 때 투수·타자가 다 보이는 '포수 뒤' 시점으로 바꿈
  let pickedCam = false;
  function closeUp() {
    if (!pickedCam) window.setCameraPreset?.('catcher');
    setTitleHidden(true); // 가운데 "게임 시작" 창이 투수를 가리므로 모션을 볼 때는 숨김
  }
  const statusEl = () => panel.querySelector('.d-status');
  function say(text) {
    const el = statusEl();
    if (el) el.textContent = text;
  }

  panel.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    b.blur();
    const label = (i) => ZONES[i].label;
    if (b.dataset.pitch != null) { closeUp(); debugPitch(Number(b.dataset.pitch)); say(`▶ 투구 (${label(Number(b.dataset.pitch))})`); }
    else if (b.dataset.swing != null) { closeUp(); debugSwing(Number(b.dataset.swing)); say(`▶ 스윙 (${label(Number(b.dataset.swing))})`); }
    else if (b.dataset.both != null) { closeUp(); debugPitch(1, true); say('▶ 투구 + 스윙 (가운데)'); }
    else if (b.dataset.cam) { pickedCam = b.dataset.cam !== 'overview'; window.setCameraPreset?.(b.dataset.cam); say(`시점: ${b.textContent}`); }
    else if (b.dataset.reset) { debugReset(); say('자세 초기화'); }
    else if (b.dataset.title) toggleTitle();
  });

  // 가운데 "게임 시작" 창이 투수를 가려서, 모션을 볼 때는 잠깐 숨길 수 있게 함 (visibility만 바꿔서 intro.js와 겹치지 않음)
  function setTitleHidden(hide) {
    const title = overlay.querySelector('.i-title');
    if (title) title.style.visibility = hide ? 'hidden' : '';
    const btn = panel.querySelector('[data-title]');
    if (btn) btn.textContent = hide ? '가운데 시작 창 보이기' : '가운데 시작 창 숨기기';
  }
  function toggleTitle() {
    setTitleHidden(overlay.querySelector('.i-title')?.style.visibility !== 'hidden');
  }

  // 시작 화면에서만 보임. 시작 화면을 떠나면(팀 고르기·경기) 하던 모션을 멈추고 자세를 되돌림
  let wasVisible = false;
  const prevUpdate = window.updateBaseballScene;
  window.updateBaseballScene = function (timeSec, dt) {
    if (typeof prevUpdate === 'function') prevUpdate(timeSec, dt);
    const visible = G.introPhase?.() === 'title';
    if (visible !== wasVisible) {
      panel.style.display = visible ? '' : 'none';
      if (!visible) {
        debugReset();
        setTitleHidden(false); // 다음에 시작 화면이 나올 때는 다시 보이게
        pickedCam = false;
      }
      wasVisible = visible;
    }
  };
  panel.style.display = 'none';

  Object.assign(G, { debugPitch, debugSwing, debugReset });
})();
