'use strict';

/* =========================================================
 * まちづくりシミュレーション
 * クラシックな都市育成ゲーム(スマホブラウザ対応・セーブ機能付き)
 * ========================================================= */

/* ===== 定数 ===== */
const W = 64, H = 64;          // マップサイズ(タイル)
const BASE_TILE = 16;          // 基本タイルピクセル
const SAVE_KEY = 'machizukuri_save_v1';
const START_FUNDS = 20000;
const START_YEAR = 1990;
const MAX_LEVEL = 4;           // 区画の最大発展レベル
const PLANT_CAPACITY = 300;    // 発電所1基が電気を送れるタイル数

// タイル種別
const T = {
  GRASS: 0, WATER: 1, TREE: 2, ROAD: 3, WIRE: 4,
  RES: 5, COM: 6, IND: 7,
  POWER: 8, POLICE: 9, FIRE_ST: 10, PARK: 11,
  RUBBLE: 12, FIRE: 13,
};

// ツール定義(ツールバー表示順)
const TOOLS = [
  { id: 'pan',      label: '移動',   icon: '✋', cost: 0 },
  { id: 'road',     label: '道路',   icon: '🛣️', cost: 10 },
  { id: 'wire',     label: '送電線', icon: '🗼', cost: 5 },
  { id: 'res',      label: '住宅地', icon: '🏠', cost: 100 },
  { id: 'com',      label: '商業地', icon: '🏬', cost: 100 },
  { id: 'ind',      label: '工業地', icon: '🏭', cost: 100 },
  { id: 'power',    label: '発電所', icon: '⚡', cost: 3000 },
  { id: 'police',   label: '警察署', icon: '🚓', cost: 500 },
  { id: 'fire_st',  label: '消防署', icon: '🚒', cost: 500 },
  { id: 'park',     label: '公園',   icon: '🌳', cost: 50 },
  { id: 'bulldoze', label: '整地',   icon: '🚜', cost: 1 },
];
const TOOL_TILE = {
  road: T.ROAD, wire: T.WIRE, res: T.RES, com: T.COM, ind: T.IND,
  power: T.POWER, police: T.POLICE, fire_st: T.FIRE_ST, park: T.PARK,
};

// 人口マイルストーン
const MILESTONES = [
  [100, '村'], [500, '町'], [2000, '市'], [10000, '大都市'], [50000, '巨大都市'],
];

/* ===== ゲーム状態 ===== */
const g = {
  t: new Uint8Array(W * H),       // タイル種別
  lvl: new Uint8Array(W * H),     // 区画の発展レベル 0〜MAX_LEVEL
  fireT: new Uint8Array(W * H),   // 火災の残り燃焼ターン
  powered: new Uint8Array(W * H), // 通電フラグ(毎月再計算)
  funds: START_FUNDS,
  month: 0,                       // 開始からの経過月数
  taxRate: 7,
  milestone: 0,                   // 達成済みマイルストーン数
  pop: 0,
  jobs: 0,
  demand: { r: 0, c: 0, i: 0 },   // 正規化済み需要 -1〜1
  speed: 1,                       // 0=停止 1=普通 2=高速
  running: false,
};

// シミュレーション用の作業マップ(セーブ対象外、毎月再計算)
const roadNear = new Uint8Array(W * H);
const pollution = new Int16Array(W * H);
const landValue = new Int16Array(W * H);
const fireCov = new Uint8Array(W * H);

/* ===== カメラ・入力状態 ===== */
const cam = { x: 0, y: 0, zoom: 1.5 };
let currentTool = 'pan';
const pointers = new Map();
let lastBuildTile = null;
let pinchState = null;

/* ===== DOM ===== */
const cv = document.getElementById('game');
const cx = cv.getContext('2d');
const $ = (id) => document.getElementById(id);

/* =========================================================
 * ユーティリティ
 * ========================================================= */
const idx = (x, y) => y * W + x;
const inB = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
const rnd = Math.random;

function isZone(t) { return t === T.RES || t === T.COM || t === T.IND; }
function conducts(t) {
  return t === T.WIRE || t === T.POWER || t === T.POLICE ||
         t === T.FIRE_ST || isZone(t);
}
function flammable(t) {
  return isZone(t) || t === T.TREE || t === T.PARK ||
         t === T.POLICE || t === T.FIRE_ST || t === T.POWER;
}

