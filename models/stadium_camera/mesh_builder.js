'use strict';

// [역할 1] 경기장 공통 상수 + MeshBuilder
//
// models/stadium_camera/ 폴더 파일 (index.html에서 이 순서로 불러옴)
//   1) mesh_builder.js   공통 상수·색·도우미 + MeshBuilder
//   2) stadium_model.js  경기장 모양(한 바퀴 도는 원형 관중석·외벽·지붕) + 노드 트리 조립 → window.SCENE_MODELS
//   3) crowd.js          관중 배치 + 들썩임 애니메이션
//   4) lighting.js       시간대 조명(태양·하늘·경기장 조명) + 슬라이더·버튼 11
//   5) camera.js         궤도 카메라 + 시점 버튼 3~6
//
// 좌표계·단위 (팀 공통으로 맞추면 좋은 값)
//   - 단위: m (실제 야구장 규격)
//   - y 위쪽, 홈플레이트 = 원점, 중견수 방향 = -z, 1루 방향 = +x
//   - 투수판 = (0, 0.34, -18.44), 1루 = (19.4, 0, -19.4), 2루 = (0, 0, -38.8), 3루 = (-19.4, 0, -19.4)
//
// common/app.js 엔진 규칙에 맞춘 점
//   1) 노드 하나당 색이 하나 → 색이 여러 개인 메시(그라운드·관중석)는 색별로 메시를 나눠 자식 노드로 넣음
//   2) 커스텀 메시는 { positions, normals, texCoords, indices } 형식 → texCoords도 채워 넣음 (단색이라 값은 0)
//   3) 셰이더가 뒷면을 따로 처리하지 않음 → 법선이 보이는 쪽(위·그라운드 쪽)을 향하도록 방향을 맞춤
//
// 파일끼리 공유하는 값은 window.STADIUM_PARTS 한 곳에 모읍니다. (다른 팀원 코드와 이름 충돌 방지)
(function () {
  const BASE_DIST = 27.43;   // 베이스 간 거리 (90ft)
  const MOUND_DIST = 18.44;  // 홈 ~ 투수판 (60ft 6in)
  const DEG = Math.PI / 180;
  const FOUL = 45 * DEG;     // 파울 라인 각도 (중견수 방향 기준 ±45°)
  const FIELD_CENTER = [0, 0, -40]; // 벽 법선을 그라운드 쪽으로 맞출 때 기준점

  const frameUpdaters = [];
  function onFrame(update, { first = false } = {}) {
    if (first) frameUpdaters.unshift(update);
    else frameUpdaters.push(update);
  }
  function updateFrame(timeSec, dt) {
    const clampedDt = Math.min(dt, 0.1);
    for (const update of frameUpdaters) update(timeSec, clampedDt);
  }

  // 색은 0~1로 적고, 노드에 넣을 때 0~255로 바꿉니다.
  const COLORS = {
    groundGrass: [0.20, 0.45, 0.20],
    grassA: [0.24, 0.56, 0.24],
    grassB: [0.29, 0.63, 0.28],
    infieldGrass: [0.27, 0.60, 0.26],
    dirt: [0.70, 0.49, 0.31],
    track: [0.58, 0.40, 0.27],
    mound: [0.74, 0.52, 0.33],
    white: [0.96, 0.96, 0.94],
    fence: [0.12, 0.32, 0.24],
    fenceTop: [0.95, 0.80, 0.15],
    pole: [0.98, 0.84, 0.10],
    seatA: [0.20, 0.38, 0.70],
    seatB: [0.25, 0.46, 0.80],
    outSeatA: [0.70, 0.22, 0.20],
    outSeatB: [0.80, 0.28, 0.24],
    concrete: [0.62, 0.62, 0.64],
    wall: [0.14, 0.24, 0.20],
    dugout: [0.25, 0.27, 0.30],
    dugoutDark: [0.08, 0.08, 0.10],
    roof: [0.60, 0.15, 0.15],
    board: [0.10, 0.10, 0.12],
    boardFace: [0.15, 0.35, 0.20],
    towerPole: [0.55, 0.57, 0.60],
    towerFrame: [0.22, 0.23, 0.26],
    lamp: [1.00, 0.97, 0.86],
    roofTop: [0.30, 0.45, 0.75],    // 사진의 파란 지붕
    roofTop2: [0.42, 0.58, 0.86],   // 지붕 앞쪽 밝은 띠
    roofUnder: [0.78, 0.80, 0.84],
    roofEdge: [0.88, 0.89, 0.91],
    facadeGlass: [0.20, 0.27, 0.36],
    facadeWindow: [0.86, 0.58, 0.36], // 따뜻한 색 창 (사진의 불 켜진 콘코스)
    facadeBanner: [0.72, 0.18, 0.18],
  };
  const rgb255 = (c) => c.map((v) => Math.round(v * 255));

  // 중견수 방향 기준 각도 θ의 수평 방향 벡터 (θ>0 → 1루/우익 쪽)
  function dir(theta) {
    return [Math.sin(theta), 0, -Math.cos(theta)];
  }

  // 외야 펜스까지의 거리: 좌우 폴 100m, 중앙 122m
  function fenceRadius(theta) {
    return 100 + 22 * Math.cos(2 * theta);
  }

  // 수평 경로의 각 점에서 접선에 수직이면서 경기장 바깥(FIELD_CENTER 반대)을 향하는 방향
  //   closed = true면 닫힌 경로(마지막 점 다음이 첫 점)로 보고 양 끝도 이웃을 이어서 계산
  function outwardDirections(points, closed = false) {
    const count = points.length;
    return points.map((p, i) => {
      const a = closed ? points[(i - 1 + count) % count] : points[Math.max(i - 1, 0)];
      const b = closed ? points[(i + 1) % count] : points[Math.min(i + 1, count - 1)];
      let n = normalize([-(b[2] - a[2]), 0, b[0] - a[0]]);
      if (n[0] * (p[0] - FIELD_CENTER[0]) + n[2] * (p[2] - FIELD_CENTER[2]) < 0) n = n.map((x) => -x);
      return n;
    });
  }

  // 밤에 스스로 빛나게(emissive) 할 노드들과, 밤 조명(점광원)으로 쓸 위치들
  const GLOW_COLORS = new Set(['lamp', 'facadeWindow', 'boardFace']);
  const glowNodes = [];
  const towerLightPositions = [];
  const roofLightPositions = [];
  const roofFixtures = [];
  // 재질별 정반사광 (Blinn-Phong): specular = 반사 세기, shininess = 광택 (클수록 하이라이트가 작고 날카로움)
  //   잔디·흙처럼 거친 면은 넣지 않음 (정반사 없음)
  //   해가 멀리 있어 평평한 면은 반사 각도가 거의 같으므로, 광택을 낮게(넓은 하이라이트) 잡아야 눈에 보입니다.
  const MATERIALS = {
    facadeGlass: { specular: 1.4, shininess: 48 },  // 유리: 가장 반짝임
    boardFace: { specular: 1.0, shininess: 40 },    // 전광판 화면
    towerPole: { specular: 1.2, shininess: 32 },    // 금속 기둥
    pole: { specular: 1.0, shininess: 32 },         // 파울 폴 (도장 금속)
    roofTop: { specular: 1.5, shininess: 28 },      // 지붕 패널 (금속 골판)
    roofTop2: { specular: 1.5, shininess: 28 },
    fenceTop: { specular: 0.8, shininess: 24 },
    board: { specular: 0.8, shininess: 24 },
    towerFrame: { specular: 0.7, shininess: 20 },
    seatA: { specular: 0.6, shininess: 24 },        // 플라스틱 좌석
    seatB: { specular: 0.6, shininess: 24 },
    outSeatA: { specular: 0.6, shininess: 24 },
    outSeatB: { specular: 0.6, shininess: 24 },
    roof: { specular: 0.7, shininess: 20 },         // 더그아웃 지붕
    roofEdge: { specular: 0.6, shininess: 16 },
    white: { specular: 0.5, shininess: 16 },        // 베이스·홈플레이트·투수판·라인
    dugout: { specular: 0.4, shininess: 12 },
    fence: { specular: 0.4, shininess: 12 },
    roofUnder: { specular: 0.25, shininess: 10 },
    concrete: { specular: 0.12, shininess: 8 },
  };

  // 색으로 노드의 성질을 정함: 밤에 빛날 색이면 glowNodes에 등록, 재질 표에 있으면 specular·shininess 지정
  function applyColorTraits(node, color) {
    for (const name of Object.keys(COLORS)) {
      if (COLORS[name] !== color) continue;
      if (GLOW_COLORS.has(name)) glowNodes.push(node);
      if (MATERIALS[name]) Object.assign(node, MATERIALS[name]);
      break;
    }
    return node;
  }

  // ------------------------------------------------------------------
  // 메시 빌더: 면을 추가하면 색별로 따로 쌓았다가, build()에서 색마다 메시 하나씩 반환
  // ------------------------------------------------------------------
  // 공통 'box' 도형과 같은 면 순서와 삼각형 분할을 사용합니다. 마지막 면은 바닥입니다.
  const BOX_FACES = [
    [[3, 2, 6, 7], [0, 0, 1]], [[1, 0, 4, 5], [0, 0, -1]],
    [[7, 6, 5, 4], [0, 1, 0]], [[2, 1, 5, 6], [1, 0, 0]],
    [[0, 3, 7, 4], [-1, 0, 0]], [[0, 1, 2, 3], [0, -1, 0]],
  ];

  class MeshBuilder {
    constructor() {
      this.groups = new Map(); // 색과 그림자 생성 여부가 같은 면끼리 묶음
      this.castShadow = true;
    }

    group(color) {
      const key = `${color.join(',')}|${this.castShadow}`;
      if (!this.groups.has(key)) {
        this.groups.set(key, { color, castShadow: this.castShadow, positions: [], normals: [], indices: [] });
      }
      return this.groups.get(key);
    }

    // 같은 평면 위의 볼록 다각형을 면 하나로 추가합니다.
    // hint: 법선이 향해야 할 쪽. 생략하면 수평면은 위(+y), 벽은 그라운드 중심 쪽을 향하게 합니다.
    face(points, color, hint) {
      const [a, b, c] = points;
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      let n = normalize(cross(u, v));

      let ref = hint;
      if (!ref) {
        if (Math.abs(n[1]) > 0.5) {
          ref = [0, 1, 0];
        } else {
          const cx = points.reduce((sum, p) => sum + p[0], 0) / points.length;
          const cz = points.reduce((sum, p) => sum + p[2], 0) / points.length;
          ref = [FIELD_CENTER[0] - cx, 0, FIELD_CENTER[2] - cz];
        }
      }
      if (dot(n, ref) < 0) n = n.map((x) => -x);
      this.appendFace(points, this.group(color), n);
    }

    appendFace(points, g, normal) {
      const start = g.positions.length / 3;
      for (const p of points) {
        g.positions.push(p[0], p[1], p[2]);
        g.normals.push(normal[0], normal[1], normal[2]);
      }
      // 부채꼴(fan) 방식으로 삼각형 분할: (0,1,2), (0,2,3), ...
      for (let i = 1; i < points.length - 1; i++) {
        g.indices.push(start, start + i, start + i + 1);
      }
    }

    tri(a, b, c, color, hint) {
      this.face([a, b, c], color, hint);
    }

    quad(a, b, c, d, color, hint) {
      this.face([a, b, c, d], color, hint);
    }

    // 바닥 중심 기준 상자. transform에는 회전과 이동만 들어갑니다.
    box([x, y, z], [width, height, depth], color, { transform, bottom = true } = {}) {
      const left = x - width / 2, right = x + width / 2;
      const back = z - depth / 2, front = z + depth / 2;
      const top = y + height;
      const corners = [
        [left, y, back], [right, y, back], [right, y, front], [left, y, front],
        [left, top, back], [right, top, back], [right, top, front], [left, top, front],
      ];
      const rotate = ([vx, vy, vz]) => [
        transform[0] * vx + transform[4] * vy + transform[8] * vz,
        transform[1] * vx + transform[5] * vy + transform[9] * vz,
        transform[2] * vx + transform[6] * vy + transform[10] * vz,
      ];
      const points = transform ? corners.map((point) => {
        const [px, py, pz] = rotate(point);
        return [px + transform[12], py + transform[13], pz + transform[14]];
      }) : corners;
      const faceCount = bottom ? BOX_FACES.length : BOX_FACES.length - 1;
      const group = this.group(color);
      for (let i = 0; i < faceCount; i++) {
        const [indices, normal] = BOX_FACES[i];
        this.appendFace(indices.map((index) => points[index]), group, transform ? rotate(normal) : normal);
      }
    }

    // 홈플레이트를 꼭짓점으로 하는 부채꼴 바닥 : rOut(θ) 바깥 반지름, rIn(θ) 안쪽 반지름
    fan(th0, th1, segments, rOut, rIn, y, colorFn) {
      for (let i = 0; i < segments; i++) {
        const ta = th0 + (th1 - th0) * (i / segments);
        const tb = th0 + (th1 - th0) * ((i + 1) / segments);
        const da = dir(ta), db = dir(tb);
        const ra = rOut(ta), rb = rOut(tb);
        const oa = [da[0] * ra, y, da[2] * ra];
        const ob = [db[0] * rb, y, db[2] * rb];
        const color = colorFn(i);
        if (!rIn) {
          this.tri([0, y, 0], oa, ob, color);
        } else {
          const ia = rIn(ta), ib = rIn(tb);
          this.quad([da[0] * ia, y, da[2] * ia], oa, ob, [db[0] * ib, y, db[2] * ib], color);
        }
      }
    }

    // 수평 원판
    disc(cx, cz, radius, y, color, segments = 40) {
      for (let i = 0; i < segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        const b = ((i + 1) / segments) * Math.PI * 2;
        this.tri([cx, y, cz],
          [cx + Math.cos(a) * radius, y, cz + Math.sin(a) * radius],
          [cx + Math.cos(b) * radius, y, cz + Math.sin(b) * radius], color);
      }
    }

    // 수평 링 (흰색 원 라인)
    ring(cx, cz, rIn, rOut, y, color, segments = 40) {
      for (let i = 0; i < segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        const b = ((i + 1) / segments) * Math.PI * 2;
        this.quad(
          [cx + Math.cos(a) * rIn, y, cz + Math.sin(a) * rIn],
          [cx + Math.cos(a) * rOut, y, cz + Math.sin(a) * rOut],
          [cx + Math.cos(b) * rOut, y, cz + Math.sin(b) * rOut],
          [cx + Math.cos(b) * rIn, y, cz + Math.sin(b) * rIn], color);
      }
    }

    // 두 점 사이의 얇은 띠 (라인 페인트)
    strip(p0, p1, width, y, color) {
      const dx = p1[0] - p0[0], dz = p1[2] - p0[2];
      const len = Math.hypot(dx, dz);
      const nx = (-dz / len) * width / 2, nz = (dx / len) * width / 2;
      this.quad(
        [p0[0] + nx, y, p0[2] + nz], [p1[0] + nx, y, p1[2] + nz],
        [p1[0] - nx, y, p1[2] - nz], [p0[0] - nx, y, p0[2] - nz], color);
    }

    // 수평 경로(points)를 따라 2D 단면(profile: [바깥 방향 오프셋, 높이, 색])을 밀어내기
    //   closed = true면 닫힌 고리: 마지막 점과 첫 점도 이어 붙이고, 양 끝 막는 면은 만들지 않음
    extrudeAlong(points, profile, closed = false) {
      const outward = outwardDirections(points, closed);
      const count = points.length;
      const at = (i, k) => {
        const p = points[i], n = outward[i], [off, h] = profile[k];
        return [p[0] + n[0] * off, h, p[2] + n[2] * off];
      };
      for (let i = 0; i < (closed ? count : count - 1); i++) {
        const j = (i + 1) % count;
        for (let k = 0; k < profile.length - 1; k++) {
          const dh = profile[k + 1][1] - profile[k][1];
          // 올라가는 수직면(앞벽·단 높이)은 그라운드 쪽, 내려가는 면(뒷벽)은 바깥쪽, 수평면은 위
          let hint = [0, 1, 0];
          if (dh > 0) hint = outward[i].map((x) => -x);
          if (dh < 0) hint = outward[i];
          // 단면 점의 4번째 값으로 법선 방향을 직접 지정 가능 (기울어진 지붕 등)
          const mode = profile[k + 1][3];
          if (mode === 'up') hint = [0, 1, 0];
          if (mode === 'down') hint = [0, -1, 0];
          if (mode === 'in') hint = outward[i].map((x) => -x);
          if (mode === 'out') hint = outward[i];
          this.quad(at(i, k), at(i, k + 1), at(j, k + 1), at(j, k), profile[k + 1][2], hint);
        }
      }
      if (closed) return;
      // 양 끝 단면 막기: 수평 구간마다 바닥까지 내려오는 사각형 (법선 = 경로 바깥 방향)
      const last = points.length - 1;
      const ends = [
        [0, [points[0][0] - points[1][0], 0, points[0][2] - points[1][2]]],
        [last, [points[last][0] - points[last - 1][0], 0, points[last][2] - points[last - 1][2]]],
      ];
      for (const [i, hint] of ends) {
        for (let k = 0; k < profile.length - 1; k++) {
          const a = at(i, k), b = at(i, k + 1);
          if (Math.abs(a[1] - b[1]) < 1e-6) {
            this.quad([a[0], 0, a[2]], [b[0], 0, b[2]], b, a, COLORS.concrete, hint);
          }
        }
      }
    }

    // 색과 그림자 생성 여부별 엔진용 메시
    build() {
      return [...this.groups.values()].map((g) => ({
        color: g.color,
        castShadow: g.castShadow,
        mesh: {
          positions: new Float32Array(g.positions),
          normals: new Float32Array(g.normals),
          texCoords: new Float32Array((g.positions.length / 3) * 2), // 단색 텍스처라 UV는 0
          indices: g.positions.length / 3 > 65535 ? new Uint32Array(g.indices) : new Uint16Array(g.indices),
        },
      }));
    }

    // 엔진에 넣을 노드: 색별 메시를 자식으로 가진 그룹 노드
    toNode(id, extra = {}) {
      return {
        id,
        ...extra,
        children: this.build().map((part, i) => applyColorTraits({
          id: `${id}_part${i}`,
          primitive: part.mesh,
          color: rgb255(part.color),
          castShadow: part.castShadow,
        }, part.color)),
      };
    }
  }

  window.STADIUM_PARTS = {
    BASE_DIST, MOUND_DIST, DEG, FOUL, FIELD_CENTER, COLORS, rgb255, dir, fenceRadius,
    outwardDirections, glowNodes, towerLightPositions, roofLightPositions, roofFixtures,
    onFrame, updateFrame, MeshBuilder,
  };
})();
