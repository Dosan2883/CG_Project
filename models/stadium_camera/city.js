'use strict';

// [역할 1] 경기장 주변 배경: 아파트 단지 · 도로망 · 주차장 · 산
// 포수 뒤 시점에서 외야 너머가 허전하지 않도록 좌중간 쪽에 아파트 단지를,
// 경기장 주변에 도로망(U자 큰 도로, 경기장 앞 둘레 도로, 정문 진입로, 가로수)과 정문 앞 주차장을,
// 외야 너머 멀리에 산(산 사진의 능선 모양 메시 + 사진 텍스처)을 만듭니다.
// 산 · 주변(도로·주차장·나무) · 아파트 낮 건물 · 아파트 밤 겹(불 켜진 창문) 노드 4개를 window.SCENE_MODELS에 등록하고,
// lighting.js가 시간대에 맞춰 밤 겹의 투명도를 바꿀 수 있도록 window.STADIUM_PARTS.apartments로 내보냅니다.
// 반드시 stadium_model.js 다음, lighting.js 앞에 불러야 함 (index.html 순서)
(function () {
  const { DEG, dir, COLORS, MeshBuilder } = window.STADIUM_PARTS;

  // ------------------------------------------------------------------
  // 아파트 = 긴 상자 + 실제 아파트 외벽 사진(textures/apartment.png) 텍스처 매핑
  //   모든 건물을 메시 하나로 합치고 텍스처 하나를 같이 써서 몇 동이든 그리기 1번 (낮 건물 1번 + 밤 겹 1번 = 2번)
  //
  //   사진 구성 (이미지를 분석해서 잰 값, 단위 px): 위쪽 SRC.roofY줄까지는 옥탑 장식 + 흰 하늘 → 잘라냄
  //     왼쪽 0 ~ SRC.frontW = 건물 앞면(창문), 그 오른쪽 SRC.sideW = 건물 옆면(문양 벽), 한 층 = SRC.floorPx
  //   사진은 21층뿐이라, 캔버스에 [위 3층 | 가운데 6층 묶음을 반복 | 아래 5층]으로 이어 붙여 TEX_FLOORS층 외벽을 만듦
  //     → 층 높이(px)가 그대로라 창문이 늘어나지 않음. 캔버스 오른쪽 끝에는 지붕용 회색 띠를 붙임 (아틀라스)
  //
  //   UV 매핑 (면마다 다르게):
  //     앞면·뒷면 → 외벽 영역의 왼쪽부터 건물 폭만큼 (폭 / 사진 속 건물 폭)
  //     옆면     → 옆면 영역 전체
  //     세로     → 맨 위(옥상선)부터 건물 층수만큼 (층수 / TEX_FLOORS)
  //     지붕     → 회색 띠의 한 점
  //   엔진 텍스처는 반복(REPEAT)이 안 되므로 늘리는 대신 이렇게 잘라 써서, 건물마다 창문 크기가 같음
  //
  //   낮·밤 전환: 밤 텍스처 = 낮 캔버스를 어둡게 덮고, 창문 칸(창문 세로줄 × 층) 중 일부에 노란 네모를 칠함
  //     → 창문 자리가 낮 사진과 같고 불빛은 깔끔한 네모. 낮 건물 위에 밤 건물을 살짝 크게 한 겹 더 씌우고,
  //       lighting.js가 밤 겹의 투명도(opacity)를 노을 동안 0 → 1로 서서히 올림 (저녁은 낮 건물이 노을빛을 받아 자연스럽게)
  // ------------------------------------------------------------------
  const FLOOR_H = 3;                                       // 한 층 높이 (m)
  const SRC = { roofY: 24, floorPx: 23, frontW: 272, sideW: 48 }; // 사진에서 잰 값 (px)
  const WINDOW_COLS = [                                    // 사진 앞면의 창문 세로줄 (x 범위, px) — 밤 불빛용
    [8, 22], [27, 45], [54, 65], [73, 82], [87, 105], [110, 125],
    [136, 151], [156, 174], [182, 193], [202, 211], [216, 234], [239, 254],
  ];
  const TEX_FLOORS = 35;                                   // 이어 붙인 외벽 텍스처의 층수 (= 가장 높은 건물)
  const TOP_FLOORS = 3, MID_FLOORS = 6, BOTTOM_FLOORS = 5; // 사진에서 위·반복·아래로 쓸 층수
  const ROOF_PX = 8;                                       // 지붕용 회색 띠 폭 (px)
  const FRONT_W_M = SRC.frontW / SRC.floorPx * FLOOR_H;    // 사진 속 건물 앞면 폭 (m) ≈ 35.5
  const TEX_W = SRC.frontW + SRC.sideW + ROOF_PX;          // 텍스처 폭 (px)
  const FRONT_U = SRC.frontW / TEX_W;                      // 앞면 영역 끝 u
  const SIDE_U = (SRC.frontW + SRC.sideW) / TEX_W;         // 옆면 영역 끝 u (이후 지붕 회색)
  const LIT_RATE = 0.35;                                   // 밤에 불 켜진 창문 칸 비율
  const WINDOW_Y = [8, 18];                                // 한 층(SRC.floorPx) 안에서 창문 유리가 있는 세로 범위 (px)

  // 단지 줄: 홈에서 거리(m), 각도 범위(°), 동 간격(°). 포수 뒤 시점 화면 왼쪽(좌중간 쪽, 각도 −)에 촘촘히 모인 단지
  //   동 간격 7° ≈ 앞줄 29m (건물 폭 18 ~ 28m) → 건물끼리 붙을 만큼 촘촘하지만 겹치지는 않음
  const APT_ROWS = [
    { r: 240, from: -35, to: -14, step: 7 },         // 앞줄 4채
    { r: 290, from: -31.5, to: -17.5, step: 7 },     // 뒷줄 3채 (앞줄 사이로 보이게 엇갈림)
  ];
  const hash01 = (n) => { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); }; // 고정 난수 0~1
  // 홈 기준 각도 a(°)·거리 r(m)·높이 y인 점
  const polar = (a, r, y = 0) => { const d = dir(a * DEG); return [d[0] * r, y, d[2] * r]; };

  // 텍스처 좌표가 있는 메시를 면 단위로 쌓는 도우미 (아파트·산 공용)
  //   addFace(점들, 법선, UV들): 볼록 다각형 하나를 부채꼴 삼각형 (0,1,2), (0,2,3)…으로 추가 / toPrimitive(): 엔진용 메시
  function texturedMesh() {
    const positions = [], normals = [], texCoords = [], indices = [];
    return {
      addFace(pts, normal, uvs) {
        const start = positions.length / 3;
        pts.forEach((p, k) => { positions.push(...p); normals.push(...normal); texCoords.push(...uvs[k]); });
        for (let k = 1; k < pts.length - 1; k++) indices.push(start, start + k, start + k + 1);
      },
      toPrimitive: () => ({
        positions: new Float32Array(positions), normals: new Float32Array(normals),
        texCoords: new Float32Array(texCoords), indices: new Uint16Array(indices),
      }),
    };
  }

  // 낮 텍스처: 사진을 [위 | 가운데 반복 | 아래]로 이어 붙여 TEX_FLOORS층 외벽 + 오른쪽 지붕 회색 띠
  function composeDayCanvas(img) {
    const f = SRC.floorPx, srcW = SRC.frontW + SRC.sideW;
    const canvas = document.createElement('canvas');
    canvas.width = TEX_W;
    canvas.height = TEX_FLOORS * f;
    const ctx = canvas.getContext('2d');
    const copy = (sy, rows, dy) => ctx.drawImage(img, 0, sy, srcW, rows, 0, dy, srcW, rows); // 크기 그대로 복사
    const topH = TOP_FLOORS * f, bottomH = BOTTOM_FLOORS * f, midH = MID_FLOORS * f;
    copy(SRC.roofY, topH, 0);                                          // 위 3층 (옥상선부터)
    for (let y = topH; y < canvas.height - bottomH; y += midH) {        // 가운데 6층 묶음을 반복해서 채움
      copy(SRC.roofY + topH, Math.min(midH, canvas.height - bottomH - y), y);
    }
    copy(img.height - bottomH, bottomH, canvas.height - bottomH);      // 아래 5층 (1층 포함)
    ctx.fillStyle = '#8e9096';                                         // 지붕 회색 띠
    ctx.fillRect(srcW, 0, ROOF_PX, canvas.height);
    return canvas;
  }

  // 밤 텍스처: 낮 캔버스를 어두운 밤색으로 덮은 뒤(건물 모양은 희미하게 남김),
  //   창문 칸(창문 세로줄 × 층)마다 고정 난수로 LIT_RATE만큼 골라 노란 네모를 칠함. 칸마다 밝기를 조금씩 다르게
  function makeNightCanvas(day) {
    const canvas = document.createElement('canvas');
    canvas.width = day.width;
    canvas.height = day.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(day, 0, 0);
    ctx.fillStyle = 'rgba(8, 10, 22, 0.88)';                         // 전체를 어두운 밤색으로
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const [y0, y1] = WINDOW_Y;
    for (let floor = 0; floor < TEX_FLOORS; floor++) {
      WINDOW_COLS.forEach(([a, b], col) => {
        const n = floor * 31 + col * 7 + 1;
        if (hash01(n) >= LIT_RATE) return;                           // 꺼진 창문
        const k = 0.8 + 0.2 * hash01(n + 0.5);                        // 밝기 차이
        ctx.fillStyle = `rgb(${255 * k | 0}, ${205 * k | 0}, ${125 * k | 0})`;
        ctx.fillRect(a + 1, floor * SRC.floorPx + y0, b - a - 1, y1 - y0);
      });
    }
    return canvas;
  }

  // 아파트 상자 메시 (옆면 4개 + 지붕), 앞면이 홈 쪽을 봄. inflate만큼 사방·위로 키움 (밤 겹이 낮 건물과 겹쳐 깜빡이지 않게)
  function apartmentMesh(inflate) {
    const { addFace, toPrimitive } = texturedMesh();
    let id = 0;
    for (const row of APT_ROWS) {
      for (let a = row.from; a <= row.to + 1e-9; a += row.step) {
        id++;
        const theta = (a + (hash01(id) - 0.5) * row.step * 0.15) * DEG;         // 각도를 살짝 흔듦 (이웃과 안 겹칠 만큼)
        const width = 18 + hash01(id + 0.3) * 10, depth = 12 + hash01(id + 0.6) * 3; // 폭 18 ~ 28m
        const floors = 25 + Math.floor(hash01(id + 0.9) * (TEX_FLOORS - 24));     // 25 ~ 35층
        const height = floors * FLOOR_H + inflate;
        const out = dir(theta), side = [Math.cos(theta), 0, Math.sin(theta)];  // 바깥(홈 반대) 방향, 옆 방향
        const c = out.map((v) => v * row.r);
        const corner = (sx, sz, y) => [c[0] + side[0] * sx + out[0] * sz, y, c[2] + side[2] * sx + out[2] * sz];
        const hw = width / 2 + inflate, hd = depth / 2 + inflate;
        // 벽: 아래 → 위. 텍스처는 위가 v = 1 → 맨 위(옥상선)부터 floors층만큼 = v (1 − floors/TEX_FLOORS) ~ 1
        const v0 = 1 - floors / TEX_FLOORS;
        const wall = (p0, p1, u0, u1, normal) => {
          addFace([[...p0, 0], [...p1, 0], [...p1, height], [...p0, height]].map(([x, z, y]) => [x, y, z]),
            normal, [[u0, v0], [u1, v0], [u1, 1], [u0, 1]]);
        };
        const frontU = Math.min(1, width / FRONT_W_M) * FRONT_U;            // 앞면: 왼쪽부터 건물 폭만큼
        const xz = (sx, sz) => { const p = corner(sx, sz, 0); return [p[0], p[2]]; };
        const neg = (v) => v.map((x) => -x);
        wall(xz(hw, -hd), xz(-hw, -hd), 0, frontU, neg(out));        // 앞면 (홈 쪽)
        wall(xz(-hw, hd), xz(hw, hd), 0, frontU, out);               // 뒷면
        wall(xz(-hw, -hd), xz(-hw, hd), FRONT_U, SIDE_U, neg(side)); // 옆면 (문양 벽)
        wall(xz(hw, hd), xz(hw, -hd), FRONT_U, SIDE_U, side);
        const roofUV = [(SIDE_U + 1) / 2, 0.5];                      // 지붕: 회색 띠의 한 점
        addFace([corner(-hw, -hd, height), corner(-hw, hd, height), corner(hw, hd, height), corner(hw, -hd, height)],
          [0, 1, 0], [roofUV, roofUV, roofUV, roofUV]);
      }
    }
    return toPrimitive();
  }

  // 낮 건물 + 밤 겹. 그림자 범위 밖이라 둘 다 그림자 없음
  //   사진을 불러온 뒤에 낮·밤 텍스처를 만들어 넣음 (그 전에는 낮 건물을 숨겨 둠)
  function buildApartments() {
    const day = {
      id: 'city_apartments',
      primitive: apartmentMesh(0),
      color: [220, 216, 205],
      castShadow: false,
      visible: false,
    };
    const night = {
      id: 'city_apartments_night',
      primitive: apartmentMesh(0.15),
      color: [10, 12, 20],     // 텍스처를 만들기 전 잠깐 보이는 어두운 색
      emissive: true,          // 불 켜진 창문은 조명과 상관없이 밝게
      blend: 'alpha',          // opacity만큼 낮 건물 위에 섞임
      opacity: 0,
      fog: false,              // 밤 안개(어두운 색)에 창문 불빛이 묻히지 않게
      castShadow: false,
      visible: false,
    };
    const img = new Image();
    img.onload = () => {
      try {
        const dayCanvas = composeDayCanvas(img);
        day.texture = dayCanvas.toDataURL();
        night.texture = makeNightCanvas(dayCanvas).toDataURL();
        day.visible = true;
      } catch (error) {
        // index.html을 파일로 바로 열면(file://) 보안 때문에 캔버스 픽셀을 읽을 수 없음 → 로컬 서버로 열어야 함
        console.warn('아파트 텍스처를 만들 수 없음 (로컬 서버로 열어 주세요):', error);
      }
    };
    img.src = 'textures/apartment.png';
    return { day, night };
  }

  // ------------------------------------------------------------------
  // 경기장 주변 도로망 (광주 구장 조감도 참고)
  //   큰 도로(4차로, U자): 경기장 양옆을 앞뒤로 지나고 뒤를 돌아 감쌈 + 바깥쪽 가로수
  //   둘레 도로(2차로): 경기장 앞을 감싸는 호, 양 끝이 큰 도로에 붙음 + 바깥쪽 가로수
  //   정문 진입로(정문 → 둘레 도로 → 주차장), 정문 앞 주차장(승용차 + 버스),
  //   아파트 단지 바닥·앞 도로 + 큰 도로로 나가는 연결로
  //   아래 → 위 높이로 겹쳐 깜빡임 방지: 바닥 0.03 · 도로 0.05 · 선 0.07
  //   좌표: 홈 = 원점, +x = 1루 쪽, −z = 중견수 쪽, 정문 = +z 쪽
  // ------------------------------------------------------------------
  const SITE = { th0: -40, th1: -8, r0: 222, r1: 300 };   // 아파트 단지 바닥 (홈 기준 각도 °, 거리 m)
  const SITE_LINK_TH = -24;                                // 단지 앞 도로에서 큰 도로로 나가는 연결로 각도 (°)
  const ROAD_W = 7;                                        // 2차로 도로 폭 (m)
  const RING_GAP = 10;                                     // 경기장 둘레(광장 끝)에서 둘레 도로 가운데까지 (m)
  const RING_FROM = 150, RING_TO = 30;                     // 둘레 도로 범위: 경기장 중심 기준 각도(°), 90° = 정문 쪽
  // 큰 도로 (U자): 3루 쪽 앞(x = −x, z = zFront) → 경기장 뒤를 반타원으로 돌아 → 1루 쪽 앞(z = zFront)까지 (좌우 대칭)
  //   양옆은 x = ±x 직선, 뒤는 중심 (0, zc), 가로 반지름 x · 세로 반지름 rz인 반타원 (아파트·전광판과 안 겹치게 납작하게)
  const BIG = { x: 135, zFront: 240, zc: -80, rz: 110, w: 16, lane: 4 };
  const LOT = { x0: -55, x1: 65, z0: 95, z1: 170 };        // 주차장 (정문 앞, 둘레 도로 바깥, x·z 범위 m)
  const STALL_W = 2.6, STALL_L = 5, AISLE = 7;             // 주차 칸 폭·길이, 통로 폭 (m)
  const BUS_ROW_L = 14, BUS_COUNT = 6, BUS_GAP = 5;        // 버스 줄 깊이(m), 버스 수, 버스 간격(m)
  const CAR_RATE = 0.55;                                   // 차가 서 있는 칸 비율
  const CAR_COLORS = [COLORS.white, COLORS.facadeBanner, COLORS.towerFrame, COLORS.roofEdge, COLORS.board, COLORS.roofNavy];

  // 홈 기준 부채꼴 띠: 각도 a0 ~ a1(°), 거리 rIn ~ rOut(m), 높이 y
  function band(m, a0, a1, rIn, rOut, y, color) {
    const segments = Math.max(1, Math.round(Math.abs(a1 - a0) / 2));
    m.fan(a0 * DEG, a1 * DEG, segments, () => rOut, () => rIn, y, () => color);
  }
  // 거리 r에서 폭 w(m)가 차지하는 각도(°)
  const widthDeg = (w, r) => (w / r) / DEG;

  // 꺾은선의 점마다 왼쪽 수직 단위벡터 [x, z] (앞뒤 이웃 방향 기준)
  function leftNormals(points) {
    return points.map((p, i) => {
      const a = points[Math.max(i - 1, 0)], b = points[Math.min(i + 1, points.length - 1)];
      const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
      return [-(b[2] - a[2]) / len, (b[0] - a[0]) / len];
    });
  }
  // 점들을 잇는 폭 w의 띠 (도로·선). 점마다 좌우로 벌려 이음새 없이 이어 붙임
  function ribbon(m, points, w, y, color) {
    const n = leftNormals(points);
    const at = (i, s) => [points[i][0] + n[i][0] * s * w / 2, y, points[i][2] + n[i][1] * s * w / 2];
    for (let i = 0; i < points.length - 1; i++) m.quad(at(i, 1), at(i + 1, 1), at(i + 1, -1), at(i, -1), color, [0, 1, 0]);
  }
  // 꺾은선을 왼쪽으로 d만큼 옮긴 꺾은선 (d < 0이면 오른쪽)
  function offsetLine(points, d) {
    const n = leftNormals(points);
    return points.map((p, i) => [p[0] + n[i][0] * d, 0, p[2] + n[i][1] * d]);
  }
  // 꺾은선을 따라 간격 step(m)마다 점 (나무 심기용)
  function along(points, step) {
    const out = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1], len = Math.hypot(b[0] - a[0], b[2] - a[2]);
      for (let d = 0; d < len; d += step) out.push([a[0] + (b[0] - a[0]) * d / len, 0, a[2] + (b[2] - a[2]) * d / len]);
    }
    return out;
  }

  // 나무: 줄기 + 잎 두 덩어리(아래 큰 상자, 위 작은 상자), 크기·회전을 조금씩 다르게
  function treeAt(m, x, z, seed) {
    const s = 0.8 + hash01(seed) * 0.5, yaw = hash01(seed + 0.4) * Math.PI;
    const t = multiply(translation(x, 0, z), rotationY(yaw));
    m.box([0, 0, 0], [0.5 * s, 3 * s, 0.5 * s], COLORS.track, { transform: t, bottom: false });             // 줄기
    m.box([0, 2.6 * s, 0], [4 * s, 3.4 * s, 4 * s], COLORS.fence, { transform: t });                       // 잎 (아래)
    m.box([0, 5.6 * s, 0], [2.6 * s, 2 * s, 2.6 * s], COLORS.grassA, { transform: t });                    // 잎 (위)
  }

  // 주차장: 아스팔트 바닥 + 흰 주차선 + 칸마다 일정 비율로 차(차체 + 지붕) + 맨 뒤 버스 줄
  //   칸 줄: 맨 앞 한 줄 → (통로 → 등 맞댄 두 줄) 반복. 차·버스는 z 방향으로 세움
  function buildParkingLot(m) {
    const { x0, x1, z0, z1 } = LOT;
    m.quad([x0, 0.05, z1], [x1, 0.05, z1], [x1, 0.05, z0], [x0, 0.05, z0], COLORS.towerFrame, [0, 1, 0]);
    // 버스 줄 (맨 뒤): 흰·빨간 차체 + 옆 창문 띠(어두운 유리색)
    const busZ = z1 - BUS_ROW_L / 2;
    for (let k = 0; k < BUS_COUNT; k++) {
      const bx = x0 + 4 + k * (2.5 + BUS_GAP);
      const body = k % 3 === 1 ? COLORS.facadeBanner : COLORS.white;
      m.box([bx, 0.05, busZ], [2.5, 3.0, 12], body, { bottom: false });              // 차체
      m.box([bx, 1.7, busZ - 0.3], [2.56, 1.0, 10.8], COLORS.facadeGlass);           // 창문 띠
    }
    m.strip([x0 + 2, 0, z1 - BUS_ROW_L], [x1 - 2, 0, z1 - BUS_ROW_L], 0.15, 0.07, COLORS.white);
    // 승용차 줄 (버스 줄 앞까지)
    const carEnd = z1 - BUS_ROW_L - 1;
    const rows = [[z0 + 1, z0 + 1 + STALL_L]];
    for (let z = rows[0][1] + AISLE; z + 2 * STALL_L <= carEnd; z += 2 * STALL_L + AISLE) {
      rows.push([z, z + STALL_L], [z + STALL_L, z + 2 * STALL_L]);
    }
    let seed = 500;
    for (const [za, zb] of rows) {
      for (let x = x0 + 2; x + STALL_W <= x1 - 2 + 1e-9; x += STALL_W) {
        m.strip([x, 0, za], [x, 0, zb], 0.15, 0.07, COLORS.white);                    // 칸 왼쪽 선
        if (hash01(seed++) >= CAR_RATE) continue;
        const cx = x + STALL_W / 2, cz = (za + zb) / 2;
        const color = CAR_COLORS[Math.floor(hash01(seed + 0.5) * CAR_COLORS.length)];
        m.box([cx, 0.05, cz], [1.8, 0.9, 4.3], color, { bottom: false });              // 차체
        m.box([cx, 0.95, cz + 0.2], [1.6, 0.6, 2.3], color, { bottom: false });        // 지붕
      }
      m.strip([x0 + 2, 0, za], [x1 - 2, 0, za], 0.15, 0.07, COLORS.white);            // 줄 앞 선
    }
  }

  function buildCityGround() {
    const m = new MeshBuilder();
    m.castShadow = false;                                  // 그림자 범위 밖
    const ROAD = COLORS.towerFrame, LINE = COLORS.fenceTop;
    let seed = 100;
    // 1) 아파트 단지 바닥 + 단지 앞 도로 (노란 선) + 가로수
    const { th0, th1, r0, r1 } = SITE;
    band(m, th0, th1, r0, r1, 0.03, COLORS.concrete);
    const roadR = r0 - ROAD_W / 2, ends = widthDeg(ROAD_W, r0);
    band(m, th0 - ends, th1 + ends, r0 - ROAD_W, r0, 0.05, ROAD);
    band(m, th0 - ends, th1 + ends, roadR - 0.15, roadR + 0.15, 0.07, LINE);
    for (let a = th0 + 1; a <= th1 - 1 + 1e-9; a += 3) {
      const p = polar(a, r0 + 4);
      treeAt(m, p[0], p[2], seed++);
    }
    // 2) 큰 도로 (U자, 4차로): 가운데 노란 겹선 + 차로 사이 흰 선 + 바깥쪽 가로수
    const big = [];
    for (let z = BIG.zFront; z > BIG.zc; z -= 10) big.push([-BIG.x, 0, z]);                // 3루 쪽 직선 (앞 → 뒤)
    for (let phi = 180; phi <= 360; phi += 4) big.push([Math.cos(phi * DEG) * BIG.x, 0, BIG.zc + Math.sin(phi * DEG) * BIG.rz]); // 뒤 반타원
    for (let z = BIG.zc + 10; z <= BIG.zFront; z += 10) big.push([BIG.x, 0, z]);           // 1루 쪽 직선 (뒤 → 앞)
    ribbon(m, big, BIG.w, 0.05, ROAD);
    for (const d of [-0.3, 0.3]) ribbon(m, offsetLine(big, d), 0.2, 0.07, LINE);           // 가운데 노란 겹선
    for (const d of [-BIG.lane, BIG.lane]) ribbon(m, offsetLine(big, d), 0.15, 0.07, COLORS.white); // 차로 선
    for (const p of along(offsetLine(big, -(BIG.w / 2 + 4)), 14)) treeAt(m, p[0], p[2], seed++);  // 오른쪽(바깥) = 경기장 반대편
    // 가장 가까운 큰 도로 위의 점 (연결로 끝점)
    const nearestBig = (p) => big.reduce((best, q) => (Math.hypot(q[0] - p[0], q[2] - p[2]) < Math.hypot(best[0] - p[0], best[2] - p[2]) ? q : best));
    // 3) 경기장 둘레 도로: 광장 바깥 원을 3루 쪽 앞(RING_FROM)부터 정문 앞을 지나 1루 쪽(RING_TO)까지,
    //    양 끝은 옆으로 곧게 뻗어 큰 도로에 붙음 + 정문 앞 구간 바깥쪽 가로수
    const { center: [cx, cz], radius } = window.STADIUM_PARTS.STADIUM_OUTLINE;
    const ringR = radius + RING_GAP;
    const onRing = (phi, r = ringR) => [cx + Math.cos(phi * DEG) * r, 0, cz + Math.sin(phi * DEG) * r];
    const ring = [];
    for (let phi = RING_FROM; phi >= RING_TO; phi -= 3) ring.push(onRing(phi));
    const [ringStart, ringEnd] = [ring[0], ring[ring.length - 1]];
    ribbon(m, [[-BIG.x, 0, ringStart[2]], ...ring, [BIG.x, 0, ringEnd[2]]], ROAD_W, 0.05, ROAD);
    ribbon(m, ring, 0.3, 0.07, LINE);
    for (let phi = RING_FROM - 5; phi >= RING_TO + 5; phi -= 5) {
      if (Math.abs(phi - 90) < 8) continue;                // 정문 진입로 자리는 비움
      const p = onRing(phi, ringR + ROAD_W / 2 + 4);
      treeAt(m, p[0], p[2], seed++);
    }
    // 4) 정문 진입로: 광장 끝 → 둘레 도로를 건너 → 주차장 앞까지
    ribbon(m, [[cx, 0, cz + radius - 2], [cx, 0, LOT.z0 + 0.5]], ROAD_W + 3, 0.05, ROAD);
    // 5) 정문 앞 주차장 (승용차 + 버스)
    buildParkingLot(m);
    // 6) 아파트 단지 앞 도로 → 큰 도로 연결로
    const siteLink = polar(SITE_LINK_TH, roadR);
    ribbon(m, [siteLink, nearestBig(siteLink)], ROAD_W, 0.05, ROAD);
    return m.toNode('city_ground');
  }

  // ------------------------------------------------------------------
  // 외야 너머 산 = 산 사진(textures/mountain.png, 하늘은 투명)의 능선 모양 그대로 만든 메시 + 그 사진을 텍스처 매핑
  //   1) 사진 분석: 12px 간격 열마다 맨 위 산 픽셀의 y(MOUNTAIN_RIDGE)를 잰 값 → 메시의 능선 높이로 씀
  //   2) 메시: 홈 기준 각도로 사진 한 장 = span°씩, pieces에 적힌 칸에 이어 붙임 (mirror면 좌우를 뒤집어 반복 티를 줄임)
  //      한 칸의 폭(호 길이) = 사진 가로 → 사진 세로 비율대로 높이를 정함 (사진이 찌그러지지 않음)
  //      단면 = 앞 산기슭(r − front, 높이 0) → 능선(r, 높이 h) → 뒤 산기슭(r + back, 0)
  //      양 끝은 taper° 동안 능선이 코사인 곡선으로 완만하게 땅까지 내려감 (뚝 끊긴 절벽 대신)
  //   3) UV: 앞면 꼭짓점 아래 = 사진 맨 아래(v = 0), 위 = 그 열의 능선 픽셀(v = 1 − y/H) → 메시 윤곽과 사진 속 산 윤곽이 일치
  //      (투명한 하늘 부분은 메시 밖이라 그리지 않음). 뒷면은 사진 아래쪽 숲 색 한 점
  //      완만한 끝 부분은 사진 가장자리에서 안쪽으로 거울처럼 되짚은 열을 씀 → 숲 무늬가 이음새 없이 이어지고,
  //      안쪽 열일수록 능선이 높아 내려가는 높이(v)가 항상 사진 속 산 안쪽 → 투명 하늘을 찍지 않음
  //   조명을 받으므로 밤에는 자연스럽게 어두워지고, 안개도 다른 물체처럼 적용 (멀수록 흐릿)
  // ------------------------------------------------------------------
  const MOUNTAIN_IMG = { w: 666, h: 375, step: 12 };      // 사진 크기(px), 능선 잰 간격(px)
  const MOUNTAIN_RIDGE = [                                // 열마다 능선 y (px, 위가 0). 마지막 값 = 오른쪽 끝(x = 665)
    240, 238, 236, 234, 233, 231, 231, 228, 221, 218, 214, 210, 200, 200, 191, 184, 182, 176, 171, 165,
    159, 156, 153, 152, 152, 153, 159, 161, 165, 168, 171, 171, 172, 172, 175, 174, 172, 175, 177, 182,
    188, 193, 199, 204, 210, 216, 220, 228, 233, 239, 242, 248, 249, 249, 251, 252, 253,
  ];
  // 능선 거리(m), 앞·뒤 산기슭 폭(m), 사진 한 장의 각도(°)와 시작 각도, 놓을 칸(0부터), 양 끝 완만하게 내려가는 각도(°)
  const MOUNTAIN = {
    r: 420, front: 60, back: 60, span: 160 / 3, start: -80, taper: 18, taperSteps: 12,
    pieces: [{ at: 1, mirror: true }, { at: 2, mirror: false }],   // 가운데·오른쪽(1루 쪽)만 (왼쪽 칸은 비움)
  };
  const FOREST_UV = [0.5, 0.15];                          // 사진 아래쪽 숲 한 점 (뒷면용)

  function buildMountains() {
    const mesh = texturedMesh();
    const addFace = (pts, uvs) => {                        // 법선 = 두 변의 외적 (위쪽을 향하게)
      const [a, b, c] = pts;
      let n = normalize(cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]));
      if (n[1] < 0) n = n.map((v) => -v);
      mesh.addFace(pts, n, uvs);
    };
    const { w: W, h: H, step } = MOUNTAIN_IMG;
    const { r, front, back, span, start, taper, taperSteps } = MOUNTAIN;
    const cols = MOUNTAIN_RIDGE.map((y, i) => ({ u: Math.min(i * step, W - 1) / (W - 1), v: 1 - (y + 1) / H })); // 능선 바로 아래
    const fullH = r * span * DEG * H / W;                                         // 사진 전체 높이에 해당하는 높이 (m)
    const forest = [FOREST_UV, FOREST_UV, FOREST_UV, FOREST_UV];

    // 능선 점들 (각도 순): 놓을 칸마다 사진 열들을 각도로 바꿔 이어 붙임
    const ridge = [];
    for (const { at: k, mirror } of MOUNTAIN.pieces) {
      for (const { u, v } of cols) {
        const t = mirror ? 1 - u : u;                                               // 칸 안 위치 0 → 1 (뒤집으면 반대로)
        ridge.push({ a: start + (k + t) * span, u, v, h: v * fullH });
      }
    }
    ridge.sort((p, q) => p.a - q.a);
    // 양 끝 완만하게: 가장자리에서 바깥으로 taper° 동안 높이를 코사인 곡선으로 0까지, u는 안쪽으로 거울처럼 되짚음
    const taperEnd = (edge, inner, side) => {
      const du = Math.sign(inner.u - edge.u) / span;                               // 1°당 사진 안쪽으로 가는 u
      const out = [];
      for (let j = 1; j <= taperSteps; j++) {
        const d = taper * j / taperSteps, h = edge.h * 0.5 * (1 + Math.cos(Math.PI * j / taperSteps));
        out.push({ a: edge.a + side * d, u: edge.u + du * d, v: h / fullH, h });
      }
      return out;
    };
    const pts = [...taperEnd(ridge[0], ridge[1], -1).reverse(), ...ridge, ...taperEnd(ridge[ridge.length - 1], ridge[ridge.length - 2], 1)];

    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1];
      if (q.a - p.a < 1e-6) continue;                                               // 칸 이음매의 같은 각도 점은 건너뜀
      addFace([polar(p.a, r - front), polar(q.a, r - front), polar(q.a, r, q.h), polar(p.a, r, p.h)],
        [[p.u, 0], [q.u, 0], [q.u, q.v], [p.u, p.v]]);                              // 앞면: 사진
      addFace([polar(p.a, r, p.h), polar(q.a, r, q.h), polar(q.a, r + back), polar(p.a, r + back)], forest); // 뒷면
    }
    return {
      id: 'city_mountains',
      primitive: mesh.toPrimitive(),
      color: [60, 110, 60],          // 사진을 불러오기 전 잠깐 보이는 초록
      texture: 'textures/mountain.png',
      specular: 0,
      castShadow: false,
    };
  }

  const apartments = buildApartments();
  window.SCENE_MODELS.push(buildMountains(), buildCityGround(), apartments.day, apartments.night);
  Object.assign(window.STADIUM_PARTS, { apartments }); // lighting.js가 밤 겹 투명도를 바꿈
})();