let lastToastMsg = '', lastToastTime = 0;
function toast(msg) {
  const now = Date.now();
  if (msg === lastToastMsg && now - lastToastTime < 2000) return;
  lastToastMsg = msg; lastToastTime = now;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

/* =========================================================
 * マップ生成
 * ========================================================= */
function genMap() {
  g.t.fill(T.GRASS);
  g.lvl.fill(0);
  g.fireT.fill(0);

  // 川:上端から下端へ蛇行させる
  let x = 8 + Math.floor(rnd() * (W - 16));
  for (let y = 0; y < H; y++) {
    const width = 2 + (rnd() < 0.3 ? 1 : 0);
    for (let dx = 0; dx < width; dx++) {
      if (inB(x + dx, y)) g.t[idx(x + dx, y)] = T.WATER;
    }
    x += Math.floor(rnd() * 3) - 1;
    x = clamp(x, 1, W - 4);
  }

  // 森:ランダムウォークで木の群生をつくる
  for (let c = 0; c < 14; c++) {
    let tx = Math.floor(rnd() * W), ty = Math.floor(rnd() * H);
    for (let s = 0; s < 25; s++) {
      if (inB(tx, ty) && g.t[idx(tx, ty)] === T.GRASS) g.t[idx(tx, ty)] = T.TREE;
      tx += Math.floor(rnd() * 3) - 1;
      ty += Math.floor(rnd() * 3) - 1;
    }
  }
}

/* =========================================================
 * 電力シミュレーション
 * 発電所から、送電線・区画・施設を伝って電気が流れる
 * ========================================================= */
function computePower() {
  g.powered.fill(0);
  const queue = [];
  let capacity = 0;
  for (let i = 0; i < W * H; i++) {
    if (g.t[i] === T.POWER) {
      g.powered[i] = 1;
      queue.push(i);
      capacity += PLANT_CAPACITY;
    }
  }
  let used = queue.length;
  let head = 0;
  while (head < queue.length && used < capacity) {
    const i = queue[head++];
    const x = i % W, y = (i / W) | 0;
    const neighbors = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
    for (const [nx, ny] of neighbors) {
      if (!inB(nx, ny)) continue;
      const ni = idx(nx, ny);
      if (!g.powered[ni] && conducts(g.t[ni])) {
        g.powered[ni] = 1;
        queue.push(ni);
        if (++used >= capacity) break;
      }
    }
  }
}

/* =========================================================
 * 各種マップの再計算(道路近接・公害・地価・消防カバー)
 * ========================================================= */
function stamp(map, cx0, cy0, radius, value, falloff) {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = cx0 + dx, y = cy0 + dy;
      if (!inB(x, y)) continue;
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      const v = falloff ? Math.round(value * (1 - d / (radius + 1))) : value;
      map[idx(x, y)] += v;
    }
  }
}

function computeMaps() {
  roadNear.fill(0);
  pollution.fill(0);
  landValue.fill(0);
  fireCov.fill(0);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      const t = g.t[i];
      if (t === T.ROAD) {
        // 道路から2タイル以内が「道路近接」
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            if (inB(x + dx, y + dy)) roadNear[idx(x + dx, y + dy)] = 1;
          }
        }
      } else if (t === T.IND) {
        stamp(pollution, x, y, 4, 14 * g.lvl[i] + 6, true);
      } else if (t === T.POWER) {
        stamp(pollution, x, y, 4, 40, true);
      } else if (t === T.FIRE) {
        stamp(pollution, x, y, 3, 30, true);
      } else if (t === T.PARK) {
        stamp(landValue, x, y, 3, 14, true);
      } else if (t === T.TREE) {
        stamp(landValue, x, y, 1, 3, false);
      } else if (t === T.POLICE && g.powered[i]) {
        stamp(landValue, x, y, 6, 8, true);
      } else if (t === T.FIRE_ST && g.powered[i]) {
        stamp(landValue, x, y, 6, 4, true);
        stamp(fireCov, x, y, 8, 1, false);
      }
    }
  }
}

/* =========================================================
 * 人口・雇用・需要
 * ========================================================= */
