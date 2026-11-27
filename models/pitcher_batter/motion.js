'use strict';

// [역할 2] 투구와 타격 모션. 그립과 발 위치를 먼저 정하고 각 관절을 맞춘다.
(function () {
  const pb = window.PITCHER_BATTER;
  const { pitcher, batter, ball, ballStart, pitcherJoints, batterJoints } = pb;
  const PITCH_DURATION = 0.55;
  const PITCH_ARC = 0.45;
  const SWING_DURATION = 0.30;
  const CONTACT_FRACTION = 0.4;
  const SWING_LEAD = SWING_DURATION * CONTACT_FRACTION;
  const SWEET_SPOT = 0.66; // 오른손 그립에서 배트 배럴의 임팩트 지점까지 (m)
  const SECOND_GRIP = 0.085;
  let windup = null, delivery = null, flight = null, swing = null;

  const nowSec = () => performance.now() / 1000;
  const clamp = (n, min = 0, max = 1) => Math.min(max, Math.max(min, n));
  const ease = (t) => { const n = clamp(t); return n * n * (3 - 2 * n); };
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const scale = (a, s) => a.map((v) => v * s);

  function orientation(node) {
    const [x, y, z] = node.rotation;
    return multiply(multiply(rotationY(y), rotationX(x)), rotationZ(z));
  }

  function direction(m, [x, y, z]) {
    return [m[0] * x + m[4] * y + m[8] * z, m[1] * x + m[5] * y + m[9] * z, m[2] * x + m[6] * y + m[10] * z];
  }

  // 회전만 포함된 행렬의 역변환은 전치 행렬로 계산한다.
  function inverseDirection(m, [x, y, z]) {
    return [m[0] * x + m[1] * y + m[2] * z, m[4] * x + m[5] * y + m[6] * z, m[8] * x + m[9] * y + m[10] * z];
  }

  function aimDown([x, y, z]) {
    return [Math.atan2(-z, -y), 0, Math.asin(clamp(x, -1, 1))];
  }

  // 뼈 길이를 유지한 채 어깨/팔꿈치 또는 고관절/무릎을 목표점에 맞춘다.
  // bend는 팔꿈치나 무릎이 굽는 방향이고, 반환값은 마지막 관절의 부모 기준 회전이다.
  function placeLimb(upper, lower, end, target, bend) {
    const offset = sub(target, upper.position);
    const rawDistance = Math.hypot(...offset);
    const axis = rawDistance > 0.0001 ? scale(offset, 1 / rawDistance) : [0, -1, 0];
    const a = -lower.position[1], b = -end.position[1];
    const distance = clamp(rawDistance, Math.abs(a - b) + 0.0001, a + b - 0.0001);
    const along = (a * a - b * b + distance * distance) / (2 * distance);
    let pole = sub(bend, scale(axis, dot(bend, axis)));
    if (Math.hypot(...pole) < 0.0001) pole = cross(axis, Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]);
    const elbow = add(scale(axis, along), scale(normalize(pole), Math.sqrt(Math.max(0, a * a - along * along))));
    upper.rotation = aimDown(scale(elbow, 1 / a));
    const upperRotation = orientation(upper);
    const lowerDirection = scale(sub(scale(axis, distance), elbow), 1 / b);
    lower.rotation = aimDown(inverseDirection(upperRotation, lowerDirection));
    return multiply(upperRotation, orientation(lower));
  }

  // pose의 발과 손은 선수 루트 좌표계에 있으므로 상체가 돌아가도 목표를 유지한다.
  function applyBody(j, pose) {
    j.pelvis.position = pose.pelvis;
    j.pelvis.rotation[1] = pose.yaw;
    j.torso.rotation = pose.torso;
    const pelvisRotation = orientation(j.pelvis);
    const chestRotation = multiply(pelvisRotation, orientation(j.torso));
    const chestOrigin = add(j.pelvis.position, direction(pelvisRotation, j.torso.position));

    for (const [side, foot, yaw] of [['L', pose.footL, 0.13], ['R', pose.footR, -0.15]]) {
      const leg = placeLimb(j[`hip${side}`], j[`knee${side}`], j[`shoe${side}`],
        inverseDirection(pelvisRotation, sub(foot, j.pelvis.position)), inverseDirection(pelvisRotation, [0, 0, 1]));
      const legRotation = multiply(pelvisRotation, leg);
      const desired = rotationY(yaw);
      const x = inverseDirection(legRotation, desired.subarray(0, 3));
      const y = inverseDirection(legRotation, desired.subarray(4, 7));
      const z = inverseDirection(legRotation, desired.subarray(8, 11));
      j[`shoe${side}`].rotation = [Math.asin(clamp(-z[1], -1, 1)), Math.atan2(z[0], z[2]), Math.atan2(x[1], y[1])];
    }
    const rightArm = placeLimb(j.shoulderR, j.elbowR, j.handR,
      inverseDirection(chestRotation, sub(pose.handR, chestOrigin)), pose.bendR);
    placeLimb(j.shoulderL, j.elbowL, j.handL,
      inverseDirection(chestRotation, sub(pose.handL, chestOrigin)), pose.bendL);
    const handRotation = multiply(chestRotation, rightArm);
    if (pose.batAxis) {
      j.batPivot.rotation = aimDown(inverseDirection(handRotation, scale(normalize(pose.batAxis), -1)));
    }
    const rightHand = add(chestOrigin, direction(chestRotation, add(j.shoulderR.position,
      add(direction(orientation(j.shoulderR), j.elbowR.position), direction(rightArm, j.handR.position)))));
    return rightHand;
  }

  function blendPose(a, b, t) {
    const pose = {};
    for (const key of Object.keys(a)) {
      pose[key] = key === 'yaw' ? a.yaw + (b.yaw - a.yaw) * t : lerpVec3(a[key], b[key], t);
    }
    return pose;
  }

  const pitchSet = {
    pelvis: [0, 0.845, 0], yaw: 0, torso: [0.03, -0.15, 0],
    footL: [0.15, 0.018, -0.025], footR: [-0.15, 0.018, -0.025],
    handR: [-0.038, 1.28, 0.275], handL: [0.065, 1.30, 0.30],
    bendR: [-1, -0.65, 0], bendL: [1, -0.7, 0],
  };
  const pitchKick = {
    ...pitchSet, pelvis: [-0.095, 0.86, -0.04], yaw: -0.53, torso: [-0.11, -0.37, 0.14],
    footL: [0.075, 0.46, 0.14], handR: [-0.11, 1.36, 0.22], handL: [-0.015, 1.36, 0.25],
  };
  const pitchStride = {
    ...pitchSet, pelvis: [-0.035, 0.77, 0.235], yaw: -0.49, torso: [-0.09, -0.49, -0.16],
    footL: [0.195, 0.12, 0.59], handR: [-0.43, 1.59, -0.20], handL: [0.21, 1.30, 0.55],
    bendR: [-1, -0.18, 0.25],
  };
  const pitchRelease = {
    ...pitchSet, pelvis: [0.055, 0.74, 0.34], yaw: 0.40, torso: [0.5, 0.16, -0.14],
    footL: [0.185, 0, 0.62], handR: [-0.065, 1.60, 0.75], handL: [0.29, 1.14, 0.43],
    bendR: [-1, 0.45, 0],
  };
  const pitchFinish = {
    ...pitchRelease, pelvis: [0.105, 0.72, 0.39], yaw: 0.6, torso: [0.62, 0.46, -0.28],
    footR: [-0.085, 0.18, 0.20], handR: [0.31, 0.94, 0.63], handL: [0.26, 1.02, 0.36],
    bendR: [-0.75, 0, 1],
  };

  function preparePitch(duration, start = nowSec()) {
    windup = { start, duration };
  }

  function triggerPitch(target = [0, 1, 0.2], duration = PITCH_DURATION, start = nowSec()) {
    const releaseHand = applyBody(pitcherJoints, pitchRelease);
    const from = add(pitcher.position, direction(orientation(pitcher), releaseHand));
    // 공의 뒤쪽이 릴리스 프레임의 손끝과 맞닿도록 비행 방향으로 이동한다.
    const release = add(from, scale(normalize(sub(target, from)), ball.meshScale));
    ballStart.splice(0, 3, ...release);
    ball.position = release;
    ball.rotation = [0, 0, 0];
    ball.visible = true;
    windup = null;
    delivery = { start };
    flight = { start, duration, from: release, to: [...target] };
  }

  function updatePitch(time) {
    if (windup) {
      const t = clamp((time - windup.start) / windup.duration);
      let pose;
      if (t < 0.45) pose = blendPose(pitchSet, pitchKick, ease(t / 0.45));
      else if (t < 0.86) pose = blendPose(pitchKick, pitchStride, ease((t - 0.45) / 0.41));
      else pose = blendPose(pitchStride, pitchRelease, ease((t - 0.86) / 0.14));
      applyBody(pitcherJoints, pose);
    }
    if (delivery) {
      const elapsed = time - delivery.start;
      const pose = elapsed < 0.21
        ? blendPose(pitchRelease, pitchFinish, ease(elapsed / 0.21))
        : blendPose(pitchFinish, pitchSet, ease((elapsed - 0.25) / 0.49));
      applyBody(pitcherJoints, pose);
      if (elapsed >= 0.74) delivery = null;
    }
    if (flight) {
      const t = clamp((time - flight.start) / flight.duration);
      const pos = lerpVec3(flight.from, flight.to, t);
      pos[1] += 4 * t * (1 - t) * PITCH_ARC;
      ball.position = pos;
      ball.rotation[0] = t * flight.duration * 35;
      if (t === 1) flight = null;
    }
  }

  function finishPitch() {
    if (!flight) return;
    ball.position = flight.to;
    ball.rotation[0] = flight.duration * 35;
    flight = null;
  }

  const stance = {
    pelvis: [0, 0.803, 0], yaw: -0.08, torso: [0.09, -0.17, 0.02],
    footL: [0.245, 0.009, 0.02], footR: [-0.245, 0.009, -0.055],
    handR: [-0.223, 1.325, 0.272], handL: [0, 0, 0], batAxis: [-0.38, 0.88, -0.27],
    bendR: [-1, -0.12, -0.12], bendL: [1, -0.72, 0],
  };
  const load = {
    ...stance, pelvis: [-0.055, 0.785, -0.011], yaw: -0.19, torso: [0.12, -0.39, 0.08],
    handR: [-0.293, 1.35, 0.185], batAxis: [-0.35, 0.79, -0.47],
  };
  const follow = {
    ...stance, pelvis: [0.086, 0.8, 0.045], yaw: 0.63, torso: [0.19, 0.84, -0.10],
    handR: [0.25, 1.36, 0.22], batAxis: [0.76, 0.53, -0.37], bendR: [-1, -0.65, 0.15],
  };

  function batPose(pose, neckYaw) {
    const handL = sub(pose.handR, scale(normalize(pose.batAxis), SECOND_GRIP));
    applyBody(batterJoints, { ...pose, handL });
    batterJoints.neck.rotation[1] = neckYaw - pose.yaw - pose.torso[1];
  }

  function startSwing(targetPos, contactInSec = SWING_LEAD, start = nowSec()) {
    const target = inverseDirection(orientation(batter), sub(targetPos, batter.position));
    const y = target[1];
    const grip = [-0.25, clamp(y + 0.14, 0.83, 1.14), 0.25];
    const batAxis = normalize(sub(target, grip));
    const impact = {
      ...stance,
      pelvis: [-0.09, clamp(0.71 + (y - 0.7) * 0.19, 0.652, 0.84), 0.06], yaw: 0.22,
      torso: [clamp(0.22 + (0.7 - y) * 0.35, 0.08, 0.56), 0.18, 0.12],
      handR: sub(target, scale(batAxis, SWEET_SPOT)), batAxis,
    };
    swing = { called: start, start: start + contactInSec - SWING_LEAD, impact };
  }

  function updateSwing(time) {
    if (!swing) return;
    const t = (time - swing.start) / SWING_DURATION;
    let pose;
    if (t < 0) {
      pose = blendPose(stance, load, ease((time - swing.called) / (swing.start - swing.called)));
    } else if (t <= CONTACT_FRACTION) {
      const startPose = swing.start > swing.called ? load : stance;
      pose = blendPose(startPose, swing.impact, (t / CONTACT_FRACTION) ** 2);
    } else if (t <= 1) {
      pose = blendPose(swing.impact, follow, 1 - ((1 - t) / (1 - CONTACT_FRACTION)) ** 2);
    } else {
      pose = blendPose(follow, stance, ease((t - 1.35) / 1.25));
    }
    batPose(pose, 1.04 + 0.24 * ease(t));
    if (t >= 2.6) {
      swing = null;
      batPose(stance, 1.04);
    }
  }

  function resetPose() {
    windup = delivery = flight = swing = null;
    applyBody(pitcherJoints, pitchSet);
    batPose(stance, 1.04);
    ball.visible = false;
    ball.position = [...ballStart];
    ball.rotation = [0, 0, 0];
  }

  resetPose();
  const prevUpdate = window.updateBaseballScene;
  window.updateBaseballScene = function (timeSec, dt) {
    prevUpdate?.(timeSec, dt);
    updatePitch(timeSec);
    updateSwing(timeSec);
  };
  Object.assign(pb, {
    preparePitch, triggerPitch, finishPitch, isPitching: () => Boolean(flight),
    pitchDuration: PITCH_DURATION, startSwing, resetPose, swingLead: SWING_LEAD,
  });
})();
