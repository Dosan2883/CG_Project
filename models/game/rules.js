'use strict';

// [역할 3: 게임] 1/4 — 규칙 수치와 스트라이크존
// 1회 ~ 5회 야구 게임. 시작할 때 선공(회 초에 공격) / 후공(회 초에 수비)을 고릅니다.
//
// 규칙
//   투수: 스트라이크존 세로 3칸 중 하나를 골라 던짐
//   타자(나): "투구 받기" → 공이 날아올 때 타이밍에 맞춰 스윙(F 키 또는 버튼)
//     - 타이밍이 정확할수록 장타 (RULES.batting.windows), 많이 어긋나면 헛스윙 (무조건 스트라이크)
//     - 스윙하지 않으면 스트라이크 : 볼 = 55 : 45
//   타자(CPU): 3칸 중 하나에 휘두름 → 내가 던진 칸과 같으면 공을 침 (칸이 틀려도 10% 확률로 맞힘)
//     → 파울 : 1루타 : 2루타 : 홈런 = 1 : 0.7 : 0.5 : 0.15
//     - 안 휘두름 → 스트라이크 : 볼 = 55 : 45
//   4볼 → 타자 출루, 3스트라이크 → 1아웃, 3아웃 → 공수 교대
//   수비: 공이 필드로 가면(1·2루타) 수비 성공 : 실패 = 1 : 1 (성공하면 아웃). 홈런은 수비 불가
//   공을 치거나 타자가 아웃되면 함성 소리, 홈런이 나오면 전광판이 깜빡이고, 밤이면 경기장 조명도 깜빡임
//
// 게임 파일 4개 (index.html에서 이 순서대로 불러옴)
//   rules.js   : 규칙 수치(RULES), 난수, 스트라이크존 칸
//   effects.js : 3D 존 표시, 배트 스윙, 주자, 함성 소리, 홈런 전광판 쇼, 밤 홈런 조명 쇼, 타구 궤적
//   ui.js      : 점수판, 입력 버튼 패널, 알림 문구
//   game.js    : 경기 진행(볼카운트·아웃·진루·득점·공수 교대), CPU 두뇌, 입력 처리
// 파일끼리 공유하는 값은 window.GAME_CONTROLLER 한 곳에 모읍니다.
(function () {
  const G = (window.GAME_CONTROLLER = window.GAME_CONTROLLER ?? {});

  // ------------------------------------------------------------------
  // 1) 규칙 수치 (여기만 고치면 밸런스 조절)
  // ------------------------------------------------------------------
  const RULES = {
    innings: 5,
    takeOdds: { strike: 55, ball: 45 },                                  // 안 휘두를 때
    hitOdds: { foul: 1, single: 0.7, double: 0.5, homerun: 0.15 },     // 공을 쳤을 때
    defenseOdds: { success: 1, fail: 1 },                              // 1·2루타 타구 수비
    cpuExtraContactChance: 0.1,                                        // CPU 타자가 칸을 틀려도 공을 맞힐 확률
    cpuSwingChance: 0.6,                                             // CPU 타자가 휘두를 확률
    cpuReadChance: 0.3,                                                // CPU가 내 습관(자주 고른 칸)을 읽고 대응할 확률
    cpuReadMinSamples: 3,                                              // 습관을 읽기 시작하는 최소 기록 수

    // 내 타격 (타이밍): 공이 홈플레이트에 도착하는 순간에 맞춰 스윙 버튼(F)을 누름
    //   오차 = 배트가 공 위치를 지나는 시각 - 공이 도착하는 시각 (음수 = 빠름, 양수 = 늦음)
    //   오차가 within(초) 안이면 그 칸의 odds로 결과를 뽑음 (위에서부터 먼저 맞는 칸). 다 벗어나면 헛스윙
    //   odds의 strike = 타이밍은 근처였지만 헛스윙 → 무조건 스트라이크 (파울과 달리 2스트라이크에서도 삼진이 됨)
    batting: {
      windupMs: 700,             // "투구 받기"를 누른 뒤 투수가 던질 때까지 (밀리초)
      pitchTime: [0.55, 0.75],    // 공이 날아오는 시간(초) 범위: 투구마다 이 사이에서 무작위
      windows: [
        { key: 'perfect', label: '완벽한 타이밍!', within: 0.0175, odds: { foul: 20, single: 40, double: 20, homerun: 20 } },
        { key: 'good', label: '좋은 타이밍', within: 0.07, odds: { strike: 30, foul: 30, single: 30, double: 10 } },
        { key: 'edge', label: '아슬아슬', within: 0.18, odds: { strike: 50, foul: 37.5, single: 12.5 } },
      ],
    },
  };

  // ------------------------------------------------------------------
  // 2) 난수·시간 도우미
  //   테스트할 때 GAME_CONTROLLER.rng에 고정 함수를 넣으면 결과를 원하는 대로 만들 수 있음
  // ------------------------------------------------------------------
  const rand = () => (G.rng ?? Math.random)();
  const randInt = (n) => Math.floor(rand() * n);
  // odds = { 결과: 비율, ... } 중 하나를 비율대로 뽑음
  function weighted(odds) {
    const entries = Object.entries(odds);
    let r = rand() * entries.reduce((sum, [, w]) => sum + w, 0);
    for (const [key, w] of entries) {
      if ((r -= w) < 0) return key;
    }
    return entries[entries.length - 1][0];
  }
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  // 현재 시각(초). requestAnimationFrame의 timeSec과 같은 기준이라 프레임 시간과 바로 비교 가능
  const nowSec = () => performance.now() / 1000;

  // ------------------------------------------------------------------
  // 3) 스트라이크존: 타자 앞 세로 3칸 (칸 번호 0 = 맨 위)
  // ------------------------------------------------------------------
  const ZONE = { z: 0.2, width: 0.43, bottom: 0.45, top: 1.25, count: 3 };
  ZONE.cellH = (ZONE.top - ZONE.bottom) / ZONE.count;
  const ZONE_LABELS = ['높게', '가운데', '낮게'];
  const ZONES = Array.from({ length: ZONE.count }, (_, i) => ({
    label: ZONE_LABELS[i],
    target: [0, ZONE.top - ZONE.cellH * (i + 0.5), ZONE.z],
  }));

  // 세로 칸이라 좌우 반전이 없어서 버튼 번호 = 칸 번호
  const buttonToZone = (b) => b;
  const cellName = (zone) => `${zone + 1}번 칸(${ZONES[zone].label})`;

  // 볼 판정일 때 공이 도착할 곳: 고른 칸 높이에서 존 옆으로 살짝 빗나감
  //   맨 위 칸은 위로, 맨 아래 칸은 아래로 빠질 수도 있음. 공 반지름(0.12m)만큼 더 바깥이라 칸과 겹치지 않음
  const BALL_MISS = 0.17;
  function ballTarget(zone) {
    const t = [...ZONES[zone].target];
    const r = rand();
    if (zone === 0 && r < 0.5) t[1] = ZONE.top + BALL_MISS;
    else if (zone === ZONE.count - 1 && r < 0.5) t[1] = ZONE.bottom - BALL_MISS;
    else t[0] = (ZONE.width / 2 + BALL_MISS) * (rand() < 0.5 ? -1 : 1);
    return t;
  }

  // ------------------------------------------------------------------
  // 4) 팀: 게임 시작 때 로고로 고름. 덕진 Computers는 항상 선수비(후공), 완산 AIs는 선공
  // ------------------------------------------------------------------
  const TEAMS = {
    // color = 유니폼(몸통), cap = 모자, mark = 모자·가슴·전광판에 붙이는 엠블럼(C / A), markAspect = 엠블럼 가로 ÷ 세로
    deokjin: {
      name: '덕진 Computers', short: '덕진', logo: 'textures/team_deokjin.png', order: 'defense',
      color: [122, 33, 112], cap: [82, 22, 74], mark: 'textures/mark_deokjin.png', markAspect: 834 / 1173,
    },
    wansan: {
      name: '완산 AIs', short: '완산', logo: 'textures/team_wansan.webp', order: 'offense',
      color: [79, 149, 216], cap: [33, 96, 155], mark: 'textures/mark_wansan.png', markAspect: 886 / 1055,
    },
  };
  const DEFAULT_TEAM = 'deokjin'; // 10초 안에 고르지 않으면 이 팀
  const TEAM_PICK_SECONDS = 10;

  Object.assign(G, { TEAMS, DEFAULT_TEAM, TEAM_PICK_SECONDS, RULES, rand, randInt, weighted, wait, nowSec, ZONE, ZONES, buttonToZone, cellName, ballTarget });
})();
