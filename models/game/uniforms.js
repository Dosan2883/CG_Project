'use strict';

// [역할 3: 게임] 공수 교대에 맞춰 유니폼을 위임하고 덕아웃을 배치한다.
(function () {
  const G = window.GAME_CONTROLLER;
  const pb = window.PITCHER_BATTER;
  if (!G || !pb) return;

  // 공격 팀 = 타자, 수비 팀 = 투수·포수·야수. 인자는 rules.js의 TEAMS 키 ('deokjin' | 'wansan')
  function dressTeams(battingKey, fieldingKey) {
    const bat = G.TEAMS[battingKey], field = G.TEAMS[fieldingKey];
    pb.applyTeamUniforms(bat, field);
    window.FIELDERS?.setTeam(field);
  }

  G.dressTeams = dressTeams;

  // ------------------------------------------------------------------
  // 덕아웃 위 팀 엠블럼: 네트 위 시점 기준 왼쪽(3루 쪽) = 덕진 C, 오른쪽(1루 쪽) = 완산 A
  //   덕아웃 위치·방향은 stadium_model.js와 같은 식으로 계산
  //     중심 = dir(s·FOUL) × 24 + dir(s·135°) × DUGOUT_OUT, Y축 회전 s·FOUL (s = +1 1루 쪽, −1 3루 쪽)
  //     DUGOUT_OUT = 파울 라인에서 덕아웃 중심까지 거리 (stadium_model.js가 STADIUM_INFO.dugoutOffset으로 알려 줌)
  //     덕아웃 상자는 바닥 기준 높이 2.2 + 지붕 0.2, 앞면(그라운드 쪽) = 로컬 −z
  //   엠블럼 판은 지붕 위에 눕혀서 붙임 (판 앞면이 하늘을 봄)
  //     X축 −90°: 판의 앞면 +z → 위(+y), 이미지 위쪽 +y → −z
  //     Y축 회전 = 덕아웃 회전(s·FOUL): 이미지 위쪽이 덕아웃 앞(그라운드 쪽)을 향함
  //       → 덕아웃 뒤 관중석에서 그라운드 쪽을 보며 내려다보면 글자가 똑바로 읽힘
  // ------------------------------------------------------------------
  const parts = window.STADIUM_PARTS;
  if (parts?.dir && parts.FOUL != null) {
    const DUGOUT_SIDES = [{ s: -1, team: 'deokjin' }, { s: 1, team: 'wansan' }];
    const DUGOUT_OUT = window.STADIUM_INFO?.dugoutOffset ?? 14.5;
    const SIGN_HEIGHT = 3.6;   // 엠블럼 세로 길이 (m) — 지붕 폭 4.4m 안에 들어가는 크기
    const ROOF_TOP = 2.4;      // 덕아웃 지붕 윗면 높이
    const signs = DUGOUT_SIDES.map(({ s, team }) => {
      const d = parts.dir(s * parts.FOUL), n = parts.dir(s * 135 * Math.PI / 180);
      const center = [d[0] * 24 + n[0] * DUGOUT_OUT, 0, d[2] * 24 + n[2] * DUGOUT_OUT];
      // 지붕 한가운데, 지붕 윗면보다 2cm 위 (지붕과 겹쳐 깜빡이지 않게)
      const position = [center[0], ROOF_TOP + 0.02, center[2]];
      const info = G.TEAMS[team];
      // 눕힌 뒤 이미지 위쪽(로컬 −z)을 덕아웃과 같이 s·FOUL만큼 돌림 → 덕아웃 앞(그라운드 쪽)을 향함
      const yaw = s * parts.FOUL;
      return {
        id: `dugout_sign_${team}`, primitive: G.QUAD, position, rotation: [-Math.PI / 2, yaw, 0],
        meshScale: [SIGN_HEIGHT * info.markAspect, SIGN_HEIGHT, 1],
        color: [255, 255, 255], texture: info.mark, blend: 'alpha', castShadow: false,
      };
    });
    window.SCENE_MODELS = window.SCENE_MODELS ?? [];
    window.SCENE_MODELS.push({ id: 'dugout_signs', children: signs });

    // ------------------------------------------------------------------
    // 덕아웃 앞 벤치 선수와 감독
    //   공격 팀: 타자·주자를 뺀 나머지 선수(8 − 주자 수)가 자기 팀 덕아웃 앞에 한 줄로 서 있음
    //   수비 팀: 선수는 모두 그라운드에 있으므로 덕아웃에는 감독만
    //   감독: 공수 상관없이 항상 자기 팀 덕아웃의 홈플레이트 쪽 끝에 있음 (팀 모자 + 어두운 점퍼)
    //   덕아웃 로컬 좌표 (x = 길이 방향, z = 앞뒤, 앞 = −z) → 월드: Y축으로 s·FOUL 돌리고 덕아웃 중심으로 이동
    // ------------------------------------------------------------------
    const F = window.FIELDERS;
    if (F?.makePerson) {
      const BENCH_SIZE = 8;               // 9명 중 타자를 뺀 인원
      const BENCH_Z = -2.6;               // 덕아웃 앞 (덕아웃 깊이 4m → 앞면 z = −2)
      const MANAGER_JACKET = [45, 45, 55];
      const benches = {};
      const managers = [];
      for (const { s, team } of DUGOUT_SIDES) {
        const d = parts.dir(s * parts.FOUL), n = parts.dir(s * 135 * Math.PI / 180);
        const center = [d[0] * 24 + n[0] * DUGOUT_OUT, 0, d[2] * 24 + n[2] * DUGOUT_OUT];
        const yaw = s * parts.FOUL;
        const toWorld = (x, z) => [center[0] + Math.cos(yaw) * x + Math.sin(yaw) * z, 0, center[2] - Math.sin(yaw) * x + Math.cos(yaw) * z];
        const info = G.TEAMS[team];
        const homeEnd = -s; // 덕아웃 길이 방향 중 홈플레이트 쪽 끝 (1루 쪽은 −x, 3루 쪽은 +x)

        benches[team] = Array.from({ length: BENCH_SIZE }, (_, i) => {
          // 홈플레이트 쪽부터 차례로 (주자가 나가면 바깥쪽부터 비게)
          const x = homeEnd * (4.9 - i * 1.4);
          const person = F.makePerson(`bench_${team}_${i}`, toWorld(x, BENCH_Z), { logo: true });
          person.rotation = [0, yaw, 0]; // 그라운드 쪽을 봄
          person.visible = false;
          F.wearTeam(person, info);
          return person;
        });

        const manager = F.makePerson(`manager_${team}`, toWorld(homeEnd * 6.4, BENCH_Z - 0.5), { logo: true });
        manager.rotation = [0, yaw, 0];
        F.wearTeam(manager, info, MANAGER_JACKET);
        managers.push(manager);
      }
      window.SCENE_MODELS.push({ id: 'dugout_people', children: [...managers, ...Object.values(benches).flat()] });

      // ui.js의 render가 부름: 공격 중인 팀의 덕아웃에만 벤치 선수를 보여 줌
      G.updateBench = (state) => {
        const battingKey = state.choosing || state.over ? null : G.battingTeamKey?.();
        const runners = (state.bases ?? []).filter(Boolean).length;
        for (const [team, people] of Object.entries(benches)) {
          const count = team === battingKey ? BENCH_SIZE - runners : 0;
          people.forEach((person, i) => { person.visible = i < count; });
        }
      };
    }
  }
})();
