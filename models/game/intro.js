'use strict';

// [역할 3: 게임] 5/5 — 타이틀 화면과 팀 고르기
//   ① 웹에 접속하면 "게임 시작" 버튼
//   ② 누르면 카메라가 외야 전광판을 비추고, 전광판에 두 팀 로고가 뜸 → TEAM_PICK_SECONDS(10초) 안에 클릭해서 고름
//   ③ 시간 안에 안 고르면 DEFAULT_TEAM(덕진 Computers)으로 자동 선택
//   덕진 Computers는 항상 선수비(후공), 완산 AIs는 선공 → game.js의 startGame(팀)이 경기를 시작
(function () {
  const G = window.GAME_CONTROLLER;
  if (!G || !G.board) return;
  const { TEAMS, DEFAULT_TEAM, TEAM_PICK_SECONDS, QUAD, board, nowSec, toast, log } = G;
  const DEG = Math.PI / 180;

  // ------------------------------------------------------------------
  // 1) 전광판 위에 띄울 3D 판들 (화면 가리개 + 팀마다 테두리·흰 카드·로고)
  //   전광판 화면 바로 앞에 조금씩 앞으로 겹쳐 놓음 (뒤 판이 가려지지 않도록 z를 띄움)
  // ------------------------------------------------------------------
  const [cx, cy, cz] = board.center;
  const [bw, bh] = board.size;
  const quad = (id, position, scale, extra) => ({
    id, primitive: QUAD, position, meshScale: [scale[0], scale[1], 1],
    emissive: true, fog: false, castShadow: false, visible: false, ...extra,
  });

  const cover = quad('pick_cover', [cx, cy, cz + 0.05], [bw, bh], { color: [12, 14, 30] });
  const CARD_W = bw * 0.42, CARD_H = bh * 0.86;
  const teamKeys = Object.keys(TEAMS); // ['deokjin', 'wansan'] → 왼쪽, 오른쪽
  const cards = teamKeys.map((key, i) => {
    const x = cx + (i === 0 ? -1 : 1) * bw * 0.24;
    // 고르기 테두리: 가운데가 비어 있는 노란 사각 틀 (얇은 막대 4개) → 로고 뒤가 비치지 않음
    const T = 0.35, fw = CARD_W + T, fh = CARD_H + T, fz = cz + 0.1;
    const bar = (side, pos, size) => quad(`pick_${key}_frame_${side}`, pos, size, { color: [255, 210, 60], visible: true });
    const frame = {
      id: `pick_${key}_frame`,
      visible: false,
      children: [
        bar('top', [x, cy + fh / 2, fz], [fw + T, T]),
        bar('bottom', [x, cy - fh / 2, fz], [fw + T, T]),
        bar('left', [x - fw / 2, cy, fz], [T, fh + T]),
        bar('right', [x + fw / 2, cy, fz], [T, fh + T]),
      ],
    };
    const card = {
      key,
      center: [x, cy, cz],
      frame,
      // 로고만 띄움 (흰 카드 없음). 로고 이미지의 투명한 부분은 alpha 블렌딩으로 전광판 화면이 그대로 비침
      logo: quad(`pick_${key}_logo`, [x, cy, cz + 0.2], [CARD_W * 0.9, CARD_H * 0.9], { color: [0, 0, 0], texture: TEAMS[key].logo, blend: 'alpha' }),
    };
    // 로고 비율에 맞춰 크기 조절 (이미지를 불러와서 가로:세로를 앎 → 카드 안에 꽉 차게, 찌그러지지 않게)
    const img = new Image();
    img.onload = () => {
      const maxW = CARD_W * 0.9, maxH = CARD_H * 0.9;
      const k = Math.min(maxW / img.width, maxH / img.height);
      card.logo.meshScale = [img.width * k, img.height * k, 1];
    };
    img.src = TEAMS[key].logo;
    return card;
  });
  const pickNodes = [cover, ...cards.flatMap((c) => [c.frame, c.logo])];
  window.SCENE_MODELS = window.SCENE_MODELS ?? [];
  window.SCENE_MODELS.push({ id: 'team_pick_root', children: pickNodes });

  // ------------------------------------------------------------------
  // 2) 화면 요소 (ui.js의 #gameOverlay 안에 넣어서 캔버스와 같은 위치·크기)
  // ------------------------------------------------------------------
  const style = document.createElement('style');
  style.textContent = `
    .i-layer { position: absolute; inset: 0; pointer-events: none !important; }
    .i-title { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); text-align: center;
      background: rgba(0,0,0,.6); border-radius: 10px; padding: 26px 40px; pointer-events: auto; }
    .i-title h2 { margin: 0 0 6px; font-size: 32px; letter-spacing: 1px; }
    .i-title p { margin: 0 0 18px; color: #ccd; font-size: 14px; }
    .i-start { font-size: 22px; font-weight: bold; padding: 14px 44px; border: 0; border-radius: 8px;
      background: #ffd84a; color: #111; cursor: pointer; }
    .i-start:hover { background: #ffe57f; }
    .i-head { position: absolute; transform: translate(-50%, -100%); text-align: center; white-space: nowrap;
      font-weight: bold; text-shadow: 0 2px 6px #000; }
    .i-head .i-count { font-size: 40px; color: #ffd84a; line-height: 1; }
    .i-head .i-msg { font-size: 18px; margin-top: 4px; }
    .i-hit { position: absolute; pointer-events: auto; cursor: pointer; border-radius: 6px; }
    .i-name { position: absolute; transform: translate(-50%, 0); font-size: 15px; font-weight: bold; white-space: nowrap;
      text-shadow: 0 1px 4px #000; }
  `;
  document.head.append(style);

  const overlay = document.getElementById('gameOverlay');
  const layer = document.createElement('div');
  layer.className = 'i-layer';
  layer.innerHTML = `
    <div class="i-title">
      <h2>⚾ 5이닝 야구</h2>
      <p>투구는 칸을 골라서, 타격은 타이밍에 맞춰서!</p>
      <button type="button" class="i-start">게임 시작</button>
    </div>
    <div class="i-head"><div class="i-count"></div><div class="i-msg">팀을 고르세요</div></div>
    ${teamKeys.map((key) => `<div class="i-hit" data-team="${key}"></div><div class="i-name" data-name="${key}">${TEAMS[key].name}</div>`).join('')}
  `;
  overlay.append(layer);
  const titleEl = layer.querySelector('.i-title');
  const headEl = layer.querySelector('.i-head');
  const countEl = layer.querySelector('.i-count');
  const hitEls = Object.fromEntries(teamKeys.map((k) => [k, layer.querySelector(`[data-team="${k}"]`)]));
  const nameEls = Object.fromEntries(teamKeys.map((k) => [k, layer.querySelector(`[data-name="${k}"]`)]));

  // ------------------------------------------------------------------
  // 3) 화면 흐름: title → pick → (팀 결정) → 경기
  // ------------------------------------------------------------------
  let phase = 'off';      // 'title' | 'pick' | 'picked' | 'off'
  let deadline = 0;
  let hovered = null;
  let picked = null;

  function setPickVisible(on) {
    for (const node of pickNodes) node.visible = on;
    for (const c of cards) c.frame.visible = false; // 테두리는 마우스를 올리거나 고른 팀만
  }

  function showTitle() {
    phase = 'title';
    picked = hovered = null;
    setPickVisible(false);
    window.setCameraPreset?.('overview');
    log('게임 시작 버튼을 눌러 주세요.');
    render();
  }

  function startPick() {
    if (phase !== 'title') return;
    phase = 'pick';
    deadline = nowSec() + TEAM_PICK_SECONDS;
    setPickVisible(true);
    log(`${TEAM_PICK_SECONDS}초 안에 전광판에서 팀 로고를 클릭하세요. (안 고르면 ${TEAMS[DEFAULT_TEAM].name})`);
    render();
  }

  function pickTeam(key, auto = false) {
    if (phase !== 'pick') return;
    phase = 'picked';
    picked = key;
    toast(`${auto ? '시간 초과 · ' : ''}${TEAMS[key].name} 선택!`, '#ffe27a', 1400);
    render();
    setTimeout(() => { // 고른 로고를 잠깐 보여 준 뒤 경기 시작
      phase = 'off';
      setPickVisible(false);
      render();
      G.startGame(key);
    }, 1200);
  }

  function render() {
    titleEl.style.display = phase === 'title' ? '' : 'none';
    const showPick = phase === 'pick' || phase === 'picked';
    headEl.style.display = showPick ? '' : 'none';
    for (const k of teamKeys) {
      hitEls[k].style.display = phase === 'pick' ? '' : 'none';
      nameEls[k].style.display = showPick ? '' : 'none';
    }
    for (const c of cards) c.frame.visible = showPick && (picked ? c.key === picked : c.key === hovered);
  }

  layer.querySelector('.i-start').addEventListener('click', (e) => { e.currentTarget.blur(); startPick(); });
  for (const k of teamKeys) {
    hitEls[k].addEventListener('mouseenter', () => { hovered = k; render(); });
    hitEls[k].addEventListener('mouseleave', () => { if (hovered === k) hovered = null; render(); });
    hitEls[k].addEventListener('click', () => pickTeam(k));
  }

  // ------------------------------------------------------------------
  // 4) 매 프레임: 카메라를 전광판에 고정, 3D 카드 위치에 클릭 영역·글자 맞추기, 남은 시간
  // ------------------------------------------------------------------
  const PICK_CAMERA = { eye: [cx, cy - 1, cz + 24], target: [cx, cy, cz], fov: 50 * DEG };
  const canvas = document.getElementById('glCanvas');

  // 3D 점 → 오버레이 안의 화면 좌표(px). common/app.js와 같은 투영 행렬을 씀
  function project(p) {
    const cam = window.ACTIVE_CAMERA;
    const projection = perspective(cam.fov, canvas.width / canvas.height, cam.near ?? 0.1, cam.far ?? 200);
    const m = multiply(projection, lookAt(cam.eye, cam.target, cam.up ?? [0, 1, 0]));
    const [x, y, z] = p;
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    const nx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
    const ny = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
    return [(nx * 0.5 + 0.5) * overlay.clientWidth, (0.5 - ny * 0.5) * overlay.clientHeight];
  }

  function update() {
    if (phase !== 'pick' && phase !== 'picked') return;
    const cam = window.ACTIVE_CAMERA;
    cam.eye = [...PICK_CAMERA.eye];
    cam.target = [...PICK_CAMERA.target];
    cam.fov = PICK_CAMERA.fov;

    const [hx, hy] = project([cx, cy + bh / 2 + 0.6, cz]);
    headEl.style.left = `${hx}px`;
    headEl.style.top = `${hy}px`;
    for (const c of cards) {
      const [x0, y0] = project([c.center[0] - CARD_W / 2, c.center[1] + CARD_H / 2, cz]);
      const [x1, y1] = project([c.center[0] + CARD_W / 2, c.center[1] - CARD_H / 2, cz]);
      Object.assign(hitEls[c.key].style, { left: `${x0}px`, top: `${y0}px`, width: `${x1 - x0}px`, height: `${y1 - y0}px` });
      Object.assign(nameEls[c.key].style, { left: `${(x0 + x1) / 2}px`, top: `${y1 + 8}px` });
    }

    if (phase === 'pick') {
      const left = deadline - nowSec();
      countEl.textContent = String(Math.max(0, Math.ceil(left)));
      if (left <= 0) pickTeam(DEFAULT_TEAM, true);
    }
  }

  const prevUpdate = window.updateBaseballScene;
  window.updateBaseballScene = function (timeSec, dt) {
    if (typeof prevUpdate === 'function') prevUpdate(timeSec, dt);
    update();
  };

  // 새 경기(다시 시작 포함)마다 타이틀부터
  G.onNewGame = showTitle;
  Object.assign(G, { showTitle, startPick, pickTeam, introPhase: () => phase });
  showTitle();
})();
