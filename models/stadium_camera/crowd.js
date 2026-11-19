'use strict';

// [역할 1] 관중
// 관중석 계단마다 막대 몸 + 동그란 머리 관중을 앉히고, 무리마다 다른 리듬으로 위아래로 들썩이게 합니다.
// 파일끼리 공유하는 값은 window.STADIUM_PARTS 한 곳에 모읍니다. (다른 팀원 코드와 이름 충돌 방지)
(function () {
  const { MeshBuilder, outwardDirections, bowlPath, BOWL_STAND, stadiumRoot } = window.STADIUM_PARTS;
  // ------------------------------------------------------------------
  // 관중: 막대 몸 + 동그란 머리. 관중석 계단 한 칸마다 앉아 있고, 각자 다른 리듬으로 위아래로 들썩임
  //   사람 수천 명을 노드 하나씩 만들면 draw 호출이 너무 많아지므로,
  //   관중을 CROWD_GROUPS개 무리로 나눠 무리마다 메시를 하나로 합칩니다. (무리 = 같은 움직임)
  //   옆 사람은 무작위로 다른 무리에 들어가기 때문에 바로 옆끼리도 움직임이 달라 보입니다.
  // ------------------------------------------------------------------
  const CROWD_GROUPS = 24;
  const SEAT_SPACING = 1.0;   // 한 줄 안에서 사람 간격 (m)
  const EMPTY_SEAT_RATE = 0.18;
  const SHIRT_COLORS = [
    [0.85, 0.15, 0.15], [0.15, 0.30, 0.75], [0.95, 0.95, 0.95], [0.95, 0.78, 0.15],
    [0.20, 0.55, 0.25], [0.12, 0.12, 0.14], [0.90, 0.45, 0.15], [0.55, 0.25, 0.60],
  ];
  const SKIN_COLORS = [[0.96, 0.80, 0.66], [0.85, 0.65, 0.48], [0.62, 0.44, 0.32]];

  // 항상 같은 배치가 나오도록 시드가 고정된 난수 (mulberry32)
  function seededRandom(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const random = seededRandom(20261119);
  const pick = (list) => list[Math.floor(random() * list.length)];

  // 경로를 따라 일정 간격으로 점과 바깥 방향을 뽑음 (경로 점 사이는 선형 보간)
  //   closed = true면 마지막 점 → 첫 점 구간까지 이어서 뽑음
  function samplePath(path, spacing, closed = false) {
    const outward = outwardDirections(path, closed);
    const count = path.length;
    const samples = [];
    let carry = spacing / 2;
    for (let i = 0; i < (closed ? count : count - 1); i++) {
      const j = (i + 1) % count;
      const a = path[i], b = path[j];
      const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
      for (let d = carry; d < len; d += spacing) {
        const t = d / len;
        const n = normalize(lerpVec3(outward[i], outward[j], t));
        samples.push({ p: lerpVec3(a, b, t), n });
      }
      carry = (carry - len) % spacing;
      if (carry < 0) carry += spacing;
    }
    return samples;
  }

  // 관중 한 명: 바닥 중심 base에 막대 몸(정사각 기둥) + 머리(낮은 다각형 구)
  const BODY_W = 0.28, BODY_H = 0.75, HEAD_R = 0.14;
  function addPerson(m, base, shirt, skin) {
    const [x, y, z] = base;
    const h = BODY_W / 2;
    const top = y + BODY_H;
    const c = [x, y + BODY_H / 2, z];
    const v = [
      [x - h, y, z - h], [x + h, y, z - h], [x + h, y, z + h], [x - h, y, z + h],
      [x - h, top, z - h], [x + h, top, z - h], [x + h, top, z + h], [x - h, top, z + h],
    ];
    const out = (face) => {
      const cx = face.reduce((s, p) => s + p[0], 0) / 4, cz = face.reduce((s, p) => s + p[2], 0) / 4;
      return [cx - c[0], 0, cz - c[2]];
    };
    m.quad(v[4], v[5], v[6], v[7], shirt, [0, 1, 0]);
    for (const face of [[v[0], v[1], v[5], v[4]], [v[1], v[2], v[6], v[5]], [v[2], v[3], v[7], v[6]], [v[3], v[0], v[4], v[7]]]) {
      m.quad(face[0], face[1], face[2], face[3], shirt, out(face));
    }

    // 머리: 위도 4칸 × 경도 6칸 구. 각 면의 법선은 머리 중심에서 바깥쪽
    const hc = [x, top + HEAD_R * 0.9, z];
    const P = (lat, lon) => [
      hc[0] + HEAD_R * Math.sin(lat) * Math.cos(lon),
      hc[1] + HEAD_R * Math.cos(lat),
      hc[2] + HEAD_R * Math.sin(lat) * Math.sin(lon),
    ];
    const LAT = 4, LON = 6;
    for (let i = 0; i < LAT; i++) {
      const la0 = (i / LAT) * Math.PI, la1 = ((i + 1) / LAT) * Math.PI;
      for (let j = 0; j < LON; j++) {
        const lo0 = (j / LON) * 2 * Math.PI, lo1 = ((j + 1) / LON) * 2 * Math.PI;
        const pts = i === 0 ? [P(la0, lo0), P(la1, lo0), P(la1, lo1)]
          : i === LAT - 1 ? [P(la0, lo0), P(la1, lo0), P(la0, lo1)]
          : [P(la0, lo0), P(la1, lo0), P(la1, lo1), P(la0, lo1)];
        const mid = pts.reduce((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length, s[2] + p[2] / pts.length], [0, 0, 0]);
        m.face(pts, skin, [mid[0] - hc[0], mid[1] - hc[1], mid[2] - hc[2]]);
      }
    }
  }

  // 관중석 한 구역(경로 + 계단 치수)에 관중을 앉힘. 사람마다 무작위 무리 번호를 받음
  function seatCrowd(builders, path, stand, closed = false) {
    for (let row = 0; row < stand.rows; row++) {
      const offset = (row + 0.5) * stand.depth;           // 좌석 단 가운데
      const seatY = stand.frontWall + row * stand.rise;   // 좌석 단 높이
      for (const { p, n } of samplePath(path, SEAT_SPACING, closed)) {
        if (random() < EMPTY_SEAT_RATE) continue;
        const jitter = (random() - 0.5) * 0.25;            // 줄 안에서 살짝 들쭉날쭉
        const t = [-n[2], 0, n[0]];                        // 경로 방향
        const base = [
          p[0] + n[0] * offset + t[0] * jitter,
          seatY,
          p[2] + n[2] * offset + t[2] * jitter,
        ];
        const group = Math.floor(random() * CROWD_GROUPS);
        addPerson(builders[group], base, pick(SHIRT_COLORS), pick(SKIN_COLORS));
      }
    }
  }

  // 무리마다 고유한 움직임: 주기·크기·시작 위치가 모두 다르고, 사인 두 개를 섞어 규칙적이지 않게
  const crowdGroups = [];
  function buildCrowd() {
    const builders = Array.from({ length: CROWD_GROUPS }, () => new MeshBuilder());
    seatCrowd(builders, bowlPath(), BOWL_STAND, true); // 경기장을 한 바퀴 도는 관중석

    const children = builders.map((m, i) => {
      const node = m.toNode(`stadium_crowd_${i}`, { position: [0, 0, 0] });
      for (const part of node.children) part.castShadow = false; // 그림자 패스 부담을 줄임
      crowdGroups.push({
        node,
        amplitude: 0.04 + random() * 0.08,          // 4 ~ 12cm
        speed: 2 * Math.PI * (0.35 + random() * 0.9), // 0.35 ~ 1.25회/초
        speed2: 2 * Math.PI * (0.9 + random() * 1.6),
        phase: random() * 2 * Math.PI,
        phase2: random() * 2 * Math.PI,
      });
      return node;
    });
    return { id: 'stadium_crowd', children };
  }

  // 매 프레임 무리마다 높이를 바꿈 (항상 0 이상이라 좌석 아래로 꺼지지 않음)
  function animateCrowd(timeSec) {
    for (const g of crowdGroups) {
      const wave = 0.65 * Math.sin(g.speed * timeSec + g.phase) + 0.35 * Math.sin(g.speed2 * timeSec + g.phase2);
      g.node.position[1] = g.amplitude * (0.5 + 0.5 * wave);
    }
  }
  function crowdLoop(nowMs) {
    animateCrowd(nowMs / 1000);
    requestAnimationFrame(crowdLoop);
  }
  requestAnimationFrame(crowdLoop);

  // 경기장 루트 노드에 관중을 붙임
  stadiumRoot.children.push(buildCrowd());

})();
