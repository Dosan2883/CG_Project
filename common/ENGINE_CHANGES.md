# 공통 엔진(`common/app.js`) 변경 사항

역할 1(경기장·카메라·조명) 작업 중에 공통 엔진에 기능을 추가했습니다.
**기존 코드는 그대로 동작합니다.** 새 기능은 모두 "값을 주면 켜지고, 안 주면 예전과 같게" 만들었습니다.

| 추가 기능 | 켜는 방법 | 안 쓰면 |
|---|---|---|
| 1. 그림자 (shadow mapping) | `ACTIVE_LIGHTING.shadow` | 그림자 없음 (예전과 같음) |
| 2. 보조 점광원 여러 개 | `ACTIVE_LIGHTING.pointLights` | 주 광원 1개만 (예전과 같음) |
| 3. 정반사광 (Blinn-Phong specular) | 노드의 `specular`, `shininess` | 정반사 없음 (예전과 같음) |
| 4. 안개 (fog) | `ACTIVE_LIGHTING.fog` | 안개 없음 (예전과 같음) |
| 5. 카메라 near / far 설정 | `ACTIVE_CAMERA.near`, `ACTIVE_CAMERA.far` | 0.1 / 200 (예전과 같음) |
| 6. 반투명 · 빛 번짐 (alpha blending) | 노드의 `blend`, `opacity` | 불투명 (예전과 같음) |

`matrix.js`, `primitives.js`, `provided_sphere_data.js`, `style.css`는 바꾸지 않았습니다.

---

## 새로 쓸 수 있는 설정

### `window.ACTIVE_LIGHTING` (기존 4개 + 새 항목)
```js
window.ACTIVE_LIGHTING = {
  // 기존
  skyColor: [r, g, b, a],
  ambientLight: [r, g, b],
  mainLightPos: [x, y, z],        // 주 광원 위치 (그림자를 만드는 빛)
  mainLightColor: [r, g, b],

  // 새로 추가 (모두 생략 가능)
  shadow: { enabled: true, center: [x, y, z], halfSize: 130 }, // 그림자가 생기는 범위: center 중심 ±halfSize(m)
  pointLights: [{ position: [x, y, z], color: [r, g, b] }, ...], // 보조 점광원 (최대 8개, 그림자 없음)
  pointLightRange: 55,            // 점광원이 약해지는 거리 (m)
  fog: { color: [r, g, b], density: 0.004 },                     // 안개 색, 밀도
};
```

### `window.ACTIVE_CAMERA` (기존 4개 + 새 항목)
```js
window.ACTIVE_CAMERA = {
  eye, target, up, fov,           // 기존
  near: 0.5, far: 1500,           // 새로 추가 (생략하면 0.1 / 200)
};
```

### 모델 노드 속성 (README 4.1 표에 추가)
| 속성명 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `specular` | `number` | `0` | 정반사 세기. 0이면 반짝임 없음. 1 이상이면 하이라이트가 흰색으로 번쩍임 |
| `shininess` | `number` | `32` | 광택. 클수록 하이라이트가 작고 날카로움 (금속·헬멧 32~64, 넓은 판 10~20) |
| `fog` | `boolean` | `true` | `false`면 이 노드는 안개에 가려지지 않음 (예: 아주 먼 태양) |
| `castShadow` | `boolean` | `true` | `false`면 이 노드는 그림자를 만들지 않음 (작고 많은 물체의 성능용) |
| `blend` | `'add'` \| `'alpha'` | 없음 | 반투명 노드. `'add'` = 더하기(빛 번짐, 겹칠수록 밝아짐), `'alpha'` = 일반 반투명(스트라이크존 등). 불투명 물체를 다 그린 뒤 따로 그림 |
| `opacity` | `number` | `1` | 투명도 0~1 (`blend`와 같이 사용) |

- `emissive: true`인 노드는 자동으로 그림자를 만들지 않습니다.
- 이 속성들은 `meshOffset`·`meshScale`처럼 **자식에게 상속되지 않습니다.** 반짝이게 할 도형 노드에 직접 넣어 주세요.

**예시 (역할 2: 헬멧·배트 반짝이게)**
```js
{ id: 'helmet', primitive: 'sphere', meshScale: 0.13, color: [20, 40, 120], specular: 0.9, shininess: 64 }
{ id: 'bat', primitive: 'cylinder', meshScale: [0.07, 0.85, 0.07], color: [190, 150, 90], specular: 0.5, shininess: 32 }
```
선수·공은 **아무것도 안 해도 그림자가 자동으로 생깁니다.** (그림자 범위 안에 있을 때)

---

## 기능별 설명

### 1. 그림자 (shadow mapping)
한 프레임을 **두 번** 그립니다.
1. **그림자 패스:** 주 광원 쪽에서 직교 투영(`orthographic`)으로 장면을 보고, 각 픽셀의 깊이를 2048×2048 텍스처에 저장합니다.
   - WebGL1에는 깊이 텍스처가 기본으로 없어서, 깊이(0~1)를 RGBA 8비트 네 칸에 나눠 저장합니다 (`packDepth` / `unpackDepth`).
2. **화면 패스:** 픽셀마다 광원 시점 좌표를 구해, 저장된 깊이보다 멀면 그림자로 처리합니다.
   - **bias:** 같은 면이 자기 자신을 가리는 줄무늬(shadow acne)를 막는 여유값. 빛이 비스듬할수록 크게 줍니다.
   - **PCF:** 주변 3×3칸을 평균해서 그림자 경계를 부드럽게 합니다.
