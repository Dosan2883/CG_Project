'use strict';

// [역할 1] 경기장 모양 + 노드 트리 조립
// 그라운드(파울 지역 흙·잔디 포함)·펜스·관중석(메인 2층 + 외야)·외벽·정문·광장·지붕·마운드·베이스·더그아웃·
// 조명탑·전광판을 만들어 경기장 루트 노드 하나로 묶고 window.SCENE_MODELS에 등록합니다.
// (외야 너머 아파트는 city.js)
// 파일끼리 공유하는 값은 window.STADIUM_PARTS 한 곳에 모읍니다. (다른 팀원 코드와 이름 충돌 방지)
(function () {
  const {
    BASE_DIST, MOUND_DIST, DEG, FOUL, FIELD_CENTER, COLORS, rgb255, dir, fenceRadius,
    outwardDirections, towerLightPositions, roofLightPositions, roofFixtures, MeshBuilder,
  } = window.STADIUM_PARTS;
  // ------------------------------------------------------------------
  // 메시 생성 (실제 크기, 홈플레이트 기준 좌표)
  // ------------------------------------------------------------------

  // 그라운드 전체: 얇은 층을 y 높이로 겹쳐서 그립니다 (z-fighting 방지, 아래 → 위 순서)
  function buildField(m) {

    // 1) 바닥 전체 (경기장 바깥 땅. 파울 지역은 위에 흙·잔디를 따로 깜)  y = 0
    const G = 600; // 멀리서 볼 때 바닥 끝이 잘 안 보이도록 넓게
    m.quad([-G, 0, G], [G, 0, G], [G, 0, -G], [-G, 0, -G], COLORS.groundGrass);

    // 2) 외야 잔디 (2칸마다 색을 바꿔 줄무늬) + 워닝 트랙  y = 0.03
    m.fan(-FOUL, FOUL, 36, (t) => fenceRadius(t) - 4.5, null, 0.03,
      (i) => (Math.floor(i / 2) % 2 ? COLORS.grassA : COLORS.grassB));
    m.fan(-FOUL, FOUL, 90, fenceRadius, (t) => fenceRadius(t) - 4.5, 0.03, () => COLORS.track);

    // 3) 내야 흙  y = 0.06 : 마운드 중심 반지름 29m 원 (홈에서 θ 방향 반직선과 원의 교점 거리)
    const R = 29;
    const dirtR = (t) => {
      const dm = Math.cos(t) * MOUND_DIST;
      return dm + Math.sqrt(dm * dm - MOUND_DIST * MOUND_DIST + R * R);
    };
    m.fan(-48 * DEG, 48 * DEG, 64, dirtR, null, 0.06, () => COLORS.dirt);

    // 4) 내야 잔디 다이아몬드  y = 0.09
    const cz = second[2] / 2, k = 16.3; // 홈과 2루의 가운데
    m.quad([0, 0.09, cz + k], [k, 0.09, cz], [0, 0.09, cz - k], [-k, 0.09, cz], COLORS.infieldGrass);

    // 5) 홈 주변 흙 원  y = 0.12
    m.disc(0, 0, 4.0, 0.12, COLORS.dirt, 48);

    // 6) 파울 라인 + 타석 박스  y = 0.15
    const yl = 0.15;
    for (const s of [1, -1]) {
      const end = dir(s * FOUL).map((x) => x * fenceRadius(FOUL));
      m.strip([0, 0, 0], end, 0.1, yl, COLORS.white);
      const x0 = s * 0.37, x1 = s * (0.37 + 1.22), z0 = 0.9, z1 = -0.93;
      m.strip([x0, 0, z0], [x1, 0, z0], 0.08, yl, COLORS.white);
      m.strip([x0, 0, z1], [x1, 0, z1], 0.08, yl, COLORS.white);
      m.strip([x0, 0, z0], [x0, 0, z1], 0.08, yl, COLORS.white);
      m.strip([x1, 0, z0], [x1, 0, z1], 0.08, yl, COLORS.white);
    }
  }

  // 투수 마운드: 단면 [반지름, 높이]를 y축으로 회전시킨 회전체 (투수판보다 약간 홈 쪽)
  function buildMound(m) {
    const profile = [[0, 0.34], [0.9, 0.34], [1.8, 0.24], [2.74, 0.09]];
    const segments = 40;
    const moundZ = -MOUND_DIST + 0.45;
    const P = (ang, r, h) => [Math.cos(ang) * r, h, moundZ + Math.sin(ang) * r];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2, b = ((i + 1) / segments) * Math.PI * 2;
      for (let j = 0; j < profile.length - 1; j++) {
        const [r0, h0] = profile[j], [r1, h1] = profile[j + 1];
        if (r0 === 0) m.tri(P(a, 0, h0), P(a, r1, h1), P(b, r1, h1), COLORS.mound);
        else m.quad(P(a, r0, h0), P(a, r1, h1), P(b, r1, h1), P(b, r0, h0), COLORS.mound);
      }
    }
  }

  // 홈플레이트: 오각형 기둥 (뒤쪽 꼭짓점 = 원점, 투수 방향 = -z)
  function buildHomePlate(m) {
    const base = 0.12, top = base + 0.035;
    const pent = [[0, 0], [0.216, -0.216], [0.216, -0.432], [-0.216, -0.432], [-0.216, -0.216]];
    m.face(pent.map(([x, z]) => [x, top, z]), COLORS.white);
    for (let i = 0; i < pent.length; i++) {
      const a = pent[i], b = pent[(i + 1) % pent.length];
      const out = [(a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2 + 0.216]; // 판 중심(0,-0.216)에서 바깥쪽
      m.quad([a[0], base, a[1]], [b[0], base, b[1]], [b[0], top, b[1]], [a[0], top, a[1]], COLORS.white, out);
    }
  }

  // 외야 펜스: 펜스 거리 r(θ)를 따라가는 두께 있는 호 모양 벽
  function buildFence(m) {
    const height = 3.0, thick = 0.4, segments = 90;
    const up = (p, h) => [p[0], h, p[2]];
    for (let i = 0; i < segments; i++) {
      const ta = -FOUL + 2 * FOUL * (i / segments), tb = -FOUL + 2 * FOUL * ((i + 1) / segments);
      const da = dir(ta), db = dir(tb);
      const ra = fenceRadius(ta), rb = fenceRadius(tb);
      const ia = [da[0] * ra, 0, da[2] * ra], ib = [db[0] * rb, 0, db[2] * rb];
      const oa = [da[0] * (ra + thick), 0, da[2] * (ra + thick)];
      const ob = [db[0] * (rb + thick), 0, db[2] * (rb + thick)];
      m.quad(ia, ib, up(ib, height), up(ia, height), COLORS.fence);         // 안쪽 면 (그라운드 쪽)
      m.quad(oa, ob, up(ob, height), up(oa, height), COLORS.fence, da);     // 바깥 면
      m.quad(up(ia, height), up(ib, height), up(ob, height), up(oa, height), COLORS.fenceTop); // 윗면
    }
  }

  // 계단식 관중석 단면: [바깥 방향 오프셋, 높이, 색]
  // 관중석 한 층의 계단 치수: 시작 오프셋, 첫 좌석 높이, 줄 수, 한 단 높이, 한 단 깊이 (관중 배치에서도 사용)
  //   메인 스탠드(좌측 폴 ~ 홈 뒤 ~ 우측 폴) = 아래층 → 콘코스 → 층 사이 띠 → 위층 (모두 빨간 좌석)
  //   외야 스탠드(외야를 한 바퀴 둘러 메인 스탠드 양 끝과 이어짐) = 낮은 회색 계단석. emptyRate = 빈자리 비율 (관중 배치에서 사용)
  const LOWER_DECK = { start: 0, firstY: 1.4, rows: 14, rise: 0.45, depth: 0.85 };
  const CONCOURSE = 2.0, BAND_HEIGHT = 2.4; // 층 사이 통로 폭, 위층 앞벽(밤에 빛나는 띠) 높이
  const UPPER_DECK = {
    start: LOWER_DECK.start + LOWER_DECK.rows * LOWER_DECK.depth + CONCOURSE,
    firstY: LOWER_DECK.firstY + LOWER_DECK.rows * LOWER_DECK.rise + BAND_HEIGHT,
    rows: 14, rise: 0.6, depth: 0.85,
  };
  const OUTFIELD_DECK = { start: 0, firstY: 1.2, rows: 10, rise: 0.45, depth: 0.9, emptyRate: 0.75 };

  // 한 층의 계단을 단면에 이어 붙임 (단면의 마지막 점이 (deck.start, deck.firstY)여야 함)
  function addDeck(prof, deck, colorA, colorB) {
    let h = deck.firstY;
    for (let i = 0; i < deck.rows; i++) {
      const off = deck.start + (i + 1) * deck.depth;
      prof.push([off, h, i % 2 ? colorB : colorA]); // 좌석 단 (수평)
      h += deck.rise;
      prof.push([off, h, COLORS.concrete]);          // 단 높이 (수직)
    }
    return { end: deck.start + deck.rows * deck.depth, top: h };
  }
  // 맨 뒤 난간 벽 + 바닥까지 내려오는 뒷벽. 반환값 = 단면의 맨 뒤 오프셋
  function addBackWall(prof, end, top) {
    prof.push([end + 0.6, top, COLORS.concrete]);
    prof.push([end + 0.6, top + 1.2, COLORS.wall]);
    prof.push([end + 0.8, top + 1.2, COLORS.wall]);
    prof.push([end + 0.8, 0, COLORS.wall]);
    return end + 0.8;
  }

  function mainStandProfile() {
    const prof = [[0, 0, COLORS.wall], [0, LOWER_DECK.firstY, COLORS.facadeBanner]]; // 앞벽 = 빨간 광고판
    const lower = addDeck(prof, LOWER_DECK, COLORS.outSeatA, COLORS.outSeatB);
    prof.push([UPPER_DECK.start, lower.top, COLORS.concrete]);         // 콘코스 (수평 통로)
    prof.push([UPPER_DECK.start, UPPER_DECK.firstY, COLORS.facadeWindow]); // 층 사이 띠 (밤에 빛남)
    const upper = addDeck(prof, UPPER_DECK, COLORS.outSeatA, COLORS.outSeatB);
    return { prof, back: addBackWall(prof, upper.end, upper.top), top: upper.top + 1.2 };
  }
  function outfieldStandProfile() {
    const prof = [[0, 0, COLORS.wall], [0, OUTFIELD_DECK.firstY, COLORS.wall]];
    const deck = addDeck(prof, OUTFIELD_DECK, COLORS.concrete, COLORS.roofUnder);
    return { prof, back: addBackWall(prof, deck.end, deck.top) };
  }
  const MAIN_STAND = mainStandProfile();
  const OUTFIELD_STAND = outfieldStandProfile();

  // 관중석 경로 (관중석 앞벽 위치)
  //   메인 스탠드 (높은 2층, 말발굽 모양): 1루 라인(폴 근처) → 홈 뒤 반원 → 3루 라인(폴 근처)
  //   외야 스탠드 (낮은 계단석 1개): 3루 쪽 메인 스탠드 끝 → 폴 바깥 → 펜스 뒤 외야 한 바퀴 → 1루 쪽 메인 스탠드 끝
  //     중견수 뒤 전광판 앞도 채움 (전광판은 스탠드 뒤 더 높은 곳에 있어 그대로 보임)
  //   관중석·외벽·지붕·지붕 조명·관중이 모두 이 경로를 기준으로 바깥 방향 오프셋을 씁니다.
  const LINE_OFFSET = 12;          // 파울 라인에서 관중석 앞벽까지 거리
  const DUGOUT_OFFSET = LINE_OFFSET - 2; // 파울 라인에서 덕아웃 중심까지 (깊이 4m → 뒷면이 관중석 앞벽에 붙음)
  const LINE_LENGTH = 90;          // 메인 스탠드 직선 구간 길이 (홈에서 파울 라인을 따라, 폴 근처까지)
  const OUTFIELD_ANGLE = 47.5;     // 외야 스탠드 펜스 뒤 구간 (중견수 방향 기준 ±47.5°, 파울 라인 바깥까지)

  // 외야 호 위의 점: 펜스 2.5m 뒤
  function outfieldArcPoint(theta) {
    const r = fenceRadius(theta) + 2.5, d = dir(theta);
    return [d[0] * r, 0, d[2] * r];
  }
  // 파울 라인에서 관중석 앞벽까지 거리: 내야에서는 LINE_OFFSET, 외야 쪽으로 가면서 점점 좁아져
  //   폴 근처에서는 CORNER_OFFSET → 관중석이 그라운드 쪽으로 휘어 들어와 외야 펜스 끝과 만남
  //   TAPER = [좁아지기 시작하는 t, 다 좁아진 t] (홈에서 파울 라인을 따라 m), 사이는 smoothstep으로 부드럽게
  const CORNER_OFFSET = 2, TAPER = [40, 72];
  function lineOffset(t) {
    const k = Math.min(1, Math.max(0, (t - TAPER[0]) / (TAPER[1] - TAPER[0])));
    return LINE_OFFSET + (CORNER_OFFSET - LINE_OFFSET) * k * k * (3 - 2 * k);
  }
  // 파울 라인을 따라 t m 간 점에서 바깥으로 off m
  function linePoint(side, t, off) {
    const d = dir(side * FOUL), n = dir(side * 135 * DEG);
    return [d[0] * t + n[0] * off, 0, d[2] * t + n[2] * off];
  }
  const lineStandPoint = (side, t) => linePoint(side, t, lineOffset(t)); // 관중석 앞벽 위의 점

  // 외야 호 위의 점들: from° → to° (2.5° 간격)
  function arcPoints(from, to) {
    const points = [];
    for (let a = from; a <= to + 1e-9; a += 2.5) points.push(outfieldArcPoint(a * DEG));
    return points;
  }

  // 메인 스탠드 경로: 1루 라인 → 홈 뒤 반원 → 3루 라인 (열린 경로)
  //   edge = 경로 점마다 짝이 되는 그라운드 쪽 점 (파울 라인 위의 점, 홈 뒤 반원은 홈) → 파울 지역 흙바닥용
  function mainStandPath() {
    const path = [], edge = [];
    for (let t = LINE_LENGTH; t >= 0; t -= 5) {                                               // 1) 1루 라인
      path.push(lineStandPoint(1, t));
      edge.push(linePoint(1, t, 0));
    }
    for (let a = 140; a <= 220; a += 5) {                                                      // 2) 홈 뒤 반원
      const d = dir(a * DEG);
      path.push([d[0] * LINE_OFFSET, 0, d[2] * LINE_OFFSET]);
      edge.push([0, 0, 0]);
    }
    for (let t = 0; t <= LINE_LENGTH; t += 5) {                                               // 3) 3루 라인
      path.push(lineStandPoint(-1, t));
      edge.push(linePoint(-1, t, 0));
    }
    return { path, edge };
  }
  const { path: MAIN_PATH, edge: MAIN_EDGE } = mainStandPath();
  // 외야 스탠드 경로: 3루 쪽 메인 스탠드 끝 앞벽 점 + 펜스 뒤 호(−47.5° → +47.5°) + 1루 쪽 메인 스탠드 끝 앞벽 점
  //   → 폴 뒤를 지나 양쪽 메인 스탠드 끝과 이어짐 (겹치는 부분은 메인 스탠드 안에 묻혀 안 보임)
  const mainEnd = (s) => lineStandPoint(s, LINE_LENGTH);
  const OUTFIELD_PATH = [mainEnd(-1), ...arcPoints(-OUTFIELD_ANGLE, OUTFIELD_ANGLE), mainEnd(1)];

  // 파울 지역 흙바닥: 파울 라인(MAIN_EDGE)부터 관중석 앞벽(MAIN_PATH)까지 이웃한 점끼리 사각형으로 깔아
  //   그라운드와 관중석 사이를 흙으로 이음 (외야 잔디(0.03)보다 낮은 0.02 높이)
  function buildFoulTerritory(m) {
    const y = 0.02, at = (p) => [p[0], y, p[2]];
    for (let i = 0; i < MAIN_PATH.length - 1; i++) {
      const [e0, e1, p1, p0] = [MAIN_EDGE[i], MAIN_EDGE[i + 1], MAIN_PATH[i + 1], MAIN_PATH[i]].map(at);
      const sameEdge = e0[0] === e1[0] && e0[2] === e1[2]; // 홈 뒤 반원: 두 짝이 모두 홈 → 삼각형
      if (sameEdge) m.tri(e0, p1, p0, COLORS.track, [0, 1, 0]);
      else m.quad(e0, e1, p1, p0, COLORS.track, [0, 1, 0]);
    }
  }

  // 파울 지역 잔디 (흙바닥 위) y = 0.07 : 흙(0.02·0.06)보다 위, 홈 주변 흙(0.12)보다 아래
  //   1) 1루·3루 쪽 (덕아웃 쪽): 홈에서 GRASS_FROM m부터 폴 근처까지, 파울 라인 바로 옆 ~ 관중석 앞벽
  //      → 관중석이 휘어 들어오는 모양을 그대로 따라가며 외야 잔디와 이어짐 (덕아웃은 이 잔디 위에 놓임)
  //      라인 옆에 흙이 보이지 않도록 라인에 딱 붙임. 흰 파울 라인(0.15)은 잔디 위에 그려짐
  //   2) 홈 뒤: 홈에서 5.5 ~ 10m, 150° ~ 210° 부채꼴
  const GRASS_FROM = 5;
  function buildFoulGrass(m) {
    const y = 0.07;
    for (const s of [1, -1]) {
      const at = (t, off) => { const p = linePoint(s, t, off); p[1] = y; return p; };
      for (let t = GRASS_FROM; t < LINE_LENGTH; t += 5) {
        const t1 = t + 5;
        m.quad(at(t, 0), at(t1, 0), at(t1, lineOffset(t1)), at(t, lineOffset(t)), COLORS.infieldGrass, [0, 1, 0]);
      }
    }
    m.fan(150 * DEG, 210 * DEG, 12, () => 10, () => 5.5, y, () => COLORS.infieldGrass);
  }

  // 둥근 지붕·외벽: 위에서 보면 바깥 가장자리가 원(중심 ROOF_CENTER, 반지름 ROOF_RADIUS)을 따라 말발굽 모양
  //   경로 점마다 바깥 방향으로 그 원까지의 거리를 구해 외벽 위치로 씀 (관중석 뒷벽보다 가까우면 뒷벽 + 1.5m)
  //   |q + n·s| = R 을 s에 대해 풀면 s = −(q·n) + √((q·n)² − (|q|² − R²))   (q = 경로 점 − 원 중심)
  //   관중석 뒷벽과 외벽 사이 빈 곳은 옥상(평평한 지붕)으로 덮고, 양 끝은 벽으로 막음
  const ROOF_CENTER = [0, -38], ROOF_RADIUS = 86; // 원 중심 (x, z), 반지름 (m)
  const FACADE_HEIGHT = MAIN_STAND.top + 2.5;
  const MAIN_OUTWARD = outwardDirections(MAIN_PATH);
  // 메인 스탠드 경로 i번 점에서 바깥으로 off m 간 점(높이 y)과, 그 점에서 바깥을 보는 Y축 회전각 (로컬 +z = 바깥)
  const standPoint = (i, off, y = 0) =>
    [MAIN_PATH[i][0] + MAIN_OUTWARD[i][0] * off, y, MAIN_PATH[i][2] + MAIN_OUTWARD[i][2] * off];
  const yawOut = (i) => Math.atan2(MAIN_OUTWARD[i][0], MAIN_OUTWARD[i][2]);
  const FACADE_DIST = MAIN_PATH.map((p, i) => {
    const n = MAIN_OUTWARD[i], qx = p[0] - ROOF_CENTER[0], qz = p[2] - ROOF_CENTER[1];
    const b = qx * n[0] + qz * n[2], c = qx * qx + qz * qz - ROOF_RADIUS * ROOF_RADIUS;
    return Math.max(-b + Math.sqrt(Math.max(0, b * b - c)), MAIN_STAND.back + 1.5);
  });

  // 관중석 뒤 외벽 (여러 층 건물 외관): 메인 스탠드 뒤 둥근 선 위
  //   안쪽 벽(회색 벽 + 유리·불 켜진 창 띠) 앞에 흰 기둥이 경로 점마다 서고, 층마다 흰 바닥판이 튀어나온 열린 구조
  //   2층 바닥판은 빨간 띠. 홈 뒤에 정문 건물, 둘레에 밝은 콘크리트 광장
  const FLOOR_HEIGHTS = [3.4, 7.0, 10.2, 13.2, 16.8]; // 층 바닥판 높이 (m)
  const RED_FLOOR = 7.0;                               // 빨간 띠가 되는 바닥판
  const SLAB_DEPTH = 1.6, SLAB_THICK = 0.35, COLUMN_SIZE = 1.0;
  const PLAZA_WIDTH = 22;                              // 외벽 바깥 광장 폭 (m)
  function buildFacade(m) {
    const path = MAIN_PATH;

    // 1) 안쪽 벽
    m.extrudeAlong(path, (i) => facadeProfile(FACADE_DIST[i]));

    // 2) 층 바닥판: 외벽에서 SLAB_DEPTH만큼 튀어나온 얇은 판 (윗면 → 앞면 → 아랫면)
    for (const h of FLOOR_HEIGHTS) {
      const color = h === RED_FLOOR ? COLORS.facadeBanner : COLORS.roofEdge;
      m.extrudeAlong(path, (i) => {
        const f = FACADE_DIST[i];
        return [
          [f, h, color],
          [f + SLAB_DEPTH, h, color],
          [f + SLAB_DEPTH, h - SLAB_THICK, color, 'out'],
          [f, h - SLAB_THICK, color, 'down'],
        ];
      }, false);
    }

    // 3) 흰 기둥: 경로 점마다 외벽 바로 앞에 바닥부터 지붕까지
    for (let i = 0; i < path.length; i++) {
      const transform = boxTransform(standPoint(i, FACADE_DIST[i] + SLAB_DEPTH - COLUMN_SIZE / 2), yawOut(i));
      m.box([0, 0, 0], [COLUMN_SIZE, FACADE_HEIGHT, COLUMN_SIZE], COLORS.roofEdge, { transform, bottom: false });
    }

    // 4) 정문: 홈 바로 뒤(경로 가운데 점) 외벽 앞에 튀어나온 회색 건물
    //   정문 로컬 좌표: x = 외벽 방향(가로), y = 위, z = 바깥쪽(앞면 z = 3). 아래부터
    //   계단 3단 → 유리 출입문(흰 문틀) → 출입문 위 차양(아래에 조명) → 세로 금속 줄무늬 벽 + 빨간 현수막
    //   → 꼭대기 간판(어두운 판 + 빨간 로고 자리) → 흰 테두리(양쪽 기둥 + 맨 위 처마)
    const mid = Math.floor(path.length / 2);
    const gate = boxTransform(standPoint(mid, FACADE_DIST[mid] + 3), yawOut(mid));
    const GATE_W = 26, GATE_H = FACADE_HEIGHT + 3, FRONT = 3;
    const DOOR_W = GATE_W - 6, DOOR_H = 5.5, CANOPY_Y = 5.8;
    const gbox = (pos, size, color, bottom = true) => m.box(pos, size, color, { transform: gate, bottom });
    gbox([0, 0, 0], [GATE_W, GATE_H, 6], COLORS.towerPole, false);                 // 몸체
    // 흰 테두리: 양쪽 기둥 + 맨 위 처마
    for (const s of [-1, 1]) gbox([s * (GATE_W / 2 - 1), 0, 0.5], [2, GATE_H + 0.5, 7], COLORS.roofEdge, false);
    gbox([0, GATE_H - 1.2, 0.5], [GATE_W + 1, 1.2, 7], COLORS.roofEdge);
    // 계단 3단: 바깥으로 갈수록 낮아짐
    for (let k = 0; k < 3; k++) gbox([0, 0, FRONT + 0.5 + k], [DOOR_W + 2 - k, 0.15 * (3 - k), 1], COLORS.concrete, false);
    // 유리 출입문 + 흰 문틀 (세로 5개)
    gbox([0, 0, FRONT + 0.1], [DOOR_W, DOOR_H, 0.2], COLORS.facadeGlass, false);
    for (let k = 0; k <= 4; k++) gbox([(k / 4 - 0.5) * DOOR_W, 0, FRONT + 0.2], [0.3, DOOR_H, 0.3], COLORS.roofEdge, false);
    // 차양 + 아래 조명 4개 (밤에 빛남)
    //   조명은 castShadow = true 묶음에 넣어 경기장의 다른 램프와 한 노드로 합침
    //   (따로 묶이면 폭 16m짜리 빛나는 노드가 생기는데, effects.js가 "가장 좁은 빛나는 노드 = 전광판(27m)"으로 찾으므로
    //    홈런 화면이 정문에 뜨게 됨)
    gbox([0, CANOPY_Y, FRONT + 2], [DOOR_W + 2, 0.4, 4], COLORS.roofEdge);
    m.castShadow = true;
    for (let k = 0; k < 4; k++) gbox([(k - 1.5) * 5, CANOPY_Y - 0.15, FRONT + 2.5], [1.2, 0.15, 0.6], COLORS.lamp);
    m.castShadow = false;
    // 세로 금속 줄무늬 (차양 위 ~ 처마 아래)
    const STRIPE_Y = CANOPY_Y + 1.2;
    for (let k = 0; k < 11; k++) {
      gbox([(k - 5) * 2.2, STRIPE_Y, FRONT + 0.05], [0.4, GATE_H - 1.2 - STRIPE_Y, 0.2], COLORS.roofEdge, false);
    }
    // 빨간 현수막 + 꼭대기 간판(어두운 판 위 빨간 로고 자리)
    gbox([0, 8.5, FRONT + 0.3], [16, 4.5, 0.3], COLORS.facadeBanner);
    gbox([0, GATE_H - 5, FRONT + 0.3], [8, 2.8, 0.3], COLORS.board);
    gbox([0, GATE_H - 4.4, FRONT + 0.5], [5, 1.4, 0.1], COLORS.facadeBanner);

    // 5) 광장: 외벽 바깥으로 PLAZA_WIDTH m 밝은 콘크리트 바닥 (잔디(0)보다 살짝 위)
    m.extrudeAlong(path, (i) => [
      [FACADE_DIST[i], 0.04, COLORS.roofUnder],
      [FACADE_DIST[i] + PLAZA_WIDTH, 0.04, COLORS.roofUnder],
    ], false);
  }
  // 안쪽 벽 단면: 외벽 위치 f에서 회색 벽과 유리·창 띠가 층마다 번갈아
  function facadeProfile(f) {
    const wall = COLORS.concrete;
    return [
      [f, 0, wall],
      [f, 2.8, COLORS.facadeGlass, 'out'],   // 1층 유리
      [f, 3.4, wall, 'out'],
      [f, 6.4, COLORS.facadeWindow, 'out'],  // 2층 콘코스 창
      [f, 7.0, wall, 'out'],
      [f, 9.6, COLORS.facadeWindow, 'out'],  // 3층 콘코스 창
      [f, 10.2, wall, 'out'],
      [f, 12.6, COLORS.facadeGlass, 'out'],  // 4층 유리
      [f, 13.2, wall, 'out'],
      [f, 16.2, COLORS.facadeWindow, 'out'], // 5층 창
      [f, 16.8, wall, 'out'],
      [f, 19.4, COLORS.facadeGlass, 'out'],  // 6층 유리
      [f, FACADE_HEIGHT, wall, 'out'],
      [MAIN_STAND.back, FACADE_HEIGHT, COLORS.concrete, 'up'], // 옥상 (관중석 뒷벽까지)
    ];
  }

  // 지붕 (남색 캐노피 + 흰 테두리): 둥근 외벽 위에서 시작해 그라운드 쪽으로 올라가며 위층 관중석을 덮는 얇은 판 (메인 스탠드만)
  //   단면 = 윗면(뒤 → 앞) → 앞 가장자리 → 아랫면 → 뒤 가장자리. 뒤 가장자리는 경로 점마다 외벽 위치(FACADE_DIST)
  //   아래층과 위층 앞쪽 좌석은 지붕 밖으로 보이게 합니다.
  const ROOF_FRONT = UPPER_DECK.start + 3.0, ROOF_FRONT_TOP = FACADE_HEIGHT + 2.3, ROOF_EDGE = 0.6;
  // 지붕 윗면은 골판(주름진 패널)처럼 산·골을 번갈아 만듦.
  //   면마다 기울기가 달라서 햇빛·조명을 받는 각도가 달라지고, 정반사 하이라이트가 줄무늬로 반짝입니다.
  const ROOF_PANELS = 8, ROOF_RIDGE = 0.25; // 패널 개수, 산 높이 (m)
  function roofProfile(back) {
    const top = [];
    for (let k = 1; k <= ROOF_PANELS * 2; k++) {
      const t = k / (ROOF_PANELS * 2);                           // 0(뒤) → 1(앞)
      const off = back + (ROOF_FRONT - back) * t;
      const h = FACADE_HEIGHT + (ROOF_FRONT_TOP - FACADE_HEIGHT) * t + (k % 2 ? ROOF_RIDGE : 0); // 홀수 = 산
      // 남색 지붕, 바깥 가장자리 2칸·앞 가장자리 2칸은 흰 띠
      const rim = k <= 2 || k > ROOF_PANELS * 2 - 2;
      top.push([off, h, rim ? COLORS.roofEdge : COLORS.roofNavy, 'up']);
    }
    return [
      [back, FACADE_HEIGHT, COLORS.roofEdge],
      ...top,
      [ROOF_FRONT, ROOF_FRONT_TOP - ROOF_EDGE, COLORS.roofEdge, 'in'],
      [back, FACADE_HEIGHT - 0.3, COLORS.roofUnder, 'down'],
      [back, FACADE_HEIGHT, COLORS.roofEdge, 'out'],
    ];
  }
  function buildRoof(m) {
    m.extrudeAlong(MAIN_PATH, (i) => roofProfile(FACADE_DIST[i] + 0.2));
  }

  function boxTransform(position, yaw, pitch = 0) {
    const turned = multiply(translation(...position), rotationY(yaw));
    return pitch ? multiply(turned, rotationX(pitch)) : turned;
  }

  // 지붕 앞 가장자리 아래에 달린 조명 (경로 점 2개마다 1개, 그라운드 쪽으로 35° 숙임)
  //   양 끝(첫 점·마지막 점)은 지붕 끝 모서리 밖으로 삐져나와 보여서 빼고, 그 안쪽부터 둠
  function buildRoofLights(m) {
    const off = ROOF_FRONT + 0.6;
    for (let i = 2; i < MAIN_PATH.length - 2; i += 2) {
      roofLightPositions.push(standPoint(i, off - 2, ROOF_FRONT_TOP - 3));
      const position = standPoint(i, off, ROOF_FRONT_TOP - ROOF_EDGE - 0.75);
      roofFixtures.push({ id: `stadium_roof_light_${i}`, position });
      const transform = boxTransform(position, yawOut(i), -35 * DEG); // 로컬 -z = 그라운드 쪽
      m.box([0, 0, 0], [3.2, 0.7, 0.4], COLORS.towerFrame, { transform });
      m.box([0, 0.1, -0.22], [2.8, 0.5, 0.06], COLORS.lamp, { transform });
    }
  }

  // 지붕 앞 가장자리 위에 세운 조명 틀 (지붕 위 철골 조명): 경로를 따라 고르게 RIG_COUNT개
  const RIG_COUNT = 7;
  function buildRoofRigs(m) {
    for (let k = 0; k < RIG_COUNT; k++) {
      const i = Math.round((k + 0.5) * (MAIN_PATH.length - 1) / RIG_COUNT);
      const transform = boxTransform(standPoint(i, ROOF_FRONT + 1.2, ROOF_FRONT_TOP), yawOut(i), -20 * DEG); // 로컬 -z = 그라운드 쪽
      m.box([0, 0, 0], [7.4, 3.6, 0.5], COLORS.towerFrame, { transform });
      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < 5; c++) {
          m.box([(c - 2) * 1.4, 0.4 + r * 1.5, -0.35], [1.1, 1.1, 0.25], COLORS.lamp, { transform });
        }
      }
    }
  }

  // 외야 스탠드 바로 바깥의 점: 외야 호 위 각도 theta 기준 (조명탑 위치용)
  function outsideStandPoint(theta, extra) {
    const r = fenceRadius(theta) + 2.5 + OUTFIELD_STAND.back + extra, d = dir(theta);
    return [d[0] * r, 0, d[2] * r];
  }

  // 조명탑의 뒤판·발판·램프는 배치에 추가하고 원통 기둥만 별도 도형으로 돌려줍니다.
  const TOWER_HEIGHT = 40;
  function buildLightTower(m, id, position) {
    // 로컬 -z가 FIELD_CENTER를 향하도록 y축 회전: rotationY(a)에서 로컬 -z = (-sin a, 0, -cos a)
    const dx = FIELD_CENTER[0] - position[0], dz = FIELD_CENTER[2] - position[2];
    const yaw = Math.atan2(-dx, -dz);
    const len = Math.hypot(dx, dz);
    towerLightPositions.push([position[0] + dx / len * 3, TOWER_HEIGHT + 2, position[2] + dz / len * 3]);

    const transform = boxTransform([position[0], TOWER_HEIGHT, position[2]], yaw, -25 * DEG);
    const cols = 6, rows = 4, lampW = 1.2, lampH = 1.0, gap = 0.25;
    const panelW = cols * (lampW + gap) + 0.6, panelH = rows * (lampH + gap) + 0.6;
    m.box([0, 0, 0], [panelW, panelH, 0.6], COLORS.towerFrame, { transform });
    m.box([0, -0.3, -1.0], [panelW, 0.3, 1.6], COLORS.towerFrame, { transform });
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = (c - (cols - 1) / 2) * (lampW + gap);
        const y = 0.4 + r * (lampH + gap);
        m.box([x, y, -0.45], [lampW, lampH, 0.3], COLORS.lamp, { transform });
      }
    }
    return {
      id: `${id}_pole`,
      primitive: 'cylinder',
      position,
      rotation: [0, yaw, 0],
      meshOffset: [0, TOWER_HEIGHT / 2, 0],
      meshScale: [1.0, TOWER_HEIGHT, 1.0],
      color: rgb255(COLORS.towerPole),
    };
  }

  const first = [BASE_DIST * Math.SQRT1_2, 0, -BASE_DIST * Math.SQRT1_2];
  const second = [0, 0, -BASE_DIST * Math.SQRT2];
  const third = [-first[0], 0, first[2]];

  function buildStadiumModel() {
    const m = new MeshBuilder();
    m.castShadow = false;
    buildField(m);
    buildFoulTerritory(m);
    buildFoulGrass(m);
    buildHomePlate(m);
    buildFacade(m);

    m.castShadow = true;
    buildFence(m);
    m.extrudeAlong(MAIN_PATH, MAIN_STAND.prof);                                  // 메인 스탠드 (2층)
    m.extrudeAlong(OUTFIELD_PATH, OUTFIELD_STAND.prof);                          // 외야 계단석
    buildRoof(m);
    buildRoofLights(m);
    buildRoofRigs(m);
    buildMound(m);
    m.box([0, 0.34, -MOUND_DIST], [0.61, 0.04, 0.15], COLORS.white);

    // 1·2·3루 베이스: 위치 이동 → 45° 회전한 좌표계에 납작한 상자
    for (const [x, , z] of [first, second, third]) {
      const transform = boxTransform([x, 0.06, z], FOUL);
      m.box([0, 0, 0], [0.38, 0.1, 0.38], COLORS.white, { transform });
    }

    for (const s of [1, -1]) {
      // 파울 폴: 펜스 끝
      const pole = dir(s * FOUL).map((x) => x * (fenceRadius(FOUL) + 0.2));
      m.box(pole, [0.35, 15, 0.35], COLORS.pole);

      // 더그아웃: 파울 라인을 따라 24m, 바깥쪽으로 DUGOUT_OFFSET m → 파울 라인과 나란하게 회전
      //   관중석 앞벽에 붙어 있어 관중석 아래로 들어간 모양. 로컬 x축 = 파울 라인 방향, 로컬 -z = 그라운드 쪽
      const d = dir(s * FOUL), n = dir(s * 135 * DEG);
      const transform = boxTransform([d[0] * 24 + n[0] * DUGOUT_OFFSET, 0, d[2] * 24 + n[2] * DUGOUT_OFFSET], s * FOUL);
      m.box([0, 0, 0], [14, 2.2, 4], COLORS.dugout, { transform });
      m.box([0, 2.2, 0], [14.4, 0.2, 4.4], COLORS.roof, { transform });
      m.box([0, 0.3, -2.02], [12, 1.6, 0.04], COLORS.dugoutDark, { transform });
    }

    // 조명탑: 외야 좌중간·우중간 계단석 바로 바깥에 2개 (나머지 조명은 지붕에 달림)
    const towerPoles = [];
    for (const s of [1, -1]) {
      const side = s > 0 ? 'first' : 'third';
      towerPoles.push(buildLightTower(m, `stadium_tower_${side}_outfield`, outsideStandPoint(s * 20 * DEG, 2)));
    }

    // 전광판: 어두운 아래 건물 + 흰 테두리 판 + 화면 (중견수 뒤, 예전 위치 그대로: 펜스에서 21.6m 뒤)
    //   화면(boardFace) 크기·위치는 그대로 둠 → 팀원 코드(홈런 연출·점수판)가 이 화면을 찾아 위에 그림
    const BOARD_BASE_H = 18; // 아래 건물 높이 (그 위에 판)
    const [boardX, , boardZ] = dir(0).map((v) => v * (fenceRadius(0) + 21.6));
    m.box([boardX, 0, boardZ - 1.5], [30, BOARD_BASE_H, 4], COLORS.board);
    m.box([boardX, BOARD_BASE_H - 1, boardZ], [34, 14, 1.5], COLORS.roofEdge);
    m.box([boardX, BOARD_BASE_H + 1, boardZ + 0.76], [27, 10, 0.04], COLORS.boardFace);

    const root = m.toNode('stadium_root');
    root.children.push(...towerPoles);
    return root;
  }

  window.SCENE_MODELS = window.SCENE_MODELS ?? [];
  const stadiumRoot = buildStadiumModel();
  window.SCENE_MODELS.push(stadiumRoot);

  // 다른 팀원이 위치를 맞출 때 쓸 수 있는 기준 좌표 (단위 m)
  window.STADIUM_INFO = {
    home: [0, 0, 0],
    rubber: [0, 0.34, -MOUND_DIST],
    bases: { first, second, third },
    fenceRadius,
    dugoutOffset: DUGOUT_OFFSET, // 덕아웃 중심 = dir(s·FOUL) × 24 + dir(s·135°) × dugoutOffset
  };

  // 관중 배치용: 관중석 층마다 { 경로, 계단 치수 } (crowd.js에서 사용)
  const STANDS = [
    { path: MAIN_PATH, ...LOWER_DECK },
    { path: MAIN_PATH, ...UPPER_DECK },
    { path: OUTFIELD_PATH, ...OUTFIELD_DECK },
  ];
  // 경기장 바깥 둘레(광장 끝까지 포함한 원: 중심 [x, z], 반지름) — city.js가 둘레 도로를 이 원 바깥으로 냄
  const STADIUM_OUTLINE = { center: ROOF_CENTER, radius: ROOF_RADIUS + PLAZA_WIDTH };
  Object.assign(window.STADIUM_PARTS, { STANDS, stadiumRoot, STADIUM_OUTLINE });
})();