function calcStats() {
  let pop = 0, cJobs = 0, iJobs = 0;
  for (let i = 0; i < W * H; i++) {
    const t = g.t[i];
    if (t === T.RES) pop += g.lvl[i] * 16;
    else if (t === T.COM) cJobs += g.lvl[i] * 12;
    else if (t === T.IND) iJobs += g.lvl[i] * 14;
  }
  g.pop = pop;
  g.jobs = cJobs + iJobs;
  // 住宅需要:仕事があれば人が来る(序盤は開拓需要で底上げ)
  const rRaw = (g.jobs * 1.35 + 120) - pop;
  const cRaw = pop * 0.38 - cJobs;
  const iRaw = pop * 0.42 - iJobs;
  g.demand.r = clamp(rRaw / 300, -1, 1);
  g.demand.c = clamp(cRaw / 300, -1, 1);
  g.demand.i = clamp(iRaw / 300, -1, 1);
}

/* =========================================================
 * 区画の発展・衰退
 * ========================================================= */
function zoneGrowth() {
  // 税率による成長補正(7%が基準)
  const taxMult = g.taxRate <= 7 ? 1 + (7 - g.taxRate) * 0.04
                                 : Math.max(0.1, 1 - (g.taxRate - 7) * 0.09);
  for (let i = 0; i < W * H; i++) {
    const t = g.t[i];
    if (!isZone(t)) continue;

    // 電気が来ていない区画は衰退する
    if (!g.powered[i]) {
      if (g.lvl[i] > 0 && rnd() < 0.08) g.lvl[i]--;
      continue;
    }
    // 道路がないと発展しない
    if (!roadNear[i]) {
      if (g.lvl[i] > 0 && rnd() < 0.04) g.lvl[i]--;
      continue;
    }

    const d = t === T.RES ? g.demand.r : t === T.COM ? g.demand.c : g.demand.i;
    let envMult = 1 + clamp(landValue[i], 0, 60) * 0.005;
    if (t === T.RES) {
      envMult *= clamp(1 - pollution[i] / 250, 0.1, 1); // 公害は住宅に大打撃
    }

    if (d > 0 && g.lvl[i] < MAX_LEVEL) {
      if (rnd() < d * 0.35 * taxMult * envMult) g.lvl[i]++;
    } else if (d < -0.25 && g.lvl[i] > 0) {
      if (rnd() < -d * 0.15) g.lvl[i]--;
    }
    // 重税・重公害でも衰退
    if (g.lvl[i] > 0 && g.taxRate > 14 && rnd() < (g.taxRate - 14) * 0.03) g.lvl[i]--;
    if (t === T.RES && g.lvl[i] > 0 && pollution[i] > 120 && rnd() < 0.06) g.lvl[i]--;
  }
}

/* =========================================================
 * 火災
 * ========================================================= */
function fireStep() {
  // 延焼と鎮火
  const burning = [];
  for (let i = 0; i < W * H; i++) if (g.t[i] === T.FIRE) burning.push(i);
  for (const i of burning) {
    const x = i % W, y = (i / W) | 0;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (!inB(nx, ny)) continue;
      const ni = idx(nx, ny);
      if (flammable(g.t[ni]) && !fireCov[ni] && rnd() < 0.15) {
        g.t[ni] = T.FIRE;
        g.lvl[ni] = 0;
        g.fireT[ni] = 2 + Math.floor(rnd() * 3);
      }
    }
    if (fireCov[i]) g.fireT[i] = Math.min(g.fireT[i], 1); // 消防カバー内は早く鎮火
    if (--g.fireT[i] <= 0) {
      g.t[i] = T.RUBBLE;
      g.fireT[i] = 0;
    }
  }

  // 自然発火:発展したタイルからまれに出火する(町が大きいほど起きやすい)
  const candidates = [];
  for (let i = 0; i < W * H; i++) {
    if (isZone(g.t[i]) && g.lvl[i] > 0 && !fireCov[i]) candidates.push(i);
  }
  if (candidates.length > 0 && rnd() < Math.min(0.03, candidates.length * 0.0006)) {
    const i = candidates[Math.floor(rnd() * candidates.length)];
    g.t[i] = T.FIRE;
    g.lvl[i] = 0;
    g.fireT[i] = 4;
    toast('🔥 火事が発生しました!');
  }
}

