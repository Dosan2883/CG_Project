'use strict';

// [역할 2: 투수 + 타자 계층 모델 및 모션 - 네모(Box) 배치 데모]
(function () {
  // 1) stadium_model.js에서 정의한 경기장 기준 좌표 가져오기 (없을 경우 기본값 대비)
  const info = window.STADIUM_INFO ?? {
    home: [0, 0, 0],
    rubber: [0, 0.34, -18.44],
  };

  // 네모(선수) 기본 크기: 가로(어깨너비) 0.6m, 높이(키) 1.8m, 두께(앞뒤) 0.4m
  const PLAYER_SIZE = [0.6, 1.8, 0.4];
  const HALF_HEIGHT = PLAYER_SIZE[1] / 2; // 0.9m (바닥면이 지면에 닿도록 중심을 올리는 값)

  // 2) 투수 자리 네모 노드 정의 (마운드 투수판 위)
  const pitcherNode = {
    id: 'pitcher_root',
    primitive: 'box',
    // 투수판(rubber) 위치: x = 0, y = 0.38 (마운드 높이 0.34 + 투수판 두께 0.04), z = -18.44
    position: [info.rubber[0], info.rubber[1] + 0.04, info.rubber[2]],
    rotation: [0, 0, 0], // 홈플레이트(+z 방향)를 정면으로 바라봄
    meshOffset: [0, HALF_HEIGHT, 0],
    meshScale: PLAYER_SIZE,
    color: [40, 100, 220], // 파란색 (투수)
    children: [],
  };

  // 3) 타자 자리 네모 노드 정의 (3루 쪽 우타석 박스 중앙)
  const batterNode = {
    id: 'batter_root',
    primitive: 'box',
    // 우타석 위치: x = -0.95 (타석 가로 중앙), y = 0.15 (타석 라인 높이), z = -0.2 (홈플레이트 옆)
    position: [-0.95, 0.15, -0.2],
    rotation: [0, Math.PI / 2, 0], // 홈플레이트(+x 방향)를 마주 보도록 Y축 90도 회전
    meshOffset: [0, HALF_HEIGHT, 0],
    meshScale: PLAYER_SIZE,
    color: [220, 60, 60], // 빨간색 (타자)
    children: [],
  };

  // 4) 야구공 노드 정의 (provided_sphere_data.js의 'sphere' 사용)
  const BALL_START = [0, 1.6, info.rubber[2] + 0.6]; // 투수 앞 손 높이 출발점
  const BALL_END = [0, 1, 0.2];                    // 홈플레이트 위 스트라이크존 도착점
  const ballNode = {
    id: 'baseball',
    primitive: 'sphere',
    position: [...BALL_START],
    rotation: [0, 0, 0],
    meshScale: 0.12, // 기본 구 반지름(1m)을 0.12배로 축소 (눈에 잘 보이는 크기)
    color: [255, 255, 255],
    visible: true,
  };

  // 5) 공통 렌더러(common/app.js)가 매 프레임 그리도록 전역 SCENE_MODELS에 투수·타자·공 함께 등록
  window.SCENE_MODELS = window.SCENE_MODELS ?? [];
  window.SCENE_MODELS.push(pitcherNode, batterNode, ballNode);

  // 6) Q 키 입력 시 공 비행 상태 제어
  const PITCH_DURATION = 0.55; // 투구 비행 시간 (초)
  const PITCH_ARC = 0.45;      // 포물선 최고점 추가 높이 (m)
  let isPitching = false;
  let pitchStart = 0;             // 투구 시작 시각 (초, performance.now 기준)
  let pitchTime = PITCH_DURATION; // 이번 투구의 비행 시간 (초)
  let pitchEnd = [...BALL_END]; // 이번 투구의 도착점 (game/game.js가 고른 칸)

  // target: 도착점 [x, y, z] (생략하면 기본 스트라이크존 중앙)
  // duration: 비행 시간(초, 생략하면 PITCH_DURATION). 타이밍 타격에서는 공 속도를 바꿔 가며 씀
  // Q 키 입력은 game/game.js에서 받아서, 고른 칸을 target으로 넘겨 호출합니다.
  function triggerPitch(target, duration = PITCH_DURATION) {
    isPitching = true;
    pitchStart = performance.now() / 1000;
    pitchTime = duration;
    pitchEnd = target ? [...target] : [...BALL_END];
    ballNode.position = [...BALL_START];
    ballNode.visible = true;
  }

  // 7) 매 프레임 공 위치 및 자전 업데이트 (common/app.js가 매 프레임 자동 호출)
  const prevUpdate = window.updateBaseballScene;
  window.updateBaseballScene = function (timeSec, dt) {
    if (typeof prevUpdate === 'function') prevUpdate(timeSec, dt);
    if (!isPitching) return;

    // 실제 시각 기준 진행률 (프레임이 끊겨도 정확히 pitchTime초 뒤에 도착 → 타이밍 판정과 맞음)
    const t = Math.min((performance.now() / 1000 - pitchStart) / pitchTime, 1); // 0.0(출발) ~ 1.0(도착) 진행률

    // 직선 보간(lerpVec3) + 포물선 높이(4 * t * (1 - t)) 결합
    const pos = lerpVec3(BALL_START, pitchEnd, t);
    pos[1] += 4 * t * (1 - t) * PITCH_ARC;
    ballNode.position = pos;

    // 날아가는 동안 공 자전 (X축 회전)
    ballNode.rotation[0] += dt * 35;

    // 홈플레이트 도착 완료 시 정지
    if (t >= 1) {
      isPitching = false;
    }
  };

  // 8) 다른 파일(game_controller.js 등)에서 참조 및 호출할 수 있도록 전역 객체로 노출
  window.PITCHER_BATTER = {
    pitcher: pitcherNode,
    batter: batterNode,
    ball: ballNode,
    triggerPitch,
    isPitching: () => isPitching,
    pitchDuration: PITCH_DURATION,
    ballStart: BALL_START,
  };
})();
