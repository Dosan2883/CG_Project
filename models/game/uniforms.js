'use strict';

// [역할 3: 게임] 유니폼 — 투수·타자에 팀 색, 모자, 엠블럼(텍스처 좌표로 붙이는 판)
//   pitcher_batter.js의 투수·타자(네모)는 건드리지 않고, children에 모자와 엠블럼 판만 덧붙입니다.
//   투수·타자는 로컬 +z가 몸 앞 (투수는 홈 쪽, 타자는 홈플레이트 쪽을 봄)
//   수비수·포수의 유니폼은 fielders.js의 setTeam이 맡습니다.
(function () {
  const G = window.GAME_CONTROLLER;
  const pb = window.PITCHER_BATTER;
  if (!G || !pb) return;

  // 엠블럼 판: 한 변 1인 사각형. 텍스처 좌표 (0,0) = 이미지 왼아래, (1,1) = 오른위 → 이미지 한 장이 판 전체에 붙음
  const DECAL_QUAD = {
    positions: new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    texCoords: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
  };

  // 투수·타자를 수비수(fielders.js의 makePerson)와 같은 모양으로: 몸통 네모 + 머리 구 + 모자 구
  //   pitcher_batter.js의 노드 위치·회전(투구·타격 동작)은 그대로 두고, 그 노드의 도형 크기만 몸통으로 바꾸고 머리·모자를 자식으로 붙임
  //   수비수와 같은 치수: 키 1.8 = 몸통 1.44 + 머리, 몸통 가로 0.55 · 두께 0.38
  const BODY = { width: 0.55, height: 1.44, depth: 0.38 };
  const HEAD_Y = BODY.height + 0.18;
  function dress(player, id) {
    player.meshScale = [BODY.width, BODY.height, BODY.depth];
    player.meshOffset = [0, BODY.height / 2, 0];
    const head = { id: `${id}_head`, primitive: 'sphere', position: [0, HEAD_Y, 0], meshScale: 0.17, color: [235, 195, 160] };
    const cap = { id: `${id}_cap`, primitive: 'sphere', position: [0, HEAD_Y + 0.07, 0], meshScale: [0.18, 0.1, 0.18], color: [80, 80, 80] };
    const decal = (part, position, height) => ({
      id: `${id}_${part}_logo`, primitive: DECAL_QUAD, position, meshScale: [height, height, 1], decalHeight: height,
      color: [255, 255, 255], blend: 'alpha', castShadow: false, visible: false,
    });
    // 엠블럼 뒤 흰 바탕(패치): 엠블럼이 유니폼과 같은 색이라 그냥 붙이면 잘 안 보임
    const patch = (part, position, size) => ({
      id: `${id}_${part}_patch`, primitive: DECAL_QUAD, position, meshScale: [size, size, 1],
      color: [245, 245, 245], castShadow: false, visible: false,
    });
    // 투수·타자는 몸 앞이 로컬 +z (수비수는 -z라서 판을 돌렸지만 여기서는 그대로)
    const chestY = BODY.height / 2 + BODY.height * 0.18, chestH = Math.min(BODY.width * 0.55, BODY.height * 0.35);
    const front = BODY.depth / 2;
    const chestLogo = decal('chest', [0, chestY, front + 0.006], chestH); // 가슴
    const capLogo = decal('cap', [0, HEAD_Y + 0.09, 0.19], 0.1);         // 모자 앞
    const patches = [patch('chest', [0, chestY, front + 0.003], chestH * 1.25), patch('cap', [0, HEAD_Y + 0.09, 0.187], 0.12)];
    player.children.push(head, cap, ...patches, chestLogo, capLogo);
    return { player, caps: [cap], decals: [chestLogo, capLogo], patches };
  }
  const pitcher = dress(pb.pitcher, 'pitcher');
  const batter = dress(pb.batter, 'batter');

  function wear(outfit, team) {
    outfit.player.color = team.color;
    for (const c of outfit.caps) c.color = team.cap;
    for (const p of outfit.patches) p.visible = true;
    for (const d of outfit.decals) {
      d.texture = team.mark;
      d.visible = true;
      d.meshScale = [d.decalHeight * team.markAspect, d.decalHeight, 1]; // 엠블럼 비율대로
    }
  }

  // 공격 팀 = 타자, 수비 팀 = 투수·포수·야수. 인자는 rules.js의 TEAMS 키 ('deokjin' | 'wansan')
  function dressTeams(battingKey, fieldingKey) {
    const bat = G.TEAMS[battingKey], field = G.TEAMS[fieldingKey];
    wear(batter, bat);
    wear(pitcher, field);
    window.FIELDERS?.setTeam(field);
  }

  G.dressTeams = dressTeams;
})();
