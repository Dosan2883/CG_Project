'use strict';

// [역할 3: 게임] 4/4 — 경기 진행
//   볼카운트·아웃·진루·득점·공수 교대·경기 종료, CPU 두뇌, 플레이어 입력
//   규칙 수치는 rules.js, 화면에 보이는 것은 effects.js(3D·소리)와 ui.js(점수판·버튼)가 맡습니다.
(function () {
  const G = window.GAME_CONTROLLER;
  const pb = window.PITCHER_BATTER;
  if (!G || !pb) return;
  const { RULES, ZONES, ZONE, rand, randInt, weighted, wait, buttonToZone, cellName, ballTarget } = G;
  const { paintZones, startSwing, cheer, flashScoreboard, flashLights, hitFlight, resetBall, hideBall, toast, log, render } = G;
  const fielders = window.FIELDERS; // fielders.js (포수·심판·야수)

  const ME_COLOR = [40, 100, 220], CPU_COLOR = [220, 60, 60];
  // 한 번의 투구가 끝난 뒤: 결과 문구를 보여 주는 시간 → 공을 숨긴 뒤 다음 입력까지 쉬는 시간 (밀리초)
  const RESULT_SHOW_MS = 1000;
  const AFTER_HIDE_MS = 400;

  // ------------------------------------------------------------------
  // 1) 게임 상태
  // ------------------------------------------------------------------
  const state = {};
  function newGame() {
    Object.assign(state, {
      inning: 1,
      half: 'top',               // top = CPU 공격(내가 수비), bottom = 내가 공격
      score: { cpu: 0, me: 0 },
      line: { cpu: Array(RULES.innings).fill(null), me: Array(RULES.innings).fill(null) },
      balls: 0, strikes: 0, outs: 0,
      bases: [false, false, false],
      busy: false,               // 투구 중에는 입력을 막음
      over: false,
      batMode: 'choose',         // 말 공격: choose(휘두를지 고르기) / aim(칸 고르기)
      lastPitchButton: 1,
      // 내 습관 기록: 칸별로 몇 번 던졌는지 / 휘둘렀는지 (CPU가 읽음)
      habit: { pitch: Array(ZONE.count).fill(0), swing: Array(ZONE.count).fill(0) },
      cpuRead: false,            // 이번 투구에서 CPU가 습관을 읽었는지 (결과 메시지용)
    });
    resetBall();
    paintZones();
    startHalf();
  }

  const battingTeam = () => (state.half === 'top' ? 'cpu' : 'me');
  const homeCamera = () => (state.half === 'top' ? 'pitcher' : 'batter');

  function startHalf() {
    state.balls = state.strikes = state.outs = 0;
    state.bases = [false, false, false];
    state.batMode = 'choose';
    const line = state.line[battingTeam()];
    if (line[state.inning - 1] == null) line[state.inning - 1] = 0;
    // 공격 팀 색: CPU 빨강, 나 파랑 (투수·수비수는 반대 팀 색)
    pb.batter.color = state.half === 'top' ? CPU_COLOR : ME_COLOR;
    pb.pitcher.color = state.half === 'top' ? ME_COLOR : CPU_COLOR;
    fielders?.setTeamColor(pb.pitcher.color);
    fielders?.resetFielders();
    window.setCameraPreset?.(homeCamera());
    toast(`${state.inning}회${state.half === 'top' ? '초 · 수비' : '말 · 공격'}`, '#9ecbff');
    log(state.half === 'top' ? '수비: 던질 칸을 고르세요.' : '공격: 배트를 휘두를지 고르세요.');
    render();
  }

  // ------------------------------------------------------------------
  // 2) 득점과 진루
  // ------------------------------------------------------------------
  function scoreRuns(n) {
    if (n <= 0) return;
    const team = battingTeam();
    state.score[team] += n;
    state.line[team][state.inning - 1] += n;
  }

  // 안타: 주자와 타자가 n루씩 진루 (n = 4면 홈런)
  function advance(n) {
    let runs = 0;
    const next = [false, false, false];
    for (let i = 2; i >= 0; i--) {
      if (!state.bases[i]) continue;
      if (i + n >= 3) runs++;
      else next[i + n] = true;
    }
    if (n >= 4) runs++;
    else next[n - 1] = true;
    state.bases = next;
    scoreRuns(runs);
    return runs;
  }

  // 볼넷: 밀려나는 주자만 진루
  function walk() {
    const b = state.bases;
    let runs = 0;
    if (b[0]) {
      if (b[1]) {
        if (b[2]) runs = 1;
        b[2] = true;
      }
      b[1] = true;
    }
    b[0] = true;
    scoreRuns(runs);
    return runs;
  }

  const runsText = (runs) => (runs > 0 ? ` ${runs}점 득점!` : '');

  // ------------------------------------------------------------------
  // 3) 한 번의 투구 진행
  //   pitchZone: 공이 가는 칸, swingZone: 타자가 휘두른 칸 (안 휘두르면 null)
  // ------------------------------------------------------------------
  async function playPitch(pitchZone, swingZone) {
    state.busy = true;
    render();

    const playerIsPitcher = state.half === 'top';
    paintZones(playerIsPitcher ? { [pitchZone]: 'mine' } : swingZone != null ? { [swingZone]: 'mine' } : {});

    // 안 휘두르면 스트라이크/볼을 던지기 전에 정함 → 볼이면 고른 칸 바로 바깥으로 살짝 빗나감
    const takeCall = swingZone == null ? weighted(RULES.takeOdds) : null;
    const target = takeCall === 'ball' ? ballTarget(pitchZone) : ZONES[pitchZone].target;

    const travel = pb.pitchDuration;
    pb.triggerPitch(target);
    fielders?.catchAt(target, travel * 0.8);
    if (swingZone != null) startSwing(swingZone, travel); // 공이 도착하는 순간 배트가 홈플레이트 위를 지남
    await wait(travel * 1000 + 80);

    // 도착 후 상대(CPU)의 선택을 보여줌: 내 칸 노랑, CPU 칸 빨강, 맞힌 칸 초록
    const marks = {};
    if (playerIsPitcher) {
      if (swingZone != null) marks[swingZone] = 'cpu';
      marks[pitchZone] = 'mine';
    } else {
      marks[pitchZone] = 'cpu';
      if (swingZone != null) marks[swingZone] = 'mine';
    }
    const contact = swingZone != null && swingZone === pitchZone;
    if (contact) marks[pitchZone] = 'hit';
    paintZones(marks);

    const who = playerIsPitcher ? `투구 ${cellName(pitchZone)}` : `상대 투구 ${cellName(pitchZone)}`;
    // CPU가 내 습관을 읽고 고른 경우 표시
    const readTag = state.cpuRead ? (playerIsPitcher ? ' (CPU가 노림수!)' : ' (CPU가 습관을 읽고 피함!)') : '';
    const swingText = (swingZone == null ? '타자 안 휘두름' : `스윙 ${cellName(swingZone)}`) + readTag;

    if (swingZone == null) {
      if (takeCall === 'strike') await addStrike(`${who} · ${swingText} → 스트라이크`);
      else await addBall(`${who} · ${swingText} → 볼`);
    } else if (!contact) {
      await addStrike(`${who} · ${swingText} → 헛스윙 스트라이크`);
    } else {
      await ballInPlay(`${who} · ${swingText} → 맞혔다!`);
    }

    // 마무리 순서: ① 결과 문구를 보여 줌 → ② 공을 숨김 → ③ 잠깐 뒤 다음 입력(투구·타격)을 받음
    if (!state.over) {
      await wait(RESULT_SHOW_MS);
      hideBall(); // 스트라이크·볼·파울·안타·홈런 모두 끝나면 공을 숨김
      fielders?.resetMitt();
      fielders?.resetFielders();
      paintZones();
      await wait(AFTER_HIDE_MS);
      if (state.over) return;
      state.busy = false;
      state.batMode = 'choose';
      render();
    }
  }

  async function addStrike(message) {
    state.strikes++;
    fielders?.callStrike(); // 주심 스트라이크 콜
    if (state.strikes >= 3) {
      log(`${message} · 삼진 아웃!`);
      toast('삼진 아웃!', '#ff8a8a');
      cheer(0.9, 2.2);
      await addOut();
    } else {
      log(message);
      toast('스트라이크!', '#ffd84a');
      render();
    }
  }

  async function addBall(message) {
    state.balls++;
    if (state.balls >= 4) {
      const runs = walk();
      log(`${message} · 볼넷 출루${runsText(runs)}`);
      toast(`볼넷!${runsText(runs)}`, '#8affb0');
      endAtBat();
      await checkWalkOff();
    } else {
      log(message);
      toast('볼', '#8affb0');
      render();
    }
  }

  function endAtBat() {
    state.balls = state.strikes = 0;
    render();
  }

  async function addOut() {
    state.outs++;
    endAtBat();
    if (state.outs >= 3) {
      await wait(1100);
      await endHalf();
    }
  }

  // 공을 맞혔을 때: 파울 / 1루타 / 2루타 / 홈런
  async function ballInPlay(message) {
    cheer(0.8, 2.2); // 공을 친 순간 함성
    const kind = weighted(RULES.hitOdds);
    const names = { foul: '파울', single: '1루타', double: '2루타', homerun: '홈런' };

    if (kind === 'foul') {
      await hitFlight('foul');
      if (state.strikes < 2) state.strikes++; // 2스트라이크에서는 파울이 카운트되지 않음
      log(`${message} 파울 (${state.strikes}스트라이크)`);
      toast('파울!', '#ffd84a');
      render();
      return;
    }

    if (kind === 'homerun') {
      toast('홈런!!!', '#ffb347');
      flashScoreboard(5); // 전광판 깜빡임 (낮·밤 모두)
      flashLights(5);     // 경기장 조명 깜빡임 (밤에만, 낮에는 아무 일 없음)
      cheer(1.6, 4.5);
      window.setCameraPreset?.('overview');
      await hitFlight('homerun');
      await wait(600);
      window.setCameraPreset?.(homeCamera());
      const runs = advance(4);
      log(`${message} 홈런!! ${runs}점 득점!`);
      toast(`홈런!!! ${runs}점`, '#ffb347');
      endAtBat();
      await checkWalkOff();
      return;
    }

    // 1·2루타 타구 → 수비 판정
    window.setCameraPreset?.('overview');
    // 수비 성공 여부를 먼저 정해서, 성공이면 야수가 공 떨어지는 곳에 맞춰 도착
    const defended = weighted(RULES.defenseOdds) === 'success';
    let chaser = '';
    await hitFlight(kind, (to, duration) => { chaser = fielders?.chaseBall(to, duration, defended) ?? ''; });
    await wait(500);
    window.setCameraPreset?.(homeCamera());
    if (defended) {
      log(`${message} ${names[kind]} 타구 → ${chaser} 수비 성공, 아웃!`);
      toast('수비 성공! 아웃', '#ff8a8a');
      cheer(1.0, 2.2); // 타자 아웃 함성
      await addOut();
    } else {
      const runs = advance(kind === 'single' ? 1 : 2);
      log(`${message} ${names[kind]}!${runsText(runs)}`);
      toast(`${names[kind]}!${runsText(runs)}`, '#8affb0');
      endAtBat();
      await checkWalkOff();
    }
  }

  // ------------------------------------------------------------------
  // 4) 공수 교대와 경기 종료
  // ------------------------------------------------------------------
  // 5회말에 내가 앞서면 바로 경기 끝 (끝내기)
  async function checkWalkOff() {
    if (state.half === 'bottom' && state.inning === RULES.innings && state.score.me > state.score.cpu) {
      await wait(1200);
      endGame('끝내기 승리!');
    }
  }

  async function endHalf() {
    if (state.half === 'top') {
      // 5회초가 끝났는데 내가 이미 앞서면 5회말은 하지 않음
      if (state.inning === RULES.innings && state.score.me > state.score.cpu) {
        state.line.me[state.inning - 1] = 'X';
        endGame();
        return;
      }
      state.half = 'bottom';
    } else {
      if (state.inning === RULES.innings) {
        endGame();
        return;
      }
      state.inning++;
      state.half = 'top';
    }
    startHalf();
  }

  function endGame(prefix = '') {
    state.over = true;
    state.busy = false;
    hideBall();
    paintZones();
    const { me, cpu } = state.score;
    const result = me > cpu ? '승리!' : me < cpu ? '패배' : '무승부';
    toast(`경기 종료 · ${prefix || result}`, me > cpu ? '#8affb0' : '#ff8a8a', 3500);
    log(`경기 종료 — 나 ${me} : ${cpu} CPU (${result})`);
    if (me > cpu) cheer(1.4, 4);
    render();
  }

  // ------------------------------------------------------------------
  // 5) CPU 두뇌: 평소엔 아무 칸이나 고르지만, cpuReadChance 확률로 내 습관을 읽음
  //   CPU 타자: 내가 가장 많이 던진 칸에 휘두름
  //   CPU 투수: 내가 가장 많이 휘두른 칸을 피해서 던짐
  //   기록이 cpuReadMinSamples보다 적으면 아직 읽지 못함. 기록은 경기마다 새로 시작
  // ------------------------------------------------------------------
  function favoriteZone(counts) {
    const total = counts.reduce((a, b) => a + b, 0);
    if (total < RULES.cpuReadMinSamples) return null;
    const max = Math.max(...counts);
    const tops = counts.map((c, i) => (c === max ? i : -1)).filter((i) => i >= 0);
    return tops[randInt(tops.length)]; // 동점이면 그중 아무거나
  }

  function cpuSwingZone() {
    if (rand() >= RULES.cpuSwingChance) return null; // 안 휘두름
    const fav = rand() < RULES.cpuReadChance ? favoriteZone(state.habit.pitch) : null;
    state.cpuRead = fav != null;
    return fav ?? randInt(ZONE.count);
  }

  function cpuPitchZone() {
    const fav = rand() < RULES.cpuReadChance ? favoriteZone(state.habit.swing) : null;
    state.cpuRead = fav != null;
    if (fav == null) return randInt(ZONE.count);
    const others = ZONES.map((_, i) => i).filter((i) => i !== fav);
    return others[randInt(others.length)];
  }

  // ------------------------------------------------------------------
  // 6) 플레이어 입력 (ui.js 버튼과 Q 키가 부름)
  // ------------------------------------------------------------------
  function onPitchButton(button) {
    if (state.busy || state.over || state.half !== 'top') return;
    state.lastPitchButton = button;
    const pitchZone = buttonToZone(button);
    state.cpuRead = false;
    const swingZone = cpuSwingZone();
    state.habit.pitch[pitchZone]++;
    playPitch(pitchZone, swingZone);
  }

  function onSwingButton(button) {
    if (state.busy || state.over || state.half !== 'bottom') return;
    const swingZone = buttonToZone(button);
    const pitchZone = cpuPitchZone(); // 이번 스윙을 기록하기 전에 정함 (미리 보고 피하지 않도록)
    state.habit.swing[swingZone]++;
    playPitch(pitchZone, swingZone);
  }

  function onTake() {
    if (state.busy || state.over || state.half !== 'bottom') return;
    playPitch(cpuPitchZone(), null);
  }

  // Q 키(한글 입력 상태에서도 동작하도록 e.code 사용): 마지막 칸으로 다시 던지기
  window.addEventListener('keydown', (e) => {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.code === 'KeyQ' && !e.repeat) onPitchButton(state.lastPitchButton);
  });

  Object.assign(G, { state, newGame, onPitchButton, onSwingButton, onTake });

  // 카메라·조명 스크립트가 준비된 뒤 시작 (app.js가 첫 프레임을 그리기 전)
  newGame();
})();
