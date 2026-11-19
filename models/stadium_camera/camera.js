'use strict';

// [역할 1] 카메라
// 궤도 카메라(드래그 회전·이동, 휠 줌, 키보드 이동)와 게임 시점 버튼 3~6, 시점 초기화를 만듭니다.
// 파일끼리 공유하는 값은 window.STADIUM_PARTS 한 곳에 모읍니다. (다른 팀원 코드와 이름 충돌 방지)
(function () {
  const { DEG, MOUND_DIST } = window.STADIUM_PARTS;
  // ------------------------------------------------------------------
  // 카메라: target 주위를 도는 궤도(orbit) 카메라
  //   - 왼쪽 드래그: 회전 / 오른쪽·Shift 드래그: 이동 / 휠: 줌
  //   - W A S D: target을 앞뒤좌우로 이동, Q / E (또는 Space): 아래 / 위, 방향키: 회전
  //   - Shift를 누르고 이동하면 3배 빠르게, R: 처음 시점으로
  //   키는 e.code(물리 키 위치)로 읽어서 한글 입력 상태에서도 동작합니다.
  // ------------------------------------------------------------------
  const ORBIT_DEFAULT = { target: [0, 0, -45], yaw: 0, pitch: 32, dist: 120 };
  const orbit = { ...ORBIT_DEFAULT, target: [...ORBIT_DEFAULT.target] };
  const keys = new Set();

  window.ACTIVE_CAMERA = {
    eye: [0, 0, 0], target: [0, 0, 0], up: [0, 1, 0], fov: 60 * DEG,
    near: 0.5, far: 1500, // 멀리서도 경기장 전체와 태양(약 530m 거리)이 잘리지 않도록 far를 늘림
  };

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // 위아래 각도 범위: 음수면 카메라가 target보다 아래 → 하늘을 올려다봄
  const PITCH_MIN = -60, PITCH_MAX = 89;
  const EYE_MIN_Y = 0.5; // 카메라가 땅 아래로 들어가지 않는 최소 높이 (m)

  // 지면 위에서의 앞 / 오른쪽 방향 (yaw만 사용, yaw = 0이면 -z = 중견수 쪽)
  function groundAxes(yawDeg) {
    const y = yawDeg * DEG;
    return { forward: [-Math.sin(y), 0, -Math.cos(y)], right: [Math.cos(y), 0, -Math.sin(y)] };
  }

  // 구면 좌표 (거리, yaw, pitch) → 카메라 위치
  //   카메라가 땅(EYE_MIN_Y)보다 아래로 내려가면, 카메라와 바라보는 점을 같은 만큼 위로 올림.
  //   → 보는 방향은 그대로라서, 땅에 붙은 채로 고개를 들어 하늘을 보는 것처럼 됨
  function updateCamera() {
    const cam = window.ACTIVE_CAMERA;
    const yaw = orbit.yaw * DEG, pitch = orbit.pitch * DEG;
    const eye = [
      orbit.target[0] + orbit.dist * Math.cos(pitch) * Math.sin(yaw),
      orbit.target[1] + orbit.dist * Math.sin(pitch),
      orbit.target[2] + orbit.dist * Math.cos(pitch) * Math.cos(yaw),
    ];
    const target = [...orbit.target];
    if (eye[1] < EYE_MIN_Y) {
      const lift = EYE_MIN_Y - eye[1];
      eye[1] += lift;
      target[1] += lift;
    }
    cam.eye = eye;
    cam.target = target;
  }

  function resetCamera() {
    Object.assign(orbit, { ...ORBIT_DEFAULT, target: [...ORBIT_DEFAULT.target] });
    window.ACTIVE_CAMERA.fov = 60 * DEG;
    markPresetButton(null);
    updateCamera();
  }

  // ------------------------------------------------------------------
  // 게임 시점 프리셋 (버튼 3 ~ 6)
  //   eye = 카메라 위치, target = 바라보는 점, fov = 시야각(도). 좌표는 m, 홈플레이트 = 원점
  //   프리셋을 고르면 궤도 카메라 값으로 바꿔서, 그 시점에서 바로 드래그·줌으로 조금씩 조정할 수 있습니다.
  // ------------------------------------------------------------------
  const RUBBER_Z = -MOUND_DIST; // 투수판 z (-18.44)
  const CAMERA_PRESETS = [
    // 3. 투수 3인칭: 투수 뒤(중견수 쪽) 7m, 높이 4.5m에서 투수 어깨 너머로 홈플레이트를 봄
    { key: 'pitcher', label: '3. 투수 시점', eye: [0, 4.5, RUBBER_Z - 7], target: [0, 1.0, -4], fov: 50 },
    // 4. 타자 3인칭: 오른손 타자(3루 쪽 타석, x = -0.95) 뒤쪽 위에서 타자 어깨 너머로 투수를 봄
    { key: 'batter', label: '4. 타자 시점', eye: [-2.2, 3.0, 5.0], target: [0, 1.4, RUBBER_Z + 4], fov: 50 },
    // 5. 홈 뒤 하늘에서 경기장 전체를 내려다봄
    { key: 'overview', label: '5. 전체 보기', eye: [0, 75, 60], target: [0, 0, -50], fov: 60 },
    // 6. 내야 다이아몬드 바로 위에서 내려다봄 (수비 위치 확인용, 홈이 화면 아래)
    { key: 'top', label: '6. 위에서', eye: [0, 75, -18.4], target: [0, 0, -19.4], fov: 55 },
  ];

  function markPresetButton(key) {
    for (const preset of CAMERA_PRESETS) {
      const button = document.getElementById(`cameraPreset_${preset.key}`);
      if (button) button.classList.toggle('active', preset.key === key);
    }
  }

  function setCameraPreset(key) {
    const preset = CAMERA_PRESETS.find((p) => p.key === key);
    if (!preset) return;
    // eye·target → 궤도 카메라의 target / 거리 / yaw / pitch로 변환
    const v = [preset.eye[0] - preset.target[0], preset.eye[1] - preset.target[1], preset.eye[2] - preset.target[2]];
    const dist = Math.hypot(v[0], v[1], v[2]);
    orbit.target = [...preset.target];
    orbit.dist = dist;
    orbit.yaw = Math.atan2(v[0], v[2]) / DEG;
    orbit.pitch = clamp(Math.asin(v[1] / dist) / DEG, PITCH_MIN, PITCH_MAX);
    window.ACTIVE_CAMERA.fov = preset.fov * DEG;
    markPresetButton(key);
    updateCamera();
  }
  window.CAMERA_PRESETS = CAMERA_PRESETS;
  window.setCameraPreset = setCameraPreset;
  window.resetCamera = resetCamera;
  updateCamera();

  // 매 프레임 눌린 키만큼 이동 (프레임 시간 dt를 곱해 속도가 일정하게)
  let lastFrame = null;
  function cameraLoop(now) {
    const dt = lastFrame === null ? 0 : Math.min((now - lastFrame) / 1000, 0.1);
    lastFrame = now;
    if (keys.size > 0) {
      const boost = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 3 : 1;
      const axis = (plus, minus) => (keys.has(plus) ? 1 : 0) - (keys.has(minus) ? 1 : 0);
      const moveF = axis('KeyW', 'KeyS'), moveR = axis('KeyD', 'KeyA');
      const moveU = axis('KeyE', 'KeyQ') + (keys.has('Space') ? 1 : 0);

      const speed = Math.max(orbit.dist, 10) * 0.6 * boost * dt; // 멀리 있을수록 빠르게
      const { forward, right } = groundAxes(orbit.yaw);
      for (let i = 0; i < 3; i++) orbit.target[i] += (forward[i] * moveF + right[i] * moveR) * speed;
      orbit.target[1] = clamp(orbit.target[1] + moveU * speed, 0, 80);
      orbit.yaw += axis('ArrowLeft', 'ArrowRight') * 90 * dt;
      orbit.pitch = clamp(orbit.pitch + axis('ArrowUp', 'ArrowDown') * 60 * dt, PITCH_MIN, PITCH_MAX);
      updateCamera();
    }
    requestAnimationFrame(cameraLoop);
  }
  requestAnimationFrame(cameraLoop);

  const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'Space', 'ShiftLeft', 'ShiftRight',
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
  window.addEventListener('keydown', (e) => {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (MOVE_KEYS.has(e.code)) {
      keys.add(e.code);
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault(); // 페이지 스크롤 방지
    }
    if (e.code === 'KeyR' && !e.repeat) resetCamera();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear()); // 창을 벗어나면 눌린 키 초기화

  const canvas = document.getElementById('glCanvas');
  if (canvas) {
    let drag = null;
    canvas.style.touchAction = 'none';
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;

      if (drag.pan) {
        // 화면을 잡아 끄는 느낌으로 target을 지면 위에서 이동
        const speed = orbit.dist * 0.0015;
        const { forward, right } = groundAxes(orbit.yaw);
        for (let i = 0; i < 3; i++) orbit.target[i] += (-right[i] * dx + forward[i] * dy) * speed;
      } else {
        orbit.yaw -= dx * 0.3;
        orbit.pitch = clamp(orbit.pitch + dy * 0.3, PITCH_MIN, PITCH_MAX);
      }
      updateCamera();
    });
    canvas.addEventListener('pointerup', () => { drag = null; });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      orbit.dist = clamp(orbit.dist * Math.exp(e.deltaY * 0.001), 1.5, 400);
      updateCamera();
    }, { passive: false });
  }

  const controlGroup = document.querySelector('.controls .control-group');
  if (controlGroup) {
    // 시점 프리셋 버튼 3 ~ 6 (버튼 줄 맨 앞, 번호 순서대로)
    const presetButtons = CAMERA_PRESETS.map((preset) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.id = `cameraPreset_${preset.key}`;
      button.textContent = preset.label;
      button.addEventListener('click', () => setCameraPreset(preset.key));
      return button;
    });
    controlGroup.prepend(...presetButtons);

    // 시점 초기화 버튼 (맨 뒤)
    const resetButton = document.createElement('button');
    resetButton.type = 'button';
    resetButton.textContent = '시점 초기화 (R)';
    resetButton.addEventListener('click', resetCamera);
    controlGroup.append(resetButton);
  }

})();
