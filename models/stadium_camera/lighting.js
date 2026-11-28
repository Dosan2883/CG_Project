'use strict';

// [역할 1] 시간대 조명
// 5시~23시 시간에 따라 태양 위치·하늘색·빛 색·경기장 조명을 바꾸고, 시간 슬라이더와 버튼 11을 만듭니다.
// 파일끼리 공유하는 값은 window.STADIUM_PARTS 한 곳에 모읍니다. (다른 팀원 코드와 이름 충돌 방지)
(function () {
  const { DEG, glowNodes, towerLightPositions, roofLightPositions, roofFixtures, apartments, onFrame } = window.STADIUM_PARTS;
  // ------------------------------------------------------------------
  // 조명: 시간대(5시 ~ 23시)에 따라 태양·하늘·빛·경기장 조명이 바뀜
  //   common/app.js가 매 프레임 window.ACTIVE_LIGHTING을 읽어 그립니다.
  //   mainLightPos·mainLightColor : 주 광원 (그림자를 만드는 빛) → 해가 떠 있으면 태양, 지면 경기장 주 조명
  //   shadow                      : 그림자 맵이 덮을 범위 (center 중심 ±halfSize m)
  //   pointLights                 : 그림자 없는 보조 점광원 (최대 8개), pointLightRange로 감쇠 거리
  // ------------------------------------------------------------------
  const SHADOW_AREA = { enabled: true, center: [0, 0, -50], halfSize: 130 };

  // 경기장 보조 조명: 외야 조명탑 2개 + 지붕 조명 중 고르게 6개
  function pickEvenly(list, count) {
    if (list.length <= count) return list.slice();
    return Array.from({ length: count }, (_, k) => list[Math.round(k * (list.length - 1) / (count - 1))]);
  }
  const STADIUM_LAMP_COLOR = [0.55, 0.52, 0.44];
  const stadiumLampPositions = [...towerLightPositions, ...pickEvenly(roofLightPositions, 6)];
  const FLOOD_MAIN_POS = [0, 90, 45];             // 경기장 주 조명 (홈 뒤 높은 곳, 그림자 담당)
  const FLOOD_MAIN_COLOR = [0.45, 0.45, 0.42];

  // 태양 궤도: 해 뜨는 시각 ~ 지는 시각 동안 동쪽(+x, 1루 쪽) → 서쪽(-x, 3루 쪽)으로 반원을 그림.
  //   한낮에도 머리 바로 위가 아니라 홈 뒤쪽(+z)으로 SUN_TILT만큼 기울어진 높이에 있음
  const SUNRISE = 5.5, SUNSET = 19.5;
  const SUN_DISTANCE = 530;
  const SUN_TILT = 35 * DEG;
  function sunPosition(hour) {
    const a = (hour - SUNRISE) / (SUNSET - SUNRISE) * Math.PI; // 0 = 해돋이, π/2 = 정오 무렵, π = 해넘이
    const east = Math.cos(a), high = Math.sin(a);
    return [
      SUN_DISTANCE * east,
      SUN_DISTANCE * high * Math.cos(SUN_TILT),
      SUN_DISTANCE * high * Math.sin(SUN_TILT),
    ];
  }

  // 시간별 기준값 (사이 시간은 선형 보간)
  //   sky: 하늘색, ambient: 주변광 밝기, sun: 햇빛 색(0이면 해가 빛을 주지 않음)
  const TIME_KEYS = [
    { hour: 5.0, sky: [0.03, 0.04, 0.10], ambient: 0.07, sun: [0, 0, 0] },
    { hour: 6.0, sky: [0.60, 0.45, 0.42], ambient: 0.26, sun: [0.60, 0.36, 0.22] },   // 해돋이 (노을)
    { hour: 7.5, sky: [0.50, 0.68, 0.88], ambient: 0.40, sun: [0.70, 0.60, 0.48] },
    { hour: 12.0, sky: [0.56, 0.77, 0.92], ambient: 0.42, sun: [0.66, 0.64, 0.58] },  // 한낮
    { hour: 16.5, sky: [0.55, 0.72, 0.88], ambient: 0.40, sun: [0.68, 0.60, 0.48] },
    { hour: 18.3, sky: [0.85, 0.48, 0.30], ambient: 0.30, sun: [0.72, 0.40, 0.18] },  // 해넘이 (노을)
    { hour: 19.0, sky: [0.22, 0.15, 0.27], ambient: 0.16, sun: [0.30, 0.12, 0.06] },
    { hour: 20.0, sky: [0.02, 0.03, 0.08], ambient: 0.07, sun: [0, 0, 0] },           // 밤
    { hour: 23.0, sky: [0.02, 0.03, 0.08], ambient: 0.07, sun: [0, 0, 0] },
  ];
  function sampleTimeKeys(hour) {
    for (let i = 0; i < TIME_KEYS.length - 1; i++) {
      const a = TIME_KEYS[i], b = TIME_KEYS[i + 1];
      if (hour <= b.hour) {
        const t = Math.max(0, (hour - a.hour) / (b.hour - a.hour));
        return {
          sky: lerpVec3(a.sky, b.sky, t),
          ambient: a.ambient + (b.ambient - a.ambient) * t,
          sun: lerpVec3(a.sun, b.sun, t),
        };
      }
    }
    return TIME_KEYS[TIME_KEYS.length - 1];
  }

  // 시간별 안개 밀도 (클수록 짙음). 노을·새벽에 조금 더 짙게. 사이 시간은 선형 보간
  //   밀도 0.004 기준: 120m 앞은 약 20%, 300m 앞은 약 76%가 안개 색
  const FOG_KEYS = [
    { hour: 5.0, density: 0.0050 },
    { hour: 6.0, density: 0.0056 },   // 새벽 안개
    { hour: 8.0, density: 0.0040 },
    { hour: 16.5, density: 0.0040 },
    { hour: 18.5, density: 0.0058 },  // 노을
    { hour: 20.0, density: 0.0050 },
    { hour: 23.0, density: 0.0050 },
  ];
  function fogDensityAt(hour) {
    for (let i = 0; i < FOG_KEYS.length - 1; i++) {
      const a = FOG_KEYS[i], b = FOG_KEYS[i + 1];
      if (hour <= b.hour) return a.density + (b.density - a.density) * Math.max(0, (hour - a.hour) / (b.hour - a.hour));
    }
    return FOG_KEYS[FOG_KEYS.length - 1].density;
  }

  // 경기장 조명 밝기 0~1: 새벽에는 해 뜨기 전에 꺼지고, 저녁 17.5시부터 19시까지 서서히 켜짐
  const LIGHTS_ON_START = 17.5, LIGHTS_ON_FULL = 19.0;
  const LIGHTS_OFF_START = 5.5, LIGHTS_OFF_FULL = 6.5;
  function stadiumLightLevel(hour) {
    if (hour >= LIGHTS_ON_FULL || hour <= LIGHTS_OFF_START) return 1;
    if (hour >= LIGHTS_ON_START) return (hour - LIGHTS_ON_START) / (LIGHTS_ON_FULL - LIGHTS_ON_START);
    if (hour < LIGHTS_OFF_FULL) return 1 - (hour - LIGHTS_OFF_START) / (LIGHTS_OFF_FULL - LIGHTS_OFF_START);
    return 0;
  }

  // 태양: 주 광원 위치에 놓은 발광 구. 빛이 어디서 오는지 눈으로 확인하는 기준점
  const SUN_RADIUS = 20;
  const sunNode = {
    id: 'sun',
    primitive: 'sphere',            // 반지름 1인 구 → meshScale로 크기 조절
    position: sunPosition(12),
    meshScale: SUN_RADIUS,
    color: [255, 214, 90],
    emissive: true,                 // 조명 계산 없이 항상 밝게 (그림자도 만들지 않음)
    fog: false,                     // 530m 밖이라 안개에 가려지지 않도록 제외
  };
  window.SCENE_MODELS.push(sunNode);
  window.SUN = sunNode;

  const MIN_HOUR = 5, MAX_HOUR = 23;
  let currentHour = 12;
  const formatHour = (hour) => {
    const h = Math.floor(hour), m = Math.round((hour - h) * 60);
    return `${String(m === 60 ? h + 1 : h).padStart(2, '0')}:${String(m === 60 ? 0 : m).padStart(2, '0')}`;
  };
  const isNight = (hour) => stadiumLightLevel(hour) >= 0.5;

  function setTimeOfDay(hour) {
    currentHour = Math.min(MAX_HOUR, Math.max(MIN_HOUR, hour));
    const keys = sampleTimeKeys(currentHour);
    const lampLevel = stadiumLightLevel(currentHour);
    const sunPos = sunPosition(currentHour);
    const sunUp = sunPos[1] > 0;
    const sunStrength = Math.max(...keys.sun);
    const floodStrength = Math.max(...FLOOD_MAIN_COLOR) * lampLevel;

    // 그림자를 만드는 주 광원: 햇빛이 경기장 주 조명보다 강하면 태양, 아니면 경기장 주 조명
    const useSun = sunUp && sunStrength >= floodStrength;
    window.ACTIVE_LIGHTING = {
      skyColor: [...keys.sky, 1],
      ambientLight: [keys.ambient, keys.ambient, keys.ambient + 0.02],
      mainLightPos: useSun ? sunPos : FLOOD_MAIN_POS,
      mainLightColor: useSun ? keys.sun : FLOOD_MAIN_COLOR.map((c) => c * lampLevel),
      shadow: SHADOW_AREA,
      pointLights: lampLevel > 0
        ? stadiumLampPositions.map((position) => ({ position, color: STADIUM_LAMP_COLOR.map((c) => c * lampLevel) }))
        : [],
      pointLightRange: 55,
      // 안개: 하늘색과 같은 색이라 먼 곳이 하늘에 녹아듦 (대기 원근 → 거리감)
      fog: { color: keys.sky, density: fogDensityAt(currentHour) },
    };

    sunNode.position = sunPos;
    sunNode.visible = sunUp;
    // 조명이 절반 이상 켜지면 램프·콘코스 창·전광판 화면이 스스로 빛남 (조명 계산 무시)
    for (const node of glowNodes) node.emissive = isNight(currentHour);
    // 외야 너머 아파트: 주변광이 어두워질수록 밤 겹(불 켜진 창문)이 서서히 진해짐
    //   주변광 0.40(낮) → 0 , 0.07(밤) → 1, 사이는 smoothstep으로 부드럽게 (노을·새벽에 반쯤 섞임)
    if (apartments) {
      const k = Math.min(1, Math.max(0, (0.40 - keys.ambient) / (0.40 - 0.07)));
      apartments.night.opacity = k * k * (3 - 2 * k);
      apartments.night.visible = apartments.night.opacity > 0.01;
    }
    // 빛 번짐 판: 경기장 조명 밝기(lampLevel)만큼 진해짐
    for (const { node, strength } of glowSprites) {
      node.visible = lampLevel > 0;
      node.opacity = lampLevel * strength;
    }

    const slider = document.getElementById('timeSlider');
    if (slider && Number(slider.value) !== currentHour) slider.value = String(currentHour);
    const label = document.getElementById('timeLabel');
    if (label) label.textContent = `시간 ${formatHour(currentHour)}`;
    const button = document.getElementById('dayNightButton');
    if (button) {
      button.textContent = isNight(currentHour) ? '11. 낮으로 (12:00)' : '11. 밤으로 (21:00)';
      button.classList.toggle('active', isNight(currentHour));
    }
  }

  // ------------------------------------------------------------------
  // 빛 번짐 (글로우 스프라이트): 램프마다 카메라를 향한 판을 겹쳐 그림
  //   판의 텍스처 = 가운데는 밝고 바깥으로 갈수록 투명해지는 원 (캔버스로 직접 만든 그라디언트)
  //   엔진의 blend: 'add'(더하기 블렌딩)로 그려서 뒤 배경에 빛이 더해짐 → 램프 주변이 뿌옇게 빛나 보임
  //   판은 매 프레임 카메라 쪽으로 돌림 (빌보드)
  // ------------------------------------------------------------------
  function makeGlowTexture() {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255, 246, 220, 1)');
    g.addColorStop(0.25, 'rgba(255, 232, 180, 0.55)');
    g.addColorStop(1, 'rgba(255, 210, 140, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return canvas.toDataURL();
  }
  const GLOW_TEXTURE = makeGlowTexture();
  // 로컬 XY 평면의 한 변 1 사각형 (앞면 = +z)
  const GLOW_MESH = {
    positions: new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    texCoords: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
  };

  const glowSprites = [];
  function addGlow(id, position, size, strength) {
    const node = {
      id,
      primitive: GLOW_MESH,
      position: [...position],
      rotation: [0, 0, 0],
      meshScale: size,
      color: [0, 0, 0],        // 이미지가 불러와지기 전 1×1 기본색 (검정 = 더해도 변화 없음)
      texture: GLOW_TEXTURE,
      emissive: true,
      blend: 'add',
      fog: false,
      opacity: 0,
      visible: false,
    };
    glowSprites.push({ node, strength });
    return node;
  }
  const glowRoot = { id: 'stadium_glows', children: [] };
  for (const { id, position } of roofFixtures) {
    glowRoot.children.push(addGlow(`${id}_glow`, position, 7, 0.6)); // 지붕 조명: 7m 판
  }
  towerLightPositions.forEach((p, i) => {
    glowRoot.children.push(addGlow(`tower_glow_${i}`, [p[0], p[1] + 0.5, p[2]], 20, 0.85)); // 조명탑: 20m 판
  });
  window.SCENE_MODELS.push(glowRoot);

  // 매 프레임 판을 카메라 쪽으로 돌림: 판의 앞면(+z)이 카메라를 향하도록 yaw(y축)·pitch(x축) 계산
  function faceGlowsToCamera() {
    const cam = window.ACTIVE_CAMERA;
    if (!cam || !glowSprites[0]?.node.visible) return;
    for (const { node } of glowSprites) {
      const dx = cam.eye[0] - node.position[0];
      const dy = cam.eye[1] - node.position[1];
      const dz = cam.eye[2] - node.position[2];
      const len = Math.hypot(dx, dy, dz) || 1;
      node.rotation[1] = Math.atan2(dx, dz);
      node.rotation[0] = -Math.asin(dy / len);
    }
  }
  onFrame(faceGlowsToCamera);

  // 다른 팀원이 쓸 수 있도록 내보내기
  window.setTimeOfDay = setTimeOfDay;
  window.getTimeOfDay = () => currentHour;
  window.setDayNight = (mode) => setTimeOfDay(mode === 'night' ? 21 : 12);
  window.toggleDayNight = () => setTimeOfDay(isNight(currentHour) ? 12 : 21);

  // 시간 슬라이더 + 버튼 11 (index.html의 .control-group에 추가)
  const controlGroup = document.querySelector('.controls .control-group');
  if (controlGroup) {
    const label = document.createElement('span');
    label.id = 'timeLabel';
    label.style.cssText = 'align-self:center; margin:0 6px 6px 10px; font-variant-numeric:tabular-nums;';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.id = 'timeSlider';
    slider.min = String(MIN_HOUR);
    slider.max = String(MAX_HOUR);
    slider.step = '0.1';
    slider.style.cssText = 'align-self:center; width:220px; margin:0 6px 6px;';
    slider.addEventListener('input', () => setTimeOfDay(Number(slider.value)));

    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'dayNightButton';
    button.addEventListener('click', window.toggleDayNight);

    controlGroup.append(button, label, slider);
  }
  setTimeOfDay(12);

})();
