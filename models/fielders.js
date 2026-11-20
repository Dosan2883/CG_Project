'use strict';

// [수비수 · 포수 · 심판]
// 투수(pitcher_batter.js)를 뺀 수비 8명(포수, 1·2·3루수, 유격수, 좌·중·우익수)과 주심을 만듭니다.
//   - 몸통(네모) + 머리(구)로 된 간단한 사람 모양
//   - 포수: 쪼그려 앉은 자세, 미트가 공이 오는 칸으로 움직임
//   - 심판: 포수 뒤에 서 있고, 스트라이크 때 오른팔을 들어 올림
//   - 타구가 나가면 가장 가까운 수비수가 공 떨어지는 곳으로 달려감
// game_controller.js가 window.FIELDERS를 통해 호출합니다.
(function () {
  const DEG = Math.PI / 180;
  const nowSec = () => performance.now() / 1000;
  const dirAt = (thetaDeg, r) => [Math.sin(thetaDeg * DEG) * r, 0, -Math.cos(thetaDeg * DEG) * r];
  // 홈플레이트를 바라보는 Y축 회전 (몸 앞 = 로컬 -z). rotationY(a)는 -z를 (-sin a, 0, -cos a)로 보냄
  const faceHome = (p) => Math.atan2(p[0], p[2]);

  // 사람 모양 노드: 발이 position(지면)에 닿도록 몸통·머리를 올림
  function makePerson(id, position, { color, height = 1.8, width = 0.55, depth = 0.38, crouch = false } = {}) {
    const bodyH = crouch ? 0.85 : height - 0.36;
    const bodyY = crouch ? 0.55 : bodyH / 2;
    const headY = crouch ? 1.1 : bodyH + 0.18;
    const body = { id: `${id}_body`, primitive: 'box', meshOffset: [0, bodyY, 0], meshScale: [width, bodyH, depth], color };
    const head = { id: `${id}_head`, primitive: 'sphere', position: [0, headY, 0], meshScale: 0.17, color: [235, 195, 160] };
    const cap = { id: `${id}_cap`, primitive: 'sphere', position: [0, headY + 0.07, 0], meshScale: [0.18, 0.1, 0.18], color };
    return {
      id,
      position: [...position],
      rotation: [0, faceHome(position), 0],
      children: [body, head, cap],
      body, cap,
    };
  }

  // ------------------------------------------------------------------
  // 1) 수비 위치 (홈 = 원점, -z = 중견수 쪽, +x = 1루 쪽)
  // ------------------------------------------------------------------
  const FIELD_SPOTS = [
    { key: 'first', name: '1루수', pos: dirAt(38, 30) },
    { key: 'second', name: '2루수', pos: dirAt(14, 37) },
    { key: 'short', name: '유격수', pos: dirAt(-14, 37) },
    { key: 'third', name: '3루수', pos: dirAt(-38, 30) },
    { key: 'left', name: '좌익수', pos: dirAt(-28, 76) },
    { key: 'center', name: '중견수', pos: dirAt(0, 84) },
    { key: 'right', name: '우익수', pos: dirAt(28, 76) },
  ];
  const fielders = FIELD_SPOTS.map((spot) => ({
    ...spot,
    node: makePerson(`fielder_${spot.key}`, spot.pos, { color: [40, 100, 220] }),
  }));

  // 포수: 홈플레이트 뒤에 쪼그려 앉음, 투수 쪽(-z)을 봄
  const catcher = makePerson('catcher', [0, 0, 1.15], { color: [40, 100, 220], crouch: true, width: 0.6, depth: 0.5 });
  catcher.rotation[1] = 0;
  const MITT_REST = [0, 0.85, 0.55];
  const mitt = { id: 'catcher_mitt', primitive: 'sphere', position: [...MITT_REST], meshScale: [0.13, 0.13, 0.07], color: [120, 70, 35] };

  // 주심: 포수 바로 뒤, 검은 옷. 오른팔(+x 쪽)은 어깨 관절에서 돌아감
  const umpire = makePerson('umpire', [0, 0, 2.05], { color: [25, 25, 30], height: 1.82 });
  umpire.rotation[1] = 0;
  umpire.cap.color = [15, 15, 18];
  const umpireArm = {
    id: 'umpire_arm',
    position: [0.33, 1.38, 0],
    rotation: [0, 0, 0],
    children: [{ id: 'umpire_arm_mesh', primitive: 'box', meshOffset: [0, -0.3, 0], meshScale: [0.13, 0.6, 0.13], color: [25, 25, 30] }],
  };
  umpire.children.push(umpireArm);

  window.SCENE_MODELS = window.SCENE_MODELS ?? [];
  window.SCENE_MODELS.push({ id: 'fielders_root', children: [...fielders.map((f) => f.node), catcher, mitt, umpire] });

  // ------------------------------------------------------------------
  // 2) 동작
  // ------------------------------------------------------------------
  let mittMove = null;   // { from, to, start, duration }
  let armRaise = null;   // { start }
  let chase = null;      // { fielder, from, to, start, duration, reach }

  // 수비 팀 색 (포수·야수 모두)
  function setTeamColor(color) {
    for (const f of [...fielders.map((x) => x.node), catcher]) {
      f.body.color = color;
      f.cap.color = color;
    }
  }

  // 포수 미트를 공이 오는 곳으로 (pitchDuration 동안 미리 움직임)
  function catchAt(target, duration = 0.45) {
    mittMove = { from: [...mitt.position], to: [target[0], target[1], 0.5], start: nowSec(), duration };
  }
  function resetMitt() {
    mittMove = { from: [...mitt.position], to: [...MITT_REST], start: nowSec(), duration: 0.4 };
  }

  // 심판 스트라이크 콜: 오른팔을 옆으로 번쩍 들었다 내림
  function callStrike() {
    armRaise = { start: nowSec() };
  }

  // 타구 쫓기: 공 떨어지는 곳에서 가장 가까운 야수가 달려감
  //   reach = true면 공이 떨어질 때 그 자리에 도착(잡음), false면 못 미침
  function chaseBall(landing, duration, reach) {
    resetFielders();
    let best = fielders[0];
    let bestDist = Infinity;
    for (const f of fielders) {
      const d = Math.hypot(f.pos[0] - landing[0], f.pos[2] - landing[2]);
      if (d < bestDist) { best = f; bestDist = d; }
    }
    const to = [landing[0], 0, landing[2]];
    chase = { fielder: best, from: [...best.pos], to, start: nowSec(), duration, reach };
    return best.name;
  }

  function resetFielders() {
    chase = null;
    for (const f of fielders) {
      f.node.position = [...f.pos];
      f.node.rotation[1] = faceHome(f.pos);
    }
  }

  function update() {
    const now = nowSec();
    if (mittMove) {
      const t = Math.min((now - mittMove.start) / mittMove.duration, 1);
      const e = t * t * (3 - 2 * t);
      mitt.position = lerpVec3(mittMove.from, mittMove.to, e);
      if (t >= 1) mittMove = null;
    }
    if (armRaise) {
      const t = now - armRaise.start;
      // 0.15초 만에 올리고, 0.7초 유지, 0.3초 동안 내림
      const up = t < 0.15 ? t / 0.15 : t < 0.85 ? 1 : Math.max(0, 1 - (t - 0.85) / 0.3);
      umpireArm.rotation[2] = up * 150 * DEG;
      if (t > 1.2) { armRaise = null; umpireArm.rotation[2] = 0; }
    }
    if (chase) {
      const { fielder, from, to, start, duration, reach } = chase;
      const t = Math.min((now - start) / duration, 1);
      const k = reach ? t : t * 0.55; // 못 잡는 경우 절반쯤만 따라감
      fielder.node.position = lerpVec3(from, to, k);
      if (Math.hypot(to[0] - from[0], to[2] - from[2]) > 0.5) {
        fielder.node.rotation[1] = Math.atan2(-(to[0] - from[0]), -(to[2] - from[2]));
      }
      // 달리는 동안 위아래로 살짝 흔들림
      fielder.node.position[1] = t < 1 ? Math.abs(Math.sin(now * 14)) * 0.12 : 0;
    }
  }

  const prevUpdate = window.updateBaseballScene;
  window.updateBaseballScene = function (timeSec, dt) {
    if (typeof prevUpdate === 'function') prevUpdate(timeSec, dt);
    update();
  };

  window.FIELDERS = { fielders, catcher, umpire, setTeamColor, catchAt, resetMitt, callStrike, chaseBall, resetFielders };
})();
