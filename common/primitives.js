'use strict';

(function registerPrimitives() {
  function createUnitBox() {
    const faces = [
      { normal: [0, 0, 1], corners: [-1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1] },
      { normal: [0, 0, -1], corners: [1, -1, -1, -1, -1, -1, -1, 1, -1, 1, 1, -1] },
      { normal: [0, 1, 0], corners: [-1, 1, 1, 1, 1, 1, 1, 1, -1, -1, 1, -1] },
      { normal: [0, -1, 0], corners: [-1, -1, -1, 1, -1, -1, 1, -1, 1, -1, -1, 1] },
      { normal: [1, 0, 0], corners: [1, -1, 1, 1, -1, -1, 1, 1, -1, 1, 1, 1] },
      { normal: [-1, 0, 0], corners: [-1, -1, -1, -1, -1, 1, -1, 1, 1, -1, 1, -1] },
    ];
    const positions = [];
    const normals = [];
    const texCoords = [];
    const indices = [];

    for (const { normal, corners } of faces) {
      const start = positions.length / 3;
      positions.push(...corners.map((coordinate) => coordinate / 2));
      for (let vertex = 0; vertex < 4; vertex++) normals.push(...normal);
      texCoords.push(0, 0, 1, 0, 1, 1, 0, 1);
      indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    }

    return {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      texCoords: new Float32Array(texCoords),
      indices: new Uint16Array(indices),
    };
  }

  function createUnitPlane() {
    return {
      positions: new Float32Array([
        -0.5, 0, 0.5,
        0.5, 0, 0.5,
        0.5, 0, -0.5,
        -0.5, 0, -0.5,
      ]),
      normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
      texCoords: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
    };
  }

  function createUnitCylinder(segments = 24) {
    const positions = [];
    const normals = [];
    const texCoords = [];
    const indices = [];

    // 높이 1, 반지름 0.5. UV 이음매의 두 정점은 위치와 법선을 공유합니다.
    for (let i = 0; i <= segments; i++) {
      const angle = (i % segments) / segments * 2 * Math.PI;
      const x = Math.cos(angle);
      const z = Math.sin(angle);
      positions.push(x / 2, 0.5, z / 2, x / 2, -0.5, z / 2);
      normals.push(x, 0, z, x, 0, z);
      texCoords.push(i / segments, 1, i / segments, 0);
    }

    for (let i = 0; i < segments; i++) {
      const top = i * 2;
      const bottom = top + 1;
      indices.push(top, top + 2, bottom, bottom, top + 2, bottom + 2);
    }

    // 끝면은 옆면과 분리된 정점을 사용해 평평한 법선을 유지합니다.
    for (const direction of [1, -1]) {
      const center = positions.length / 3;
      positions.push(0, direction / 2, 0);
      normals.push(0, direction, 0);
      texCoords.push(0.5, 0.5);

      for (let i = 0; i < segments; i++) {
        const x = positions[i * 6];
        const z = positions[i * 6 + 2];
        positions.push(x, direction / 2, z);
        normals.push(0, direction, 0);
        texCoords.push(x + 0.5, z + 0.5);

        const current = center + 1 + i;
        const next = center + 1 + (i + 1) % segments;
        if (direction > 0) indices.push(center, next, current);
        else indices.push(center, current, next);
      }
    }

    return {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      texCoords: new Float32Array(texCoords),
      indices: new Uint16Array(indices),
    };
  }

  window.getPrimitives = function getPrimitives() {
    return {
      sphere: window.getProvidedSphere(),
      box: createUnitBox(),
      plane: createUnitPlane(),
      cylinder: createUnitCylinder(),
    };
  };
})();