- 그림자를 만드는 빛은 **주 광원(`mainLightPos`) 하나**입니다. 보조 점광원은 그림자를 만들지 않습니다.
- 관련 코드: `createShadowFramebuffer`, `orthographic`, `computeLightViewProjection`, `renderShadowMap`, 셰이더 `shadowFactor`

### 2. 보조 점광원
- 최대 8개(`MAX_POINT_LIGHTS`). 각 빛은 diffuse + specular를 더하고, 거리에 따라 `1 / (1 + (거리/range)²)`로 약해집니다.
- 경기장 밤 조명(조명탑·지붕 조명)에 쓰고 있습니다.

### 3. 정반사광 (Blinn-Phong)
```glsl
vec3 halfDir = normalize(lightDir + viewDir);          // 빛 방향과 시선 방향의 중간
spec = specular * pow(max(dot(normal, halfDir), 0.0), shininess);
color = 물체색 × (ambient + diffuse) + 빛색 × spec     // 정반사는 물체 색과 곱하지 않고 더함
```
- 주 광원(그림자 안에서는 꺼짐)과 보조 점광원 모두 적용됩니다.
- 시선 방향 계산을 위해 카메라 위치(`uCameraPosition`)를 매 프레임 넘깁니다.
- 평평한 넓은 면은 하이라이트가 잘 안 보이므로 `shininess`를 낮게(10~20) 주면 됩니다. 곡면(공·헬멧)은 높게(32~64).

### 4. 안개 (fog)
```glsl
fogAmount = 1 − exp(−(거리 × density)²)   // 지수 제곱 안개: 가까운 곳은 맑고, 먼 곳에서 빠르게 짙어짐
color = mix(color, fogColor, fogAmount)
```
- 안개 색을 하늘색(`skyColor`)과 같게 주면 먼 곳이 하늘에 녹아들어 거리감이 생깁니다.
- 밀도 0.004 기준: 120m 앞은 약 20%, 300m 앞은 약 76%가 안개 색.

### 5. 카메라 near / far
- 원래 `perspective(..., 0.1, 200)` 고정이었습니다. 경기장이 실제 크기(m)라 200으로는 멀리서 볼 때 잘려서, `ACTIVE_CAMERA.near` / `far`로 바꿀 수 있게 했습니다.
- 역할 1 카메라는 `near: 0.5, far: 1500`을 씁니다. (near를 0.1보다 키워야 먼 곳 깊이 정밀도가 유지됨)

### 6. 반투명 · 빛 번짐 (alpha blending)
- `blend`가 있는 노드는 화면 패스에서 바로 그리지 않고 모아 두었다가, **불투명 물체를 다 그린 뒤** 그립니다.
- 이때 깊이 테스트는 켜고(건물 뒤에 있으면 가려짐) 깊이 기록은 끕니다(반투명끼리는 서로 가리지 않음).
- `'add'`: `blendFunc(SRC_ALPHA, ONE)` — 배경에 빛을 더함. 역할 1의 밤 조명 빛 번짐 판에 사용.
- `'alpha'`: `blendFunc(SRC_ALPHA, ONE_MINUS_SRC_ALPHA)` — 일반 반투명. 반투명 스트라이크존 등에 사용 가능.
- `blend` 노드는 그림자를 만들지 않습니다.

---

## 렌더링 흐름 변화 (`drawScene`)
```
기존:  updateBaseballScene → 조명 uniform → 카메라 → 모델 트리 그리기
지금:  updateBaseballScene
       → (shadow.enabled면) 그림자 패스: 광원 시점 깊이 → 그림자 텍스처
       → 화면 패스: 조명·점광원·안개 uniform → 카메라(+ cameraPosition) → 불투명 노드 그리기
       → 반투명 패스: blend 노드 (깊이 기록 끔, 블렌딩 켬)
```
- 모델 트리 순회는 `forEachMesh` 하나로 묶어서 그림자 패스와 화면 패스가 같이 씁니다.
- `bindAndDrawMesh`에 인자 4개 추가: `specular`, `shininess`, `fog`, `opacity` (노드 값에서 자동으로 넘김).

## 성능 메모
- 그림자 때문에 그림자를 만드는 노드는 **한 프레임에 두 번** 그려집니다. 관중처럼 작고 많은 물체는 `castShadow: false`를 주세요.
- 그림자는 `shadow.center` ±`halfSize` 범위 안에서만 생깁니다. 범위를 넓히면 그림자가 흐려지고, 좁히면 범위 밖에 그림자가 없습니다.

## 같이 바뀐 다른 파일
- `index.html`: 역할 1 스크립트가 `models/stadium_camera.js` 한 줄에서 아래 5줄로 바뀌었습니다. **순서를 지켜야 합니다.**
  ```html
  <script src="models/stadium_camera/mesh_builder.js"></script>
  <script src="models/stadium_camera/stadium_model.js"></script>
  <script src="models/stadium_camera/crowd.js"></script>
  <script src="models/stadium_camera/lighting.js"></script>
  <script src="models/stadium_camera/camera.js"></script>
  ```
- 버튼은 역할 1 스크립트가 `.controls .control-group`에 직접 추가합니다 (시점 3~6, 버튼 11, 시간 슬라이더, 시점 초기화).
- 역할 1이 내보내는 함수: `setTimeOfDay(시간)`, `getTimeOfDay()`, `setDayNight('day'|'night')`, `toggleDayNight()`, `setCameraPreset('pitcher'|'batter'|'overview'|'top')`, `resetCamera()`, `STADIUM_INFO`, `SUN`.
- 역할 1 카메라가 쓰는 키: **W A S D Q E Space 방향키 Shift R**. 게임 조작에 같은 키를 쓰면 알려 주세요.
