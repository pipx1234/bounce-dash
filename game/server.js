'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DynamoDBClient, PutItemCommand, ScanCommand } = require('@aws-sdk/client-dynamodb');

const SCORES_FILE = path.join(__dirname, 'scores.json');
const TOP_N = 10;
const MAX_SCORE = 99999;
const SESSION_TTL_MS = 35 * 60 * 1000;
const TABLE_NAME = process.env.SCORES_TABLE || '';
const AWS_REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';

const dynamo = TABLE_NAME ? new DynamoDBClient({ region: AWS_REGION }) : null;
const sessions = new Map();
let localScores = [];

try { localScores = JSON.parse(fs.readFileSync(SCORES_FILE, 'utf8')); } catch {}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.wasm': 'application/wasm',
};

const PUBLIC = path.join(__dirname, 'public');
const WASM_PKG = path.join(__dirname, 'wasm-game', 'pkg');
const LOCAL_WASM_FALLBACKS = {
  'wasm_game.js': path.join(WASM_PKG, 'wasm_game.js'),
  'wasm_game_bg.wasm': path.join(WASM_PKG, 'wasm_game_bg.wasm'),
};

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function readBody(req, maxBytes = 2048) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > maxBytes) {
        reject(new Error('body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function cleanName(value) {
  const name = String(value || '').replace(/[^a-zA-Z0-9 _.-]/g, '').trim().slice(0, 16);
  return name || 'Player';
}

function cleanSessions(now = Date.now()) {
  for (const [runId, session] of sessions) {
    if (now - session.startedAt > SESSION_TTL_MS || session.used) sessions.delete(runId);
  }
}

function createSession() {
  cleanSessions();
  const runId = crypto.randomBytes(18).toString('base64url');
  let seed = crypto.randomBytes(4).readUInt32BE(0);
  if (seed === 0) seed = 1;
  const startedAt = Date.now();
  sessions.set(runId, { seed, startedAt, used: false });
  return { runId, seed, startedAt };
}

function validateSubmission({ runId, score, tick }) {
  const session = sessions.get(String(runId || ''));
  if (!session) return 'Run session expired. Start a new run.';
  if (session.used) return 'This run has already been submitted.';

  const now = Date.now();
  const elapsedMs = now - session.startedAt;
  const safeScore = Math.floor(Number(score));
  const safeTick = Math.floor(Number(tick || 0));

  if (!Number.isFinite(safeScore) || safeScore < 0 || safeScore > MAX_SCORE) return 'Invalid score.';
  if (elapsedMs < 1200 && safeScore > 20) return 'Score submitted too quickly.';

  const elapsedSeconds = Math.max(1, elapsedMs / 1000);
  const maxDistance = elapsedSeconds * 105 + 90;
  const maxTicks = elapsedMs / (1000 / 60) + 720;
  if (safeScore > maxDistance) return 'Score is faster than the game allows.';
  if (safeTick > maxTicks) return 'Run timer is inconsistent.';

  return null;
}

function rangeCutoff(range) {
  const now = new Date();
  if (range === 'daily') return Date.now() - 24 * 60 * 60 * 1000;
  if (range === 'weekly') return Date.now() - 7 * 24 * 60 * 60 * 1000;
  return 0;
}

function formatScores(scores, range) {
  const cutoff = rangeCutoff(range);
  return scores
    .filter(score => Number(score.createdAt) >= cutoff)
    .sort((a, b) => b.score - a.score || a.createdAt - b.createdAt)
    .slice(0, TOP_N)
    .map((score, index) => ({ rank: index + 1, name: score.name, score: score.score, createdAt: score.createdAt }));
}

async function listScores(range) {
  if (!dynamo) return formatScores(localScores, range);

  const cutoff = rangeCutoff(range);
  const params = {
    TableName: TABLE_NAME,
    ProjectionExpression: '#id, #name, score, createdAt',
    ExpressionAttributeNames: { '#id': 'id', '#name': 'name' },
  };
  if (cutoff > 0) {
    params.FilterExpression = 'createdAt >= :cutoff';
    params.ExpressionAttributeValues = { ':cutoff': { N: String(cutoff) } };
  }

  const scores = [];
  let ExclusiveStartKey;
  do {
    const page = await dynamo.send(new ScanCommand({ ...params, ExclusiveStartKey }));
    for (const item of page.Items || []) {
      scores.push({
        id: item.id?.S || '',
        name: item.name?.S || 'Player',
        score: Number(item.score?.N || 0),
        createdAt: Number(item.createdAt?.N || 0),
      });
    }
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  return formatScores(scores, range);
}

async function putScore({ runId, name, score }) {
  const record = {
    id: `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`,
    runId,
    name,
    score,
    createdAt: Date.now(),
  };

  if (!dynamo) {
    localScores.push(record);
    fs.writeFile(SCORES_FILE, JSON.stringify(localScores.slice(-500)), () => {});
    return record;
  }

  await dynamo.send(new PutItemCommand({
    TableName: TABLE_NAME,
    Item: {
      id: { S: record.id },
      runId: { S: record.runId },
      name: { S: record.name },
      score: { N: String(record.score) },
      createdAt: { N: String(record.createdAt) },
    },
    ConditionExpression: 'attribute_not_exists(id)',
  }));
  return record;
}

async function getLeaderboards() {
  const [daily, weekly, all] = await Promise.all([
    listScores('daily'),
    listScores('weekly'),
    listScores('all'),
  ]);
  return { daily, weekly, all };
}

function serveStatic(url, res) {
  const safe = url.split('?')[0].replace(/\.\./g, '');
  const file = safe === '/' ? 'index.html' : safe.slice(1);
  const full = path.join(PUBLIC, file);
  if (!full.startsWith(PUBLIC + path.sep) && full !== PUBLIC) {
    res.writeHead(403); res.end(); return;
  }
  fs.readFile(full, (err, data) => {
    if (err && LOCAL_WASM_FALLBACKS[file]) {
      fs.readFile(LOCAL_WASM_FALLBACKS[file], (fallbackErr, fallbackData) => {
        if (fallbackErr) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(fallbackData);
      });
      return;
    }
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(data);
  });
}

const httpServer = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'POST' && url.pathname === '/session') {
      sendJson(res, 200, createSession());
      return;
    }

    if (req.method === 'GET' && url.pathname === '/leaderboard') {
      sendJson(res, 200, await getLeaderboards());
      return;
    }

    if (req.method === 'POST' && url.pathname === '/score') {
      const payload = JSON.parse(await readBody(req));
      const score = Math.max(0, Math.min(MAX_SCORE, Math.floor(Number(payload.score))));
      const rejection = validateSubmission({ runId: payload.runId, score, tick: payload.tick });
      if (rejection) {
        sendJson(res, 400, { ok: false, error: rejection, leaderboards: await getLeaderboards() });
        return;
      }
      const session = sessions.get(String(payload.runId));
      session.used = true;
      await putScore({ runId: String(payload.runId), name: cleanName(payload.name), score });
      sessions.delete(String(payload.runId));
      sendJson(res, 200, { ok: true, leaderboards: await getLeaderboards() });
      return;
    }

    if (req.method === 'GET') {
      serveStatic(req.url, res);
      return;
    }

    res.writeHead(405); res.end();
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { ok: false, error: 'Server error' });
  }
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`Cometio running on http://localhost:${PORT}`));