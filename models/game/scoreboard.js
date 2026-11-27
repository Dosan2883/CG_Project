'use strict';

// [역할 3: 게임] 외야 전광판 — 경기가 시작되면 흔히 보는 야구 점수판(라인 스코어)으로 바뀜
//
//   ┌──────────────────────────────────────────────┐
//   │            1   2   3   4   5  │  R    H       │  ← 회 번호 (배경 그림)
//   │ [C] 덕진   0   1   0          │  1    3       │  ← 선공 팀 (엠블럼 + 이름 + 회별 점수 + R(점수) + H(안타))
//   │ [A] 완산   0   0              │  0    1       │  ← 후공 팀
//   │ B ●●●  S ●●  O ●●        ◇◆◇       3회초    │  ← 볼카운트 램프 + 주자(루) + 지금 회
//   └──────────────────────────────────────────────┘
//
//   텍스처 좌표(UV) 활용
//   - 숫자·글자: 글자 14개를 가로로 이어 그린 이미지 한 장(아틀라스)을 만들고,
//     글자마다 그 글자 부분의 u 범위만 쓰는 사각형(메시)을 미리 만들어 둠 → 칸마다 메시만 바꿔 끼우면 숫자가 바뀜
//     (텍스처는 처음 한 번만 만들어서, 점수가 바뀌어도 새 텍스처가 생기지 않음)
//   - 엠블럼: C / A 이미지를 사각형 전체(UV 0~1)에 붙임
(function () {
  const G = window.GAME_CONTROLLER;
  if (!G || !G.board) return;
  const { TEAMS, board } = G;
  const [cx, cy, cz] = board.center;
  const [W, H] = board.size;

  // 전광판 안의 위치: u = 왼쪽 0 → 오른쪽 1, v = 아래 0 → 위 1
  const at = (u, v, dz) => [cx - W / 2 + u * W, cy - H / 2 + v * H, cz + dz];

  const COL = { emblem: 0.045, name: 0.085, innings: [0.27, 0.35, 0.43, 0.51, 0.59], R: 0.71, H: 0.84, split: 0.645 };
  const ROW = { head: 0.83, away: 0.6, home: 0.38, bottom: 0.13 };
  const LAMPS = { B: { label: 0.05, at: [0.1, 0.14, 0.18] }, S: { label: 0.25, at: [0.3, 0.34] }, O: { label: 0.41, at: [0.46, 0.5] } };

  // ------------------------------------------------------------------
  // 1) 글자 아틀라스: '0'~'9', 'X', '회', '초', '말' 을 96×96 칸에 하나씩
  // ------------------------------------------------------------------
  const GLYPHS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'X', '회', '초', '말'];
  const CELL = 96;
  function makeAtlas(color) {
    const canvas = document.createElement('canvas');
    canvas.width = CELL * GLYPHS.length;
    canvas.height = CELL;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    GLYPHS.forEach((g, i) => {
      ctx.font = /[0-9X]/.test(g) ? 'bold 84px "Arial Black", Arial, sans-serif' : 'bold 70px "Noto Sans KR", sans-serif';
      ctx.fillText(g, CELL * (i + 0.5), CELL * 0.54);
    });
    return canvas.toDataURL(); // 배경 투명 → 판에 blend: 'alpha'
  }
  const ATLAS = { white: makeAtlas('#ffffff'), yellow: makeAtlas('#ffd84a'), sky: makeAtlas('#9ecbff') };

  // 글자마다 사각형 메시: 텍스처 좌표의 u를 그 글자 칸(i/N ~ (i+1)/N)만 쓰게 함
  const GLYPH_MESH = Object.fromEntries(GLYPHS.map((g, i) => {
    const pad = 0.5 / canvasWidth(); // 옆 글자가 번져 보이지 않게 반 픽셀 안쪽
    const u0 = i / GLYPHS.length + pad, u1 = (i + 1) / GLYPHS.length - pad;
    return [g, {
      positions: new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
      texCoords: new Float32Array([u0, 0, u1, 0, u1, 1, u0, 1]),
      indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
    }];
  }));
  function canvasWidth() { return CELL * GLYPHS.length; }

  const QUAD = G.QUAD; // UV 0~1 사각형 (effects.js)
  const GLYPH_SIZE = H * 0.17;
  function glyphNode(id, u, v, atlas = 'white', size = GLYPH_SIZE) {
    return {
      id, primitive: GLYPH_MESH['0'], position: at(u, v, 0.08), meshScale: [size, size, 1],
      color: [0, 0, 0], texture: ATLAS[atlas], blend: 'alpha', emissive: true, fog: false, castShadow: false, visible: false,
    };
  }
  // 글자 하나 바꾸기 (null이면 숨김)
  function setGlyph(node, ch) {
    if (ch == null || !GLYPH_MESH[ch]) { node.visible = false; return; }
    node.primitive = GLYPH_MESH[ch];
    node.visible = true;
  }

  // ------------------------------------------------------------------
  // 2) 램프(B·S·O): 동그란 불빛 이미지를 색별로 하나씩
  // ------------------------------------------------------------------
  function makeLamp(fill) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(32, 32, 26, 0, Math.PI * 2);
    ctx.fill();
    return canvas.toDataURL();
  }
  const LAMP = { off: makeLamp('#2a2f3a'), B: makeLamp('#4cd964'), S: makeLamp('#ffcc00'), O: makeLamp('#ff3b30') };

  // ------------------------------------------------------------------
  // 3) 배경: 판 테두리·구분선·회 번호·R·H·팀 이름 (팀 순서가 정해질 때 한 번 그림)
  // ------------------------------------------------------------------
  const backgroundCache = new Map(); // 팀 순서마다 한 번만 그림
  function makeBackground(awayKey, homeKey, meSide) {
    const cacheKey = `${awayKey}|${homeKey}|${meSide}`;
    if (!backgroundCache.has(cacheKey)) backgroundCache.set(cacheKey, drawBackground(awayKey, homeKey, meSide));
    return backgroundCache.get(cacheKey);
  }
  function drawBackground(awayKey, homeKey, meSide) {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = Math.round(1024 * H / W);
    const ctx = canvas.getContext('2d');
    const cw = canvas.width, ch = canvas.height;
    const px = (u) => u * cw, py = (v) => (1 - v) * ch;
    ctx.fillStyle = '#0b0f1c';
    ctx.fillRect(0, 0, cw, ch);
    ctx.strokeStyle = '#3d4a66';
    ctx.lineWidth = 3;
    ctx.strokeRect(6, 6, cw - 12, ch - 12);
    // 가로 구분선
    for (const v of [0.715, 0.49, 0.265]) {
      ctx.beginPath(); ctx.moveTo(px(0.02), py(v)); ctx.lineTo(px(0.98), py(v)); ctx.stroke();
    }
    // R·H 앞 세로 구분선
    ctx.beginPath(); ctx.moveTo(px(COL.split), py(0.93)); ctx.lineTo(px(COL.split), py(0.28)); ctx.stroke();

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.font = 'bold 34px Arial, sans-serif';
    ctx.fillStyle = '#9aa6bf';
    COL.innings.forEach((u, i) => ctx.fillText(String(i + 1), px(u), py(ROW.head)));
    ctx.fillStyle = '#ffd84a';
    ctx.fillText('R', px(COL.R), py(ROW.head));
    ctx.fillStyle = '#9aa6bf';
    ctx.fillText('H', px(COL.H), py(ROW.head));

    // 팀 이름 (내 팀은 하늘색 + "나")
    ctx.textAlign = 'left';
    for (const [side, key, v] of [['away', awayKey, ROW.away], ['home', homeKey, ROW.home]]) {
      const mine = side === meSide;
      ctx.font = 'bold 38px "Noto Sans KR", sans-serif';
      ctx.fillStyle = mine ? '#9ecbff' : '#ffffff';
      ctx.fillText(TEAMS[key].short, px(COL.name), py(v));
      if (mine) {
        ctx.font = 'bold 22px "Noto Sans KR", sans-serif';
        ctx.fillText('나', px(COL.name) + ctx.measureText(TEAMS[key].short).width * 1.7 + 6, py(v) + 2);
      }
    }
    // B S O 글자
    ctx.font = 'bold 30px Arial, sans-serif';
    ctx.fillStyle = '#9aa6bf';
    ctx.textAlign = 'center';
    for (const k of ['B', 'S', 'O']) ctx.fillText(k, px(LAMPS[k].label), py(ROW.bottom));
    return canvas.toDataURL();
  }

  // ------------------------------------------------------------------
  // 4) 노드 만들기
  // ------------------------------------------------------------------
  const background = {
    id: 'score_bg', primitive: QUAD, position: at(0.5, 0.5, 0.03), meshScale: [W, H, 1],
    color: [11, 15, 28], emissive: true, fog: false, castShadow: false,
  };
  const emblemSize = H * 0.19;
  const emblems = {
    away: { id: 'score_emblem_away', primitive: QUAD, position: at(COL.emblem, ROW.away, 0.08), meshScale: [emblemSize, emblemSize, 1],
      color: [0, 0, 0], blend: 'alpha', emissive: true, fog: false, castShadow: false },
    home: { id: 'score_emblem_home', primitive: QUAD, position: at(COL.emblem, ROW.home, 0.08), meshScale: [emblemSize, emblemSize, 1],
      color: [0, 0, 0], blend: 'alpha', emissive: true, fog: false, castShadow: false },
  };
  const rows = {};
  for (const side of ['away', 'home']) {
    const v = ROW[side];
    rows[side] = {
      innings: COL.innings.map((u, i) => glyphNode(`score_${side}_${i}`, u, v)),
      R: [glyphNode(`score_${side}_R10`, COL.R - 0.022, v, 'yellow'), glyphNode(`score_${side}_R1`, COL.R + 0.022, v, 'yellow')],
      H: [glyphNode(`score_${side}_H10`, COL.H - 0.022, v), glyphNode(`score_${side}_H1`, COL.H + 0.022, v)],
    };
  }
  const lamps = Object.fromEntries(['B', 'S', 'O'].map((k) => [k, LAMPS[k].at.map((u, i) => ({
    id: `score_lamp_${k}${i}`, primitive: QUAD, position: at(u, ROW.bottom, 0.08), meshScale: [H * 0.1, H * 0.1, 1],
    color: [0, 0, 0], texture: LAMP.off, blend: 'alpha', emissive: true, fog: false, castShadow: false,
  }))]));
  // 주자 표시: 다이아몬드 모양 사각형 3개 (45° 돌린 정사각형). 주자가 있으면 노랑, 없으면 어두운 회색
  //   왼쪽 위 점수판(ui.js)의 베이스 표시와 같은 배치: 1루 = 오른쪽, 2루 = 위, 3루 = 왼쪽
  const BASE_ON = [255, 216, 74], BASE_OFF = [42, 47, 58];
  const DIAMOND = { u: 0.64, v: ROW.bottom, du: 0.032, dv: 0.085 }; // 가운데, 좌우·위아래 간격
  const baseLamps = [
    [DIAMOND.u + DIAMOND.du, DIAMOND.v - DIAMOND.dv / 2], // 1루
    [DIAMOND.u, DIAMOND.v + DIAMOND.dv / 2],              // 2루
    [DIAMOND.u - DIAMOND.du, DIAMOND.v - DIAMOND.dv / 2], // 3루
  ].map(([u, v], i) => ({
    id: `score_base_${i + 1}`, primitive: QUAD, position: at(u, v, 0.08), rotation: [0, 0, Math.PI / 4],
    meshScale: [H * 0.075, H * 0.075, 1], color: BASE_OFF, emissive: true, fog: false, castShadow: false,
  }));

  // 지금 회 표시: "3회초" (글자 3개) + 지금 칸 밑줄
  const inningText = [0.79, 0.85, 0.91].map((u, i) => glyphNode(`score_inning_${i}`, u, ROW.bottom, 'sky', H * 0.15));
  const nowBar = {
    id: 'score_now_bar', primitive: QUAD, position: at(0, 0, 0.06), meshScale: [W * 0.06, H * 0.025, 1],
    color: [255, 210, 60], emissive: true, fog: false, castShadow: false, visible: false,
  };

  const root = {
    id: 'scoreboard_root',
    visible: false,
    children: [
      background, emblems.away, emblems.home, nowBar,
      ...Object.values(rows).flatMap((r) => [...r.innings, ...r.R, ...r.H]),
      ...Object.values(lamps).flat(), ...baseLamps, ...inningText,
    ],
  };
  window.SCENE_MODELS = window.SCENE_MODELS ?? [];
  window.SCENE_MODELS.push(root);

  // ------------------------------------------------------------------
  // 5) 상태가 바뀔 때마다 (ui.js의 render가 부름)
  // ------------------------------------------------------------------
  const digit = (n) => (n == null ? null : n === 'X' ? 'X' : String(Math.min(9, n)));
  function setNumber(pair, n) { // 두 자리 (10 이상이면 십의 자리도)
    setGlyph(pair[0], n >= 10 ? String(Math.floor(n / 10) % 10) : null);
    setGlyph(pair[1], String(n % 10));
  }

  function updateScoreboard(state) {
    root.visible = Boolean(state.teams) && !state.choosing; // 팀을 고르기 전에는 원래 전광판
    if (!root.visible) return;
    const away = state.order === 'offense' ? 'me' : 'cpu';
    const home = away === 'me' ? 'cpu' : 'me';
    const awayKey = state.teams[away], homeKey = state.teams[home];

    background.texture = makeBackground(awayKey, homeKey, away === 'me' ? 'away' : 'home'); // 같은 그림이면 같은 텍스처를 다시 씀
    emblems.away.texture = TEAMS[awayKey].mark;
    emblems.home.texture = TEAMS[homeKey].mark;
    for (const [side, key] of [['away', awayKey], ['home', homeKey]]) {
      emblems[side].meshScale = [emblemSize * TEAMS[key].markAspect, emblemSize, 1];
    }

    for (const [side, team] of [['away', away], ['home', home]]) {
      rows[side].innings.forEach((node, i) => setGlyph(node, digit(state.line[team][i])));
      setNumber(rows[side].R, state.score[team]);
      setNumber(rows[side].H, state.hits?.[team] ?? 0);
    }

    const counts = { B: state.balls, S: state.strikes, O: state.outs };
    for (const k of ['B', 'S', 'O']) lamps[k].forEach((lamp, i) => { lamp.texture = i < counts[k] ? LAMP[k] : LAMP.off; });

    baseLamps.forEach((lamp, i) => { lamp.color = state.bases[i] && !state.over ? BASE_ON : BASE_OFF; });

    const over = state.over;
    setGlyph(inningText[0], over ? null : String(state.inning));
    setGlyph(inningText[1], over ? null : '회');
    setGlyph(inningText[2], over ? null : state.half === 'top' ? '초' : '말');
    nowBar.visible = !over;
    if (!over) {
      nowBar.position = at(COL.innings[state.inning - 1], (state.half === 'top' ? ROW.away : ROW.home) - 0.1, 0.06);
    }
  }

  G.updateScoreboard = updateScoreboard;
})();