/* =========================================================
 * 財政(毎月)
 * ========================================================= */
function economy() {
  let roads = 0, wires = 0, police = 0, fireSts = 0, plants = 0, parks = 0;
  for (let i = 0; i < W * H; i++) {
    switch (g.t[i]) {
      case T.ROAD: roads++; break;
      case T.WIRE: wires++; break;
      case T.POLICE: police++; break;
      case T.FIRE_ST: fireSts++; break;
      case T.POWER: plants++; break;
      case T.PARK: parks++; break;
    }
  }
  const income = (g.pop * 1.2 + g.jobs * 0.6) * g.taxRate / 100 / 2;
  const expense = roads * 0.1 + wires * 0.03 +
                  police * 15 + fireSts * 12 + plants * 25 + parks * 2;
  g.funds += Math.round(income - expense);
  if (g.funds < 0) toast('⚠️ 財政が赤字です!税率や支出を見直しましょう');
}

/* =========================================================
 * マイルストーン
 * ========================================================= */
function checkMilestones() {
  while (g.milestone < MILESTONES.length && g.pop >= MILESTONES[g.milestone][0]) {
    toast(`🎉 人口${MILESTONES[g.milestone][0]}人達成!「${MILESTONES[g.milestone][1]}」になりました!`);
    g.milestone++;
  }
}

/* =========================================================
 * 月次シミュレーション
 * ========================================================= */
function simMonth() {
  computePower();
  computeMaps();
  calcStats();
  zoneGrowth();
  fireStep();
  economy();
  g.month++;
  checkMilestones();
  if (g.month % 12 === 0) saveGame(true); // 毎年自動セーブ
  updateHUD();
}

let simTimer = null;
function setSpeed(s) {
  g.speed = s;
  if (simTimer) { clearInterval(simTimer); simTimer = null; }
  const intervals = [0, 1200, 400];
  if (s > 0 && g.running) {
    simTimer = setInterval(simMonth, intervals[s]);
  }
  $('btn-speed').textContent = ['⏸', '▶', '⏩'][s];
}

/* =========================================================
 * セーブ・ロード
 * ========================================================= */
