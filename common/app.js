'use strict';

function findNodeById(rootNode, targetId) {
  if (!rootNode) return null;
  if (rootNode.id === targetId) return rootNode;

  for (const child of rootNode.children ?? []) {
    const found = findNodeById(child, targetId);
    if (found) return found;
  }
  return null;
}

(function startBaseballProject() {
  const canvas = document.getElementById('glCanvas');
  const status = document.getElementById('status');
  if (!canvas) return;

  function setStatus(message) {
    if (status) status.textContent = message;
  }

  const gl = canvas.getContext('webgl');
  if (!gl) {
    setStatus('오류: 이 브라우저는 WebGL을 지원하지 않습니다.');
    return;
  }

  // 최대 보조 점광원 개수 (조명탑·지붕 조명 등). 셰이더 배열 크기와 같아야 합니다.
  const MAX_POINT_LIGHTS = 8;
  const SHADOW_MAP_SIZE = 2048;

  const vertexShaderSource = `
    attribute vec3 aPosition;
    attribute vec3 aNormal;
    attribute vec2 aTexCoord;

    uniform mat4 uModelMatrix;
    uniform mat4 uMvpMatrix;
    uniform mat3 uNormalMatrix;
    uniform mat4 uLightViewProjection;   // 그림자: 월드 좌표 → 광원 시점 클립 좌표

    varying highp vec3 vWorldPosition;
    varying mediump vec3 vNormal;
    varying mediump vec2 vTexCoord;
    varying highp vec4 vLightSpacePosition;

    void main() {
      vec4 worldPosition = uModelMatrix * vec4(aPosition, 1.0);
      vWorldPosition = worldPosition.xyz;
      vLightSpacePosition = uLightViewProjection * worldPosition;
      vNormal = uNormalMatrix * aNormal;
      vTexCoord = aTexCoord;
      gl_Position = uMvpMatrix * vec4(aPosition, 1.0);
    }
  `;

  const fragmentShaderSource = `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif

    #define MAX_POINT_LIGHTS ${MAX_POINT_LIGHTS}

    uniform sampler2D uTexture;
    uniform vec3 uLightPosition;
    uniform vec3 uLightColor;
    uniform vec3 uAmbientLight;
    uniform bool uIsEmissive;

    // 정반사광 (Blinn-Phong): 노드마다 specular / shininess로 재질을 정함
    uniform vec3 uCameraPosition;
    uniform float uSpecularStrength;
    uniform float uShininess;

    // 안개 (대기 원근): 카메라에서 멀수록 안개 색과 섞임. uFogEnabled = 이 노드에 안개를 적용할지
    uniform bool uFogEnabled;
    uniform vec3 uFogColor;
    uniform float uFogDensity;

    // 투명도 (0~1): 반투명·빛 번짐 노드용. 불투명 노드는 1
    uniform float uOpacity;

    // 그림자 맵 (주 광원 하나에서만 그림자를 계산)
    uniform sampler2D uShadowMap;
    uniform bool uShadowEnabled;
    uniform float uShadowMapSize;

    // 보조 점광원 (그림자 없음, 거리에 따라 약해짐)
    uniform int uPointLightCount;
    uniform vec3 uPointLightPositions[MAX_POINT_LIGHTS];
    uniform vec3 uPointLightColors[MAX_POINT_LIGHTS];
    uniform float uPointLightRange;

    varying highp vec3 vWorldPosition;
    varying mediump vec3 vNormal;
    varying mediump vec2 vTexCoord;
    varying highp vec4 vLightSpacePosition;

    // 그림자 패스에서 RGBA 네 칸에 나눠 저장한 깊이를 다시 하나의 실수로
    float unpackDepth(vec4 color) {
      return dot(color, vec4(1.0, 1.0 / 255.0, 1.0 / 65025.0, 1.0 / 16581375.0));
    }

    // 1.0 = 빛을 받음, 0.0 = 그림자. 주변 3x3 칸을 평균해 그림자 경계를 부드럽게 (PCF)
    float shadowFactor(vec3 normal, vec3 lightDir) {
      if (!uShadowEnabled) return 1.0;
      vec3 p = vLightSpacePosition.xyz / vLightSpacePosition.w * 0.5 + 0.5;
      if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;

      // 같은 면이 자기 자신을 가리는 줄무늬(shadow acne)를 막는 여유값. 빛이 비스듬할수록 크게
      float bias = max(0.002 * (1.0 - dot(normal, lightDir)), 0.0006);
      float texel = 1.0 / uShadowMapSize;
      float lit = 0.0;
      for (int x = -1; x <= 1; x++) {
        for (int y = -1; y <= 1; y++) {
          float closest = unpackDepth(texture2D(uShadowMap, p.xy + vec2(float(x), float(y)) * texel));
          lit += (p.z - bias > closest) ? 0.0 : 1.0;
        }
      }
      return lit / 9.0;
    }

    // 지수 제곱 안개: f = 1 − e^−(거리 × 밀도)²  → 가까운 곳은 거의 맑고, 먼 곳에서 빠르게 짙어짐
    vec3 applyFog(vec3 color) {
      if (!uFogEnabled || uFogDensity <= 0.0) return color;
      float dist = length(vWorldPosition - uCameraPosition);
      float k = dist * uFogDensity;
      float fogAmount = 1.0 - exp(-k * k);
      return mix(color, uFogColor, fogAmount);
    }

    // Blinn-Phong 정반사: 빛 방향과 시선 방향의 중간(half vector)이 법선과 가까울수록 밝은 하이라이트
    //   uSpecularStrength = 반사 세기 (0이면 정반사 없음), uShininess = 광택 (클수록 하이라이트가 작고 날카로움)
    float blinnPhong(vec3 normal, vec3 lightDir, vec3 viewDir, float nDotL) {
      if (uSpecularStrength <= 0.0 || nDotL <= 0.0) return 0.0;
      vec3 halfDir = normalize(lightDir + viewDir);
      return uSpecularStrength * pow(max(dot(normal, halfDir), 0.0), uShininess);
    }

    void main() {
      vec4 texColor = texture2D(uTexture, vTexCoord);
      if (uIsEmissive) {
        gl_FragColor = vec4(applyFog(texColor.rgb), texColor.a * uOpacity);
        return;
      }

      vec3 normal = normalize(vNormal);
      vec3 viewDir = normalize(uCameraPosition - vWorldPosition);   // 표면 → 카메라

      // 주 광원: ambient + diffuse + specular (그림자는 diffuse·specular에만 적용)
      vec3 lightDir = normalize(uLightPosition - vWorldPosition);
      float diffuse = max(dot(normal, lightDir), 0.0);
      float shadow = diffuse > 0.0 ? shadowFactor(normal, lightDir) : 1.0;
      vec3 lighting = uAmbientLight + uLightColor * diffuse * shadow;
      vec3 specular = uLightColor * blinnPhong(normal, lightDir, viewDir, diffuse) * shadow;

      // 보조 점광원: diffuse + specular, 거리 감쇠
      for (int i = 0; i < MAX_POINT_LIGHTS; i++) {
        if (i >= uPointLightCount) break;
        vec3 toLight = uPointLightPositions[i] - vWorldPosition;
        float dist = length(toLight);
        vec3 pointDir = toLight / dist;
        float nDotL = max(dot(normal, pointDir), 0.0);
        float ratio = dist / uPointLightRange;
        float attenuation = 1.0 / (1.0 + ratio * ratio);
        lighting += uPointLightColors[i] * nDotL * attenuation;
        specular += uPointLightColors[i] * blinnPhong(normal, pointDir, viewDir, nDotL) * attenuation;
      }

      // 정반사광은 물체 색과 곱하지 않고 더함 → 빛 색 그대로의 하이라이트
      gl_FragColor = vec4(applyFog(texColor.rgb * lighting + specular), texColor.a * uOpacity);
    }
  `;

  // 그림자 패스: 광원 시점에서 본 깊이만 텍스처에 기록
  const shadowVertexShaderSource = `
    attribute vec3 aPosition;
    uniform mat4 uLightMvpMatrix;
    void main() {
      gl_Position = uLightMvpMatrix * vec4(aPosition, 1.0);
    }
  `;

  const shadowFragmentShaderSource = `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif

    // 깊이(0~1)를 8비트 RGBA 네 칸에 나눠 저장 (WebGL1 깊이 텍스처 확장 없이 사용)
    vec4 packDepth(float depth) {
      vec4 enc = fract(vec4(1.0, 255.0, 65025.0, 16581375.0) * depth);
      enc -= enc.yzww * vec4(1.0 / 255.0, 1.0 / 255.0, 1.0 / 255.0, 0.0);
      return enc;
    }

    void main() {
      gl_FragColor = packDepth(gl_FragCoord.z);
    }
  `;

  const defaultLighting = {
    skyColor: [0.45, 0.72, 0.95, 1],
    ambientLight: [0.55, 0.55, 0.55],
    mainLightPos: [0, 40, -20],
    mainLightColor: [1, 0.98, 0.9],
  };
  const defaultCamera = {
    eye: [0, 3, 16.5],
    target: [0, 1.2, 0],
    up: [0, 1, 0],
    fov: Math.PI / 4,
  };
  const origin = [0, 0, 0];
  const textureCache = new Map();
  const customMeshes = new WeakMap();

  function createShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`Shader 컴파일 오류:\n${message}`);
    }

    return shader;
  }

  function createProgram(vertexSource, fragmentSource) {
    const vertex = createShader(gl.VERTEX_SHADER, vertexSource);
    const fragment = createShader(gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`Program 연결 오류:\n${message}`);
    }

    return program;
  }

  function createAttributeBuffer(data, location, elementSize) {
    if (location < 0) return null;

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data instanceof Float32Array ? data : new Float32Array(data), gl.STATIC_DRAW);
    return { buffer, location, elementSize };
  }

  function createMeshBuffers(geometry, locations) {
    let indices = geometry.indices;
    let indexType = gl.UNSIGNED_SHORT;
    if (indices instanceof Uint8Array) {
      indexType = gl.UNSIGNED_BYTE;
    } else if (indices instanceof Uint32Array || indices.some((index) => index > 65535)) {
      if (!gl.getExtension('OES_element_index_uint')) {
        throw new Error('이 WebGL 환경은 32비트 메쉬 인덱스를 지원하지 않습니다.');
      }
      indices = indices instanceof Uint32Array ? indices : new Uint32Array(indices);
      indexType = gl.UNSIGNED_INT;
    } else if (!(indices instanceof Uint16Array)) {
      indices = new Uint16Array(indices);
    }

    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    const positionAttribute = createAttributeBuffer(geometry.positions, locations.position, 3);
    const attributes = [
      positionAttribute,
      createAttributeBuffer(geometry.normals, locations.normal, 3),
      createAttributeBuffer(geometry.texCoords, locations.texCoord, 2),
    ].filter(Boolean);
    return {
      attributes,
      positionBuffer: positionAttribute && positionAttribute.buffer, // 그림자 패스용
      indexBuffer,
      indexType,
      indexCount: indices.length,
    };
  }

  // 그림자 맵: 광원 시점 깊이를 담을 RGBA 텍스처 + 깊이 테스트용 렌더버퍼
  function createShadowFramebuffer(size) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const depthBuffer = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depthBuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, size, size);

    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthBuffer);
    const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return complete ? { framebuffer, texture, size } : null;
  }

  // 직교 투영 (그림자 맵용: 햇빛처럼 평행한 빛)
  function orthographic(left, right, bottom, top, near, far) {
    return new Float32Array([
      2 / (right - left), 0, 0, 0,
      0, 2 / (top - bottom), 0, 0,
      0, 0, -2 / (far - near), 0,
      -(right + left) / (right - left), -(top + bottom) / (top - bottom), -(far + near) / (far - near), 1,
    ]);
  }

  // 광원 시점 행렬: shadow.center를 중심으로 halfSize 범위를 덮는 직교 카메라를 광원 쪽에 둡니다.
  function computeLightViewProjection(light) {
    const shadow = light.shadow;
    const center = shadow.center ?? origin;
    const half = shadow.halfSize ?? 50;
    const toLight = normalize([
      light.mainLightPos[0] - center[0],
      light.mainLightPos[1] - center[1],
      light.mainLightPos[2] - center[2],
    ]);
    const distance = half * 2;
    const eye = [
      center[0] + toLight[0] * distance,
      center[1] + toLight[1] * distance,
      center[2] + toLight[2] * distance,
    ];
    const up = Math.abs(toLight[1]) > 0.99 ? [0, 0, -1] : [0, 1, 0];
    const view = lookAt(eye, center, up);
    const projection = orthographic(-half, half, -half, half, 1, distance + half * 2);
    return multiply(projection, view);
  }

  function getOrCreateTexture(defaultColor = [200, 200, 200], imagePath) {
    const key = `${defaultColor.join(',')}|${imagePath || ''}`;
    if (textureCache.has(key)) return textureCache.get(key);

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array([...defaultColor, 255])
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    if (imagePath) {
      const image = new Image();
      image.onload = () => {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      };
      image.onerror = () => {
        if (status) status.textContent += ` | 텍스처 로딩 실패: ${imagePath}`;
      };
      image.src = imagePath;
    }

    textureCache.set(key, texture);
    return texture;
  }

  function scaleMatrix(value) {
    return typeof value === 'number' ? scaling(value) : scalingXYZ(...value);
  }

  function computeJointMatrix(node) {
    const [rx, ry, rz] = node.rotation ?? origin;
    let matrix = translation(...(node.position ?? origin));
    if (ry) matrix = multiply(matrix, rotationY(ry));
    if (rx) matrix = multiply(matrix, rotationX(rx));
    if (rz) matrix = multiply(matrix, rotationZ(rz));
    if (node.scale != null) matrix = multiply(matrix, scaleMatrix(node.scale));
    return matrix;
  }

  function computeMeshMatrix(jointWorldMatrix, node) {
    let matrix = jointWorldMatrix;
    if (node.meshOffset) matrix = multiply(matrix, translation(...node.meshOffset));
    if (node.meshScale != null) matrix = multiply(matrix, scaleMatrix(node.meshScale));
    return matrix;
  }

  function computeNormalMatrix(modelMatrix) {
    const x = modelMatrix.subarray(0, 3);
    const y = modelMatrix.subarray(4, 7);
    const z = modelMatrix.subarray(8, 11);
    const yz = cross(y, z);
    const zx = cross(z, x);
    const xy = cross(x, y);
    const cofactors = [...yz, ...zx, ...xy];
    // 역전치 행렬과 같은 방향을 유지하며, 한 축을 0으로 줄인 평면도 처리합니다.
    const sign = dot(x, yz) < 0 ? -1 : 1;
    const max = Math.max(...cofactors.map(Math.abs)) || 1;
    return new Float32Array(cofactors.map((value) => value * sign / max));
  }

  function reportError(error) {
    console.error(error);
    setStatus(error.message);
  }

  try {
    const rootMatrix = identity();
    const program = createProgram(vertexShaderSource, fragmentShaderSource);
    gl.useProgram(program);
    const locations = {
      position: gl.getAttribLocation(program, 'aPosition'),
      normal: gl.getAttribLocation(program, 'aNormal'),
      texCoord: gl.getAttribLocation(program, 'aTexCoord'),
      modelMatrix: gl.getUniformLocation(program, 'uModelMatrix'),
      mvpMatrix: gl.getUniformLocation(program, 'uMvpMatrix'),
      normalMatrix: gl.getUniformLocation(program, 'uNormalMatrix'),
      texture: gl.getUniformLocation(program, 'uTexture'),
      lightPosition: gl.getUniformLocation(program, 'uLightPosition'),
      lightColor: gl.getUniformLocation(program, 'uLightColor'),
      ambientLight: gl.getUniformLocation(program, 'uAmbientLight'),
      isEmissive: gl.getUniformLocation(program, 'uIsEmissive'),
      lightViewProjection: gl.getUniformLocation(program, 'uLightViewProjection'),
      shadowMap: gl.getUniformLocation(program, 'uShadowMap'),
      shadowEnabled: gl.getUniformLocation(program, 'uShadowEnabled'),
      shadowMapSize: gl.getUniformLocation(program, 'uShadowMapSize'),
      pointLightCount: gl.getUniformLocation(program, 'uPointLightCount'),
      pointLightPositions: gl.getUniformLocation(program, 'uPointLightPositions'),
      pointLightColors: gl.getUniformLocation(program, 'uPointLightColors'),
      pointLightRange: gl.getUniformLocation(program, 'uPointLightRange'),
      cameraPosition: gl.getUniformLocation(program, 'uCameraPosition'),
      specularStrength: gl.getUniformLocation(program, 'uSpecularStrength'),
      shininess: gl.getUniformLocation(program, 'uShininess'),
      fogEnabled: gl.getUniformLocation(program, 'uFogEnabled'),
      fogColor: gl.getUniformLocation(program, 'uFogColor'),
      fogDensity: gl.getUniformLocation(program, 'uFogDensity'),
      opacity: gl.getUniformLocation(program, 'uOpacity'),
    };

    const shadowProgram = createProgram(shadowVertexShaderSource, shadowFragmentShaderSource);
    const shadowLocations = {
      position: gl.getAttribLocation(shadowProgram, 'aPosition'),
      lightMvpMatrix: gl.getUniformLocation(shadowProgram, 'uLightMvpMatrix'),
    };
    const shadowTarget = createShadowFramebuffer(SHADOW_MAP_SIZE);
    if (!shadowTarget) console.warn('그림자 맵 프레임버퍼를 만들 수 없어 그림자를 끕니다.');

    const meshRegistry = new Map();
    for (const [name, geometry] of Object.entries(window.getPrimitives())) {
      meshRegistry.set(name, createMeshBuffers(geometry, locations));
    }

    function resolveMesh(primitive) {
      if (typeof primitive === 'string') return meshRegistry.get(primitive);
      if (!customMeshes.has(primitive)) {
        customMeshes.set(primitive, createMeshBuffers(primitive, locations));
      }
      return customMeshes.get(primitive);
    }

    // 노드 재질: specular(정반사 세기, 기본 0 = 없음), shininess(광택, 기본 32)
    function bindAndDrawMesh(mesh, modelMatrix, viewProjectionMatrix, texture, isEmissive, specular = 0, shininess = 32, fog = true, opacity = 1) {
      for (const { buffer, location, elementSize } of mesh.attributes) {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, elementSize, gl.FLOAT, false, 0, 0);
      }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.indexBuffer);

      gl.uniformMatrix4fv(locations.modelMatrix, false, modelMatrix);
      gl.uniformMatrix4fv(locations.mvpMatrix, false, multiply(viewProjectionMatrix, modelMatrix));
      gl.uniformMatrix3fv(locations.normalMatrix, false, computeNormalMatrix(modelMatrix));
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(locations.isEmissive, isEmissive ? 1 : 0);
      gl.uniform1f(locations.specularStrength, specular);
      gl.uniform1f(locations.shininess, shininess);
      gl.uniform1i(locations.fogEnabled, fog ? 1 : 0);
      gl.uniform1f(locations.opacity, opacity);
      gl.drawElements(gl.TRIANGLES, mesh.indexCount, mesh.indexType, 0);
    }

    // 그림자 패스용: 위치 버퍼만 연결하고 광원 시점 MVP로 깊이만 그림
    function drawMeshDepth(mesh, modelMatrix, lightViewProjection) {
      if (!mesh.positionBuffer) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.positionBuffer);
      gl.enableVertexAttribArray(shadowLocations.position);
      gl.vertexAttribPointer(shadowLocations.position, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.indexBuffer);
      gl.uniformMatrix4fv(shadowLocations.lightMvpMatrix, false, multiply(lightViewProjection, modelMatrix));
      gl.drawElements(gl.TRIANGLES, mesh.indexCount, mesh.indexType, 0);
    }

    // 모델 트리를 순회하며 도형이 있는 노드마다 drawNode(mesh, meshMatrix, node)를 호출
    function forEachMesh(node, parentMatrix, drawNode) {
      if (!node || node.visible === false) return;

      const jointWorldMatrix = multiply(parentMatrix, computeJointMatrix(node));

      if (node.primitive) {
        const mesh = resolveMesh(node.primitive);
        if (mesh) drawNode(mesh, computeMeshMatrix(jointWorldMatrix, node), node);
      }

      for (const child of node.children ?? []) {
        forEachMesh(child, jointWorldMatrix, drawNode);
      }
    }

    // blend가 있는 노드(반투명·빛 번짐)는 바로 그리지 않고 모아 두었다가, 불투명 물체를 다 그린 뒤에 그림
    function drawNode(mesh, meshMatrix, current, viewProjectionMatrix) {
      const texture = getOrCreateTexture(current.color, current.texture);
      bindAndDrawMesh(mesh, meshMatrix, viewProjectionMatrix, texture, current.emissive,
        current.specular ?? 0, current.shininess ?? 32, current.fog !== false, // fog: false면 안개 제외 (태양 등)
        current.opacity ?? 1);
    }
    function renderModelTree(node, parentMatrix, viewProjectionMatrix, blendQueue) {
      forEachMesh(node, parentMatrix, (mesh, meshMatrix, current) => {
        if (current.blend) blendQueue.push({ mesh, meshMatrix, current });
        else drawNode(mesh, meshMatrix, current, viewProjectionMatrix);
      });
    }

    // 2단계: 반투명 노드. 깊이 테스트는 켜서 불투명 물체 뒤에 있으면 가려지고,
    //   깊이 기록은 꺼서 반투명끼리는 서로 가리지 않게 함.
    //   blend: 'add' = 더하기(빛 번짐, 겹칠수록 밝아짐) / 'alpha' = 일반 반투명
    function renderBlendQueue(blendQueue, viewProjectionMatrix) {
      if (blendQueue.length === 0) return;
      gl.enable(gl.BLEND);
      gl.depthMask(false);
      for (const { mesh, meshMatrix, current } of blendQueue) {
        if (current.blend === 'add') gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        else gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        drawNode(mesh, meshMatrix, current, viewProjectionMatrix);
      }
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    // 1패스: 광원 시점 깊이를 그림자 맵에 기록 (발광체·castShadow:false 노드는 제외)
    function renderShadowMap(lightViewProjection) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, shadowTarget.framebuffer);
      gl.viewport(0, 0, shadowTarget.size, shadowTarget.size);
      gl.clearColor(1, 1, 1, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      gl.useProgram(shadowProgram);
      // 메인 프로그램에서 켜 둔 법선·UV 속성은 그림자 패스에서 쓰지 않으므로 끔
      for (const location of [locations.normal, locations.texCoord]) {
        if (location >= 0 && location !== shadowLocations.position) gl.disableVertexAttribArray(location);
      }
      for (const modelRoot of window.SCENE_MODELS ?? []) {
        forEachMesh(modelRoot, rootMatrix, (mesh, meshMatrix, current) => {
          if (current.emissive || current.blend || current.castShadow === false) return;
          drawMeshDepth(mesh, meshMatrix, lightViewProjection);
        });
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.useProgram(program);
    }

    function applyLighting(light, lightViewProjection) {
      gl.uniform3fv(locations.lightPosition, light.mainLightPos);
      gl.uniform3fv(locations.lightColor, light.mainLightColor);
      gl.uniform3fv(locations.ambientLight, light.ambientLight);

      gl.uniform1i(locations.shadowEnabled, lightViewProjection ? 1 : 0);
      gl.uniformMatrix4fv(locations.lightViewProjection, false, lightViewProjection ?? rootMatrix);
      gl.uniform1f(locations.shadowMapSize, SHADOW_MAP_SIZE);

      const pointLights = (light.pointLights ?? []).slice(0, MAX_POINT_LIGHTS);
      const positions = new Float32Array(MAX_POINT_LIGHTS * 3);
      const colors = new Float32Array(MAX_POINT_LIGHTS * 3);
      pointLights.forEach((pointLight, i) => {
        positions.set(pointLight.position, i * 3);
        colors.set(pointLight.color, i * 3);
      });
      gl.uniform1i(locations.pointLightCount, pointLights.length);
      gl.uniform3fv(locations.pointLightPositions, positions);
      gl.uniform3fv(locations.pointLightColors, colors);
      gl.uniform1f(locations.pointLightRange, light.pointLightRange ?? 50);

      // 안개: ACTIVE_LIGHTING.fog = { color: [r,g,b], density } (없으면 안개 없음)
      const fog = light.fog;
      gl.uniform3fv(locations.fogColor, fog ? fog.color : [0, 0, 0]);
      gl.uniform1f(locations.fogDensity, fog ? fog.density : 0);
    }

    gl.enable(gl.DEPTH_TEST);
    gl.uniform1i(locations.shadowMap, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(locations.texture, 0);

    let lastTime;
    function drawScene(timeSec) {
      const dt = timeSec - (lastTime ?? timeSec);
      lastTime = timeSec;
      if (typeof window.updateBaseballScene === 'function') {
        window.updateBaseballScene(timeSec, dt);
      }

      const light = window.ACTIVE_LIGHTING ?? defaultLighting;

      // 1패스: 그림자 맵 (ACTIVE_LIGHTING.shadow.enabled일 때만)
      let lightViewProjection = null;
      if (shadowTarget && light.shadow && light.shadow.enabled) {
        lightViewProjection = computeLightViewProjection(light);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, null); // 기록 중인 텍스처를 읽지 않도록 잠시 해제
        gl.activeTexture(gl.TEXTURE0);
        renderShadowMap(lightViewProjection);
      }

      // 2패스: 화면에 그리기
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(...light.skyColor);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, lightViewProjection ? shadowTarget.texture : null);
      gl.activeTexture(gl.TEXTURE0);
      applyLighting(light, lightViewProjection);

      const cam = window.ACTIVE_CAMERA ?? defaultCamera;
      // near/far는 ACTIVE_CAMERA에서 바꿀 수 있음 (없으면 기존 값 0.1 / 200)
      const projection = perspective(
        cam.fov ?? defaultCamera.fov, canvas.width / canvas.height, cam.near ?? 0.1, cam.far ?? 200
      );
      const view = lookAt(cam.eye, cam.target, cam.up ?? defaultCamera.up);
      const viewProjection = multiply(projection, view);
      gl.uniform3fv(locations.cameraPosition, cam.eye); // 정반사광 계산용 시선 방향
      const blendQueue = [];
      for (const modelRoot of window.SCENE_MODELS ?? []) {
        renderModelTree(modelRoot, rootMatrix, viewProjection, blendQueue); // 1단계: 불투명
      }
      renderBlendQueue(blendQueue, viewProjection);                         // 2단계: 반투명
    }

    function animate(nowMs) {
      try {
        drawScene(nowMs * 0.001);
        requestAnimationFrame(animate);
      } catch (error) {
        reportError(error);
      }
    }

    setStatus('야구 프로젝트 초기 엔진 준비 완료');
    requestAnimationFrame(animate);
  } catch (error) {
    reportError(error);
  }
})();
