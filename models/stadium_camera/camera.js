'use strict';

// [역할 1] 카메라 — 버튼 3~7 시점, 8 공 따라가기, 9 자유 카메라(WASD·E/C·Shift·드래그·휠), 10 멈춤
// 버튼은 켜고 끄는 방식: 켜진 버튼은 파란색, 한 번 더 누르면 꺼짐. 여러 개가 함께 켜질 수 있음
//   기본 시점(3~7 또는 9) 하나 + 공 따라가기(8) + 멈춤(10)
//   예) 3 → 8: 투수 뒤 자리에서 시선만 공을 따라감 (3·8 파란색). 8을 끄면 투수 뒤 시점으로 돌아옴
//   6·7 + 8: 공이 멀면 확대(시야각 축소), 가까워지면 점점 원래 시야각으로
// batter·overview 시점은 game.js가 씀. 내보내기: setCameraPreset(key), resetCamera()
(function () {
  const { DEG, MOUND_DIST, FOUL, dir, fenceRadius, onFrame } = window.STADIUM_PARTS;

  const EYE_MIN_Y = 0.5;                     // 카메라 최소 높이 (땅 밑 방지)
  const FREE_SPEED = 20;                     // 자유 카메라 속도 (m/s), Shift = 3배
  const DEFAULT_PRESET = 'pitcher';          // 기본 시점 버튼을 끄면 돌아가는 시점 (투수 뒤, 버튼은 파란색 아님)

  window.ACTIVE_CAMERA = {
    eye: [0, 0, 0], target: [0, 0, 0], up: [0, 1, 0], fov: 60 * DEG, near: 0.5, far: 1500,
  };
  const cam = window.ACTIVE_CAMERA;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // 카메라 상태: 기본 시점(preset 또는 free) + 공 따라가기 여부 + 멈춤 여부
  //   isDefault: 버튼을 꺼서 돌아온 기본 시점이면 true (그 시점 버튼을 파란색으로 표시하지 않음)
  const state = { base: 'preset', presetKey: DEFAULT_PRESET, isDefault: true, following: false, frozen: false, pendingPreset: null };

  function setView(eye, target) {
    cam.eye = eye;
    cam.target = target;
  }

  // yaw·pitch(도) → 바라보는 방향 (yaw 0 = 중견수 쪽 −z)
  function lookDirection(yawDeg, pitchDeg) {
    const y = yawDeg * DEG, p = pitchDeg * DEG;
    return [-Math.cos(p) * Math.sin(y), Math.sin(p), -Math.cos(p) * Math.cos(y)];
  }

  // 시점 프리셋 (좌표 m, 홈 = 원점)
  const RUBBER_Z = -MOUND_DIST;
  const abovePole = (side) => {              // 파울 폴(15m) 위, 살짝 바깥
    const d = dir(side * FOUL), r = (fenceRadius(FOUL) + 0.2) * 1.04;
    return [d[0] * r, 20, d[2] * r];
  };
  const CAMERA_PRESETS = [
    { key: 'pitcher', button: 3, label: '3. 투수 뒤', eye: [0, 4.5, RUBBER_Z - 7], target: [0, 1.0, -4], fov: 50 },
    { key: 'catcher', button: 4, label: '4. 포수 뒤', eye: [1.2, 1.9, 3.4], target: [0, 1.2, RUBBER_Z], fov: 50 }, // 포수 오른쪽 뒤
    { key: 'net', button: 5, label: '5. 네트 위', eye: [0, 13, 20], target: [0, 0, -22], fov: 55 },
    { key: 'rightPole', button: 6, label: '6. 오른쪽 폴대', eye: abovePole(1), target: [0, 0, -20], fov: 50 },
    { key: 'leftPole', button: 7, label: '7. 왼쪽 폴대', eye: abovePole(-1), target: [0, 0, -20], fov: 50 },
    { key: 'batter', eye: [-2.2, 3.0, 5.0], target: [0, 1.4, RUBBER_Z + 4], fov: 50 },
    { key: 'overview', eye: [0, 75, 60], target: [0, 0, -50], fov: 60 },
  ];
  const presetOf = (key) => CAMERA_PRESETS.find((p) => p.key === key);

  // 켜진 버튼을 모두 파란색으로: 기본 시점 버튼(3~7 또는 9) + 8 + 10
  function refreshButtons() {
    const on = new Set();
    if (state.base === 'free') on.add(9);
    else if (!state.isDefault && presetOf(state.presetKey)?.button) on.add(presetOf(state.presetKey).button);
    if (state.following) on.add(8);
    if (state.frozen) on.add(10);
    document.querySelectorAll('[data-camera-button]').forEach((b) => {
      b.classList.toggle('active', on.has(Number(b.dataset.cameraButton)));
    });
  }

  // 프리셋 = target 주위를 도는 궤도 카메라 (드래그 회전·휠 줌)
  const orbit = { target: [0, 0, 0], yaw: 0, pitch: 0, dist: 1 };
  function orbitView() {
    const d = lookDirection(orbit.yaw, orbit.pitch);
    const eye = orbit.target.map((t, i) => t - d[i] * orbit.dist);
    const target = [...orbit.target];
    const lift = Math.max(0, EYE_MIN_Y - eye[1]); // 땅 밑이면 카메라·보는 점을 같이 올림
    eye[1] += lift;
    target[1] += lift;
    return { eye, target };
  }

  // 자유 카메라
  const FREE_START = { eye: [0, 8, -45], yaw: 180, pitch: -10 }; // 경기장 가운데에서 홈 쪽
  const free = { eye: [...FREE_START.eye], yaw: FREE_START.yaw, pitch: FREE_START.pitch };
  function freeView() {
    const f = lookDirection(free.yaw, free.pitch);
    return { eye: [...free.eye], target: free.eye.map((e, i) => e + f[i]) };
  }

  // 현재 기본 시점으로 카메라를 다시 그림. 공을 따라가는 중이면 위치만 바꾸고 시선은 그대로 공 쪽
  function updateBaseView() {
    const view = state.base === 'free' ? freeView() : orbitView();
    setView(view.eye, state.following ? cam.target : view.target);
  }

  function applyPreset(key, isDefault = false) {
    const preset = presetOf(key);
    if (!preset) return;
    state.isDefault = isDefault;
    const v = preset.target.map((t, i) => t - preset.eye[i]);
    orbit.dist = Math.hypot(...v);
    orbit.target = [...preset.target];
    orbit.yaw = Math.atan2(-v[0], -v[2]) / DEG;
    orbit.pitch = clamp(Math.asin(v[1] / orbit.dist) / DEG, -89, 60);
    cam.fov = preset.fov * DEG;
    Object.assign(state, { base: 'preset', presetKey: key, frozen: false });
    updateBaseView();
    refreshButtons();
  }

  function startFree() {
    Object.assign(free, { eye: [...FREE_START.eye], yaw: FREE_START.yaw, pitch: FREE_START.pitch });
    cam.fov = 60 * DEG;
    Object.assign(state, { base: 'free', frozen: false });
    updateBaseView();
    refreshButtons();
  }

  // 8. 공 따라가기: 위치는 기본 시점 그대로, 보는 점만 공을 부드럽게(1 − e^(−k·dt)) 따라감 (투구·타구 모두)
  //   공이 숨겨지면(플레이 끝) 마지막으로 본 곳을 계속 봄
  function setFollowing(on) {
    if (on && !window.PITCHER_BATTER?.ball) return;
    state.following = on;
    if (!on && state.pendingPreset) {         // 따라가는 동안 게임이 요청한 시점을 이제 적용
      const key = state.pendingPreset;
      state.pendingPreset = null;
      applyPreset(key, true);
      return;
    }
    if (!on) setView(cam.eye, (state.base === 'free' ? freeView() : orbitView()).target); // 원래 시선으로
    refreshButtons();
  }
  function updateFollow(dt) {
    const ball = window.PITCHER_BATTER?.ball;
    if (!ball || !ball.visible || dt <= 0) return;
    const k = 1 - Math.exp(-12 * dt);
    setView(cam.eye, cam.target.map((t, i) => t + (ball.position[i] - t) * k));
  }

  // 6·7 폴대 시점 + 8 공 따라가기: 공이 멀면 시야각(fov)을 좁혀 확대, 가까워지면 원래 시야각으로 돌아옴
  //   tan(fov/2) = tan(기본/2) × ZOOM_REF / 거리 → 공이 ZOOM_REF(m)보다 멀면 화면 속 공 크기가 일정하게 보임
  const POLE_KEYS = new Set(['rightPole', 'leftPole']);
  const ZOOM_REF = 20;                       // 이 거리 안이면 확대 안 함 (m)
  const ZOOM_MIN_FOV = 10 * DEG;             // 최대 확대 ≈ 5배
  function updatePoleZoom(dt) {
    if (state.base !== 'preset' || !POLE_KEYS.has(state.presetKey) || dt <= 0) return;
    const baseFov = presetOf(state.presetKey).fov * DEG;
    const ball = window.PITCHER_BATTER?.ball;
    let goal = baseFov;
    if (state.following && ball?.visible) {
      const dist = Math.hypot(...ball.position.map((p, i) => p - cam.eye[i]));
      const half = Math.atan(Math.tan(baseFov / 2) * ZOOM_REF / Math.max(dist, ZOOM_REF));
      goal = Math.max(ZOOM_MIN_FOV, 2 * half);
    }
    cam.fov += (goal - cam.fov) * (1 - Math.exp(-4 * dt)); // 부드럽게
  }

  // 10. 멈춤: 자유 이동·공 따라가기를 그 자리에서 멈춤
  function setFrozen(on) {
    if (on && state.base !== 'free' && !state.following) return; // 움직이는 카메라일 때만 의미 있음
    state.frozen = on;
    refreshButtons();
  }

  // 게임 코드용: 공을 따라가는 중에는 위치를 지키고, 요청한 시점은 따라가기를 끌 때 적용
  function setCameraPreset(key) {
    if (state.following) { state.pendingPreset = key; return; }
    applyPreset(key, true); // 게임이 바꾼 시점은 버튼을 파란색으로 켜지 않음
  }

  // 버튼: 켜져 있으면 끄고, 꺼져 있으면 켬
  function onCameraButton(number) {
    if (number === 8) return setFollowing(!state.following);
    if (number === 10) return setFrozen(!state.frozen);
    if (number === 9) return state.base === 'free' ? applyPreset(DEFAULT_PRESET, true) : startFree();
    const preset = CAMERA_PRESETS.find((p) => p.button === number);
    const isOn = state.base === 'preset' && state.presetKey === preset.key && !state.isDefault;
    applyPreset(isOn ? DEFAULT_PRESET : preset.key, isOn); // 켜져 있으면 끄고 기본 시점(투수 뒤)으로
  }

  // 입력
  const keys = new Set();
  const FREE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyC', 'ShiftLeft', 'ShiftRight']);
  window.addEventListener('keydown', (e) => {
    if (FREE_KEYS.has(e.code) && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName)) keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));

  // 숫자 키 → 같은 번호 버튼 클릭 (1~9, 0 = 10번). 버튼 글자가 "번호." 로 시작하는 버튼을 찾음
  window.addEventListener('keydown', (e) => {
    const m = /^(?:Digit|Numpad)(\d)$/.exec(e.code);
    if (!m || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName)) return;
    const number = m[1] === '0' ? '10' : m[1];
    const button = [...document.querySelectorAll('.controls button')]
      .find((b) => b.textContent.trim().startsWith(number + '.'));
    if (button && !button.disabled) { e.preventDefault(); button.click(); }
  });
  window.addEventListener('blur', () => keys.clear());

  function moveFree(forward, right, up) {
    const f = lookDirection(free.yaw, free.pitch);
    const yaw = free.yaw * DEG, r = [Math.cos(yaw), 0, -Math.sin(yaw)];
    for (let i = 0; i < 3; i++) free.eye[i] += f[i] * forward + r[i] * right;
    free.eye[1] = Math.max(EYE_MIN_Y, free.eye[1] + up);
    updateBaseView();
  }

  onFrame((timeSec, dt) => {
    if (state.frozen) return;
    if (state.base === 'free' && keys.size > 0) {
      const axis = (plus, minus) => (keys.has(plus) ? 1 : 0) - (keys.has(minus) ? 1 : 0);
      const step = FREE_SPEED * (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 3 : 1) * dt;
      moveFree(axis('KeyW', 'KeyS') * step, axis('KeyD', 'KeyA') * step, axis('KeyE', 'KeyC') * step);
    }
    if (state.following) updateFollow(dt);
    updatePoleZoom(dt);
  }, { first: true }); // 빛 번짐 판보다 먼저 갱신

  // 마우스: 멈춤·공 따라가기 중에는 위치만 바뀌는 휠 이동 외엔 무시
  const canvas = document.getElementById('glCanvas');
  if (canvas) {
    let drag = null;
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag = { x: e.clientX, y: e.clientY };
      if (state.frozen || state.following) return;
      if (state.base === 'preset') {
        orbit.yaw -= dx * 0.3;
        orbit.pitch = clamp(orbit.pitch - dy * 0.3, -89, 60);
      } else {
        free.yaw -= dx * 0.2;
        free.pitch = clamp(free.pitch - dy * 0.2, -89, 89);
      }
      updateBaseView();
    });
    canvas.addEventListener('pointerup', () => { drag = null; });
    canvas.addEventListener('wheel', (e) => {
      if (state.frozen) return;
      e.preventDefault();
      if (state.base === 'free') return moveFree(-e.deltaY * 0.05, 0, 0);
      orbit.dist = clamp(orbit.dist * Math.exp(e.deltaY * 0.001), 1.5, 400);
      updateBaseView();
    }, { passive: false });
  }

  // 버튼 3 ~ 10
  const controlGroup = document.querySelector('.controls .control-group');
  if (controlGroup) {
    const makeButton = (number, label) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.cameraButton = String(number);
      button.textContent = label;
      button.addEventListener('click', () => { onCameraButton(number); button.blur(); });
      return button;
    };
    controlGroup.prepend(
      ...CAMERA_PRESETS.filter((p) => p.button).map((p) => makeButton(p.button, p.label)),
      makeButton(8, '8. 공 따라가기'),
      makeButton(9, '9. 자유 카메라'),
      makeButton(10, '10. 카메라 멈춤'),
    );
  }

  window.setCameraPreset = setCameraPreset;
  window.resetCamera = () => applyPreset(DEFAULT_PRESET, true);
  applyPreset('overview', true); // 처음 화면은 경기장 전체
})();
