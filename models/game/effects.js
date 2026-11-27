'use strict';

// [역할 3: 게임] 2/4 — 3D 연출과 소리
//   스트라이크존 표시, 루 위 주자, 함성 소리, 홈런 전광판 쇼, 밤 홈런 조명 쇼, 타구 궤적
//   경기 규칙은 모르고, game.js가 부르는 대로 보여 주기만 합니다.
(function () {
  const G = window.GAME_CONTROLLER;
  const pb = window.PITCHER_BATTER;
  if (!G || !pb) return;
  const { rand, wait, nowSec, ZONE, ZONES } = G;
  const info = window.STADIUM_INFO ?? {};
  let clock = 0; // 마지막 프레임 시각(초), 맨 아래 프레임 갱신에서 바뀜

  // ------------------------------------------------------------------
  // 1) 스트라이크존 3D 표시: 반투명 판 (고른 칸은 색이 진해짐)
  // ------------------------------------------------------------------
  const ZONE_COLORS = { base: [255, 255, 255], mine: [255, 210, 60], cpu: [255, 80, 80], hit: [80, 255, 120] };
  const zoneCells = ZONES.map((zone, i) => ({
    id: `zone_cell_${i}`,
    primitive: 'box',
    position: [...zone.target],
    meshScale: [ZONE.width - 0.008, ZONE.cellH - 0.008, 0.01],
    color: ZONE_COLORS.base,
    emissive: true,
    blend: 'alpha',
    opacity: 0.15,
    castShadow: false,
    fog: false,
  }));
  // 합친 존: 내가 공격할 때는 칸을 고르지 않으므로 3칸 대신 존 전체를 판 하나로 보여 줌
  const zoneWhole = {
    id: 'zone_whole',
    primitive: 'box',
    position: [0, (ZONE.top + ZONE.bottom) / 2, ZONE.z],
    meshScale: [ZONE.width - 0.008, ZONE.top - ZONE.bottom - 0.008, 0.01],
    color: ZONE_COLORS.base,
    emissive: true,
    blend: 'alpha',
    opacity: 0.15,
    castShadow: false,
    fog: false,
    visible: false,
  };
  // split = true: 3칸(수비할 때), false: 한 판(공격할 때)
  function setZoneSplit(split) {
    for (const cell of zoneCells) cell.visible = split;
    zoneWhole.visible = !split;
  }

  // marks = { 칸 번호: 'mine' | 'cpu' | 'hit' } (없는 칸은 기본색)
  //   합친 존일 때는 표시가 하나라도 있으면 판 전체를 그 색으로 (맞힘 > CPU > 나 순서)
  function paintZones(marks = {}) {
    zoneCells.forEach((cell, i) => {
      const mark = marks[i];
      cell.color = mark ? ZONE_COLORS[mark] : ZONE_COLORS.base;
      cell.opacity = mark ? 0.5 : 0.15;
    });
    const all = Object.values(marks);
    const mark = ['hit', 'cpu', 'mine'].find((m) => all.includes(m));
    zoneWhole.color = mark ? ZONE_COLORS[mark] : ZONE_COLORS.base;
    zoneWhole.opacity = mark ? 0.5 : 0.15;
  }

  // ------------------------------------------------------------------
  // 3) 주자: 다른 선수들과 같은 모양 (몸통 네모 + 머리 구 + 모자 구 + 가슴·모자 엠블럼)
  //   크기는 fielders.js의 makePerson과 같음 (키 1.8 = 몸통 1.44 + 머리). 몸 앞 = 로컬 −z, 홈플레이트 쪽을 봄
  // ------------------------------------------------------------------
  const BASES = [
    info.bases?.first ?? [19.4, 0, -19.4],
    info.bases?.second ?? [0, 0, -38.8],
    info.bases?.third ?? [-19.4, 0, -19.4],
  ];
  const RUNNER_QUAD = { // 엠블럼 판 (텍스처 좌표 0~1)
    positions: new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    texCoords: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
  };
  const RB = { width: 0.55, height: 1.44, depth: 0.38 };
  const RHEAD_Y = RB.height + 0.18;
  function makeRunner(base, i) {
    const position = [base[0], base[1] ?? 0, base[2] + 0.9]; // 루 바로 옆 (홈 쪽)
    const body = { id: `runner_${i}_body`, primitive: 'box', meshOffset: [0, RB.height / 2, 0], meshScale: [RB.width, RB.height, RB.depth], color: [200, 200, 200] };
    const head = { id: `runner_${i}_head`, primitive: 'sphere', position: [0, RHEAD_Y, 0], meshScale: 0.17, color: [235, 195, 160] };
    const cap = { id: `runner_${i}_cap`, primitive: 'sphere', position: [0, RHEAD_Y + 0.07, 0], meshScale: [0.18, 0.1, 0.18], color: [120, 120, 120] };
    // 몸 앞이 −z라서 판을 Y축 180° 돌려 붙임 (흰 바탕 패치 + 엠블럼)
    const chestY = RB.height / 2 + RB.height * 0.18, chestH = Math.min(RB.width * 0.55, RB.height * 0.35);
    const flat = (id, pos, size, extra) => ({
      id, primitive: RUNNER_QUAD, position: pos, rotation: [0, Math.PI, 0], meshScale: [size, size, 1], castShadow: false, ...extra,
    });
    const patches = [
      flat(`runner_${i}_chest_patch`, [0, chestY, -(RB.depth / 2 + 0.003)], chestH * 1.25, { color: [245, 245, 245] }),
      flat(`runner_${i}_cap_patch`, [0, RHEAD_Y + 0.09, -0.187], 0.12, { color: [245, 245, 245] }),
    ];
    const decals = [
      flat(`runner_${i}_chest_logo`, [0, chestY, -(RB.depth / 2 + 0.006)], chestH, { color: [255, 255, 255], blend: 'alpha', decalHeight: chestH }),
      flat(`runner_${i}_cap_logo`, [0, RHEAD_Y + 0.09, -0.19], 0.1, { color: [255, 255, 255], blend: 'alpha', decalHeight: 0.1 }),
    ];
    return {
      id: `runner_${i}`,
      position,
      rotation: [0, Math.atan2(position[0], position[2]), 0], // 홈플레이트 쪽을 봄
      visible: false,
      children: [body, head, cap, ...patches, ...decals],
      body, cap, decals,
    };
  }
  const runnerNodes = BASES.map(makeRunner);
  // bases = [1루, 2루, 3루] 주자 있음 여부, team = 공격 팀 (rules.js의 TEAMS 항목: color·cap·mark·markAspect)
  function showRunners(bases, team) {
    runnerNodes.forEach((node, i) => {
      node.visible = Boolean(bases[i]);
      if (!team) return;
      node.body.color = team.color;
      node.cap.color = team.cap;
      for (const d of node.decals) {
        d.texture = team.mark;
        d.meshScale = [d.decalHeight * team.markAspect, d.decalHeight, 1]; // 엠블럼 비율대로
      }
    });
  }

  window.SCENE_MODELS = window.SCENE_MODELS ?? [];
  window.SCENE_MODELS.push({ id: 'game_effects_root', children: [...zoneCells, zoneWhole, ...runnerNodes] });

  // ------------------------------------------------------------------
  // 4) 함성 소리
  //   CHEER_FILE에 실제 함성 녹음 파일 경로를 적으면 그 파일을 재생합니다. (예: 'sounds/cheer.mp3')
  //   비워 두면 Web Audio로 직접 만든 함성을 재생합니다:
  //     여러 사람의 "와아아" 목소리(톱니파 + '우'→'아'로 바뀌는 모음 공명 필터, 사람마다 음높이·시작 시각이 다름)
  //     + 경기장 울림(잔향)
  // ------------------------------------------------------------------
  const CHEER_FILE = '';
  let audioCtx = null;
  let reverb = null;
  let cheerFileBuffer = null;
  const arand = Math.random; // 소리는 테스트용 고정 난수(rng)를 쓰지 않음 (목소리가 모두 똑같아지므로)

  function getAudio() {
    audioCtx = audioCtx ?? new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    if (!reverb) {
      // 경기장 울림: 1.8초 동안 줄어드는 노이즈를 임펄스 응답으로 쓰는 잔향
      const ctx = audioCtx, len = Math.floor(ctx.sampleRate * 1.8);
      const ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = (arand() * 2 - 1) * Math.pow(1 - i / len, 2.5);
      }
      reverb = ctx.createConvolver();
      reverb.buffer = ir;
      const wet = ctx.createGain();
      wet.gain.value = 0.25;
      reverb.connect(wet).connect(ctx.destination);
    }
    return audioCtx;
  }

  if (CHEER_FILE) {
    fetch(CHEER_FILE).then((r) => r.arrayBuffer()).then((data) => {
      cheerFileBuffer = data;
    }).catch((error) => console.warn('함성 파일을 불러오지 못했습니다:', error));
  }

  async function playCheerFile(ctx, strength, duration) {
    if (!(cheerFileBuffer instanceof AudioBuffer)) cheerFileBuffer = await ctx.decodeAudioData(cheerFileBuffer);
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = cheerFileBuffer;
    const gain = ctx.createGain();
    const level = Math.min(1, 0.6 * strength);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(level, now + 0.15);
    gain.gain.setValueAtTime(level, now + duration * 0.6);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    src.connect(gain).connect(ctx.destination);
    src.start(now, 0, duration);
  }

  // strength: 함성 크기(1 = 보통, 1.6 = 홈런), duration: 길이(초)
  function cheer(strength = 1, duration = 2.5) {
    try {
      const ctx = getAudio();
      if (cheerFileBuffer) {
        playCheerFile(ctx, strength, duration).catch((error) => console.warn('함성 파일 재생 실패:', error));
        return;
      }
      const now = ctx.currentTime;

      // 전체 볼륨 + 압축(여러 목소리가 겹쳐도 소리가 깨지지 않게)
      const master = ctx.createGain();
      master.gain.value = Math.min(0.9, 0.5 * strength);
      const comp = ctx.createDynamicsCompressor();
      const soften = ctx.createBiquadFilter(); // 톱니파의 날카로운 고음을 깎음
      soften.type = 'lowpass';
      soften.frequency.value = 3200;
      master.connect(soften).connect(comp);
      comp.connect(ctx.destination);
      comp.connect(reverb);

      // 모음 공명(포먼트): 처음엔 '우'(F1 350Hz, F2 700Hz)였다가 '아'(760Hz, 1180Hz)로 열려서 "와아~"
      const voices = ctx.createGain();
      for (const [from, to, q, g] of [[350, 760, 4, 1], [700, 1180, 5, 0.55], [2300, 2550, 7, 0.22]]) {
        const band = ctx.createBiquadFilter();
        band.type = 'bandpass';
        band.frequency.setValueAtTime(from, now);
        band.frequency.linearRampToValueAtTime(from, now + 0.12);
        band.frequency.exponentialRampToValueAtTime(to, now + 0.45);
        band.Q.value = q;
        const bandGain = ctx.createGain();
        bandGain.gain.value = g;
        voices.connect(band).connect(bandGain).connect(master);
      }

      // 사람 목소리 여러 개 (함성이 클수록 많이)
      const count = Math.round(Math.min(48, 26 * strength));
      for (let k = 0; k < count; k++) {
        const female = arand() < 0.45;
        const f = female ? 210 + arand() * 120 : 105 + arand() * 70;
        const onset = now + arand() * 0.2;
        const attack = 0.12 + arand() * 0.3;
        const release = now + duration * (0.55 + arand() * 0.45);

        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        // "우와아↑" 하고 음이 올라갔다가 끝에서 살짝 내려감
        osc.frequency.setValueAtTime(f * 0.85, onset);
        osc.frequency.linearRampToValueAtTime(f * 1.18, onset + attack + 0.25);
        osc.frequency.linearRampToValueAtTime(f * 1.05, release);
        // 떨림(비브라토)
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 4.5 + arand() * 2.5;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = f * 0.025;
        lfo.connect(lfoGain).connect(osc.frequency);

        const env = ctx.createGain();
        const peak = 0.05 + arand() * 0.04;
        env.gain.setValueAtTime(0.0001, now);
        env.gain.setValueAtTime(0.0001, onset);
        env.gain.exponentialRampToValueAtTime(peak, onset + attack);
        env.gain.setValueAtTime(peak * (0.7 + arand() * 0.3), release - 0.3);
        env.gain.exponentialRampToValueAtTime(0.0001, release);

        const pan = ctx.createStereoPanner();
        pan.pan.value = arand() * 1.6 - 0.8;
        osc.connect(env).connect(pan).connect(voices);
        osc.start(onset);
        lfo.start(onset);
        osc.stop(release + 0.05);
        lfo.stop(release + 0.05);
      }
    } catch (error) {
      console.warn('함성 소리를 재생하지 못했습니다:', error);
    }
  }

  // ------------------------------------------------------------------
  // 5) 홈런 전광판 쇼 (낮·밤 모두): 외야 전광판이 "HOME RUN!" 글자와 여러 색으로 깜빡임
  //   전광판 화면(stadium_model.js의 boardFace) 바로 앞에 얇은 판 2장을 띄워서 번갈아 보여 줌
  //     - 글자 판: 캔버스로 그린 "HOME RUN!" 이미지
  //     - 색 판  : 단색 (금색 → 빨강 → 하늘색 → 흰색 차례로)
  // ------------------------------------------------------------------
  const parts = window.STADIUM_PARTS ?? {};
  const BOARD_FLASH_COLORS = [[255, 205, 40], [255, 60, 60], [80, 200, 255], [255, 255, 255]];
  let boardFlash = null; // { start, until }

  // 전광판 화면 노드 찾기: 밤에 빛나는 노드 중 가로 폭이 가장 좁은 것(약 27m) = 전광판
  function findBoardScreen() {
    let best = null;
    for (const node of parts.glowNodes ?? []) {
      const p = node.primitive?.positions;
      if (!p) continue;
      const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < p.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          mn[k] = Math.min(mn[k], p[i + k]);
          mx[k] = Math.max(mx[k], p[i + k]);
        }
      }
      const width = mx[0] - mn[0];
      if (!best || width < best.width) best = { node, width, mn, mx };
    }
    return best;
  }
  const board = findBoardScreen();
  const boardCenter = board
    ? [(board.mn[0] + board.mx[0]) / 2, (board.mn[1] + board.mx[1]) / 2, board.mx[2] + 0.05]
    : [0, 24, -142.8];
  const boardSize = board ? [board.width * 0.98, (board.mx[1] - board.mn[1]) * 0.96, 1] : [26.5, 9.6, 1];

  // "HOME RUN!" 글자 이미지 (캔버스로 직접 그림, 가로:세로 = 전광판 비율)
  function makeHomeRunTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 540;
    canvas.height = Math.round(540 * boardSize[1] / boardSize[0]);
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.fillStyle = '#0a0a14';
    ctx.fillRect(0, 0, w, h);
    // 전광판 전구 느낌의 점 무늬 테두리
    ctx.fillStyle = '#ffd23c';
    for (let x = 8; x < w; x += 16) {
      ctx.beginPath(); ctx.arc(x, 8, 4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x, h - 8, 4, 0, Math.PI * 2); ctx.fill();
    }
    // 글자가 전광판 폭의 88% 안에 들어가도록 글자 크기를 맞춤
    let size = Math.round(h * 0.55);
    const setFont = () => { ctx.font = `bold ${size}px "Arial Black", Arial, sans-serif`; };
    setFont();
    while (size > 10 && ctx.measureText('HOME RUN!').width > w * 0.88) { size -= 2; setFont(); }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#c81e1e';
    ctx.strokeText('HOME RUN!', w / 2, h / 2 + 4);
    ctx.fillStyle = '#ffe14a';
    ctx.fillText('HOME RUN!', w / 2, h / 2 + 4);
    return canvas.toDataURL();
  }
  // 로컬 XY 평면의 한 변 1 사각형 (앞면 = +z = 홈플레이트 쪽)
  const QUAD = {
    positions: new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    texCoords: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
  };
  const boardScreen = (id, extra) => ({
    // 외야 점수판(scoreboard.js) 글자보다 앞에 보이도록 0.3m 앞으로
    id, primitive: QUAD, position: [boardCenter[0], boardCenter[1], boardCenter[2] + 0.3], meshScale: boardSize,
    emissive: true, fog: false, castShadow: false, visible: false, ...extra,
  });
  const boardText = boardScreen('board_homerun_text', { color: [10, 10, 20], texture: makeHomeRunTexture() });
  const boardColor = boardScreen('board_homerun_color', { color: BOARD_FLASH_COLORS[0] });
  window.SCENE_MODELS.push({ id: 'board_homerun_root', children: [boardText, boardColor] });

  function flashScoreboard(seconds = 5) {
    boardFlash = { start: nowSec(), until: nowSec() + seconds };
  }
  function updateBoardFlash() {
    if (!boardFlash) return;
    if (clock >= boardFlash.until) {
      boardFlash = null;
      boardText.visible = boardColor.visible = false;
      return;
    }
    // 0.16초마다: 글자 → 색 → 글자 → 꺼짐(원래 전광판) 순서로 반복
    const step = Math.floor((clock - boardFlash.start) / 0.16);
    const phase = step % 4;
    boardText.visible = phase === 0 || phase === 2;
    boardColor.visible = phase === 1;
    boardColor.color = BOARD_FLASH_COLORS[Math.floor(step / 4) % BOARD_FLASH_COLORS.length];
  }

  // ------------------------------------------------------------------
  // 5-2) 홈런 조명 쇼 (밤에만): 경기장 조명이 색을 바꾸며 깜빡임
  //   밤 = 경기장 조명이 절반 이상 켜지는 시간 (lighting.js 기준 약 18:15 ~ 다음 날 06:00)
  // ------------------------------------------------------------------
  const FLASH_COLORS = [[1.6, 1.5, 1.2], [1.6, 0.3, 0.3], [0.3, 0.6, 1.8], [1.6, 1.3, 0.2]];
  let flash = null; // { until, base }

  function isNight() {
    const hour = window.getTimeOfDay?.() ?? 12;
    return hour >= 18.25 || hour <= 6.0;
  }
  // 밤이면 조명 쇼를 시작하고 true, 낮이면 아무것도 안 하고 false
  function flashLights(seconds = 5) {
    if (!isNight()) return false;
    flash = { until: nowSec() + seconds, base: flash?.base ?? window.ACTIVE_LIGHTING };
    return true;
  }
  function lampPositions() {
    const roof = parts.roofLightPositions ?? [];
    const step = Math.max(1, Math.floor(roof.length / 6));
    return [...(parts.towerLightPositions ?? []), ...roof.filter((_, i) => i % step === 0)].slice(0, 8);
  }
  function glowSprites() {
    const root = (window.SCENE_MODELS ?? []).find((n) => n.id === 'stadium_glows');
    return root?.children ?? [];
  }
  function updateFlash() {
    if (!flash) return;
    if (clock >= flash.until) {
      flash = null;
      window.setTimeOfDay?.(window.getTimeOfDay?.() ?? 21); // 원래 조명으로 되돌림
      return;
    }
    const step = Math.floor(clock * 7);
    const on = step % 2 === 0;
    const color = FLASH_COLORS[Math.floor(step / 2) % FLASH_COLORS.length];
    const base = flash.base ?? window.ACTIVE_LIGHTING;
    const amb = base.ambientLight;
    window.ACTIVE_LIGHTING = {
      ...base,
      ambientLight: on ? amb.map((a, i) => a + 0.12 * color[i]) : amb.map((a) => a * 0.6),
      pointLights: lampPositions().map((position) => ({ position, color: on ? color : [0, 0, 0] })),
      pointLightRange: 80,
    };
    for (const sprite of glowSprites()) {
      sprite.visible = on;
      sprite.opacity = on ? 0.95 : 0;
    }
    for (const node of parts.glowNodes ?? []) node.emissive = on;
  }

  // ------------------------------------------------------------------
  // 6) 타구 궤적 (공 날아가기)
  // ------------------------------------------------------------------
  // 펜스까지 거리 (stadium_model.js의 fenceRadius(θ)는 함수: 좌우 폴 100m, 중앙 122m)
  const fenceAt = (theta) => (typeof info.fenceRadius === 'function' ? info.fenceRadius(theta) : 110);
  let flight = null; // { start, duration, from, to, apex }

  // kind: foul | single | double | homerun
  // onLaunch(to, duration): 공이 떨어질 곳이 정해지면 호출 (수비수 달리기용)
  // 공이 다 날아가면 끝나는 Promise를 돌려줌
  function hitFlight(kind, onLaunch) {
    const side = rand() < 0.5 ? -1 : 1;
    const deg = Math.PI / 180;
    const plans = {
      foul: { angle: side * (52 + rand() * 25) * deg, dist: 25 + rand() * 25, apex: 12 + rand() * 10, endY: 0.1, duration: 1.6 },
      single: { angle: (rand() * 70 - 35) * deg, dist: 38 + rand() * 15, apex: 2 + rand() * 4, endY: 0.1, duration: 1.3 },
      double: { angle: side * (18 + rand() * 20) * deg, dist: 70 + rand() * 15, apex: 14 + rand() * 6, endY: 0.1, duration: 2.0 },
      homerun: { angle: (rand() * 70 - 35) * deg, dist: 0, apex: 38, endY: 10, duration: 2.8 },
    };
    const p = plans[kind];
    if (kind === 'homerun') p.dist = fenceAt(p.angle) + 25; // 펜스 너머 관중석
    pb.finishPitch();
    const from = [...pb.ball.position];
    const to = [Math.sin(p.angle) * p.dist, p.endY, -Math.cos(p.angle) * p.dist];
    flight = { start: nowSec(), duration: p.duration, from, to, apex: p.apex };
    onLaunch?.(to, p.duration);
    return wait(p.duration * 1000);
  }
  function updateFlight(dt) {
    if (!flight) return;
    const t = Math.min((clock - flight.start) / flight.duration, 1);
    const pos = lerpVec3(flight.from, flight.to, t);
    pos[1] += 4 * t * (1 - t) * flight.apex;
    pb.ball.position = pos;
    pb.ball.rotation[0] += dt * 25;
    if (t >= 1) flight = null;
  }
  // 플레이가 끝나면 공을 숨김 (필드·홈플레이트·관중석에 공이 남지 않게)
  //   다음 투구 때 투수 모션에서 공을 다시 표시합니다.
  function hideBall() {
    flight = null;
    pb.finishPitch();
    pb.ball.visible = false;
    pb.ball.position = [...pb.ballStart];
  }
  // 새 경기: 날아가던 공을 멈추고 숨김
  function resetBall() {
    hideBall();
    pb.resetPose();
  }

  // ------------------------------------------------------------------
  // 7) 매 프레임 갱신
  // ------------------------------------------------------------------
  const prevUpdate = window.updateBaseballScene;
  window.updateBaseballScene = function (timeSec, dt) {
    if (typeof prevUpdate === 'function') prevUpdate(timeSec, dt);
    clock = timeSec;
    updateFlight(dt);
    updateBoardFlash();
    updateFlash();
  };

  // 전광판 화면 위치·크기와 사각형 판 (intro.js가 팀 고르기 화면을 전광판에 띄울 때 씀)
  const boardArea = { center: boardCenter, size: boardSize };

  Object.assign(G, {
    board: boardArea, QUAD, setZoneSplit, paintZones, showRunners, cheer,
    flashScoreboard, flashLights, hitFlight, resetBall, hideBall,
    SWING_LEAD: pb.swingLead,
    startSwing: (zone, contactInSec, start) => pb.startSwing(ZONES[zone].target, contactInSec, start),
  });
})();
