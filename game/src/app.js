import initWasm, * as wasm from './wasm_game.js';

'use strict';

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const W = 800;
const H = 480;
const BALL_R = 11;
const PLAT_H = 14;
const playerNameInput = document.getElementById('playerName');
const scoreForm = document.getElementById('scoreForm');
const scoreStatus = document.getElementById('scoreStatus');
const submitScoreButton = document.getElementById('submitScore');
const scoresEl = document.getElementById('scores');
const tabButtons = [...document.querySelectorAll('#tabs button')];

function drawMessage(line1, line2 = '') {
  ctx.fillStyle = '#06060f';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#7eb8f7';
  ctx.font = '18px "Segoe UI", Arial';
  ctx.fillText(line1, W / 2, H / 2 - (line2 ? 12 : 0));
  if (line2) {
    ctx.fillStyle = '#657184';
    ctx.font = '13px "Segoe UI", Arial';
    ctx.fillText(line2, W / 2, H / 2 + 18);
  }
  ctx.textAlign = 'left';
}

drawMessage('Loading...');

try {
  await initWasm();
} catch (error) {
  console.error(error);
  drawMessage('Could not load game', 'Refresh the page and try again');
  throw error;
}

const THEME = {
  bgTop: '#08081a', bgBot: '#0b1720',
  starR: 225, starG: 245, starB: 255, fogR: 40, fogG: 190, fogB: 150,
  platA: [70, 210, 150], platB: [245, 90, 120],
};

const STARS = Array.from({ length: 90 }, () => ({
  x0: Math.random() * W,
  y: Math.random() * H,
  r: Math.random() * 1.1 + 0.3,
  a: 0.25 + Math.random() * 0.55,
  par: 0.012 + Math.random() * 0.038,
}));