function saveGame(auto) {
  if (!g.running) return;
  try {
    const data = {
      v: 1,
      funds: g.funds,
      month: g.month,
      taxRate: g.taxRate,
      milestone: g.milestone,
      t: Array.from(g.t),
      lvl: Array.from(g.lvl),
      fireT: Array.from(g.fireT),
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    if (!auto) toast('💾 セーブしました');
  } catch (e) {
    toast('セーブに失敗しました');
  }
}

function hasSave() {
  return localStorage.getItem(SAVE_KEY) !== null;
}

function loadGame() {
  try {
    const data = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (!data || data.v !== 1 || !Array.isArray(data.t) || data.t.length !== W * H) {
      return false;
    }
    g.t.set(data.t);
    g.lvl.set(data.lvl);
    g.fireT.set(data.fireT);
    g.funds = data.funds;
    g.month = data.month;
    g.taxRate = data.taxRate;
    g.milestone = data.milestone || 0;
    return true;
  } catch (e) {
    return false;
  }
}

/* =========================================================
 * 建設
 * ========================================================= */
function spend(cost) {
  if (g.funds < cost) {
    toast('💸 資金が足りません');
    return false;
  }
  g.funds -= cost;
  return true;
}

function toolCost(toolId) {
  return TOOLS.find((t) => t.id === toolId).cost;
}

function placeTool(tx, ty) {
  if (!inB(tx, ty)) return;
  const i = idx(tx, ty);
  const cur = g.t[i];

  if (currentTool === 'bulldoze') {
    if (cur === T.GRASS || cur === T.WATER) return;
    if (!spend(1)) return;
    g.t[i] = T.GRASS;
    g.lvl[i] = 0;
    g.fireT[i] = 0;
    updateHUD();
    return;
  }

  const tileType = TOOL_TILE[currentTool];
  if (tileType === undefined) return;
  if (cur === tileType) return;

  // 道路・送電線は水上にも建設できる(橋・水上線、費用3倍)
  let cost = toolCost(currentTool);
  if (cur === T.WATER) {
    if (tileType !== T.ROAD && tileType !== T.WIRE) return;
    cost *= 3;
  } else if (cur !== T.GRASS && cur !== T.TREE) {
    // 既存の構造物の上には建てられない(先に整地が必要)
    if (cur === T.RUBBLE) toast('🚜 がれきは整地してから建設できます');
    return;
  }

  if (!spend(cost)) return;
  g.t[i] = tileType;
  g.lvl[i] = 0;
  g.fireT[i] = 0;
  if (tileType === T.POWER) computePower();
  updateHUD();
}

// 2点間のタイルを直線補間しながら建設(ドラッグ建設用)
function placeLine(x0, y0, x1, y1) {
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy, x = x0, y = y0;
  for (let n = 0; n < 200; n++) {
    placeTool(x, y);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
}

/* =========================================================
 * 描画
 * ========================================================= */
const spriteCache = new Map();

function tileSprite(type, lvl, ts) {
  const key = type + '_' + lvl + '_' + ts;
  let sp = spriteCache.get(key);
  if (sp) return sp;
  if (spriteCache.size > 400) spriteCache.clear();

  sp = document.createElement('canvas');
  sp.width = ts; sp.height = ts;
  const c = sp.getContext('2d');

  const emoji = (ch, scale = 0.78) => {
    c.font = Math.floor(ts * scale) + 'px serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(ch, ts / 2, ts / 2 + ts * 0.04);
  };
  const grassBg = () => { c.fillStyle = '#6fb44a'; c.fillRect(0, 0, ts, ts); };

  switch (type) {
    case T.GRASS: {
      grassBg();
      c.fillStyle = 'rgba(255,255,255,0.05)';
      if (lvl % 2) c.fillRect(0, 0, ts, ts); // 市松の濃淡(lvl流用)
      break;
    }
    case T.WATER:
      c.fillStyle = '#3a7bd5'; c.fillRect(0, 0, ts, ts);
      c.strokeStyle = 'rgba(255,255,255,0.25)';
      c.beginPath();
      c.moveTo(ts * 0.15, ts * 0.4); c.lineTo(ts * 0.45, ts * 0.4);
      c.moveTo(ts * 0.5, ts * 0.7); c.lineTo(ts * 0.85, ts * 0.7);
      c.stroke();
      break;
    case T.TREE: grassBg(); emoji('🌲'); break;
    case T.ROAD:
      c.fillStyle = '#4a4a4a'; c.fillRect(0, 0, ts, ts);
      c.fillStyle = '#e0d060';
      c.fillRect(ts * 0.46, ts * 0.1, ts * 0.08, ts * 0.25);
      c.fillRect(ts * 0.46, ts * 0.65, ts * 0.08, ts * 0.25);
      break;
    case T.WIRE:
      grassBg();
      c.strokeStyle = '#7a5c3a'; c.lineWidth = Math.max(1, ts * 0.08);
      c.beginPath();
      c.moveTo(ts / 2, ts * 0.15); c.lineTo(ts / 2, ts * 0.85);
      c.moveTo(ts * 0.25, ts * 0.3); c.lineTo(ts * 0.75, ts * 0.3);
      c.stroke();
      c.strokeStyle = '#222';
      c.beginPath();
      c.moveTo(0, ts * 0.32); c.lineTo(ts, ts * 0.32);
      c.stroke();
      break;
    case T.RES: {
      c.fillStyle = '#a5d6a7'; c.fillRect(0, 0, ts, ts);
      c.strokeStyle = '#2e7d32'; c.strokeRect(0.5, 0.5, ts - 1, ts - 1);
      const icons = ['', '🛖', '🏠', '🏘️', '🏢'];
      if (lvl === 0) { c.fillStyle = '#2e7d32'; emoji('住', 0.5); }
      else emoji(icons[lvl], 0.6 + lvl * 0.06);
      break;
    }
    case T.COM: {
      c.fillStyle = '#90caf9'; c.fillRect(0, 0, ts, ts);
      c.strokeStyle = '#1565c0'; c.strokeRect(0.5, 0.5, ts - 1, ts - 1);
      const icons = ['', '🏪', '🏬', '🏢', '🌆'];
      if (lvl === 0) { c.fillStyle = '#1565c0'; emoji('商', 0.5); }
      else emoji(icons[lvl], 0.6 + lvl * 0.06);
      break;
    }
    case T.IND: {
      c.fillStyle = '#ffe082'; c.fillRect(0, 0, ts, ts);
      c.strokeStyle = '#ef6c00'; c.strokeRect(0.5, 0.5, ts - 1, ts - 1);
      if (lvl === 0) { c.fillStyle = '#ef6c00'; emoji('工', 0.5); }
      else emoji('🏭', 0.55 + lvl * 0.08);
      break;
    }
    case T.POWER:
      c.fillStyle = '#616161'; c.fillRect(0, 0, ts, ts);
      c.strokeStyle = '#fdd835'; c.strokeRect(0.5, 0.5, ts - 1, ts - 1);
      emoji('⚡');
      break;
    case T.POLICE:
      c.fillStyle = '#bbdefb'; c.fillRect(0, 0, ts, ts);
      c.strokeStyle = '#0d47a1'; c.strokeRect(0.5, 0.5, ts - 1, ts - 1);
      emoji('🚓', 0.65);
      break;
    case T.FIRE_ST:
      c.fillStyle = '#ffcdd2'; c.fillRect(0, 0, ts, ts);
      c.strokeStyle = '#b71c1c'; c.strokeRect(0.5, 0.5, ts - 1, ts - 1);
      emoji('🚒', 0.65);
      break;
    case T.PARK: grassBg(); emoji('🌳'); break;
    case T.RUBBLE:
      c.fillStyle = '#8d6e63'; c.fillRect(0, 0, ts, ts);
      c.fillStyle = '#5d4037';
      c.fillRect(ts * 0.2, ts * 0.3, ts * 0.2, ts * 0.2);
      c.fillRect(ts * 0.55, ts * 0.55, ts * 0.25, ts * 0.18);
      break;
    case T.FIRE:
      c.fillStyle = '#bf360c'; c.fillRect(0, 0, ts, ts);
      emoji('🔥');
      break;
  }
  spriteCache.set(key, sp);
  return sp;
}

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.floor(cv.clientWidth * dpr);
  cv.height = Math.floor(cv.clientHeight * dpr);
  cx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function clampCamera() {
  const ts = BASE_TILE * cam.zoom;
  const vw = cv.clientWidth, vh = cv.clientHeight;
  cam.x = clamp(cam.x, -vw * 0.4, W * ts - vw * 0.6);
  cam.y = clamp(cam.y, -vh * 0.4, H * ts - vh * 0.6);
}

function draw() {
  const ts = Math.max(4, Math.round(BASE_TILE * cam.zoom));
  const vw = cv.clientWidth, vh = cv.clientHeight;
  cx.fillStyle = '#142014';
  cx.fillRect(0, 0, vw, vh);

  const x0 = Math.max(0, Math.floor(cam.x / ts));
  const y0 = Math.max(0, Math.floor(cam.y / ts));
  const x1 = Math.min(W - 1, Math.ceil((cam.x + vw) / ts));
  const y1 = Math.min(H - 1, Math.ceil((cam.y + vh) / ts));
  const blink = ((Date.now() / 450) | 0) % 2 === 0;

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = idx(x, y);
      const t = g.t[i];
      const lvl = t === T.GRASS ? (x * 7 + y * 13) % 2 : g.lvl[i];
      const px = Math.round(x * ts - cam.x);
      const py = Math.round(y * ts - cam.y);
      cx.drawImage(tileSprite(t, lvl, ts), px, py);

      // 電気が来ていない区画・施設は ⚡ を点滅表示
      if (blink && !g.powered[i] &&
          (isZone(t) || t === T.POLICE || t === T.FIRE_ST)) {
        cx.font = Math.floor(ts * 0.5) + 'px serif';
        cx.textAlign = 'left';
        cx.textBaseline = 'top';
        cx.fillStyle = '#ff0';
        cx.fillText('⚡', px + 1, py + 1);
      }
    }
  }
  requestAnimationFrame(draw);
}

