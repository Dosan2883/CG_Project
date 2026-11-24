'use strict';

// [역할 3: 게임] 4/4 — 경기 진행
//   볼카운트·아웃·진루·득점·공수 교대·경기 종료, CPU 두뇌, 플레이어 입력
//   규칙 수치는 rules.js, 화면에 보이는 것은 effects.js(3D·소리)와 ui.js(점수판·버튼)가 맡습니다.
(function () {
  const G = window.GAME_CONTROLLER;
  const pb = window.PITCHER_BATTER;
  if (!G || !pb) return;
  const { RULES, ZONES, ZONE, rand, randInt, weighted, wait, buttonToZone, cellName, ballTarget } = G;
  const { SWING_LEAD, paintZones, startSwing, cheer, flashScoreboard, flashLights, hitFlight, resetBall, hideBall, toast, log, render } = G;
  const fielders = window.FIELDERS; // fielders.js (포수·심판·야수)

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
      half: 'top',               // top = 회 초(선공 팀 공격), bottom = 회 말(후공 팀 공격)
      order: null,               // 'offense' = 내가 선공(초에 공격), 'defense' = 내가 후공(초에 수비)
      choosing: true,            // 경기 시작 전 (타이틀·팀 고르기 화면)
      teams: null,               // { me: 'deokjin' | 'wansan', cpu: 나머지 } (rules.js의 TEAMS 키)
      score: { cpu: 0, me: 0 },
      hits: { cpu: 0, me: 0 },   // 안타 수 (1루타·2루타·홈런, 전광판 H 칸)
      line: { cpu: Array(RULES.innings).fill(null), me: Array(RULES.innings).fill(null) },
      balls: 0, strikes: 0, outs: 0,
      bases: [false, false, false],
      busy: false,               // 투구 중에는 입력을 막음
      over: false,
      lastPitchButton: 1,
      // 내 습관 기록: 칸별로 몇 번 던졌는지 (CPU 타자가 읽음)
      habit: { pitch: Array(ZONE.count).fill(0) },
      cpuRead: false,            // 이번 투구에서 CPU가 습관을 읽었는지 (결과 메시지용)
      // 내 타격(타이밍): ready(투구 받기 대기) → windup(투수 준비) → pitch(공 날아옴, 스윙 가능) → result
      batPhase: 'ready',
      swingWindow: null,         // 지금 투구의 타이밍 정보 { start, arrival, ideal, press }
      lastSwing: null,           // 마지막 스윙 결과 (타이밍 바 표시용) { ...swingWindow, error, window }
    });
    resetBall();
    paintZones();
    log('게임 시작 버튼을 눌러 주세요.');
    render();
    G.onNewGame?.(); // intro.js: 타이틀 화면 띄우기
  }

  // 팀을 고르면 1회초 시작. 선공/후공은 팀이 정함 (덕진 = 후공, 완산 = 선공)
  function startGame(myTeam) {
    if (!state.choosing) return;
    const cpuTeam = Object.keys(G.TEAMS).find((key) => key !== myTeam);
    state.teams = { me: myTeam, cpu: cpuTeam };
    state.order = G.TEAMS[myTeam].order;
    state.choosing = false;
    startHalf();
  }

  // 누가 공격하는지: 내가 선공이면 회 초에, 후공이면 회 말에 내가 공격
  const meBatsFirst = () => state.order === 'offense';
  const playerBatting = () => !state.choosing && (state.half === 'top') === meBatsFirst();
  const battingTeam = () => (playerBatting() ? 'me' : 'cpu');
  const homeTeam = () => (meBatsFirst() ? 'cpu' : 'me'); // 후공(회 말에 공격하는) 팀
  const awayTeam = () => (meBatsFirst() ? 'me' : 'cpu');
  const homeCamera = () => (playerBatting() ? 'batter' : 'pitcher');
  const battingTeamKey = () => state.teams?.[battingTeam()]; // 공격 중인 팀 ('deokjin' | 'wansan')

  function startHalf() {
    state.balls = state.strikes = state.outs = 0;
    state.bases = [false, false, false];
    const line = state.line[battingTeam()];
    if (line[state.inning - 1] == null) line[state.inning - 1] = 0;
    state.batPhase = 'ready';
    state.lastSwing = null;
    // 유니폼: 타자 = 공격 팀, 투수·포수·야수 = 수비 팀 (팀 색 + 모자·가슴 엠블럼, uniforms.js)
    G.dressTeams?.(battingTeamKey(), state.teams[battingTeam() === 'me' ? 'cpu' : 'me']);
    G.setZoneSplit?.(!playerBatting()); // 내가 수비할 때만 3칸, 공격할 때는 한 판
    fielders?.resetFielders();
    window.setCameraPreset?.(homeCamera());
    toast(`${state.inning}회${state.half === 'top' ? '초' : '말'} · ${playerBatting() ? '공격' : '수비'}`, '#9ecbff');
    log(playerBatting() ? '공격: "투구 받기"(Enter)를 누르고, 공이 오면 타이밍에 맞춰 스윙(F)!' : '수비: 던질 칸을 고르세요.');
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

    const playerIsPitcher = !playerBatting();
    paintZones(playerIsPitcher ? { [pitchZone]: 'mine' } : {}); // 공격할 때는 칸을 고르지 않으므로 표시 없음

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
    // CPU 타자: 칸이 맞으면 공을 침. 칸이 틀려도 cpuExtraContactChance 확률로 배트에 맞힘
    const contact = swingZone != null &&
      (swingZone === pitchZone || (playerIsPitcher && rand() < RULES.cpuExtraContactChance));
    if (contact) marks[pitchZone] = 'hit';
    paintZones(marks);

    const who = playerIsPitcher ? `투구 ${cellName(pitchZone)}` : `상대 투구 ${cellName(pitchZone)}`;
    // CPU가 내 습관을 읽고 고른 경우 표시
    const readTag = playerIsPitcher && state.cpuRead ? ' (CPU가 노림수!)' : '';
    const swingText = swingZone == null ? '타자 안 휘두름'
      : playerIsPitcher ? `스윙 ${cellName(swingZone)}${readTag}` : '스윙';

    if (swingZone == null) {
      if (takeCall === 'strike') await addStrike(`${who} · ${swingText} → 스트라이크`);
      else await addBall(`${who} · ${swingText} → 볼`);
    } else if (!contact) {
      await addStrike(`${who} · ${swingText} → 헛스윙 스트라이크`);
    } else {
      await ballInPlay(`${who} · ${swingText} → 맞혔다!`);
    }

    await finishPlay();
  }

  // 투구 한 번의 마무리: ① 결과 문구를 보여 줌 → ② 공을 숨김 → ③ 잠깐 뒤 다음 입력(투구·타격)을 받음
  async function finishPlay() {
    if (state.over) return;
    await wait(RESULT_SHOW_MS);
    hideBall(); // 스트라이크·볼·파울·안타·홈런 모두 끝나면 공을 숨김
    fielders?.resetMitt();
    fielders?.resetFielders();
    paintZones();
    await wait(AFTER_HIDE_MS);
    if (state.over) return;
    state.busy = false;
    state.batPhase = 'ready';
    render();
  }

  // ------------------------------------------------------------------
  // 3-2) 내 타격: 타이밍 맞춰 치기
  //   "투구 받기" → windupMs 뒤 CPU가 3칸 중 아무 데나 던짐 (속도는 pitchTime 범위에서 무작위)
  //   공이 날아오는 동안 스윙(F)을 누르면, 배트가 공 위치를 지나는 시각과 공 도착 시각의 차이로 결과가 정해짐
  // ------------------------------------------------------------------
  const B = RULES.batting;
  const lastWindow = () => B.windows[B.windows.length - 1].within;

  async function requestPitch() {
    if (state.busy || state.over || !playerBatting()) return;
    state.busy = true;
    state.batPhase = 'windup';
    state.lastSwing = null;
    paintZones();
    log('상대 투수가 던질 준비를 해요…');
    render();
    await wait(B.windupMs);
    if (state.over) return;

    const pitchZone = randInt(ZONE.count);
    const takeCall = weighted(RULES.takeOdds); // 스윙하지 않았을 때의 판정 (볼이면 존 바깥으로 빗나감)
    const target = takeCall === 'ball' ? ballTarget(pitchZone) : ZONES[pitchZone].target;
    const [minTime, maxTime] = B.pitchTime;
    const travel = minTime + rand() * (maxTime - minTime);
    const start = G.nowSec();
    state.swingWindow = { start, arrival: start + travel, ideal: start + travel - SWING_LEAD, press: null, zone: pitchZone };
    state.batPhase = 'pitch';
    log('공이 온다! 타이밍에 맞춰 스윙 (F)');
    render();
    pb.triggerPitch(target, travel);
    fielders?.catchAt(target, travel * 0.8);

    // 공이 도착하고, 늦게 누를 수 있는 시간까지 기다림
    await wait((travel + lastWindow() + 0.05) * 1000);
    const w = state.swingWindow;
    state.swingWindow = null;
    state.batPhase = 'result';
    await resolveSwing(w, takeCall, pitchZone);
    await finishPlay();
  }

  // 스윙 버튼(F): 공이 날아오는 동안 한 번만. 누른 순간 배트를 휘두름
  function pressSwing() {
    const w = state.swingWindow;
    if (state.batPhase !== 'pitch' || !w || w.press != null) return;
    w.press = G.nowSec();
    startSwing(w.zone, SWING_LEAD); // 누른 뒤 SWING_LEAD초에 배트가 공 위치를 지남
    render();
  }

  async function resolveSwing(w, takeCall, pitchZone) {
    const who = `상대 투구 ${cellName(pitchZone)}`;
    if (w.press == null) { // 스윙 안 함 → 스트라이크/볼
      state.lastSwing = { ...w, error: null, window: null };
      render();
      paintZones({ [pitchZone]: 'cpu' });
      if (takeCall === 'strike') await addStrike(`${who} · 스윙 안 함 → 스트라이크`);
      else await addBall(`${who} · 스윙 안 함 → 볼`);
      return;
    }
    const error = w.press + SWING_LEAD - w.arrival; // 음수 = 빠름, 양수 = 늦음
    const hit = B.windows.find((win) => Math.abs(error) <= win.within) ?? null;
    state.lastSwing = { ...w, error, window: hit };
    render();
    const ms = Math.round(Math.abs(error) * 1000);
    const timingText = hit?.key === 'perfect' ? `${hit.label}` : `${error < 0 ? '빨랐어요' : '늦었어요'} ${ms}ms`;
    paintZones({ [pitchZone]: hit ? 'hit' : 'cpu' });
    if (!hit) {
      await addStrike(`${who} · 스윙 (${timingText}) → 헛스윙 스트라이크`);
      return;
    }
    const kind = weighted(hit.odds);
    const swingText = `${who} · 스윙 (${hit.label}, ${error < 0 ? '-' : '+'}${ms}ms)`;
    if (kind === 'strike') { // 타이밍은 근처였지만 배트에 안 맞음
      paintZones({ [pitchZone]: 'cpu' });
      await addStrike(`${swingText} → 헛스윙 스트라이크`);
      return;
    }
    toast(hit.label, '#ffe27a', 900);
    await ballInPlay(`${swingText} → 맞혔다!`, kind);
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
  //   kind를 주지 않으면 RULES.hitOdds로 뽑음 (CPU 타자), 내 타격은 타이밍 결과로 정한 kind를 넘김
  async function ballInPlay(message, kind = weighted(RULES.hitOdds)) {
    cheer(0.8, 2.2); // 공을 친 순간 함성
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
      state.hits[battingTeam()]++;
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
      state.hits[battingTeam()]++;
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
  // 마지막 회 말에 후공 팀이 앞서면 바로 경기 끝 (끝내기)
  async function checkWalkOff() {
    const home = homeTeam(), away = awayTeam();
    if (state.half === 'bottom' && state.inning === RULES.innings && state.score[home] > state.score[away]) {
      await wait(1200);
      endGame(home === 'me' ? '끝내기 승리!' : '끝내기 패배');
    }
  }

  async function endHalf() {
    if (state.half === 'top') {
      // 마지막 회 초가 끝났는데 후공 팀이 이미 앞서면 마지막 회 말은 하지 않음
      const home = homeTeam();
      if (state.inning === RULES.innings && state.score[home] > state.score[awayTeam()]) {
        state.line[home][state.inning - 1] = 'X';
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
  // 5) CPU 두뇌
  //   CPU 타자: 평소엔 아무 칸에나 휘두르지만, cpuReadChance 확률로 내가 가장 많이 던진 칸에 휘두름
  //            칸이 틀려도 cpuExtraContactChance 확률로 공을 맞힘
  //   CPU 투수: 3칸 중 아무 데나 던짐 (내 타격은 타이밍으로 정해지므로 읽을 습관이 없음)
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

  // ------------------------------------------------------------------
  // 6) 플레이어 입력 (ui.js 버튼과 Q 키가 부름)
  // ------------------------------------------------------------------
  function onPitchButton(button) {
    if (state.busy || state.over || state.choosing || playerBatting()) return;
    state.lastPitchButton = button;
    const pitchZone = buttonToZone(button);
    state.cpuRead = false;
    const swingZone = cpuSwingZone();
    state.habit.pitch[pitchZone]++;
    playPitch(pitchZone, swingZone);
  }

  // 키보드 (한글 입력 상태에서도 동작하도록 e.code 사용)
  //   Q: 마지막 칸으로 다시 던지기(수비) / Enter: 투구 받기(공격) / F: 스윙(공격)
  //   Space는 카메라 위로 이동에 쓰여서 스윙 키로 쓰지 않음
  window.addEventListener('keydown', (e) => {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.repeat) return;
    if (e.code === 'KeyQ') onPitchButton(state.lastPitchButton);
    else if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); requestPitch(); }
    else if (e.code === 'KeyF') pressSwing();
  });

  Object.assign(G, { state, newGame, startGame, playerBatting, awayTeam, homeTeam, battingTeamKey, onPitchButton, requestPitch, pressSwing });

  // 카메라·조명 스크립트가 준비된 뒤 시작 (app.js가 첫 프레임을 그리기 전)
  newGame();
})();