function lerp(a, b, t) {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

const storedBest = parseInt(localStorage.getItem('bd_best') || '0', 10);
playerNameInput.value = localStorage.getItem('bd_name') || '';

let activeRange = 'daily';
let leaderboards = { daily: [], weekly: [], all: [] };
let currentRun = null;
let phase = 'title';

async function postJson(url, payload = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function startRun() {
  try {
    currentRun = await postJson('/session');
  } catch {
    currentRun = {
      runId: '',
      seed: Math.floor(Math.random() * 4294967295) || 1,
      startedAt: Date.now(),
      offline: true,
    };
  }
}

function renderLeaderboards() {
  const rows = leaderboards[activeRange] || [];
  if (!rows.length) {
    scoresEl.innerHTML = '<div id="emptyScores">No scores yet.</div>';
    return;
  }
  scoresEl.innerHTML = rows.map(row => `
    <div class="scoreRow">
      <span>${row.rank}</span>
      <strong title="${row.name}">${row.name}</strong>
      <em>${row.score}m</em>
    </div>
  `).join('');
}

async function loadLeaderboards() {
  try {
    leaderboards = await fetch('/leaderboard').then(response => response.json());
  } catch {
    leaderboards = { daily: [], weekly: [], all: [] };
  }
  renderLeaderboards();
}

function setScoreForm(show, message = '') {
  scoreForm.classList.toggle('show', show);
  scoreStatus.textContent = message;
}

await loadLeaderboards();

const held = {};
let submittedGameOverScore = null;
let pendingScore = null;

async function beginGame() {
  if (phase === 'starting') return;
  phase = 'starting';
  setScoreForm(false);
  submittedGameOverScore = null;
  pendingScore = null;
  await startRun();
  wasm.game_init(Number.isFinite(storedBest) ? storedBest : 0, currentRun.seed);
  phase = 'playing';
  camX = 0;
  tickAccum = 0;
  lastTime = performance.now();
}

document.addEventListener('keydown', async (event) => {
  if (event.target === playerNameInput) {
    if (event.key === 'Enter') submitScoreButton.click();
    return;
  }
  if (event.target.closest?.('#leaderboard')) return;
  held[event.key] = true;
  if (event.key === ' ' || event.key === 'Enter') {
    if (phase === 'title') {
      await beginGame();
    } else if (phase === 'playing' && wasm.get_game_state() === 2) {
      localStorage.setItem('bd_best', String(wasm.get_best()));
      await beginGame();
    }
  }
  if ([' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
    event.preventDefault();
  }
});

document.addEventListener('keyup', (event) => {
  held[event.key] = false;
});

tabButtons.forEach((button) => {
  button.addEventListener('click', () => {
    activeRange = button.dataset.range;
    tabButtons.forEach(tab => tab.classList.toggle('active', tab === button));
    renderLeaderboards();
  });
});

submitScoreButton.addEventListener('click', async () => {
  if (!pendingScore || !currentRun || currentRun.offline) return;
  const name = playerNameInput.value.trim() || 'Player';
  localStorage.setItem('bd_name', name);
  submitScoreButton.disabled = true;
  scoreStatus.textContent = 'Submitting...';
  try {
    const result = await postJson('/score', {
      runId: currentRun.runId,
      name,
      score: pendingScore,
      tick: wasm.get_tick(),
    });
    leaderboards = result.leaderboards || leaderboards;
    submittedGameOverScore = pendingScore;
    pendingScore = null;
    scoreStatus.textContent = 'Saved.';
    renderLeaderboards();
  } catch (error) {
    scoreStatus.textContent = error.message || 'Score rejected.';
  } finally {
    submitScoreButton.disabled = false;
  }
});

let camX = 0;
const TICK_MS = 1000 / 60;
let lastTime = performance.now();
let tickAccum = 0;

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function drawBg(level) {
  const gradient = ctx.createLinearGradient(0, 0, 0, H);
  gradient.addColorStop(0, level.bgTop);
  gradient.addColorStop(1, level.bgBot);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, W, H);
  for (const star of STARS) {
    const sx = ((star.x0 - camX * star.par) % W + W) % W;
    ctx.globalAlpha = star.a;
    ctx.fillStyle = `rgb(${level.starR},${level.starG},${level.starB})`;
    ctx.beginPath();
    ctx.arc(sx, star.y, star.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const fog = ctx.createLinearGradient(0, H - 60, 0, H);
  fog.addColorStop(0, `rgba(${level.fogR},${level.fogG},${level.fogB},0)`);
  fog.addColorStop(1, `rgba(${level.fogR},${level.fogG},${level.fogB},0.4)`);
  ctx.fillStyle = fog;
  ctx.fillRect(0, H - 60, W, 60);
}

function drawTitleScreen(now) {
  const level = THEME;
  const drift = Math.sin(now * 0.00035) * 34;
  const pulse = 0.5 + 0.5 * Math.sin(now * 0.0018);
  const titleY = 156 + Math.sin(now * 0.0016) * 3;
  camX = drift;
  drawBg(level);

  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = `rgb(${level.platA[0]},${level.platA[1]},${level.platA[2]})`;
  for (let index = 0; index < 11; index += 1) {
    const x = 70 + index * 68 + Math.sin(now * 0.001 + index) * 14;
    const y = 348 + Math.sin(now * 0.0014 + index * 0.8) * 54;
    roundRect(x, y, 82, PLAT_H, 4);
    ctx.fill();
  }
  ctx.restore();

  ctx.save();
  ctx.textAlign = 'center';
  ctx.shadowColor = `rgba(126, 184, 247, ${0.6 + pulse * 0.35})`;
  ctx.shadowBlur = 24 + pulse * 8;
  ctx.fillStyle = '#e9f5ff';
  ctx.font = '900 60px "Segoe UI", Arial';
  ctx.fillText('BOUNCE DASH', W / 2, titleY);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#7eb8f7';
  ctx.font = 'bold 17px "Segoe UI", Arial';
  ctx.fillText('Arrow keys to steer / how far can you go?', W / 2, 206);
  ctx.fillStyle = `rgba(232, 255, 247, ${0.58 + pulse * 0.42})`;
  ctx.font = 'bold 20px "Segoe UI", Arial';
  ctx.fillText('Press Space or Enter to start', W / 2, 272);
  ctx.fillStyle = '#657184';
  ctx.font = '13px "Segoe UI", Arial';
  ctx.fillText('Daily / Weekly / All Time leaderboard on the right', W / 2, 306);
  ctx.restore();
}

function drawPlatforms(fallbackLevel, platformData) {
  const stride = 9;
  for (let index = 0; index < platformData.length; index += stride) {
    const px = platformData[index];
    const py = platformData[index + 1];
    const pw = platformData[index + 2];
    const tint = platformData[index + 3];
    const platformLevel = fallbackLevel;
    const lit = platformData[index + 5] / 8;
    const falling = platformData[index + 6] > 0.5;
    const fallVy = platformData[index + 7];
    const angle = platformData[index + 8];
    const sx = px - camX;
    const baseR = Math.round(lerp(platformLevel.platA[0], platformLevel.platB[0], tint));
    const baseG = Math.round(lerp(platformLevel.platA[1], platformLevel.platB[1], tint));
    const baseB = Math.round(lerp(platformLevel.platA[2], platformLevel.platB[2], tint));
    ctx.fillStyle = lit > 0
      ? `rgb(${Math.round(lerp(baseR, 255, lit))},${Math.round(lerp(baseG, 235, lit))},${Math.round(lerp(baseB, 100, lit))})`
      : `rgb(${baseR},${baseG},${baseB})`;
    if (falling) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - fallVy / 16);
      ctx.translate(sx + pw / 2, py + PLAT_H / 2);
      ctx.rotate(angle);
      roundRect(-pw / 2, -PLAT_H / 2, pw, PLAT_H, 4);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(-pw / 2 + 5, -PLAT_H / 2 + 2, pw - 10, 3);
      ctx.restore();
    } else {
      roundRect(sx, py, pw, PLAT_H, 4);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(sx + 5, py + 2, pw - 10, 3);
    }
  }
}

function drawBall(bx, by, holdTicks) {
  const charge = holdTicks / 45;
  const glowR = Math.round(lerp(126, 255, charge));
  const glowG = Math.round(lerp(184, 140, charge));
  const glowB = Math.round(lerp(247, 30, charge));
  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(bx, by + BALL_R + 2, BALL_R * 0.85, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  const halo = ctx.createRadialGradient(bx, by, 0, bx, by, BALL_R * (2.2 + charge * 1.4));
  halo.addColorStop(0, `rgba(${glowR},${glowG},${glowB},${0.35 + charge * 0.4})`);
  halo.addColorStop(1, `rgba(${glowR},${glowG},${glowB},0)`);
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(bx, by, BALL_R * (2.2 + charge * 1.4), 0, Math.PI * 2);
  ctx.fill();
  const gradient = ctx.createRadialGradient(bx - 3, by - 3, 1, bx, by, BALL_R);
  gradient.addColorStop(0, '#e9f5ff');
  gradient.addColorStop(1, `rgb(${Math.round(lerp(90, 255, charge))},${Math.round(lerp(174, 110, charge))},${Math.round(lerp(245, 20, charge))})`);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(bx, by, BALL_R, 0, Math.PI * 2);
  ctx.fill();
  if (charge > 0.05) {
    ctx.save();
    ctx.strokeStyle = `rgba(${glowR},${glowG},${glowB},${0.5 + charge * 0.5})`;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(bx, by, BALL_R + 7, Math.PI + Math.PI * (1 - charge), Math.PI * 2 - Math.PI * (1 - charge));
    ctx.stroke();
    ctx.restore();
  }
}

function drawHUD(score, best) {
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  roundRect(10, 10, 170, 54, 6);
  ctx.fill();
  ctx.fillStyle = '#7eb8f7';
  ctx.font = 'bold 15px "Segoe UI", Arial';
  ctx.fillText(`Distance:  ${score} m`, 22, 32);
  ctx.fillStyle = '#7a8fa0';
  ctx.font = '13px "Segoe UI", Arial';
  ctx.fillText(`Best: ${best} m`, 22, 52);
}

function drawGameOver(level) {
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ff6b6b';
  ctx.font = 'bold 52px "Segoe UI", Arial';
  ctx.fillText('GAME OVER', W / 2, H / 2 - 72);
  ctx.fillStyle = '#7eb8f7';
  ctx.font = 'bold 28px "Segoe UI", Arial';
  ctx.fillText(`${wasm.get_score()} m reached`, W / 2, H / 2 - 20);
  ctx.fillStyle = '#7a8fa0';
  ctx.font = '16px "Segoe UI", Arial';
  ctx.fillText(`Best: ${wasm.get_best()} m`, W / 2, H / 2 + 28);
  ctx.fillStyle = '#cccccc';
  ctx.font = '16px "Segoe UI", Arial';
  ctx.fillText('Press Space or Enter to play again', W / 2, H / 2 + 64);
  ctx.textAlign = 'left';
}

function loop(now) {
  if (phase !== 'playing') {
    drawTitleScreen(now);
    requestAnimationFrame(loop);
    return;
  }

  tickAccum += Math.min(now - lastTime, 250);
  lastTime = now;
  while (tickAccum >= TICK_MS) {
    wasm.update(!!(held.ArrowLeft || held.a), !!(held.ArrowRight || held.d));
    tickAccum -= TICK_MS;
  }

  camX += (wasm.get_cam_x_target() - camX) * 0.12;
  if (camX < 0) camX = 0;

  const state = wasm.get_game_state();
  const level = THEME;
  const score = wasm.get_score();

  if (state === 2 && submittedGameOverScore !== score) {
    pendingScore = score;
    setScoreForm(!currentRun?.offline, currentRun?.offline ? 'Local run only.' : `Submit ${score} m`);
  }

  drawBg(level);
  drawPlatforms(level, wasm.get_visible_platforms(camX - 200, camX + W + 200));
  drawBall(wasm.get_ball_x() - camX, wasm.get_ball_y(), wasm.get_ball_hold_ticks());
  drawHUD(score, wasm.get_best());
  if (state === 2) drawGameOver(level);

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);