/* =========================================================
 * HUD更新
 * ========================================================= */
function updateHUD() {
  $('hud-funds').textContent = '💰 ' + g.funds.toLocaleString();
  $('hud-pop').textContent = '👥 ' + g.pop.toLocaleString();
  const year = START_YEAR + Math.floor(g.month / 12);
  const m = (g.month % 12) + 1;
  $('hud-date').textContent = `${year}年${m}月`;
  $('bar-r').style.height = Math.round(Math.max(0, g.demand.r) * 100) + '%';
  $('bar-c').style.height = Math.round(Math.max(0, g.demand.c) * 100) + '%';
  $('bar-i').style.height = Math.round(Math.max(0, g.demand.i) * 100) + '%';
  $('tax-value').textContent = g.taxRate + '%';
}

/* =========================================================
 * 入力(タッチ・マウス共通のPointer Events)
 * ========================================================= */
function screenToTile(sx, sy) {
  const ts = BASE_TILE * cam.zoom;
  return [Math.floor((sx + cam.x) / ts), Math.floor((sy + cam.y) / ts)];
}

function tileInfo(tx, ty) {
  if (!inB(tx, ty)) return;
  const i = idx(tx, ty);
  const names = ['草地', '水', '森', '道路', '送電線', '住宅地', '商業地',
                 '工業地', '発電所', '警察署', '消防署', '公園', 'がれき', '火災'];
  let msg = names[g.t[i]];
  if (isZone(g.t[i])) {
    msg += ` Lv.${g.lvl[i]}` + (g.powered[i] ? '' : '(電気なし)') +
           (roadNear[i] ? '' : '(道路なし)');
  } else if (g.t[i] === T.POLICE || g.t[i] === T.FIRE_ST) {
    msg += g.powered[i] ? '(稼働中)' : '(電気なし)';
  }
  toast('📍 ' + msg);
}

