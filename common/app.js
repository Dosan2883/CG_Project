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

  const vertexShaderSource = `
    attribute vec3 aPosition;
    attribute vec3 aNormal;
    attribute vec2 aTexCoord;

    uniform mat4 uModelMatrix;
    uniform mat4 uMvpMatrix;
    uniform mat3 uNormalMatrix;

    varying mediump vec3 vWorldPosition;
    varying mediump vec3 vNormal;
    varying mediump vec2 vTexCoord;

    void main() {
      vWorldPosition = (uModelMatrix * vec4(aPosition, 1.0)).xyz;
      vNormal = uNormalMatrix * aNormal;
      vTexCoord = aTexCoord;
      gl_Position = uMvpMatrix * vec4(aPosition, 1.0);
    }
  `;

  const fragmentShaderSource = `
    precision mediump float;

    uniform sampler2D uTexture;
    uniform vec3 uLightPosition;
    uniform vec3 uLightColor;
    uniform vec3 uAmbientLight;
    uniform bool uIsEmissive;

    varying mediump vec3 vWorldPosition;
    varying mediump vec3 vNormal;
    varying mediump vec2 vTexCoord;

    void main() {
      vec4 texColor = texture2D(uTexture, vTexCoord);
      if (uIsEmissive) {
        gl_FragColor = texColor;
        return;
      }

      vec3 normal = normalize(vNormal);
      vec3 lightDir = normalize(uLightPosition - vWorldPosition);
      float diffuse = max(dot(normal, lightDir), 0.0);
      vec3 lighting = uAmbientLight + uLightColor * diffuse;
      gl_FragColor = vec4(texColor.rgb * lighting, texColor.a);
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

    const attributes = [
      createAttributeBuffer(geometry.positions, locations.position, 3),
      createAttributeBuffer(geometry.normals, locations.normal, 3),
      createAttributeBuffer(geometry.texCoords, locations.texCoord, 2),
    ].filter(Boolean);
    return { attributes, indexBuffer, indexType, indexCount: indices.length };
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
    };

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

    function bindAndDrawMesh(mesh, modelMatrix, viewProjectionMatrix, texture, isEmissive) {
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
      gl.drawElements(gl.TRIANGLES, mesh.indexCount, mesh.indexType, 0);
    }

    function renderModelTree(node, parentMatrix, viewProjectionMatrix) {
      if (!node || node.visible === false) return;

      const jointWorldMatrix = multiply(parentMatrix, computeJointMatrix(node));

      if (node.primitive) {
        const mesh = resolveMesh(node.primitive);
        if (mesh) {
          const meshMatrix = computeMeshMatrix(jointWorldMatrix, node);
          const texture = getOrCreateTexture(node.color, node.texture);
          bindAndDrawMesh(mesh, meshMatrix, viewProjectionMatrix, texture, node.emissive);
        }
      }

      for (const child of node.children ?? []) {
        renderModelTree(child, jointWorldMatrix, viewProjectionMatrix);
      }
    }

    gl.enable(gl.DEPTH_TEST);
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
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(...light.skyColor);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniform3fv(locations.lightPosition, light.mainLightPos);
      gl.uniform3fv(locations.lightColor, light.mainLightColor);
      gl.uniform3fv(locations.ambientLight, light.ambientLight);

      const cam = window.ACTIVE_CAMERA ?? defaultCamera;
      const projection = perspective(cam.fov ?? defaultCamera.fov, canvas.width / canvas.height, 0.1, 200);
      const view = lookAt(cam.eye, cam.target, cam.up ?? defaultCamera.up);
      const viewProjection = multiply(projection, view);
      for (const modelRoot of window.SCENE_MODELS ?? []) {
        renderModelTree(modelRoot, rootMatrix, viewProjection);
      }
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
