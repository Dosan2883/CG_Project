'use strict';

// [역할 1] 경기장 모양 + 노드 트리 조립
// 그라운드·펜스·관중석·외벽·지붕·마운드·베이스·더그아웃·조명탑·전광판을 만들고
// window.SCENE_MODELS에 경기장 루트 노드를 등록합니다.
// 파일끼리 공유하는 값은 window.STADIUM_PARTS 한 곳에 모읍니다. (다른 팀원 코드와 이름 충돌 방지)
(function () {
  const { BASE_DIST, MOUND_DIST, DEG, FOUL, FIELD_CENTER, COLORS, rgb255, dir, fenceRadius, outwardDirections, towerLightPositions, roofLightPositions, applyColorTraits, MeshBuilder } = window.STADIUM_PARTS;
  // ------------------------------------------------------------------
  // 메시 생성 (실제 크기, 홈플레이트 기준 좌표)
  // ------------------------------------------------------------------

  // 그라운드 전체: 얇은 층을 y 높이로 겹쳐서 그립니다 (z-fighting 방지, 아래 → 위 순서)
  function buildField() {
    const m = new MeshBuilder();
    const secondZ = -BASE_DIST * Math.SQRT2;

    // 1) 바닥 전체 (파울 지역 잔디)  y = 0
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
    const cz = secondZ / 2, k = 16.3;
    m.quad([0, 0.09, cz + k], [k, 0.09, cz], [0, 0.09, cz - k], [-k, 0.09, cz], COLORS.infieldGrass);

    // 5) 홈 주변 흙 원  y = 0.12
    m.disc(0, 0, 4.0, 0.12, COLORS.dirt, 48);

    // 6) 파울 라인 + 타석 박스 + 대기 타석 원  y = 0.15
    const yl = 0.15;
    for (const s of [1, -1]) {
      const end = dir(s * FOUL).map((x) => x * fenceRadius(FOUL));
      m.strip([0, 0, 0], end, 0.1, yl, COLORS.white);
      const x0 = s * 0.37, x1 = s * (0.37 + 1.22), z0 = 0.9, z1 = -0.93;
      m.strip([x0, 0, z0], [x1, 0, z0], 0.08, yl, COLORS.white);
      m.strip([x0, 0, z1], [x1, 0, z1], 0.08, yl, COLORS.white);
      m.strip([x0, 0, z0], [x0, 0, z1], 0.08, yl, COLORS.white);
      m.strip([x1, 0, z0], [x1, 0, z1], 0.08, yl, COLORS.white);
      m.disc(s * 11, 4, 1.5, 0.04, COLORS.dirt, 32);
      m.ring(s * 11, 4, 1.4, 1.5, 0.06, COLORS.white, 32);
    }
    return m;
  }

  // 투수 마운드: 단면 [반지름, 높이]를 y축으로 회전시킨 회전체 (원점 중심)
  function buildMound() {
    const m = new MeshBuilder();
    const profile = [[0, 0.34], [0.9, 0.34], [1.8, 0.24], [2.74, 0.09]];
    const segments = 40;
    const P = (ang, r, h) => [Math.cos(ang) * r, h, Math.sin(ang) * r];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2, b = ((i + 1) / segments) * Math.PI * 2;
      for (let j = 0; j < profile.length - 1; j++) {
        const [r0, h0] = profile[j], [r1, h1] = profile[j + 1];
        if (r0 === 0) m.tri(P(a, 0, h0), P(a, r1, h1), P(b, r1, h1), COLORS.mound);
        else m.quad(P(a, r0, h0), P(a, r1, h1), P(b, r1, h1), P(b, r0, h0), COLORS.mound);
      }
    }
    return m;
  }

  // 홈플레이트: 오각형 기둥 (뒤쪽 꼭짓점 = 원점, 투수 방향 = -z)
  function buildHomePlate() {
    const m = new MeshBuilder();
    const h = 0.035;
    const pent = [[0, 0], [0.216, -0.216], [0.216, -0.432], [-0.216, -0.432], [-0.216, -0.216]];
    m.face(pent.map(([x, z]) => [x, h, z]), COLORS.white);
    for (let i = 0; i < pent.length; i++) {
      const a = pent[i], b = pent[(i + 1) % pent.length];
      const out = [(a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2 + 0.216]; // 판 중심(0,-0.216)에서 바깥쪽
      m.quad([a[0], 0, a[1]], [b[0], 0, b[1]], [b[0], h, b[1]], [a[0], h, a[1]], COLORS.white, out);
    }
    return m;
  }

  // 외야 펜스: 펜스 거리 r(θ)를 따라가는 두께 있는 호 모양 벽
  function buildFence() {
    const m = new MeshBuilder();
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
    return m;
  }

  // 계단식 관중석 단면: [바깥 방향 오프셋, 높이, 색]
  // 관중석 계단 치수: 줄 수, 앞벽 높이, 한 단 높이, 한 단 깊이 (관중 배치에서도 사용)
  const BOWL_STAND = { rows: 18, frontWall: 1.4, rise: 0.45, depth: 0.85 };

  function standProfile(rows, frontWall, rise, depth, colorA, colorB) {
    const prof = [[0, 0, COLORS.wall], [0, frontWall, COLORS.wall]];
    let h = frontWall;
    for (let i = 0; i < rows; i++) {
      const off = i * depth;
      prof.push([off + depth, h, i % 2 ? colorB : colorA]); // 좌석 단 (수평)
      h += rise;
      prof.push([off + depth, h, COLORS.concrete]);           // 단 높이 (수직)
    }
    const back = rows * depth;
    prof.push([back + 0.6, h, COLORS.concrete]);
    prof.push([back + 0.6, h + 1.2, COLORS.wall]); // 뒤쪽 난간 벽
    prof.push([back + 0.8, h + 1.2, COLORS.wall]);
    prof.push([back + 0.8, 0, COLORS.wall]);
    return prof;
  }

  // 관중석 고리(볼) 경로: 경기장을 한 바퀴 감싸는 닫힌 곡선 (관중석 앞벽 위치)
  //   사진(원형 구장)처럼 내야는 파울 라인을 따라 곧게 가다가, 코너에서 크게 휘어져 외야 관중석으로 이어집니다.
  //     1) 1루 라인 직선 (파울 라인에서 18m 바깥, 홈에서 60m까지) → 2) 홈 뒤 반원 → 3) 3루 라인 직선
  //     4) 3루 코너 곡선 → 5) 외야 호 (펜스 2.5m 뒤, ±30°) → 6) 1루 코너 곡선 → 다시 1)로
  //   관중석·외벽·지붕·지붕 조명·관중이 모두 이 경로를 기준으로 바깥 방향 오프셋을 씁니다.
  const LINE_OFFSET = 18;          // 파울 라인에서 관중석 앞벽까지 거리
  const LINE_LENGTH = 60;          // 내야 직선 구간 길이 (홈에서 파울 라인을 따라)
  const OUTFIELD_HALF_ANGLE = 30;  // 외야 호 구간 (중견수 방향 기준 ±30°)
  const CORNER_HANDLE = 0.6;       // 코너 곡선 제어점 길이 비율 (클수록 바깥으로 둥글게 부풂)

  // 외야 호 위의 점: 펜스 2.5m 뒤
  function outfieldArcPoint(theta) {
    const r = fenceRadius(theta) + 2.5, d = dir(theta);
    return [d[0] * r, 0, d[2] * r];
  }
  // 내야 직선 위의 점: 파울 라인을 따라 t m, 바깥으로 LINE_OFFSET m
  function lineStandPoint(side, t) {
    const d = dir(side * FOUL), n = dir(side * 135 * DEG);
    return [d[0] * t + n[0] * LINE_OFFSET, 0, d[2] * t + n[2] * LINE_OFFSET];
  }

  // 코너 곡선 (3차 베지어): 내야 직선 끝 P0 → 외야 호 끝 P1
  //   B(t) = (1−t)³P0 + 3(1−t)²t·C0 + 3(1−t)t²·C1 + t³P1
  //   C0는 파울 라인 방향, C1은 외야 호가 뻗어 나가던 방향에 두어 양쪽 이음새가 꺾이지 않게 함
  function cornerCurve(side, segments = 12) {
    const p0 = lineStandPoint(side, LINE_LENGTH);
    const thetaEnd = side * OUTFIELD_HALF_ANGLE * DEG;
    const p1 = outfieldArcPoint(thetaEnd);
    const ahead = outfieldArcPoint(thetaEnd + side * 0.01);
    const t0 = dir(side * FOUL);
    const t1 = normalize([ahead[0] - p1[0], 0, ahead[2] - p1[2]]);
    const len = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]) * CORNER_HANDLE;
    const c0 = [p0[0] + t0[0] * len, 0, p0[2] + t0[2] * len];
    const c1 = [p1[0] + t1[0] * len, 0, p1[2] + t1[2] * len];
    const curve = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments, u = 1 - t;
      const b = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
      curve.push([
        b[0] * p0[0] + b[1] * c0[0] + b[2] * c1[0] + b[3] * p1[0],
        0,
        b[0] * p0[2] + b[1] * c0[2] + b[2] * c1[2] + b[3] * p1[2],
      ]);
    }
    return curve; // P0 → P1
  }

  function bowlPath() {
    const path = [];
    for (let t = LINE_LENGTH; t >= 0; t -= 5) path.push(lineStandPoint(1, t));              // 1) 1루 라인
    for (let a = 140; a <= 220; a += 5) {                                                      // 2) 홈 뒤 반원
      const d = dir(a * DEG);
      path.push([d[0] * LINE_OFFSET, 0, d[2] * LINE_OFFSET]);
    }
    for (let t = 0; t <= LINE_LENGTH; t += 5) path.push(lineStandPoint(-1, t));               // 3) 3루 라인
    path.push(...cornerCurve(-1).slice(1, -1));                                                // 4) 3루 코너
    for (let a = -OUTFIELD_HALF_ANGLE; a <= OUTFIELD_HALF_ANGLE; a += 2.5) {                  // 5) 외야 호
      path.push(outfieldArcPoint(a * DEG));
    }
    path.push(...cornerCurve(1).slice(1, -1).reverse());                                       // 6) 1루 코너
    return path; // 닫힌 고리 (마지막 점 다음 = 첫 점)
  }

  // 관중석 (18줄 계단, 한 바퀴)
  function buildBowlStands() {
    const m = new MeshBuilder();
    const s = BOWL_STAND;
    m.extrudeAlong(bowlPath(), standProfile(s.rows, s.frontWall, s.rise, s.depth, COLORS.seatA, COLORS.seatB), true);
    return m;
  }

  // 관중석 뒤 외벽 (사진의 여러 층 건물 외관): 바깥 면에 층마다 색 띠
  const FACADE_OFFSET = 17.6, FACADE_HEIGHT = 13.2;
  function buildFacade() {
    const m = new MeshBuilder();
    const f = FACADE_OFFSET;
    m.extrudeAlong(bowlPath(), [
      [f, 0, COLORS.concrete],
      [f, 2.8, COLORS.facadeGlass, 'out'],   // 1층 유리
      [f, 3.4, COLORS.concrete, 'out'],
      [f, 6.4, COLORS.facadeWindow, 'out'],  // 2층 콘코스 창
      [f, 7.0, COLORS.concrete, 'out'],
      [f, 9.6, COLORS.facadeBanner, 'out'],  // 3층 띠 (배너)
      [f, 10.2, COLORS.concrete, 'out'],
      [f, 12.6, COLORS.facadeGlass, 'out'],  // 4층 유리
      [f, FACADE_HEIGHT, COLORS.concrete, 'out'],
      [16.1, FACADE_HEIGHT, COLORS.concrete, 'up'], // 옥상 (관중석 뒷벽까지)
    ], true);
    return m;
  }

  // 지붕 (캐노피): 외벽 위에서 시작해 그라운드 쪽으로 올라가며 관중석 뒤쪽 절반을 덮는 얇은 판, 한 바퀴
  //   단면 = 윗면(뒤 → 앞) → 앞 가장자리 → 아랫면 → 뒤 가장자리
  //   사진처럼 앞쪽 좌석은 지붕 밖으로 보이게 합니다.
  const ROOF_FRONT = 7.0, ROOF_FRONT_TOP = 15.6, ROOF_EDGE = 0.6;
  // 지붕 윗면은 골판(주름진 패널)처럼 산·골을 번갈아 만듦.
  //   면마다 기울기가 달라서 햇빛·조명을 받는 각도가 달라지고, 정반사 하이라이트가 줄무늬로 반짝입니다.
  const ROOF_PANELS = 8, ROOF_RIDGE = 0.25; // 패널 개수, 산 높이 (m)
  function buildRoof() {
    const m = new MeshBuilder();
    const back = FACADE_OFFSET + 0.2;
    const top = [];
    for (let k = 1; k <= ROOF_PANELS * 2; k++) {
      const t = k / (ROOF_PANELS * 2);                           // 0(뒤) → 1(앞)
      const off = back + (ROOF_FRONT - back) * t;
      const h = FACADE_HEIGHT + (ROOF_FRONT_TOP - FACADE_HEIGHT) * t + (k % 2 ? ROOF_RIDGE : 0); // 홀수 = 산
      const color = t > 0.75 ? COLORS.roofTop2 : COLORS.roofTop; // 앞쪽 띠는 밝은 파랑
      top.push([off, h, color, 'up']);
    }
    m.extrudeAlong(bowlPath(), [
      [back, FACADE_HEIGHT, COLORS.roofEdge],
      ...top,
      [ROOF_FRONT, ROOF_FRONT_TOP - ROOF_EDGE, COLORS.roofEdge, 'in'],
      [back, FACADE_HEIGHT - 0.3, COLORS.roofUnder, 'down'],
      [back, FACADE_HEIGHT, COLORS.roofEdge, 'out'],
    ], true);
    return m;
  }

  // 지붕 앞 가장자리 아래에 달린 조명 (경로 점 2개마다 1개, 그라운드 쪽으로 35° 숙임)
  function buildRoofLights() {
    const path = bowlPath();
    const outward = outwardDirections(path, true);
    const lights = [];
    for (let i = 0; i < path.length; i += 2) {
      const p = path[i], n = outward[i];
      const off = ROOF_FRONT + 0.6;
      const yaw = Math.atan2(n[0], n[2]); // 로컬 -z = -n (그라운드 쪽)
      roofLightPositions.push([p[0] + n[0] * (off - 2), ROOF_FRONT_TOP - 3, p[2] + n[2] * (off - 2)]);
      lights.push({
        id: `stadium_roof_light_${i}`,
        position: [p[0] + n[0] * off, ROOF_FRONT_TOP - ROOF_EDGE - 0.75, p[2] + n[2] * off],
        rotation: [-35 * DEG, yaw, 0],
        children: [
          boxPart(`stadium_roof_light_${i}_frame`, [0, 0, 0], [3.2, 0.7, 0.4], COLORS.towerFrame),
          boxPart(`stadium_roof_light_${i}_lamp`, [0, 0.1, -0.22], [2.8, 0.5, 0.06], COLORS.lamp),
        ],
      });
    }
    return { id: 'stadium_roof_lights', children: lights };
  }

  // 경기장 바깥 둘레(외벽 바로 바깥)의 점: 외야 호 위 각도 theta 기준 (조명탑·전광판 위치용)
  function outsideBowlPoint(theta, extra) {
    const r = fenceRadius(theta) + 2.5 + FACADE_OFFSET + extra, d = dir(theta);
    return [d[0] * r, 0, d[2] * r];
  }

  // ------------------------------------------------------------------
  // 상자 부품: 엔진의 'box'(한 변 1, 중심 원점) + meshOffset/meshScale
  //   center = 부모 기준 바닥면 중심, size = [가로, 높이, 세로]
  //   meshOffset·meshScale은 자식에게 상속되지 않음 (HW1의 clone 후 scale과 같은 개념)
  // ------------------------------------------------------------------
  function boxPart(id, center, size, color) {
    return applyColorTraits({
      id,
      primitive: 'box',
      meshOffset: [center[0], center[1] + size[1] / 2, center[2]],
      meshScale: size,
      color: rgb255(color),
    }, color);
  }

  // 조명탑 (모양만, 빛은 아직 없음)
  //   tower(바닥 위치, 그라운드 쪽으로 회전)
  //    ├ 기둥 (cylinder)
  //    └ head (기둥 꼭대기, 아래로 25° 기울임)
  //        ├ 램프 판 (뒤판) + 아래 발판
  //        └ 램프 4 × 6개 (그라운드 쪽 = 로컬 -z 면)
  const TOWER_HEIGHT = 40;
  function buildLightTower(id, position) {
    // 로컬 -z가 FIELD_CENTER를 향하도록 y축 회전: rotationY(a)에서 로컬 -z = (-sin a, 0, -cos a)
    const dx = FIELD_CENTER[0] - position[0], dz = FIELD_CENTER[2] - position[2];
    const yaw = Math.atan2(-dx, -dz);
    const len = Math.hypot(dx, dz);
    towerLightPositions.push([position[0] + dx / len * 3, TOWER_HEIGHT + 2, position[2] + dz / len * 3]);

    const lamps = [];
    const cols = 6, rows = 4, lampW = 1.2, lampH = 1.0, gap = 0.25;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = (c - (cols - 1) / 2) * (lampW + gap);
        const y = 0.4 + r * (lampH + gap);
        lamps.push(boxPart(`${id}_lamp_${r}_${c}`, [x, y, -0.45], [lampW, lampH, 0.3], COLORS.lamp));
      }
    }
    const panelW = cols * (lampW + gap) + 0.6, panelH = rows * (lampH + gap) + 0.6;

    return {
      id,
      position,
      rotation: [0, yaw, 0],
      children: [
        {
          id: `${id}_pole`,
          primitive: 'cylinder',            // 반지름 0.5, 높이 1 (중심 원점)
          meshOffset: [0, TOWER_HEIGHT / 2, 0],
          meshScale: [1.0, TOWER_HEIGHT, 1.0],
          color: rgb255(COLORS.towerPole),
        },
        {
          id: `${id}_head`,
          position: [0, TOWER_HEIGHT, 0],
          rotation: [-25 * DEG, 0, 0],      // 램프 면(-z)이 그라운드 아래쪽을 향하게
          children: [
            boxPart(`${id}_panel`, [0, 0, 0], [panelW, panelH, 0.6], COLORS.towerFrame),
            boxPart(`${id}_catwalk`, [0, -0.3, -1.0], [panelW, 0.3, 1.6], COLORS.towerFrame),
            ...lamps,
          ],
        },
      ],
    };
  }

  const first = [BASE_DIST * Math.SQRT1_2, 0, -BASE_DIST * Math.SQRT1_2];
  const second = [0, 0, -BASE_DIST * Math.SQRT2];
  const third = [-first[0], 0, first[2]];

  function buildStadiumModel() {
    const children = [
      buildField().toNode('stadium_field'),
      buildFence().toNode('stadium_fence'),
      buildBowlStands().toNode('stadium_stands'),
      buildFacade().toNode('stadium_facade'),
      buildRoof().toNode('stadium_roof'),
      buildRoofLights(),
      // 마운드 중심은 투수판보다 약간 홈 쪽
      buildMound().toNode('stadium_mound', { position: [0, 0, -MOUND_DIST + 0.45] }),
      buildHomePlate().toNode('stadium_home_plate', { position: [0, 0.12, 0] }),
      // 투수판: 마운드 꼭대기(높이 0.34)
      {
        id: 'stadium_rubber',
        position: [0, 0.34, -MOUND_DIST],
        children: [boxPart('stadium_rubber_box', [0, 0, 0], [0.61, 0.04, 0.15], COLORS.white)],
      },
    ];

    // 1·2·3루 베이스: 위치 이동 → 45° 회전한 좌표계에 납작한 상자
    [first, second, third].forEach((p, i) => {
      children.push({
        id: `stadium_base${i + 1}`,
        position: [p[0], 0.06, p[2]],
        rotation: [0, FOUL, 0],
        children: [boxPart(`stadium_base${i + 1}_box`, [0, 0, 0], [0.38, 0.1, 0.38], COLORS.white)],
      });
    });

    for (const s of [1, -1]) {
      const side = s > 0 ? 'first' : 'third';

      // 파울 폴: 펜스 끝
      const pole = dir(s * FOUL).map((x) => x * (fenceRadius(FOUL) + 0.2));
      children.push({
        id: `stadium_pole_${side}`,
        position: pole,
        children: [boxPart(`stadium_pole_${side}_box`, [0, 0, 0], [0.35, 15, 0.35], COLORS.pole)],
      });

      // 더그아웃 (계층): 파울 라인을 따라 24m, 바깥쪽으로 14.5m → 파울 라인과 나란하게 회전
      //   로컬 x축 = 파울 라인 방향, 로컬 -z = 그라운드 쪽
      const d = dir(s * FOUL), n = dir(s * 135 * DEG);
      children.push({
        id: `stadium_dugout_${side}`,
        position: [d[0] * 24 + n[0] * 14.5, 0, d[2] * 24 + n[2] * 14.5],
        rotation: [0, s * FOUL, 0],
        children: [
          boxPart(`stadium_dugout_${side}_body`, [0, 0, 0], [14, 2.2, 4], COLORS.dugout),
          boxPart(`stadium_dugout_${side}_roof`, [0, 2.2, 0], [14.4, 0.2, 4.4], COLORS.roof),
          boxPart(`stadium_dugout_${side}_opening`, [0, 0.3, -2.02], [12, 1.6, 0.04], COLORS.dugoutDark),
        ],
      });
    }

    // 조명탑: 사진처럼 외야 좌중간·우중간 외벽 바로 바깥에 2개 (나머지 조명은 지붕에 달림)
    for (const s of [1, -1]) {
      const side = s > 0 ? 'first' : 'third';
      children.push(buildLightTower(`stadium_tower_${side}_outfield`, outsideBowlPoint(s * 20 * DEG, 2)));
    }

    // 전광판 (2단 계층: 전광판 전체 → 기둥 꼭대기 판)
    const SCOREBOARD_POST = 18; // 지붕(약 16m) 위로 판이 보이도록
    children.push({
      id: 'stadium_scoreboard',
      position: outsideBowlPoint(0, 1.5),
      children: [
        boxPart('stadium_scoreboard_post_l', [-10, 0, 0], [1, SCOREBOARD_POST, 1], COLORS.concrete),
        boxPart('stadium_scoreboard_post_r', [10, 0, 0], [1, SCOREBOARD_POST, 1], COLORS.concrete),
        {
          id: 'stadium_scoreboard_panel',
          position: [0, SCOREBOARD_POST, 0],
          children: [
            boxPart('stadium_scoreboard_board', [0, 0, 0], [30, 12, 1.5], COLORS.board),
            boxPart('stadium_scoreboard_screen', [0, 1, 0.76], [27, 10, 0.04], COLORS.boardFace),
          ],
        },
      ],
    });

    return { id: 'stadium_root', children };
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
  };

  Object.assign(window.STADIUM_PARTS, { bowlPath, BOWL_STAND, stadiumRoot });
})();
