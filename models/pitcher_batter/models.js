'use strict';

// [역할 2] 투수·타자 모델과 장비
(function () {
  const rubber = window.STADIUM_INFO?.rubber ?? [0, 0.34, -18.44];
  const skin = [218, 164, 119];
  const pantsColor = [229, 224, 211];
  const bootColor = [34, 40, 47];
  const { box, cylinder } = window.getPrimitives();
  const quad = {
    positions: new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    texCoords: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
  };

  // 유니폼 아틀라스는 위쪽에 앞/뒤, 아래쪽에 옆/소매 순서로 배치한다.
  function atlasUV(uv, column, row) {
    return uv.map((v, i) => (v * 0.484375 + (i % 2 === 0 ? column : row) * 0.5 + 0.0078125));
  }
  const torsoMesh = {
    ...box,
    texCoords: new Float32Array([[0, 1], [1, 1], [0, 0], [0, 0], [0, 0], [0, 0]]
      .flatMap(([col, row]) => Array.from(atlasUV(quad.texCoords, col, row)))),
  };
  const sleeveMesh = { ...cylinder, texCoords: atlasUV(cylinder.texCoords, 1, 0) };

  // 앞쪽은 이마에서 끝나고 옆과 뒤는 더 낮게 내려오는 헬멧 쉘.
  function createHelmetShell() {
    const slices = 32, rings = 16;
    const positions = [], normals = [], texCoords = [], indices = [];
    for (let row = 0; row <= rings; row++) {
      const v = row / rings;
      for (let col = 0; col <= slices; col++) {
        const u = col / slices;
        const azimuth = (col % slices) * 2 * Math.PI / slices;
        const rimY = -0.53 + 0.45 * Math.sin(azimuth);
        const polar = Math.acos(rimY) * v;
        const point = [Math.cos(azimuth) * Math.sin(polar), Math.cos(polar), Math.sin(azimuth) * Math.sin(polar)];
        positions.push(...point);
        normals.push(...point);
        texCoords.push(u, 1 - v);
        if (row === 0 || col === slices) continue;
        const bottom = row * (slices + 1) + col, top = bottom - slices - 1;
        indices.push(top, top + 1, bottom, bottom, top + 1, bottom + 1);
      }
    }
    return {
      positions: new Float32Array(positions), normals: new Float32Array(normals),
      texCoords: new Float32Array(texCoords), indices: new Uint16Array(indices),
    };
  }

  // +Y 방향 손잡이부터 배럴까지 이어지는 하나의 테이퍼 메쉬.
  const BAT_PROFILE = [
    [-0.13, 0.024], [-0.113, 0.026], [-0.105, 0.016], [0.24, 0.015],
    [0.4, 0.019], [0.57, 0.031], [0.76, 0.034], [0.79, 0.029],
  ];
  function createBatMesh() {
    const segments = 24;
    const positions = [], normals = [], texCoords = [], indices = [];
    const bottomY = BAT_PROFILE[0][0], length = BAT_PROFILE.at(-1)[0] - bottomY;
    BAT_PROFILE.forEach(([y, radius], ring) => {
      const [y0, r0] = BAT_PROFILE[Math.max(0, ring - 1)];
      const [y1, r1] = BAT_PROFILE[Math.min(BAT_PROFILE.length - 1, ring + 1)];
      for (let i = 0; i <= segments; i++) {
        const angle = (i % segments) * 2 * Math.PI / segments;
        const x = Math.cos(angle), z = Math.sin(angle);
        positions.push(x * radius, y, z * radius);
        normals.push(...normalize([x, (r0 - r1) / (y1 - y0), z]));
        texCoords.push(i / segments, (y - bottomY) / length);
        if (ring === 0 || i === segments) continue;
        const top = ring * (segments + 1) + i;
        const bottom = top - segments - 1;
        indices.push(top, top + 1, bottom, bottom, top + 1, bottom + 1);
      }
    });
    for (const [ring, sign] of [[0, -1], [BAT_PROFILE.length - 1, 1]]) {
      const [y, radius] = BAT_PROFILE[ring];
      const center = positions.length / 3;
      positions.push(0, y, 0);
      normals.push(0, sign, 0);
      texCoords.push(0.5, (y - bottomY) / length);
      for (let i = 0; i < segments; i++) {
        const angle = i * 2 * Math.PI / segments;
        positions.push(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
        normals.push(0, sign, 0);
        texCoords.push(i / segments, (y - bottomY) / length);
        const a = center + 1 + i, b = center + 1 + (i + 1) % segments;
        if (sign > 0) indices.push(center, b, a);
        else indices.push(center, a, b);
      }
    }
    return {
      positions: new Float32Array(positions), normals: new Float32Array(normals),
      texCoords: new Float32Array(texCoords), indices: new Uint16Array(indices),
    };
  }

  function makePlayer(role, position, yaw, jerseyColor, headgearColor) {
    const joints = {};
    const outfit = { jersey: [], pants: [], skin: [], decals: [], patches: [] };
    const node = (id, props) => ({ id: `${role}_${id}`, children: [], ...props });
    function add(parent, id, props) {
      const child = node(id, props);
      parent.children.push(child);
      return child;
    }
    function part(parent, id, primitive, position, meshScale, color, props) {
      return add(parent, id, { primitive, position, meshScale, color, ...props });
    }
    function joint(parent, name, id, position, props) {
      const child = add(parent, id, { position, rotation: [0, 0, 0], ...props });
      joints[name] = child;
      return child;
    }
    function emblem(parent, id, [x, y, z], height, patchWidth) {
      const base = { castShadow: false, visible: false };
      outfit.patches.push(part(parent, `${id}_patch`, quad, [x, y, z], [patchWidth, height * 1.15, 1],
        [236, 236, 232], base));
      outfit.decals.push(part(parent, `${id}_logo`, quad, [x, y, z + 0.001], [height, height, 1],
        [255, 255, 255], { ...base, blend: 'alpha', decalHeight: height }));
    }

    const root = node('root', { position, rotation: [0, yaw, 0] });
    const pelvis = joint(root, 'pelvis', 'pelvis', [0, 0.89, 0], {
      primitive: 'box', meshScale: [0.37, 0.16, 0.235], color: pantsColor,
    });
    outfit.pants.push(pelvis);
    part(pelvis, 'belt', 'box', [0, 0.058, 0], [0.376, 0.031, 0.241], bootColor);
    const torso = joint(pelvis, 'torso', 'torso', [0, 0.07, 0], {
      primitive: torsoMesh, meshOffset: [0, 0.25, 0], meshScale: [0.44, 0.53, 0.26], color: jerseyColor,
    });
    outfit.jersey.push(torso);
    emblem(torso, 'chest', [0.105, 0.337, 0.131], 0.125, 0.115);
    const neck = joint(torso, 'neck', 'neck', [0, 0.509, 0], {
      primitive: 'cylinder', meshOffset: [0, 0.044, 0], meshScale: [0.113, 0.115, 0.113], color: skin,
    });
    const head = joint(neck, 'head', 'head', [0, 0.145, 0], {
      primitive: 'sphere', meshScale: [0.123, 0.132, 0.122], color: skin,
    });
    outfit.skin.push(neck, head);
    part(head, 'nose', 'sphere', [0, -0.014, 0.117], [0.025, 0.025, 0.027], skin);
    part(head, 'mouth', 'sphere', [0, -0.066, 0.104], [0.033, 0.005, 0.008], [124, 73, 61]);

    for (const [side, sign] of [['L', 1], ['R', -1]]) {
      part(head, `ear_${side}`, 'sphere', [sign * 0.117, -0.018, 0], [0.023, 0.042, 0.025], skin);
      part(head, `eye_${side}`, 'sphere', [sign * 0.045, 0.016, 0.112], [0.022, 0.012, 0.009], [237, 230, 215]);
      part(head, `pupil_${side}`, 'sphere', [sign * 0.045, 0.017, 0.12], [0.009, 0.009, 0.005], [52, 36, 30]);

      const shoulder = joint(torso, `shoulder${side}`, `shoulder_${side}`, [sign * 0.228, 0.442, 0]);
      outfit.jersey.push(part(shoulder, `sleeve_${side}`, sleeveMesh, [0, -0.069, 0], [0.155, 0.223, 0.155], jerseyColor));
      outfit.skin.push(part(shoulder, `upper_arm_${side}`, 'cylinder', [0, -0.215, 0], [0.112, 0.23, 0.112], skin));
      const elbow = joint(shoulder, `elbow${side}`, `elbow_${side}`, [0, -0.30, 0]);
      outfit.skin.push(part(elbow, `elbow_joint_${side}`, 'sphere', [0, 0, 0], [0.055, 0.056, 0.055], skin),
        part(elbow, `forearm_${side}`, 'cylinder', [0, -0.143, 0], [0.096, 0.29, 0.096], skin));
      const hand = joint(elbow, `hand${side}`, `hand_${side}`, [0, -0.29, 0], {
        primitive: 'sphere', meshScale: [0.053, 0.063, 0.047], color: skin,
      });
      outfit.skin.push(hand);

      const hip = joint(pelvis, `hip${side}`, `hip_${side}`, [sign * 0.111, -0.037, 0]);
      const knee = joint(hip, `knee${side}`, `knee_${side}`, [0, -0.419, 0]);
      const pants = part(hip, `thigh_${side}`, 'cylinder', [0, -0.199, 0], [0.199, 0.445, 0.194], pantsColor);
      outfit.pants.push(pants, part(knee, `knee_pad_${side}`, 'sphere', [0, 0, 0], [0.079, 0.086, 0.08], pantsColor),
        part(knee, `shin_${side}`, 'cylinder', [0, -0.146, 0], [0.151, 0.323, 0.152], pantsColor));
      part(knee, `sock_${side}`, 'cylinder', [0, -0.348, 0], [0.12, 0.12, 0.124], bootColor);
      const shoe = joint(knee, `shoe${side}`, `shoe_${side}`, [0, -0.40, 0]);
      part(shoe, `sole_${side}`, 'box', [0, -0.025, 0.048], [0.134, 0.028, 0.237], [26, 28, 33]);
      part(shoe, `cleat_${side}`, 'sphere', [0, 0.01, 0.05], [0.073, 0.053, 0.13], [47, 54, 62]);
    }

    if (role === 'pitcher') {
      const cap = joint(head, 'capGroup', 'cap_group', [0, 0.04, 0]);
      const cloth = { specular: 0.08, shininess: 10 };
      outfit.cap = [
        part(cap, 'cap_crown', 'sphere', [0, 0.04, 0], [0.132, 0.095, 0.136], headgearColor, cloth),
        part(cap, 'cap_brim', 'sphere', [0, 0.016, 0.146], [0.097, 0.007, 0.081], headgearColor,
          { ...cloth, rotation: [0.08, 0, 0] }),
        part(cap, 'cap_button', 'sphere', [0, 0.135, 0], [0.014, 0.009, 0.014], headgearColor, cloth),
      ];
      emblem(cap, 'cap', [0, 0.051, 0.137], 0.055, 0.057);
      const leather = [121, 74, 42];
      const glove = joint(joints.handL, 'glove', 'glove', [0, 0, 0.035], { rotation: [-0.35, 0, -0.25] });
      outfit.glove = [
        part(glove, 'glove_palm', 'sphere', [0, -0.028, 0.023], [0.094, 0.092, 0.053], leather),
        part(glove, 'glove_fingers', 'sphere', [0.009, -0.10, 0.032], [0.084, 0.072, 0.044], leather),
        part(glove, 'glove_thumb', 'sphere', [-0.067, -0.034, 0.040], [0.043, 0.074, 0.042], leather,
          { rotation: [0, 0, -0.32] }),
      ];
    } else {
      const helmet = joint(head, 'helmetGroup', 'helmet_group', [0, 0.03, 0]);
      const plastic = { specular: 0.9, shininess: 64 };
      outfit.helmet = [
        part(helmet, 'helmet_shell', createHelmetShell(), [0, 0.035, -0.008], [0.15, 0.13, 0.155], headgearColor, plastic),
        part(helmet, 'helmet_brim', 'sphere', [0, 0.012, 0.148], [0.103, 0.011, 0.053], headgearColor,
          { ...plastic, rotation: [0.12, 0, 0] }),
        part(helmet, 'helmet_earflap', 'sphere', [0.132, -0.048, 0.025], [0.026, 0.072, 0.063], headgearColor,
          { ...plastic, rotation: [0, 0, -0.15] }),
        part(helmet, 'helmet_neckguard', 'sphere', [0, -0.041, -0.118], [0.114, 0.049, 0.047], headgearColor, plastic),
      ];
      part(helmet, 'helmet_earhole', 'sphere', [0.157, -0.066, 0.046], [0.004, 0.018, 0.021], [24, 28, 34]);
      emblem(helmet, 'helmet', [0, 0.05, 0.148], 0.058, 0.06);
      const grip = joint(joints.handR, 'batPivot', 'bat_pivot', [0, 0, 0]);
      joints.bat = part(grip, 'bat', createBatMesh(), [0, 0, 0], 1, [175, 125, 70], { specular: 0.14 });
      outfit.bat = [joints.bat];
    }

    return { root, joints, outfit };
  }

  const pitcher = makePlayer('pitcher', [rubber[0], rubber[1] + 0.04, rubber[2]], 0, [79, 149, 216], [33, 96, 155]);
  const batter = makePlayer('batter', [-0.95, 0.15, -0.2], Math.PI / 2, [122, 33, 112], [82, 22, 74]);
  const ballStart = [rubber[0], rubber[1] + 1.26, rubber[2] + 0.6];
  const ball = {
    id: 'baseball', primitive: 'sphere', position: [...ballStart], rotation: [0, 0, 0],
    meshScale: 0.12, color: [255, 255, 250], visible: false,
  };

  window.SCENE_MODELS = window.SCENE_MODELS ?? [];
  window.SCENE_MODELS.push(pitcher.root, batter.root, ball);
  window.PITCHER_BATTER = {
    pitcher: pitcher.root, batter: batter.root, ball, ballStart,
    pitcherJoints: pitcher.joints, batterJoints: batter.joints,
    outfitParts: { pitcher: pitcher.outfit, batter: batter.outfit },
  };
})();
