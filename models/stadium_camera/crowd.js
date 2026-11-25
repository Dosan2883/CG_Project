'use strict';

// [역할 1] 관중
// 관중석 계단마다 저폴리곤 관중을 앉히고, 무리마다 다른 리듬으로 위아래로 들썩이게 합니다.
// 파일끼리 공유하는 값은 window.STADIUM_PARTS 한 곳에 모읍니다. (다른 팀원 코드와 이름 충돌 방지)
(function () {
  const { MeshBuilder, outwardDirections, bowlPath, BOWL_STAND, stadiumRoot, onFrame } = window.STADIUM_PARTS;
  // ------------------------------------------------------------------
  // 관중: 관중석 계단 한 칸마다 앉아 있고, 각자 다른 리듬으로 위아래로 들썩임
  //   사람 수천 명을 노드 하나씩 만들면 draw 호출이 너무 많아지므로,
  //   관중을 CROWD_GROUPS개 무리로 나눠 무리마다 메시를 하나로 합칩니다. (무리 = 같은 움직임)
  //   옆 사람은 무작위로 다른 무리에 들어가기 때문에 바로 옆끼리도 움직임이 달라 보입니다.
  // ------------------------------------------------------------------
  const CROWD_GROUPS = 12;
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

  // 몸과 머리는 각각 바닥면을 뺀 상자입니다.
  const BODY_H = 0.75;
  const BODY_SIZE = [0.28, BODY_H, 0.28];
  const HEAD_SIZE = [0.238, 0.238, 0.238];
  const OPEN_BOX = { bottom: false };
  function addPerson(m, base, shirt, skin) {
    const [x, y, z] = base;
    m.box(base, BODY_SIZE, shirt, OPEN_BOX);
    m.box([x, y + BODY_H + 0.02, z], HEAD_SIZE, skin, OPEN_BOX);
  }

  // 관중석 한 구역(경로 + 계단 치수)에 관중을 앉힘. 사람마다 무작위 무리 번호를 받음
  function seatCrowd(builders, path, stand, closed = false) {
    const seats = samplePath(path, SEAT_SPACING, closed);
    for (let row = 0; row < stand.rows; row++) {
      const offset = (row + 0.5) * stand.depth;           // 좌석 단 가운데
      const seatY = stand.frontWall + row * stand.rise;   // 좌석 단 높이
      for (const { p, n } of seats) {
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
    const builders = Array.from({ length: CROWD_GROUPS }, () => {
      const m = new MeshBuilder();
      m.castShadow = false; // 관중은 그림자를 만들지 않음 (매 프레임 움직여 그림자 캐시를 깨지 않도록)
      return m;
    });
    seatCrowd(builders, bowlPath(), BOWL_STAND, true); // 경기장을 한 바퀴 도는 관중석

    const children = builders.map((m, i) => {
      const node = m.toNode(`stadium_crowd_${i}`, { position: [0, 0, 0] });
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
  // 경기장 루트 노드에 관중을 붙임
  stadiumRoot.children.push(buildCrowd());
  onFrame(animateCrowd);

})();
