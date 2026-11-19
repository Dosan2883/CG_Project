'use strict';

// [역할 1: 경기장 + 카메라 + 조명]
// 초록색 네모(box)가 바닥에 납작하게 누워있는 예시 코드입니다.
const stadiumGroundModel = {
  id: 'stadium_root',
  children: [
    {
      id: 'grass_ground_box',
      primitive: 'box',
      position: [0, -0.05, 0], // 윗면이 y = 0에 오도록 배치
      meshScale: [60, 0.1, 60], // 가로·세로는 넓고 높이는 얇게 눌러 바닥에 누운 네모
      color: [46, 139, 87],     // 초록색 (RGB)
    },
  ],
};

window.SCENE_MODELS = window.SCENE_MODELS ?? [];
window.SCENE_MODELS.push(stadiumGroundModel);
