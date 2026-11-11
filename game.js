(() => {
  'use strict';
  const canvas = document.querySelector('#pitch');
  const ctx = canvas.getContext('2d', { alpha: false });
  const $ = (s) => document.querySelector(s);
  const homeScoreEl = $('#home-score'), awayScoreEl = $('#away-score'), clockEl = $('#clock');
  const menu = $('#menu-screen'), pauseScreen = $('#pause-screen'), resultScreen = $('#result-screen');
  const W = 1000, H = 600, field = { l: 56, r: 944, t: 42, b: 558 };
  const GOAL_TOP = 247, GOAL_BOTTOM = 353;
  const keys = new Set();
  const mobile = matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  if (mobile) document.body.classList.add('mobile');

  let width = 0, height = 0, dpr = 1, scale = 1, offsetX = 0, offsetY = 0, verticalPitch = false;
  let state = 'menu', home = [], away = [], ball, score = [0, 0], timeLeft = 75;
  let round = 1, best = Number(localStorage.getItem('pes-best') || 0), player, lastTime = 0;
  let particles = [], shake = 0, goalFreeze = 0, bannerTimer = 0, burst = 100, burstActive = false, burstCooldown = 0;
  let soundOn = true, audioCtx = null, musicTimer = null, musicStep = 0, toastTimer = 0, joystick = { x: 0, y: 0, active: false, pointer: null }, lastAim = { x: 1, y: 0 };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const random = (a, b) => a + Math.random() * (b - a);

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = rect.width; height = rect.height; dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    verticalPitch = mobile && height > width;
    scale = verticalPitch ? Math.min((width - 26) / H, (height - 330) / W) : Math.min(width / W, height / H);
    offsetX = (width - (verticalPitch ? H : W) * scale) / 2;
    offsetY = verticalPitch ? 166 + (height - 330 - W * scale) / 2 : (height - H * scale) / 2;
  }
  window.addEventListener('resize', resize); resize();

  function playerObj(team, i, x, y, role) {
    return { team, i, x, y, homeX: x, homeY: y, vx: 0, vy: 0, dirX: team === 'home' ? 1 : -1, dirY: 0, role, radius: role === 'GK' ? 14 : 13, speed: role === 'GK' ? 2.15 : 2.5, kickCooldown: 0, tackle: 0, anim: random(0, 6), stun: 0 };
  }
  function setupMatch() {
    home = [playerObj('home', 0, 315, 300, 'FW'), playerObj('home', 1, 255, 195, 'MF'), playerObj('home', 2, 255, 405, 'MF'), playerObj('home', 3, 140, 300, 'DF'), playerObj('home', 4, 83, 300, 'GK')];
    away = [playerObj('away', 0, 685, 300, 'FW'), playerObj('away', 1, 745, 195, 'MF'), playerObj('away', 2, 745, 405, 'MF'), playerObj('away', 3, 860, 300, 'DF'), playerObj('away', 4, 917, 300, 'GK')];
    player = home[0]; ball = { x: 347, y: 300, vx: 0, vy: 0, owner: player, radius: 8, spin: 0, lastTeam: 'home' };
    score = [0, 0]; timeLeft = 75; burst = 100; burstCooldown = 0; particles = []; goalFreeze = 0;
    homeScoreEl.textContent = '0'; awayScoreEl.textContent = '0'; updateClock(); updatePower();
    $('#level-chip').textContent = `ROUND ${String(round).padStart(2, '0')} / 03`;
    $('#match-label').textContent = `STREET LEAGUE · MATCH ${String(round).padStart(2, '0')}`;
  }
  function startMatch() {
    setupMatch(); state = 'playing'; menu.classList.add('hidden'); pauseScreen.classList.add('hidden'); resultScreen.classList.add('hidden');
    $('#controls-hint').style.opacity = mobile ? '0' : '1'; say('First to three. Make it count.', 1800); tone(520, .08, 'sine', .035); startMusic();
  }
  function pauseGame() { if (state !== 'playing') return; state = 'paused'; pauseScreen.classList.remove('hidden'); }
  function resumeGame() { if (state !== 'paused') return; state = 'playing'; pauseScreen.classList.add('hidden'); lastTime = performance.now(); }
  function updateClock() { const elapsed = Math.max(0, Math.ceil(timeLeft)); const m = Math.floor(elapsed / 60), s = elapsed % 60; clockEl.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; }
  function updatePower() { $('#power-fill').style.width = `${burst}%`; }
  function say(text, duration = 1600) { const el = $('#toast'); el.textContent = text; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), duration); }
  function tone(freq, duration = .1, type = 'triangle', volume = .045) {
    if (!soundOn) return;
    try { audioCtx ||= new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === 'suspended') audioCtx.resume(); const osc = audioCtx.createOscillator(), gain = audioCtx.createGain(); osc.type = type; osc.frequency.setValueAtTime(freq, audioCtx.currentTime); gain.gain.setValueAtTime(volume, audioCtx.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audioCtx.currentTime + duration); osc.connect(gain); gain.connect(audioCtx.destination); osc.start(); osc.stop(audioCtx.currentTime + duration); } catch (_) {}
  }
  function startMusic() {
    if (musicTimer || !soundOn) return;
    const notes = [110, 164.81, 146.83, 196, 123.47, 164.81, 185, 146.83];
    musicTimer = setInterval(() => { if (!soundOn || state !== 'playing') return; const base = notes[musicStep++ % notes.length]; tone(base, .24, 'sine', .009); if (musicStep % 2 === 0) tone(base * 2, .11, 'triangle', .004); }, 390);
  }
  function emit(x, y, color, count = 10, speed = 3) { for (let i = 0; i < count; i++) { const a = random(0, Math.PI * 2), v = random(.6, speed); particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: random(.35, .9), max: .9, size: random(2, 5), color }); } }
  function celebrate(side) {
    score[side === 'home' ? 0 : 1]++; homeScoreEl.textContent = score[0]; awayScoreEl.textContent = score[1];
    goalFreeze = 1.15; shake = 9; bannerTimer = 1.65;
    const banner = $('#event-banner'); banner.innerHTML = side === 'home' ? 'GOAL<span>!</span> <em>NORTHSIDE</em>' : '<em>GOAL!</em> RIVALS'; banner.classList.remove('show'); void banner.offsetWidth; banner.classList.add('show');
    for (let i = 0; i < 75; i++) emit(random(field.l, field.r), random(field.t, field.b), Math.random() > .5 ? '#d8ff3f' : '#f5f7ef', 1, 5);
    tone(580, .17, 'sawtooth', .07); setTimeout(() => tone(760, .25, 'triangle', .05), 100);
    setTimeout(() => { if (state === 'playing') kickoff(side === 'home' ? 'away' : 'home'); }, 1150);
    if (score[0] >= 3 || score[1] >= 3) setTimeout(finishMatch, 1450);
  }
  function kickoff(side) {
    home.forEach((p, i) => { p.x = [315, 255, 255, 140, 83][i]; p.y = [300, 195, 405, 300, 300][i]; p.vx = p.vy = 0; });
    away.forEach((p, i) => { p.x = [685, 745, 745, 860, 917][i]; p.y = [300, 195, 405, 300, 300][i]; p.vx = p.vy = 0; });
    ball.x = 500; ball.y = 300; ball.vx = ball.vy = 0; ball.owner = null;
    const team = side === 'home' ? home : away; ball.owner = team[0]; ball.lastTeam = side; player = home[0];
    if (side === 'away') { const opponent = away[0], dx = 1, dy = clamp((300 - opponent.y) / 140, -.35, .35); releaseBall(opponent, -dx * 4.4, dy * 4.4, 'pass'); }
    say(side === 'home' ? 'Your ball. Go!' : 'They have the restart!', 1100);
  }
  function finishMatch() {
    if (state !== 'playing') return;
    state = 'result'; const won = score[0] > score[1];
    $('#result-stamp').textContent = score[0] === score[1] ? 'DRAW' : won ? 'FULL TIME · WINNER' : 'FULL TIME';
    $('#result-title').innerHTML = score[0] === score[1] ? 'EVEN<br><em>STEVEN.</em>' : won ? 'WHAT A<br><em>WIN.</em>' : 'BACK<br><em>SOON.</em>';
    $('#result-copy').textContent = won ? 'You own this pitch. The next crew is waiting.' : score[0] === score[1] ? 'One more round will settle it.' : 'Shake it off. Legends come back stronger.';
    $('#result-score').textContent = `${score[0]} — ${score[1]}`;
    const total = score[0] * 100 + score[1] * 15 + round * 20;
    if (total > best) { best = total; localStorage.setItem('pes-best', String(best)); $('#best-score').textContent = best; }
    $('#continue-btn').querySelector('span').textContent = won && round < 3 ? 'PLAY NEXT ROUND' : 'PLAY AGAIN';
    resultScreen.classList.remove('hidden'); tone(won ? 690 : 200, .35, 'triangle', .05);
  }
  function buttonKick(kind) {
    if (state !== 'playing' || goalFreeze > 0) return;
    let owner = ball.owner;
    if (owner?.team === 'home') {
      const p = owner;
      if (kind === 'shoot') {
        let aimY = (300 - p.y) * .28 + lastAim.y * 45;
        let dx = 1, dy = clamp(aimY / 100, -.48, .48); const len = Math.hypot(dx, dy); dx /= len; dy /= len;
        releaseBall(p, dx * 11.4, dy * 11.4, 'shoot'); emit(ball.x, ball.y, '#eaffaa', 7, 2.5); tone(190, .12, 'square', .055);
      } else {
        const target = home.filter(t => t !== p && t.role !== 'GK').sort((a, b) => dist(a, p) - dist(b, p))[0] || home[1];
        const dx = target.x - p.x, dy = target.y - p.y, len = Math.hypot(dx, dy) || 1;
        releaseBall(p, dx / len * 8.2, dy / len * 8.2, 'pass'); tone(340, .07, 'triangle', .04);
        setTimeout(() => { if (state === 'playing' && ball.owner && ball.owner.team === 'home') player = ball.owner; }, 250);
      }
    } else if (kind === 'shoot') {
      // A timely tackle steals the ball when an opponent is within reach.
      const nearby = home.filter(p => p !== home[4]).sort((a, b) => dist(a, owner || ball) - dist(b, owner || ball))[0];
      if (nearby && dist(nearby, owner || ball) < 47) { nearby.tackle = .25; const dx = nearby.x - (owner || ball).x, dy = nearby.y - (owner || ball).y; ball.owner = nearby; ball.vx = ball.vy = 0; ball.lastTeam = 'home'; player = nearby; say('CLEAN WIN!', 650); emit(nearby.x, nearby.y, '#d8ff3f', 8, 2); tone(430, .08, 'square', .04); }
    }
  }
  function releaseBall(p, vx, vy, action) { ball.owner = null; ball.x = p.x + p.dirX * 17; ball.y = p.y + p.dirY * 17; ball.vx = vx; ball.vy = vy; ball.lastTeam = p.team; p.kickCooldown = .35; }
  function tryBurst(active, dt) {
    if (active && burst >= 35 && burstCooldown <= 0) { burstActive = true; burst = Math.max(0, burst - 35 * dt); if (Math.random() < .18) emit(player.x, player.y + 13, '#d8ff3f', 1, 1); }
    else { burstActive = false; burst = Math.min(100, burst + 14 * dt); }
    burstCooldown = Math.max(0, burstCooldown - dt); updatePower();
  }
  function getInput() {
    let x = 0, y = 0;
    if (keys.has('a') || keys.has('arrowleft')) x--; if (keys.has('d') || keys.has('arrowright')) x++;
    if (keys.has('w') || keys.has('arrowup')) y--; if (keys.has('s') || keys.has('arrowdown')) y++;
    if (joystick.active) { x += joystick.x; y += joystick.y; }
    const n = Math.hypot(x, y); if (n > 1) { x /= n; y /= n; }
    return { x, y, sprint: keys.has('shift') || (joystick.active && keys.has('touch-sprint')) };
  }
  function movePlayer(p, tx, ty, speed, dt) {
    let dx = tx, dy = ty, n = Math.hypot(dx, dy); if (n > 1) { dx /= n; dy /= n; }
    p.vx += (dx * speed - p.vx) * Math.min(1, dt * 12); p.vy += (dy * speed - p.vy) * Math.min(1, dt * 12);
    p.x = clamp(p.x + p.vx * dt * 60, field.l + p.radius, field.r - p.radius); p.y = clamp(p.y + p.vy * dt * 60, field.t + p.radius, field.b - p.radius);
    if (Math.hypot(p.vx, p.vy) > .3) { p.dirX = p.vx / Math.hypot(p.vx, p.vy); p.dirY = p.vy / Math.hypot(p.vx, p.vy); }
    p.anim += Math.hypot(p.vx, p.vy) * dt * 3;
  }
  function update(dt) {
    if (state !== 'playing') return;
    if (goalFreeze > 0) { goalFreeze -= dt; particlesUpdate(dt); return; }
    timeLeft -= dt; updateClock(); if (timeLeft <= 0) { timeLeft = 0; updateClock(); finishMatch(); return; }
    const input = getInput(); tryBurst(input.sprint || keys.has('q'), dt);
    const baseSpeed = burstActive ? 3.9 : 2.55;
    movePlayer(player, input.x, input.y, baseSpeed, dt);
    if (input.x || input.y) lastAim = { x: input.x || lastAim.x, y: input.y };
    const difficulty = 1 + (round - 1) * .13;
    for (const p of home) {
      if (p === player) continue;
      aiMove(p, home, away, dt, difficulty);
    }
    for (const p of away) aiMove(p, away, home, dt, difficulty);
    if (ball.owner) {
      const o = ball.owner; ball.x = o.x + o.dirX * 15; ball.y = o.y + o.dirY * 15; ball.spin += dt * 8;
      if (o.team === 'away') aiKick(o, dt, difficulty);
    } else {
      ball.x += ball.vx * dt * 60; ball.y += ball.vy * dt * 60; ball.spin += Math.hypot(ball.vx, ball.vy) * dt * .3;
      const damp = Math.pow(.984, dt * 60); ball.vx *= damp; ball.vy *= damp;
      if (ball.y < field.t + 8 || ball.y > field.b - 8) { ball.y = clamp(ball.y, field.t + 8, field.b - 8); ball.vy *= -.72; tone(150, .04, 'sine', .012); }
      if (ball.x < field.l && (ball.y < GOAL_TOP || ball.y > GOAL_BOTTOM)) { ball.x = field.l + 5; ball.vx = Math.abs(ball.vx) * .75; }
      if (ball.x > field.r && (ball.y < GOAL_TOP || ball.y > GOAL_BOTTOM)) { ball.x = field.r - 5; ball.vx = -Math.abs(ball.vx) * .75; }
      if (ball.x < 34 && ball.y > GOAL_TOP && ball.y < GOAL_BOTTOM) { celebrate('away'); return; }
      if (ball.x > 966 && ball.y > GOAL_TOP && ball.y < GOAL_BOTTOM) { celebrate('home'); return; }
      collectBall();
    }
    collisions(); particlesUpdate(dt); shake = Math.max(0, shake - dt * 22);
  }
  function aiMove(p, own, opposition, dt, difficulty) {
    const isGK = p.role === 'GK', attacking = ball.owner && ball.owner.team === p.team;
    let tx, ty, speed = p.speed * difficulty;
    if (isGK) {
      const goalX = p.team === 'home' ? 82 : 918; tx = goalX + (p.team === 'home' ? clamp(ball.x - goalX, -34, 30) : clamp(ball.x - goalX, -30, 34)) * .34; ty = clamp(ball.y, 267, 333); speed *= 1.12;
    } else if (ball.owner === p) {
      tx = p.team === 'home' ? 914 : 86; ty = 300 + Math.sin(performance.now() / 740 + p.i) * 55;
      if (dist(p, { x: tx, y: ty }) < 120 && Math.random() < .018 * difficulty) aiShoot(p);
    } else if (!ball.owner && Math.hypot(ball.x - p.x, ball.y - p.y) < Math.hypot(ball.x - (p.team === 'home' ? 500 : 500), ball.y - 300) + 60) { tx = ball.x; ty = ball.y; }
    else if (attacking) { const offsets = p.team === 'home' ? [0, -108, 108, 0, 0] : [0, -108, 108, 0, 0]; tx = p.homeX + (p.team === 'home' ? 100 : -100); ty = p.homeY + offsets[p.i] * .18; }
    else { const active = own.filter(q => !['GK'].includes(q.role)).sort((a, b) => dist(a, ball.owner || ball) - dist(b, ball.owner || ball))[0]; const chaser = active === p; tx = chaser ? (ball.owner ? ball.owner.x : ball.x) : p.homeX + (ball.owner ? (ball.owner.x - 500) * .22 : (ball.x - 500) * .22); ty = chaser ? (ball.owner ? ball.owner.y : ball.y) : p.homeY + (ball.owner ? (ball.owner.y - 300) * .18 : (ball.y - 300) * .18); }
    if (p.team === 'home' && !attacking && !ball.owner && p === player) return;
    const dx = tx - p.x, dy = ty - p.y; const length = Math.hypot(dx, dy);
    if (length > (isGK ? 4 : 9)) movePlayer(p, dx / length, dy / length, speed, dt); else { p.vx *= .8; p.vy *= .8; }
  }
  function aiShoot(p) { const dir = p.team === 'home' ? 1 : -1, goalY = 300 + random(-50, 50), dy = (goalY - p.y), length = Math.hypot(1, dy / 125); releaseBall(p, dir * 9.2 / length, dy / 125 * 9.2 / length, 'shoot'); tone(180, .1, 'square', .03); }
  function aiKick(p, dt, difficulty) {
    p.kickCooldown = Math.max(0, p.kickCooldown - dt);
    const targetX = p.team === 'home' ? 915 : 85;
    if (p.kickCooldown <= 0 && (Math.abs(targetX - p.x) < 120 || Math.random() < .0015 * difficulty)) {
      const teammate = (p.team === 'home' ? home : away).filter(q => q !== p && q.role !== 'GK').sort((a, b) => dist(a, p) - dist(b, p))[0];
      if (teammate && Math.random() < .3 && Math.abs(targetX - p.x) > 160) { const dx = teammate.x - p.x, dy = teammate.y - p.y, n = Math.hypot(dx, dy); releaseBall(p, dx / n * 7.3, dy / n * 7.3, 'pass'); }
      else aiShoot(p);
    }
  }
  function collectBall() {
    let closest = null, bestDist = 22;
    for (const p of [...home, ...away]) { const d = dist(p, ball); if (d < bestDist && p.kickCooldown <= 0) { closest = p; bestDist = d; } }
    if (closest) { ball.owner = closest; ball.lastTeam = closest.team; if (closest.team === 'home') player = closest; tone(260, .035, 'sine', .015); }
  }
  function collisions() {
    const all = [...home, ...away];
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j], dx = b.x - a.x, dy = b.y - a.y, n = Math.hypot(dx, dy) || .01, min = a.radius + b.radius - 3;
      if (n < min) { const push = (min - n) * .5; a.x -= dx / n * push; a.y -= dy / n * push; b.x += dx / n * push; b.y += dy / n * push; if (a.team !== b.team && ball.owner === a && n < 21 && Math.random() < .035) { ball.owner = b; ball.lastTeam = b.team; if (b.team === 'home') player = b; } if (a.team !== b.team && ball.owner === b && n < 21 && Math.random() < .035) { ball.owner = a; ball.lastTeam = a.team; if (a.team === 'home') player = a; } }
    }
  }
  function particlesUpdate(dt) { particles = particles.filter(p => p.life > 0); for (const p of particles) { p.x += p.vx * dt * 60; p.y += p.vy * dt * 60; p.vx *= .985; p.vy *= .985; p.life -= dt; } }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = '#0a2119'; ctx.fillRect(0, 0, width, height);
    ctx.translate(dpr * (offsetX + (shake ? random(-shake, shake) : 0)), dpr * (offsetY + (shake ? random(-shake, shake) : 0)));
    if (verticalPitch) { ctx.translate(dpr * H * scale, 0); ctx.rotate(Math.PI / 2); }
    ctx.scale(dpr * scale, dpr * scale);
    drawField(); drawPlayers(); drawBall(); drawParticles();
    if (state === 'playing' && ball.owner === player) drawAim();
    requestAnimationFrame(draw);
  }
  function drawField() {
    // Stadium glow and the deep emerald pitch.
    const grad = ctx.createLinearGradient(0, field.t, 0, field.b); grad.addColorStop(0, '#23623d'); grad.addColorStop(.5, '#277246'); grad.addColorStop(1, '#1d5b39');
    ctx.fillStyle = grad; ctx.fillRect(field.l, field.t, field.r - field.l, field.b - field.t);
    const stripeW = (field.r - field.l) / 10;
    for (let i = 0; i < 10; i++) { ctx.fillStyle = i % 2 ? '#ffffff06' : '#061d1020'; ctx.fillRect(field.l + i * stripeW, field.t, stripeW, field.b - field.t); }
    // Turf speckle and subtle stadium light pools.
    ctx.save(); ctx.globalAlpha = .12; for (let i = 0; i < 210; i++) { const x = (i * 197 + 31) % (field.r - field.l) + field.l, y = (i * 113 + 18) % (field.b - field.t) + field.t; ctx.fillStyle = i % 2 ? '#a8da8b' : '#061b10'; ctx.fillRect(x, y, 1, 1); } ctx.restore();
    // Goals.
    drawGoal(field.l - 25, GOAL_TOP, 26, GOAL_BOTTOM - GOAL_TOP, true); drawGoal(field.r, GOAL_TOP, 26, GOAL_BOTTOM - GOAL_TOP, false);
    ctx.strokeStyle = '#edf9e1b8'; ctx.lineWidth = 2; ctx.strokeRect(field.l, field.t, field.r - field.l, field.b - field.t);
    ctx.beginPath(); ctx.moveTo(500, field.t); ctx.lineTo(500, field.b); ctx.stroke();
    ctx.beginPath(); ctx.arc(500, 300, 70, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = '#edf9e1'; ctx.beginPath(); ctx.arc(500, 300, 3, 0, Math.PI * 2); ctx.fill();
    ctx.strokeRect(field.l, 198, 120, 204); ctx.strokeRect(field.l, 238, 50, 124); ctx.strokeRect(field.r - 120, 198, 120, 204); ctx.strokeRect(field.r - 50, 238, 50, 124);
    ctx.beginPath(); ctx.arc(160, 300, 3, 0, Math.PI * 2); ctx.arc(840, 300, 3, 0, Math.PI * 2); ctx.fill();
    // Corner arcs.
    for (const [x, y, a] of [[field.l,field.t,0],[field.r,field.t,Math.PI/2],[field.r,field.b,Math.PI],[field.l,field.b,-Math.PI/2]]) { ctx.beginPath(); ctx.arc(x, y, 13, a, a + Math.PI / 2); ctx.stroke(); }
    // Advert boards outside pitch.
    ctx.fillStyle = '#101b15'; ctx.fillRect(field.l, 18, field.r - field.l, 16); ctx.fillRect(field.l, 566, field.r - field.l, 16);
    ctx.fillStyle = '#d8ff3f'; ctx.font = '800 8px DM Sans'; ctx.textAlign = 'center'; ctx.fillText('PES  •  PLAY BEAUTIFUL  •  STREET CUP', 500, 29); ctx.fillText('PES  •  PLAY BEAUTIFUL  •  STREET CUP', 500, 577);
  }
  function drawGoal(x, y, w, h, left) {
    ctx.fillStyle = '#edf5e51d'; ctx.fillRect(x, y, w, h); ctx.strokeStyle = '#f0f7e7'; ctx.lineWidth = 4; ctx.strokeRect(x, y, w, h);
    ctx.strokeStyle = '#ffffff35'; ctx.lineWidth = 1; for (let i = 1; i < 5; i++) { ctx.beginPath(); ctx.moveTo(x + i * w / 5, y); ctx.lineTo(x + i * w / 5, y + h); ctx.stroke(); } for (let j = 1; j < 5; j++) { ctx.beginPath(); ctx.moveTo(x, y + j * h / 5); ctx.lineTo(x + w, y + j * h / 5); ctx.stroke(); }
  }
  function drawPlayers() {
    const ordered = [...home, ...away].sort((a, b) => a.y - b.y);
    for (const p of ordered) {
      const isHome = p.team === 'home', skin = p.i % 3 === 1 ? '#c88c65' : p.i % 3 === 2 ? '#edbd91' : '#dfaa80';
      ctx.save(); ctx.translate(p.x, p.y);
      // Long clean shadow, animated stride and boots.
      ctx.fillStyle = '#07170c62'; ctx.beginPath(); ctx.ellipse(1, 13, 14, 7, 0, 0, Math.PI * 2); ctx.fill();
      const moving = Math.hypot(p.vx, p.vy) > .4, stride = moving ? Math.sin(p.anim * 5) * 4 : 0;
      ctx.strokeStyle = '#18221b'; ctx.lineWidth = 4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-4, 7); ctx.lineTo(-5 + stride, 13); ctx.lineTo(-7 + stride, 16); ctx.moveTo(4, 7); ctx.lineTo(5 - stride, 13); ctx.lineTo(7 - stride, 16); ctx.stroke();
      // Jersey with shoulder panels.
      ctx.fillStyle = isHome ? '#d9ff43' : '#e9e9ee'; ctx.beginPath(); ctx.roundRect(-10, -9, 20, 20, 6); ctx.fill();
      ctx.fillStyle = isHome ? '#14251a' : '#d94a3f'; ctx.fillRect(-10, -5, 4, 11); ctx.fillRect(6, -5, 4, 11);
      ctx.fillStyle = isHome ? '#173020' : '#9d3433'; ctx.font = '900 9px Barlow Condensed'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(p.i + 1), 0, 1);
      ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(0, -14, 7.7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = p.i % 2 ? '#30251f' : '#27221c'; ctx.beginPath(); ctx.arc(0, -17, 7, Math.PI, Math.PI * 2); ctx.fill();
      // Facing marker and selected-player ring.
      if (p === player && state === 'playing') { ctx.strokeStyle = '#e9ff89'; ctx.lineWidth = 1.4; ctx.globalAlpha = .8; ctx.beginPath(); ctx.ellipse(0, 1, 18, 19, 0, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1; ctx.fillStyle = '#e9ff89'; ctx.beginPath(); ctx.moveTo(0, -28); ctx.lineTo(-4, -34); ctx.lineTo(4, -34); ctx.fill(); }
      if (p.role === 'GK') { ctx.fillStyle = '#ec6f4a'; ctx.beginPath(); ctx.arc(0, -1, 3, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
  }
  function drawBall() {
    const x = ball.x, y = ball.y; ctx.fillStyle = '#06150b70'; ctx.beginPath(); ctx.ellipse(x + 2, y + 8, 9, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.translate(x, y - 2 + Math.sin(ball.spin) * .6); ctx.rotate(ball.spin * .18); ctx.fillStyle = '#f7f8ef'; ctx.beginPath(); ctx.arc(0, 0, ball.radius, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#202923';
    for (let i = 0; i < 5; i++) { const a = i * Math.PI * 2 / 5; ctx.beginPath(); ctx.arc(Math.cos(a) * 4.1, Math.sin(a) * 4.1, 1.7, 0, Math.PI * 2); ctx.fill(); } ctx.restore();
  }
  function drawParticles() { for (const p of particles) { ctx.globalAlpha = clamp(p.life / p.max, 0, 1); ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, p.size, p.size); } ctx.globalAlpha = 1; }
  function drawAim() { if (!player || !ball.owner) return; ctx.save(); ctx.globalAlpha = .2; ctx.strokeStyle = '#eaffb2'; ctx.setLineDash([4, 7]); ctx.beginPath(); ctx.moveTo(ball.x, ball.y); ctx.lineTo(920, ball.y + (300 - ball.y) * .35 + lastAim.y * 45); ctx.stroke(); ctx.restore(); }
  function renderLoop(now) { const dt = Math.min(.035, (now - (lastTime || now)) / 1000); lastTime = now; update(dt); draw(); requestAnimationFrame(renderLoop); }

  window.addEventListener('keydown', e => {
    const key = e.key.toLowerCase(); if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) e.preventDefault();
    if (keys.has(key)) return; keys.add(key);
    if (key === 'escape' || key === 'p') state === 'playing' ? pauseGame() : state === 'paused' ? resumeGame() : null;
    if (key === ' ' || key === 'a') buttonKick('pass'); if (key === 'x' || key === 'enter') buttonKick('shoot');
    if (key === 'c') buttonKick('shoot');
  });
  window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => { keys.clear(); if (state === 'playing') pauseGame(); });
  $('#start-btn').addEventListener('click', startMatch); $('#pause-btn').addEventListener('click', () => state === 'playing' ? pauseGame() : state === 'paused' ? resumeGame() : null);
  $('#resume-btn').addEventListener('click', resumeGame); $('#restart-btn').addEventListener('click', startMatch);
  $('#sound-btn').addEventListener('click', () => { soundOn = !soundOn; $('#sound-btn').textContent = soundOn ? '♫' : '♪'; $('#sound-btn').style.color = soundOn ? '' : '#d8ff3f'; if (soundOn) tone(500, .07); });
  $('#continue-btn').addEventListener('click', () => { if (score[0] > score[1] && round < 3) round++; else round = 1; startMatch(); });
  $('#menu-btn').addEventListener('click', () => { state = 'menu'; resultScreen.classList.add('hidden'); menu.classList.remove('hidden'); $('#best-score').textContent = best || '—'; $('#menu-level').textContent = String(round).padStart(2, '0'); });
  const joy = $('#joystick'), knob = $('#joy-knob');
  function joystickMove(e) { const r = joy.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, max = r.width * .34; let dx = e.clientX - cx, dy = e.clientY - cy, n = Math.hypot(dx, dy); if (n > max) { dx *= max / n; dy *= max / n; } joystick.x = dx / max; joystick.y = dy / max; knob.style.left = `calc(50% + ${dx}px)`; knob.style.top = `calc(50% + ${dy}px)`; }
  joy.addEventListener('pointerdown', e => { e.preventDefault(); joystick.active = true; joystick.pointer = e.pointerId; joy.setPointerCapture(e.pointerId); joystickMove(e); });
  joy.addEventListener('pointermove', e => { if (joystick.active && joystick.pointer === e.pointerId) joystickMove(e); });
  const releaseJoy = () => { joystick.active = false; joystick.x = joystick.y = 0; knob.style.left = knob.style.top = '50%'; };
  joy.addEventListener('pointerup', releaseJoy); joy.addEventListener('pointercancel', releaseJoy);
  document.querySelectorAll('.touch-btn').forEach(btn => {
    const action = btn.dataset.action;
    btn.addEventListener('pointerdown', e => { e.preventDefault(); if (action === 'pass' || action === 'shoot') buttonKick(action); else keys.add('touch-sprint'); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => btn.addEventListener(ev, () => { if (action === 'sprint') keys.delete('touch-sprint'); }));
  });
  $('#best-score').textContent = best || '—';
  setupMatch(); requestAnimationFrame(renderLoop);
})();
