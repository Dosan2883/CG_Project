'use strict';

// [역할 1] 카메라 — 버튼 3~7 시점, 8 공 따라가기, 9 자유 카메라(WASD·E/C·Shift·드래그·휠), 10 멈춤
// 모드: 'preset' / 'follow' / 'free' / 'frozen'. batter·overview 시점은 game.js가 씀.
// 내보내기: setCameraPreset(key), getCameraMode(), resetCamera()
(function () {
  const { DEG, MOUND_DIST, FOUL, dir, fenceRadius, onFrame } = window.STADIUM_PARTS;

  const EYE_MIN_Y = 0.5;                     // 카메라 최소 높이 (땅 밑 방지)
  const FREE_SPEED = 20;                     // 자유 카메라 속도 (m/s), Shift = 3배
  const FOLLOW_BACK = 6, FOLLOW_UP = 2;      // 공 따라가기: 공 뒤 거리, 위 높이 (m)

  window.ACTIVE_CAMERA = {
    eye: [0, 0, 0], target: [0, 0, 0], up: [0, 1, 0], fov: 60 * DEG, near: 0.5, far: 1500,
  };
  const cam = window.ACTIVE_CAMERA;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  let mode = 'preset';

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

  // 프리셋 = target 주위를 도는 궤도 카메라 (드래그 회전·휠 줌)
  const orbit = { target: [0, 0, 0], yaw: 0, pitch: 0, dist: 1 };
  function updateOrbitCamera() {
    const d = lookDirection(orbit.yaw, orbit.pitch);
    const eye = orbit.target.map((t, i) => t - d[i] * orbit.dist);
    const target = [...orbit.target];
    const lift = Math.max(0, EYE_MIN_Y - eye[1]); // 땅 밑이면 카메라·보는 점을 같이 올림
    eye[1] += lift;
    target[1] += lift;
    setView(eye, target);
  }

  function markButton(number) {
    document.querySelectorAll('[data-camera-button]').forEach((b) => {
      b.classList.toggle('active', Number(b.dataset.cameraButton) === number);
    });
  }

  function setCameraPreset(key) {
    const preset = CAMERA_PRESETS.find((p) => p.key === key);
    if (!preset) return;
    const v = preset.target.map((t, i) => t - preset.eye[i]);
    orbit.dist = Math.hypot(...v);
    orbit.target = [...preset.target];
    orbit.yaw = Math.atan2(-v[0], -v[2]) / DEG;
    orbit.pitch = clamp(Math.asin(v[1] / orbit.dist) / DEG, -89, 60);
    cam.fov = preset.fov * DEG;
    mode = 'preset';
    markButton(preset.button ?? null);
    updateOrbitCamera();
  }

  // 8. 공 따라가기: 공이 움직이는 순간부터 진행 방향 뒤쪽 위에서 부드럽게(1 − e^(−k·dt)) 추적
  const follow = { prev: null, dir: [0, 0, 1], started: false };
  function startFollow() {
    const ball = window.PITCHER_BATTER?.ball;
    if (!ball) return;
    Object.assign(follow, { prev: [...ball.position], dir: [0, 0, 1], started: false });
    mode = 'follow';
    markButton(8);
  }
  function updateFollow(dt) {
    const ball = window.PITCHER_BATTER?.ball;
    if (!ball || dt <= 0) return;
    const p = ball.position;
    const v = p.map((x, i) => x - follow.prev[i]);
    const moved = Math.hypot(...v);
    follow.prev = [...p];
    if (moved / dt > 1) {                    // 초속 1m 이상 = 날아가는 중
      follow.dir = v.map((x) => x / moved);
      if (!follow.started) { follow.started = true; cam.fov = 55 * DEG; }
    }
    if (!follow.started) return;
    const want = [p[0] - follow.dir[0] * FOLLOW_BACK, Math.max(EYE_MIN_Y, p[1] + FOLLOW_UP), p[2] - follow.dir[2] * FOLLOW_BACK];
    const kEye = 1 - Math.exp(-6 * dt), kTarget = 1 - Math.exp(-12 * dt);
    setView(cam.eye.map((e, i) => e + (want[i] - e) * kEye), cam.target.map((t, i) => t + (p[i] - t) * kTarget));
  }

  // 9. 자유 카메라 (Q는 게임 키라 안 씀) / 10. 멈춤
  const free = { eye: [0, 8, -45], yaw: 180, pitch: -10 };
  function updateFreeCamera() {
    const f = lookDirection(free.yaw, free.pitch);
    setView([...free.eye], free.eye.map((e, i) => e + f[i]));
  }
  function moveFree(forward, right, up) {
    const f = lookDirection(free.yaw, free.pitch);
    const yaw = free.yaw * DEG, r = [Math.cos(yaw), 0, -Math.sin(yaw)];
    for (let i = 0; i < 3; i++) free.eye[i] += f[i] * forward + r[i] * right;
    free.eye[1] = Math.max(EYE_MIN_Y, free.eye[1] + up);
    updateFreeCamera();
  }
  function startFree() {
    Object.assign(free, { eye: [0, 8, -45], yaw: 180, pitch: -10 }); // 경기장 가운데에서 홈 쪽
    cam.fov = 60 * DEG;
    mode = 'free';
    markButton(9);
    updateFreeCamera();
  }
  function freezeCamera() {
    if (mode !== 'free' && mode !== 'follow') return;
    mode = 'frozen';
    markButton(10);
  }

  // 입력
  const keys = new Set();
  const FREE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyC', 'ShiftLeft', 'ShiftRight']);
  window.addEventListener('keydown', (e) => {
    if (FREE_KEYS.has(e.code) && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName)) keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  onFrame((timeSec, dt) => {
    if (mode === 'follow') updateFollow(dt);
    if (mode === 'free' && keys.size > 0) {
      const axis = (plus, minus) => (keys.has(plus) ? 1 : 0) - (keys.has(minus) ? 1 : 0);
      const step = FREE_SPEED * (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 3 : 1) * dt;
      moveFree(axis('KeyW', 'KeyS') * step, axis('KeyD', 'KeyA') * step, axis('KeyE', 'KeyC') * step);
    }
  }, { first: true }); // 빛 번짐 판보다 먼저 갱신

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
      if (mode === 'preset') {
        orbit.yaw -= dx * 0.3;
        orbit.pitch = clamp(orbit.pitch - dy * 0.3, -89, 60);
        updateOrbitCamera();
      } else if (mode === 'free') {
        free.yaw -= dx * 0.2;
        free.pitch = clamp(free.pitch - dy * 0.2, -89, 89);
        updateFreeCamera();
      }
    });
    canvas.addEventListener('pointerup', () => { drag = null; });
    canvas.addEventListener('wheel', (e) => {
      if (mode !== 'preset' && mode !== 'free') return;
      e.preventDefault();
      if (mode === 'free') return moveFree(-e.deltaY * 0.05, 0, 0);
      orbit.dist = clamp(orbit.dist * Math.exp(e.deltaY * 0.001), 1.5, 400);
      updateOrbitCamera();
    }, { passive: false });
  }

  // 버튼 3 ~ 10
  const controlGroup = document.querySelector('.controls .control-group');
  if (controlGroup) {
    const makeButton = (number, label, onClick) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.cameraButton = String(number);
      button.textContent = label;
      button.addEventListener('click', () => { onClick(); button.blur(); });
      return button;
    };
    controlGroup.prepend(
      ...CAMERA_PRESETS.filter((p) => p.button).map((p) => makeButton(p.button, p.label, () => setCameraPreset(p.key))),
      makeButton(8, '8. 공 따라가기', startFollow),
      makeButton(9, '9. 자유 카메라', startFree),
      makeButton(10, '10. 카메라 멈춤', freezeCamera),
    );
  }

  window.CAMERA_PRESETS = CAMERA_PRESETS;
  window.setCameraPreset = setCameraPreset;
  window.resetCamera = () => setCameraPreset('overview');
  window.getCameraMode = () => mode;
  setCameraPreset('overview');
})();
