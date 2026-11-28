'use strict';

// [역할 1] 외야 너머 아파트 (경기장 배경)
// 포수 뒤 시점에서 외야 너머가 허전하지 않도록 좌중간 쪽에 아파트 몇 채를 세웁니다.
// 낮 건물 + 밤 겹(불 켜진 창문) 노드 2개를 window.SCENE_MODELS에 등록하고,
// lighting.js가 시간대에 맞춰 밤 겹의 투명도를 바꿀 수 있도록 window.STADIUM_PARTS.apartments로 내보냅니다.
// 반드시 stadium_model.js 다음, lighting.js 앞에 불러야 함 (index.html 순서)
(function () {
  const { DEG, dir } = window.STADIUM_PARTS;

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
    const positions = [], normals = [], texCoords = [], indices = [];
    const addFace = (corners, normal, uvs) => {
      const start = positions.length / 3;
      corners.forEach((p, k) => { positions.push(...p); normals.push(...normal); texCoords.push(...uvs[k]); });
      indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    };
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
    return {
      positions: new Float32Array(positions), normals: new Float32Array(normals),
      texCoords: new Float32Array(texCoords), indices: new Uint16Array(indices),
    };
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

  const apartments = buildApartments();
  window.SCENE_MODELS.push(apartments.day, apartments.night);
  Object.assign(window.STADIUM_PARTS, { apartments }); // lighting.js가 밤 겹 투명도를 바꿈
})();
