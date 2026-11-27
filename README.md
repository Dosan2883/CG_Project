# ⚾ 컴퓨터그래픽스 텀 프로젝트 — `common/` 엔진 사용 및 렌더링 가이드

이 문서는 [`common/`](file:///c:/Users/User/Desktop/공부/컴퓨터그래픽스/Term_Project/common) 공통 WebGL 엔진 코드를 기반으로, **팀원들이 WebGL 버퍼/셰이더 코드를 직접 건드리지 않고 모델 데이터만으로 3D 오브젝트를 그리고 애니메이션·카메라·조명을 제어하는 방법**을 정리한 가이드입니다.

---

## 1. 프로젝트 구조 및 `common/` 파일 역할

`common/` 폴더의 파일들은 초기 세팅이 완료된 **공통 렌더링 코어**입니다. 각 담당자는 [`models/`](file:///c:/Users/User/Desktop/공부/컴퓨터그래픽스/Term_Project/models) 폴더의 파일에서 모델 객체와 상태만 정의하면 [`common/app.js`](file:///c:/Users/User/Desktop/공부/컴퓨터그래픽스/Term_Project/common/app.js)가 자동으로 화면에 그립니다.

```text
Term_Project/
├── index.html                      # 캔버스(#glCanvas), 상태창(#status), 버튼 UI 및 스크립트 로드
├── textures/                       # 텍스처 이미지 폴더 (이미지 없어도 기본 RGB 색상으로 즉시 렌더링됨)
├── common/                         # [공통 엔진 코어 - 수정 불필요]
│   ├── style.css                   # 다크 테마, 캔버스, .controls 버튼 및 #status 레이아웃
│   ├── matrix.js                   # 4x4 행렬 변환 및 벡터 연산 유틸리티
│   ├── provided_sphere_data.js     # window.getProvidedSphere() - 구(Sphere) 정점/법선/UV/인덱스 데이터
│   ├── primitives.js               # window.getPrimitives() - sphere, box, plane, cylinder 기본 도형 생성기
│   └── app.js                      # 씬 그래프(SCENE_MODELS) 자동 순회 렌더링 및 애니메이션 루프, findNodeById 제공
└── models/                         # [팀원 작업 폴더]
    ├── stadium_camera.js           # [역할 1: 유기태] 경기장 모델 + 카메라 프리셋(버튼 3~10) + 낮/밤 조명(버튼 11)
    ├── pitcher_batter/             # [역할 2: 백경환] 투수·타자 계층 모델, 팀 유니폼, 투구·타격 모션
    │   ├── models.js
    │   ├── uniforms.js
    │   └── motion.js
    └── game_controller.js          # [역할 3: 오승재] 공 궤적 + 버튼 1~11 이벤트 연결 및 게임 로직
```

---

## 2. ⚠️ `index.html` 스크립트 로드 순서

[`common/app.js`](file:///c:/Users/User/Desktop/공부/컴퓨터그래픽스/Term_Project/common/app.js)는 로드되는 즉시 실행되면서 `identity()`(`matrix.js`)와 `window.getPrimitives()`(`primitives.js`)를 호출합니다.  
따라서 [`index.html`](file:///c:/Users/User/Desktop/공부/컴퓨터그래픽스/Term_Project/index.html)에서 **`common/app.js`보다 먼저 `matrix.js`, `provided_sphere_data.js`, `primitives.js`가 로드되어야 합니다.**

1. `common/matrix.js`
2. `common/provided_sphere_data.js`
3. `common/primitives.js`
4. `models/stadium_camera/`의 스크립트 → `models/pitcher_batter/models.js` → `uniforms.js` → `motion.js`
5. `models/fielders.js` → `models/game/`의 스크립트
6. `common/app.js`

브라우저의 Canvas에서 팀 색 텍스처를 합성할 수 있도록 프로젝트 폴더를 로컬 HTTP 서버로 열어 실행합니다.

---

## 3. 화면에 그리는 핵심 전역 인터페이스 4가지

[`common/app.js`](file:///c:/Users/User/Desktop/공부/컴퓨터그래픽스/Term_Project/common/app.js#L306-L328)의 `drawScene(timeSec)`은 매 프레임마다 아래 **4개의 전역(`window`) 항목**을 읽어서 화면을 갱신합니다.

| 전역 변수 / 함수 | 타입 | 역할 및 기본값 |
| --- | --- | --- |
| `window.SCENE_MODELS` | `Array<ModelNode>` | 화면에 그릴 최상위 루트 모델 노드들의 배열 |
| `window.ACTIVE_CAMERA` | `Object` | 현재 카메라 상태 `{ eye: [x,y,z], target: [x,y,z], up: [0,1,0], fov: Math.PI/4 }` |
| `window.ACTIVE_LIGHTING` | `Object` | 현재 조명 및 배경 상태 `{ skyColor: [r,g,b,a], ambientLight: [r,g,b], mainLightPos: [x,y,z], mainLightColor: [r,g,b] }` |
| `window.updateBaseballScene(timeSec, dt)` | `Function` | 매 프레임 렌더링 직전에 호출되는 콜백 (`timeSec`: 누적 초, `dt`: 이전 프레임과의 시간차 초) |

---

## 4. 모델 노드(Model Node) 속성 및 그리기 규칙

WebGL 버퍼(`gl.createBuffer`)나 드로우 콜(`gl.drawElements`)을 직접 호출할 필요 없이, 아래 속성을 가진 객체를 만들어 `window.SCENE_MODELS` 배열에 넣으면 렌더러가 트리를 순회하며 자동으로 그립니다.

### 4.1 모델 노드 속성 명세

| 속성명 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `id` | `string` | `undefined` | `findNodeById(rootNode, targetId)`로 특정 노드를 찾을 때 사용하는 식별자 |
| `visible` | `boolean` | `true` | `false`로 설정하면 자신과 모든 자식(`children`) 렌더링을 건너뜀 |
| `primitive` | `string \| Object` | `undefined` | `'box'`, `'sphere'`, `'plane'`, `'cylinder'` 또는 커스텀 정점 객체 (`{ positions, normals, texCoords, indices }`). 생략 시 화면에 그려지지 않는 순수 회전 관절(피벗) 노드로 동작 |
| `position` | `[x, y, z]` | `[0, 0, 0]` | **[자식에게 상속됨]** 부모 기준 관절 위치 |
| `rotation` | `[rx, ry, rz]` | `[0, 0, 0]` | **[자식에게 상속됨]** 관절 회전 각도(라디안, 적용 순서: `Y` → `X` → `Z`) |
| `scale` | `number \| [sx, sy, sz]` | `1` | **[자식에게 상속됨]** 자식 전체에 영향을 주는 스케일 |
| `meshOffset` | `[x, y, z]` | `[0, 0, 0]` | **[자식에게 상속 안 됨]** 관절(회전축) 위치에서 현재 도형 중심만 이동시킬 오프셋 |
| `meshScale` | `number \| [sx, sy, sz]` | `1` | **[자식에게 상속 안 됨]** 현재 도형의 실제 가로·세로·두께 크기 |
| `color` | `[R, G, B]` | `[200, 200, 200]` | 기본 색상 (`0 ~ 255` 정수 배열). 텍스처가 없거나 로딩 전일 때 표시됨 |
| `texture` | `string` | `undefined` | 텍스처 이미지 경로. 지정 시 자동으로 텍스처 생성 및 캐싱 |
| `emissive` | `boolean` | `false` | `true`이면 조명 계산을 무시하고 원래 색/텍스처 그대로 발광 (태양, 가로등 전구용) |
| `children` | `Array<ModelNode>` | `[]` | 자식 모델 노드 배열 (Transform Hierarchy) |

### 4.2 기본 제공 도형 (`primitive` 옵션) 및 기준 크기

[`common/primitives.js`](file:///c:/Users/User/Desktop/공부/컴퓨터그래픽스/Term_Project/common/primitives.js)와 [`common/provided_sphere_data.js`](file:///c:/Users/User/Desktop/공부/컴퓨터그래픽스/Term_Project/common/provided_sphere_data.js)에서 제공하는 기본 도형의 로컬 기준 크기입니다. **`meshScale`을 줄 때 이 기준 크기를 바탕으로 계산**합니다.

| `primitive` 이름 | 로컬 중심점 | 기본 크기 (`meshScale: 1` 기준) | 주요 활용처 |
| --- | --- | --- | --- |
| `'box'` | `(0, 0, 0)` | 가로 `1` × 세로 `1` × 두께 `1` (`-0.5 ~ +0.5`) | 캐릭터(몸통/팔/다리), 홈플레이트, 베이스, 담장, 폴대 |
| `'plane'` | `(0, 0, 0)` | XZ 평면 가로 `1` × 세로 `1` (`y = 0`, 법선 `+Y`) | 외야 잔디 바닥, 내야 흙 바닥 |
| `'cylinder'` | `(0, 0, 0)` | 반지름 `0.5` (지름 `1`), Y축 높이 `1` (`y: -0.5 ~ +0.5`) | 야구 배트, 파울 폴대, 가로등 기둥 |
| `'sphere'` | `(0, 0, 0)` | **반지름 `1.0` (지름 `2.0`, `-1.0 ~ +1.0`)** | 야구공, 선수 머리/손, 투수 마운드, 가로등 전구 |
| 커스텀 객체 | 직접 정의 | `{ positions, normals, texCoords, indices }` | 직접 생성한 특수 메쉬도 `primitive`에 바로 넣으면 자동 버퍼링됨 |

### 4.3 핵심 원리: `position`/`scale` vs `meshOffset`/`meshScale` 분리

계층 모델(몸통 → 어깨 → 팔꿈치 → 손 → 배트)을 만들 때의 핵심 규칙입니다.

1. **부모 도형의 모양을 직육면체 등으로 늘릴 때는 `meshScale`을 사용합니다.**
   - `scale`을 비균등하게 주면 자식 노드(팔, 배트 등)까지 함께 찌그러집니다.
   - `meshScale`을 사용하면 현재 도형의 크기만 바뀌고 자식 관절 좌표계에는 영향을 주지 않습니다.
2. **관절 끝점을 기준으로 회전시키려면 `meshOffset`을 사용합니다.**
   - 관절의 위치는 `position`으로 잡고, 도형의 중심은 `meshOffset`으로 절반만큼 이동시키면 관절 끝점을 회전축으로 자연스럽게 회전합니다.

---

## 5. `common/` 제공 유틸리티 함수 레퍼런스

### 5.1 트리 노드 검색 — [`common/app.js`](file:///c:/Users/User/Desktop/공부/컴퓨터그래픽스/Term_Project/common/app.js#L3-L12)
- `findNodeById(rootNode, targetId)`: 모델 트리(`rootNode`)에서 `id === targetId`인 노드를 재귀 탐색하여 반환합니다. 애니메이션 시 특정 관절을 찾아 `node.rotation`이나 `node.position`을 수정할 때 사용합니다.

### 5.2 행렬 및 벡터 함수 — [`common/matrix.js`](file:///c:/Users/User/Desktop/공부/컴퓨터그래픽스/Term_Project/common/matrix.js)
- **기본 행렬**: `identity()`, `multiply(a, b)`
- **이동/스케일**: `translation(x, y, z)`, `scaling(scale)`, `scalingXYZ(sx, sy, sz)`
- **회전 (라디안)**: `rotationX(angle)`, `rotationY(angle)`, `rotationZ(angle)`
- **카메라 투영/뷰**: `perspective(fieldOfView, aspect, near, far)`, `lookAt(eye, target, up)`
- **벡터 연산**: `dot(a, b)`, `cross(a, b)`, `normalize(vector)`
- **선형 보간**: `lerpVec3(a, b, t)` — 두 3차원 벡터 `a`, `b` 사이를 `t` (`0.0 ~ 1.0`) 비율로 보간합니다.

---