cv.addEventListener('pointerdown', (e) => {
  cv.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false });
  if (pointers.size === 2) {
    // ピンチ開始
    const [p1, p2] = [...pointers.values()];
    pinchState = {
      dist: Math.hypot(p1.x - p2.x, p1.y - p2.y),
      zoom: cam.zoom,
    };
    lastBuildTile = null;
  } else if (pointers.size === 1 && currentTool !== 'pan') {
    const [tx, ty] = screenToTile(e.clientX, e.clientY);
    placeTool(tx, ty);
    lastBuildTile = [tx, ty];
  }
});

cv.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 6) p.moved = true;
  p.x = e.clientX; p.y = e.clientY;

  if (pointers.size === 2 && pinchState) {
    // ピンチズーム+2本指パン
    const [p1, p2] = [...pointers.values()];
    const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
    const midX = (p1.x + p2.x) / 2, midY = (p1.y + p2.y) / 2;
    const oldTs = BASE_TILE * cam.zoom;
    const newZoom = clamp(pinchState.zoom * dist / pinchState.dist, 0.5, 4);
    const wx = (midX + cam.x) / oldTs, wy = (midY + cam.y) / oldTs;
    cam.zoom = newZoom;
    const newTs = BASE_TILE * cam.zoom;
    cam.x = wx * newTs - midX;
    cam.y = wy * newTs - midY;
    cam.x -= dx / 2; cam.y -= dy / 2;
    clampCamera();
  } else if (pointers.size === 1) {
    if (currentTool === 'pan') {
      cam.x -= dx; cam.y -= dy;
      clampCamera();
    } else {
      const [tx, ty] = screenToTile(e.clientX, e.clientY);
      if (lastBuildTile && (tx !== lastBuildTile[0] || ty !== lastBuildTile[1])) {
        placeLine(lastBuildTile[0], lastBuildTile[1], tx, ty);
        lastBuildTile = [tx, ty];
      }
    }
  }
});

function pointerEnd(e) {
  const p = pointers.get(e.pointerId);
  if (p && !p.moved && currentTool === 'pan' && pointers.size === 1 && g.running) {
    const [tx, ty] = screenToTile(e.clientX, e.clientY);
    tileInfo(tx, ty);
  }
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchState = null;
  if (pointers.size === 0) lastBuildTile = null;
}
cv.addEventListener('pointerup', pointerEnd);
cv.addEventListener('pointercancel', pointerEnd);

// デスクトップ用:ホイールズーム
cv.addEventListener('wheel', (e) => {
  e.preventDefault();
  const oldTs = BASE_TILE * cam.zoom;
  const wx = (e.clientX + cam.x) / oldTs, wy = (e.clientY + cam.y) / oldTs;
  cam.zoom = clamp(cam.zoom * (e.deltaY < 0 ? 1.15 : 0.87), 0.5, 4);
  const newTs = BASE_TILE * cam.zoom;
  cam.x = wx * newTs - e.clientX;
  cam.y = wy * newTs - e.clientY;
  clampCamera();
}, { passive: false });

document.addEventListener('contextmenu', (e) => e.preventDefault());

/* =========================================================
 * UI構築・イベント
 * ========================================================= */
function buildToolbar() {
  const bar = $('toolbar');
  for (const tool of TOOLS) {
    const btn = document.createElement('button');
    btn.className = 'tool-btn' + (tool.id === currentTool ? ' active' : '');
    btn.dataset.tool = tool.id;
    btn.innerHTML = `<span class="icon">${tool.icon}</span>` +
                    `<span>${tool.label}</span>` +
                    (tool.cost ? `<span class="cost">§${tool.cost}</span>` : '<span class="cost">&nbsp;</span>');
    btn.addEventListener('click', () => {
      currentTool = tool.id;
      document.querySelectorAll('.tool-btn').forEach((b) =>
        b.classList.toggle('active', b.dataset.tool === tool.id));
    });
    bar.appendChild(btn);
  }
}

$('btn-speed').addEventListener('click', () => {
  setSpeed((g.speed + 1) % 3);
});

$('btn-menu').addEventListener('click', () => {
  $('menu-panel').classList.toggle('hidden');
});
$('btn-close-menu').addEventListener('click', () => $('menu-panel').classList.add('hidden'));

$('tax-down').addEventListener('click', () => {
  g.taxRate = Math.max(0, g.taxRate - 1);
  updateHUD();
});
$('tax-up').addEventListener('click', () => {
  g.taxRate = Math.min(20, g.taxRate + 1);
  updateHUD();
});

$('btn-save').addEventListener('click', () => saveGame(false));

$('btn-help').addEventListener('click', () => {
  $('menu-panel').classList.add('hidden');
  $('help-panel').classList.remove('hidden');
});
$('btn-close-help').addEventListener('click', () => $('help-panel').classList.add('hidden'));

$('btn-title').addEventListener('click', () => {
  saveGame(true);
  g.running = false;
  setSpeed(0);
  $('menu-panel').classList.add('hidden');
  showTitle();
});

$('btn-continue').addEventListener('click', () => {
  if (loadGame()) startGame();
  else toast('セーブデータが読み込めませんでした');
});

$('btn-new').addEventListener('click', () => {
  if (hasSave() && !confirm('セーブデータがあります。新しく始めると上書きされます。よろしいですか?')) {
    return;
  }
  newGame();
  startGame();
});

function showTitle() {
  $('title-screen').classList.remove('hidden');
  $('btn-continue').disabled = !hasSave();
}

function newGame() {
  genMap();
  g.funds = START_FUNDS;
  g.month = 0;
  g.taxRate = 7;
  g.milestone = 0;
  g.pop = 0;
  g.jobs = 0;
  g.demand = { r: 0, c: 0, i: 0 };
}

function startGame() {
  $('title-screen').classList.add('hidden');
  // カメラをマップ中央へ
  const ts = BASE_TILE * cam.zoom;
  cam.x = (W * ts - cv.clientWidth) / 2;
  cam.y = (H * ts - cv.clientHeight) / 2;
  clampCamera();
  g.running = true;
  computePower();
  computeMaps();
  calcStats();
  updateHUD();
  setSpeed(1);
  if (g.month === 0) {
    toast('⚡ まずは発電所と道路を作りましょう!(☰→遊び方)');
  }
}

// 画面を閉じる・切り替える時に自動セーブ
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveGame(true);
});
window.addEventListener('pagehide', () => saveGame(true));

window.addEventListener('resize', () => {
  resizeCanvas();
  clampCamera();
});

/* ===== 起動 ===== */
resizeCanvas();
buildToolbar();
showTitle();
updateHUD();
requestAnimationFrame(draw);
