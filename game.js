'use strict';

/* =========================================================
 * まちづくりシミュレーション
 * クラシックな都市育成ゲーム(スマホブラウザ対応・セーブ機能付き)
 * ========================================================= */

/* ===== 定数 ===== */
const W = 64, H = 64;          // マップサイズ(タイル)
const BASE_TILE = 16;          // 基本タイルピクセル
const SAVE_KEY = 'machizukuri_save_v1';
const CONGESTION = 150;          // 交通渋滞しきい値
const START_FUNDS = 20000;
const START_YEAR = 1990;
const MAX_LEVEL = 4;           // 区画の最大発展レベル
const PLANT_CAPACITY = 300;    // 石炭発電所1基が電気を送れるタイル数
const NUCLEAR_CAPACITY = 700;  // 原子力発電所1基が電気を送れるタイル数

// タイル種別
const T = {
  GRASS: 0, WATER: 1, TREE: 2, ROAD: 3, WIRE: 4,
  RES: 5, COM: 6, IND: 7,
  POWER: 8, POLICE: 9, FIRE_ST: 10, PARK: 11,
  RUBBLE: 12, FIRE: 13,
  RAIL: 14, FLOOD: 15,
  NUCLEAR: 16, STADIUM: 17, SEAPORT: 18, AIRPORT: 19,
};

// マルチタイル建物のサイズ(タイル数)。lvlに足元内の位置(dy*size+dx)を
// 格納し、lvl=0のタイルをアンカー(左上)とする
const BIG = {
  [T.NUCLEAR]: 2, [T.STADIUM]: 2, [T.SEAPORT]: 2, [T.AIRPORT]: 2,
};

// ツール定義(ツールバー表示順)
const TOOLS = [
  { id: 'pan',      label: '移動',     icon: '✋', cost: 0 },
  { id: 'road',     label: '道路',     icon: '🛣️', cost: 10 },
  { id: 'rail',     label: '線路',     icon: '🚃', cost: 20 },
  { id: 'wire',     label: '送電線',   icon: '🗼', cost: 5 },
  { id: 'res',      label: '住宅地',   icon: '🏠', cost: 100 },
  { id: 'com',      label: '商業地',   icon: '🏬', cost: 100 },
  { id: 'ind',      label: '工業地',   icon: '🏭', cost: 100 },
  { id: 'power',    label: '発電所',   icon: '⚡', cost: 3000 },
  { id: 'nuclear',  label: '原子力',   icon: '☢️', cost: 5000 },
  { id: 'police',   label: '警察署',   icon: '🚓', cost: 500 },
  { id: 'fire_st',  label: '消防署',   icon: '🚒', cost: 500 },
  { id: 'park',     label: '公園',     icon: '🌳', cost: 50 },
  { id: 'stadium',  label: 'スタジアム', icon: '🏟️', cost: 3000 },
  { id: 'seaport',  label: '港',       icon: '⚓', cost: 3000 },
  { id: 'airport',  label: '空港',     icon: '✈️', cost: 5000 },
  { id: 'bulldoze', label: '整地',     icon: '🚜', cost: 1 },
];
const TOOL_TILE = {
  road: T.ROAD, rail: T.RAIL, wire: T.WIRE,
  res: T.RES, com: T.COM, ind: T.IND,
  power: T.POWER, nuclear: T.NUCLEAR, police: T.POLICE, fire_st: T.FIRE_ST,
  park: T.PARK, stadium: T.STADIUM, seaport: T.SEAPORT, airport: T.AIRPORT,
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
  // v2: 予算(0〜100%)
  budget: { road: 100, police: 100, fire: 100, autoShow: true },
  // v2: 年度財政(月次累積)
  finYear: { tax: 0, road: 0, police: 0, fire: 0, other: 0 },
  // v2: 前年度財政
  lastFin: { tax: 0, road: 0, police: 0, fire: 0, other: 0 },
  // v2: 予算ウィンドウ表示フラグ(UI側が消費)
  pendingBudget: false,
  // v2: 自動災害フラグ
  autoDisaster: true,
  // v2: 移動型災害アクター(セーブ対象外)
  actors: [],
  // v2: 市民評価
  eval: { score: 0, approval: 50, problems: [] },
  // v2: 画面揺れカウンタ(描画担当が使用)
  shakeT: 0,
  // B: データマップオーバーレイモード(セーブ対象外)
  overlayMode: 'none',
};

// シミュレーション用の作業マップ(セーブ対象外、毎月再計算)
const roadNear = new Uint8Array(W * H);
const pollution = new Int16Array(W * H);
const landValue = new Int16Array(W * H);
const fireCov = new Uint8Array(W * H);
// v2: 交通量・犯罪・警察カバレッジ(セーブ対象外)
const traffic = new Uint16Array(W * H);
const crime = new Int16Array(W * H);
const policeCov = new Int16Array(W * H);
// v2: 需要ゲートヒント間隔管理(セーブ不要)
const g_hintAt = {};

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
function isBig(t) { return BIG[t] !== undefined; }
function conducts(t) {
  return t === T.WIRE || t === T.POWER || t === T.POLICE ||
         t === T.FIRE_ST || isZone(t) || isBig(t);
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
    if (g.t[i] === T.POWER || g.t[i] === T.NUCLEAR) {
      g.powered[i] = 1;
      queue.push(i);
      if (g.t[i] === T.POWER) capacity += PLANT_CAPACITY;
      else if (g.lvl[i] === 0) capacity += NUCLEAR_CAPACITY; // 2×2のうちアンカーのみ容量加算
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
  policeCov.fill(0);

  // 予算%に基づく半径計算
  const policeR = Math.round(6 * g.budget.police / 100);
  const fireR   = Math.round(8 * g.budget.fire   / 100);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      const t = g.t[i];
      if (t === T.ROAD || t === T.RAIL) {
        // 道路・線路から2タイル以内が「道路近接」(RAILも輸送アクセスに含める)
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            if (inB(x + dx, y + dy)) roadNear[idx(x + dx, y + dy)] = 1;
          }
        }
      }
      if (t === T.IND) {
        stamp(pollution, x, y, 4, 14 * g.lvl[i] + 6, true);
      } else if (t === T.POWER) {
        stamp(pollution, x, y, 4, 40, true);
      } else if (t === T.FIRE) {
        stamp(pollution, x, y, 3, 30, true);
      }
      if (t === T.PARK) {
        stamp(landValue, x, y, 3, 14, true);
      } else if (t === T.TREE) {
        stamp(landValue, x, y, 1, 3, false);
      } else if (t === T.POLICE && g.powered[i]) {
        stamp(landValue, x, y, 6, 8, true);
        // 警察カバレッジ(予算%でスケール)
        if (policeR > 0) stamp(policeCov, x, y, policeR, 40, true);
      } else if (t === T.FIRE_ST && g.powered[i]) {
        stamp(landValue, x, y, 6, 4, true);
        if (fireR > 0) stamp(fireCov, x, y, fireR, 1, false);
      }
    }
  }
}

/* =========================================================
 * 交通シミュレーション
 * ========================================================= */
function updateTraffic() {
  // 全タイル減衰(0.7倍)
  for (let i = 0; i < W * H; i++) {
    traffic[i] = (traffic[i] * 0.7) | 0;
  }
  // 発展済み・通電中の区画からチェビシェフ距離2以内のROADへ交通量を加算
  // RAILには加算しない(線路は渋滞しない)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      if (g.lvl[i] <= 0 || !g.powered[i]) continue;
      if (!isZone(g.t[i])) continue;
      // 線路が近くにあれば住民は鉄道で通勤するため、道路交通を発生させない
      let nearRail = false;
      for (let dy = -2; dy <= 2 && !nearRail; dy++) {
        for (let dx = -2; dx <= 2 && !nearRail; dx++) {
          if (inB(x + dx, y + dy) && g.t[idx(x + dx, y + dy)] === T.RAIL) nearRail = true;
        }
      }
      if (nearRail) continue;
      const add = g.lvl[i] * 3;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx, ny = y + dy;
          if (!inB(nx, ny)) continue;
          const ni = idx(nx, ny);
          if (g.t[ni] === T.ROAD) {
            traffic[ni] = Math.min(999, traffic[ni] + add);
          }
        }
      }
    }
  }
}

/* =========================================================
 * 犯罪シミュレーション
 * ========================================================= */
function updateCrime() {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      if (!isZone(g.t[i]) || g.lvl[i] <= 0) {
        crime[i] = 0;
        continue;
      }
      // 周囲8マスの住宅lvl合計(人口密度ボーナス)
      let resDensity = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx, ny = y + dy;
          if (!inB(nx, ny)) continue;
          const ni = idx(nx, ny);
          if (g.t[ni] === T.RES) resDensity += g.lvl[ni];
        }
      }
      const raw = g.lvl[i] * 10 + resDensity - landValue[i] * 0.3 - policeCov[i];
      crime[i] = clamp(Math.round(raw), 0, 250);
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

  // v2: 需要ゲート — 特殊建物がないと需要上限を制限
  applyDemandGates(cJobs, iJobs);
}

// 特殊建物の存在チェック(アンカーが存在し通電していること)
function hasBigBuilding(type) {
  for (let i = 0; i < W * H; i++) {
    if (g.t[i] === type && g.lvl[i] === 0 && g.powered[i]) return true;
  }
  return false;
}

// 需要ゲートの適用と24ヶ月ヒントトースト
function applyDemandGates(cJobs, iJobs) {
  const hints = [
    { key: 'stadium', check: () => g.pop >= 1200 && !hasBigBuilding(T.STADIUM),
      gate: () => { g.demand.r = Math.min(g.demand.r, 0.05); },
      msg: '🏟️ 住民はスタジアムを求めています' },
    { key: 'seaport', check: () => iJobs >= 500 && !hasBigBuilding(T.SEAPORT),
      gate: () => { g.demand.i = Math.min(g.demand.i, 0.05); },
      msg: '⚓ 工業の発展には港が必要です' },
    { key: 'airport', check: () => cJobs >= 400 && !hasBigBuilding(T.AIRPORT),
      gate: () => { g.demand.c = Math.min(g.demand.c, 0.05); },
      msg: '✈️ 商業の発展には空港が必要です' },
  ];
  for (const h of hints) {
    if (h.check()) {
      h.gate();
      // 24ヶ月に1回までヒントトースト
      if (g_hintAt[h.key] === undefined || g.month - g_hintAt[h.key] >= 24) {
        g_hintAt[h.key] = g.month;
        toast(h.msg);
      }
    }
  }
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

    // v2: 犯罪の影響(COM/RES)
    if (t === T.COM) envMult *= clamp(1 - crime[i] / 350, 0.2, 1);
    else if (t === T.RES) envMult *= clamp(1 - crime[i] / 500, 0.3, 1);

    // v2: 渋滞ペナルティ(道路アクセスのみの区画で、周囲5×5のROADが全て渋滞)
    // 線路アクセスのみの区画は渋滞ペナルティなし
    let congested = false;
    {
      const x = i % W, y = (i / W) | 0;
      let roadCount = 0, congestedCount = 0;
      let hasRoadOnly = false; // 道路が存在するか
      let hasRailOnly = false; // 線路が存在するか(道路なし)
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx, ny = y + dy;
          if (!inB(nx, ny)) continue;
          const ni = idx(nx, ny);
          if (g.t[ni] === T.ROAD) {
            hasRoadOnly = true;
            roadCount++;
            if (traffic[ni] > CONGESTION) congestedCount++;
          } else if (g.t[ni] === T.RAIL) {
            hasRailOnly = true;
          }
        }
      }
      // 線路アクセスのみなら渋滞ペナルティなし
      // 道路があり、その全てが渋滞なら渋滞ペナルティ適用
      if (hasRoadOnly && roadCount > 0 && congestedCount === roadCount) {
        congested = true;
      }
    }
    if (congested) {
      envMult *= 0.5;
      if (g.lvl[i] > 0 && rnd() < 0.03) g.lvl[i]--; // 毎月3%で衰退
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
 * アクター(洪水減衰・竜巻・怪獣)
 * ========================================================= */
function actorsStep() {
  // FLOODタイルの減衰と拡散
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      if (g.t[i] !== T.FLOOD) continue;
      g.fireT[i]--;
      if (g.fireT[i] <= 0) {
        g.t[i] = T.GRASS;
        g.lvl[i] = 0;
        g.fireT[i] = 0;
      } else if (g.fireT[i] > 2 && rnd() < 0.15) {
        // 隣接タイルへ拡大
        const dirs = [[x+1,y],[x-1,y],[x,y+1],[x,y-1]];
        const d = dirs[Math.floor(rnd() * dirs.length)];
        if (inB(d[0], d[1])) {
          const ni = idx(d[0], d[1]);
          if (g.t[ni] !== T.WATER && g.t[ni] !== T.FLOOD) {
            if (isBig(g.t[ni])) {
              const [ax, ay] = bigAnchor(d[0], d[1]);
              const size = BIG[g.t[ni]];
              for (let bdy = 0; bdy < size; bdy++) {
                for (let bdx = 0; bdx < size; bdx++) {
                  const bni = idx(ax+bdx, ay+bdy);
                  g.t[bni] = T.FLOOD;
                  g.lvl[bni] = 0;
                  g.fireT[bni] = Math.max(1, g.fireT[i] - 1);
                }
              }
            } else {
              g.t[ni] = T.FLOOD;
              g.lvl[ni] = 0;
              g.fireT[ni] = Math.max(1, g.fireT[i] - 1);
            }
          }
        }
      }
    }
  }

  // アクター(竜巻・怪獣)の移動・破壊
  for (const a of g.actors) {
    if (a.ttl <= 0) continue;
    a.ttl--;

    if (a.kind === 'tornado') {
      // ランダムに1歩移動
      let dx, dy;
      do {
        dx = Math.floor(rnd() * 3) - 1;
        dy = Math.floor(rnd() * 3) - 1;
      } while (dx === 0 && dy === 0);
      const nx = a.x + dx, ny = a.y + dy;
      if (!inB(nx, ny)) { a.ttl = 0; continue; }
      a.x = nx; a.y = ny;
      const ni = idx(nx, ny);
      if (g.t[ni] !== T.WATER) {
        if (isBig(g.t[ni])) {
          const [ax, ay] = bigAnchor(nx, ny);
          const size = BIG[g.t[ni]];
          for (let bdy = 0; bdy < size; bdy++) {
            for (let bdx = 0; bdx < size; bdx++) {
              const bni = idx(ax+bdx, ay+bdy);
              g.t[bni] = T.RUBBLE;
              g.lvl[bni] = 0;
              g.fireT[bni] = 0;
            }
          }
        } else {
          g.t[ni] = T.RUBBLE;
          g.lvl[ni] = 0;
          g.fireT[ni] = 0;
        }
      }

    } else if (a.kind === 'monster') {
      // 目標(最大公害地点)へ1歩移動(±1の揺らぎあり)
      let maxP = -1;
      for (let pi = 0; pi < W * H; pi++) {
        if (pollution[pi] > maxP) { maxP = pollution[pi]; a.tx = pi % W; a.ty = (pi / W) | 0; }
      }
      const ddx = a.tx - a.x, ddy = a.ty - a.y;
      let mx = ddx === 0 ? 0 : (ddx > 0 ? 1 : -1);
      let my = ddy === 0 ? 0 : (ddy > 0 ? 1 : -1);
      // 揺らぎ
      if (rnd() < 0.3) mx += (Math.floor(rnd() * 3) - 1);
      if (rnd() < 0.3) my += (Math.floor(rnd() * 3) - 1);
      mx = clamp(mx, -1, 1);
      my = clamp(my, -1, 1);
      const nx = clamp(a.x + mx, 0, W - 1);
      const ny = clamp(a.y + my, 0, H - 1);
      a.x = nx; a.y = ny;
      const ni = idx(nx, ny);
      // 通過タイル破壊
      if (isBig(g.t[ni])) {
        const [ax, ay] = bigAnchor(nx, ny);
        const size = BIG[g.t[ni]];
        for (let bdy = 0; bdy < size; bdy++) {
          for (let bdx = 0; bdx < size; bdx++) {
            const bni = idx(ax+bdx, ay+bdy);
            g.t[bni] = T.RUBBLE;
            g.lvl[bni] = 0;
            g.fireT[bni] = 0;
          }
        }
      } else if (g.t[ni] !== T.WATER) {
        g.t[ni] = T.RUBBLE;
        g.lvl[ni] = 0;
        g.fireT[ni] = 0;
      }
      // 隣接タイルに発火
      for (const [fnx, fny] of [[nx+1,ny],[nx-1,ny],[nx,ny+1],[nx,ny-1]]) {
        if (!inB(fnx, fny)) continue;
        const fni = idx(fnx, fny);
        if (flammable(g.t[fni]) && rnd() < 0.3) {
          g.t[fni] = T.FIRE;
          g.lvl[fni] = 0;
          g.fireT[fni] = 3 + Math.floor(rnd() * 3);
        }
      }
    }
  }

  // 死んだアクターを除去
  g.actors = g.actors.filter(a => a.ttl > 0);
}

/* =========================================================
 * 災害発生
 * ========================================================= */
function triggerDisaster(kind) {
  const developed = [];
  for (let i = 0; i < W * H; i++) {
    if (isZone(g.t[i]) && g.lvl[i] > 0) developed.push(i);
  }

  if (kind === 'fire') {
    if (developed.length === 0) return;
    const i = developed[Math.floor(rnd() * developed.length)];
    g.t[i] = T.FIRE;
    g.lvl[i] = 0;
    g.fireT[i] = 4 + Math.floor(rnd() * 4);
    toast('🔥 火事が発生しました!');

  } else if (kind === 'flood') {
    // Find water tiles adjacent to land
    const waterEdge = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (g.t[idx(x,y)] !== T.WATER) continue;
        for (const [nx,ny] of [[x+1,y],[x-1,y],[x,y+1],[x,y-1]]) {
          if (inB(nx,ny) && g.t[idx(nx,ny)] !== T.WATER) { waterEdge.push(idx(x,y)); break; }
        }
      }
    }
    if (waterEdge.length === 0) return;
    const wi = waterEdge[Math.floor(rnd() * waterEdge.length)];
    const wx = wi % W, wy = (wi / W) | 0;
    // Flood land tiles within distance 2
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = wx+dx, ny = wy+dy;
        if (!inB(nx,ny)) continue;
        const ni = idx(nx,ny);
        if (g.t[ni] === T.WATER) continue;
        // Handle multi-tile buildings
        if (isBig(g.t[ni])) {
          const [ax,ay] = bigAnchor(nx,ny);
          const size = BIG[g.t[ni]];
          for (let bdy = 0; bdy < size; bdy++) {
            for (let bdx = 0; bdx < size; bdx++) {
              const bni = idx(ax+bdx, ay+bdy);
              g.t[bni] = T.FLOOD;
              g.lvl[bni] = 0;
              g.fireT[bni] = 4 + Math.floor(rnd() * 4);
            }
          }
        } else {
          g.t[ni] = T.FLOOD;
          g.lvl[ni] = 0;
          g.fireT[ni] = 4 + Math.floor(rnd() * 4);
        }
      }
    }
    toast('🌊 洪水が発生しました!');

  } else if (kind === 'quake') {
    g.shakeT = 60;
    const hits = 8 + Math.floor(rnd() * 8);
    for (let h = 0; h < hits; h++) {
      const qx = Math.floor(rnd() * W), qy = Math.floor(rnd() * H);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = qx+dx, ny = qy+dy;
          if (!inB(nx,ny)) continue;
          const ni = idx(nx,ny);
          if (g.t[ni] === T.WATER) continue;
          if (rnd() < 0.6) {
            // Destroy - handle multi-tile buildings
            if (isBig(g.t[ni])) {
              const ttype = g.t[ni];
              const [ax,ay] = bigAnchor(nx,ny);
              const size = BIG[ttype];
              // 原子力ならメルトダウン判定(建物につき1回)
              const meltdown = ttype === T.NUCLEAR && rnd() < 0.3;
              for (let bdy = 0; bdy < size; bdy++) {
                for (let bdx = 0; bdx < size; bdx++) {
                  const bni = idx(ax+bdx, ay+bdy);
                  if (meltdown) {
                    g.t[bni] = T.FIRE;
                    g.lvl[bni] = 0;
                    g.fireT[bni] = 6 + Math.floor(rnd() * 4);
                  } else {
                    g.t[bni] = T.RUBBLE;
                    g.lvl[bni] = 0;
                    g.fireT[bni] = 0;
                  }
                }
              }
              if (meltdown) toast('☢️ 原子力発電所がメルトダウン!');
            } else {
              const wasZone = isZone(g.t[ni]) && g.lvl[ni] > 0;
              g.t[ni] = T.RUBBLE;
              g.lvl[ni] = 0;
              g.fireT[ni] = 0;
              if (wasZone && rnd() < 0.25) {
                g.t[ni] = T.FIRE;
                g.fireT[ni] = 4 + Math.floor(rnd() * 4);
              }
            }
          }
        }
      }
    }
    toast('🌋 地震が発生しました!');

  } else if (kind === 'tornado') {
    // Spawn from a random map edge
    let sx, sy;
    const edge = Math.floor(rnd() * 4);
    if (edge === 0) { sx = Math.floor(rnd() * W); sy = 0; }
    else if (edge === 1) { sx = Math.floor(rnd() * W); sy = H - 1; }
    else if (edge === 2) { sx = 0; sy = Math.floor(rnd() * H); }
    else { sx = W - 1; sy = Math.floor(rnd() * H); }
    g.actors.push({ kind: 'tornado', x: sx, y: sy, ttl: 24, tx: 0, ty: 0 });
    toast('🌪️ 竜巻が発生しました!');

  } else if (kind === 'monster') {
    let sx, sy;
    const edge = Math.floor(rnd() * 4);
    if (edge === 0) { sx = Math.floor(rnd() * W); sy = 0; }
    else if (edge === 1) { sx = Math.floor(rnd() * W); sy = H - 1; }
    else if (edge === 2) { sx = 0; sy = Math.floor(rnd() * H); }
    else { sx = W - 1; sy = Math.floor(rnd() * H); }
    // Find max pollution target
    let maxP = -1, tx = W >> 1, ty = H >> 1;
    for (let pi = 0; pi < W * H; pi++) {
      if (pollution[pi] > maxP) { maxP = pollution[pi]; tx = pi % W; ty = (pi / W) | 0; }
    }
    g.actors.push({ kind: 'monster', x: sx, y: sy, ttl: 30, tx, ty });
    toast('👾 怪獣が現れました!');
  }
}

/* =========================================================
 * 市民評価
 * ========================================================= */
function computeEvaluation() {
  let totalCrime = 0, totalPoll = 0, zonedCount = 0;
  let congestedRoads = 0, totalRoads = 0;
  let unpoweredZones = 0, totalZones = 0;

  for (let i = 0; i < W * H; i++) {
    if (isZone(g.t[i]) && g.lvl[i] > 0) {
      totalCrime += crime[i];
      totalPoll += pollution[i];
      zonedCount++;
      if (!g.powered[i]) unpoweredZones++;
    }
    if (isZone(g.t[i])) totalZones++;
    if (g.t[i] === T.ROAD) {
      totalRoads++;
      if (traffic[i] > CONGESTION) congestedRoads++;
    }
  }

  const avgCrime = zonedCount > 0 ? totalCrime / zonedCount : 0;
  const avgPoll = zonedCount > 0 ? totalPoll / zonedCount : 0;
  const congestionRate = totalRoads > 0 ? congestedRoads / totalRoads : 0;
  const unemployed = Math.max(0, (g.pop * 0.6 - g.jobs)) / Math.max(1, g.pop * 0.6);
  const unpoweredRate = totalZones > 0 ? unpoweredZones / totalZones : 0;

  const approval = clamp(Math.round(
    75 - avgCrime * 0.15 - avgPoll * 0.1
    - congestionRate * 40 - unemployed * 50
    - (g.taxRate - 7) * 2.5
  ), 0, 100);

  // problems: collect factors, sort descending, take top 3
  const factors = [
    { label: '犯罪', v: avgCrime * 0.15 },
    { label: '公害', v: avgPoll * 0.1 },
    { label: '交通渋滞', v: congestionRate * 40 },
    { label: '税金', v: Math.max(0, (g.taxRate - 7) * 2.5) },
    { label: '失業', v: unemployed * 50 },
    { label: '電力不足', v: unpoweredRate * 30 },
  ];
  factors.sort((a, b) => b.v - a.v);
  const problems = factors.slice(0, 3).filter(f => f.v > 0).map(f => f.label);

  const score = clamp(Math.round(g.pop * 0.5 + approval * 3 + 500), 0, 9999);

  g.eval = { score, approval, problems };
}

/* =========================================================
 * 財政(毎月)
 * ========================================================= */
function economy() {
  let roads = 0, rails = 0, wires = 0, police = 0, fireSts = 0, plants = 0;
  let nuclearAnchors = 0, parks = 0, stadiums = 0, seaports = 0, airports = 0;
  for (let i = 0; i < W * H; i++) {
    switch (g.t[i]) {
      case T.ROAD:    roads++; break;
      case T.RAIL:    rails++; break;
      case T.WIRE:    wires++; break;
      case T.POLICE:  police++; break;
      case T.FIRE_ST: fireSts++; break;
      case T.POWER:   plants++; break;
      case T.NUCLEAR: if (g.lvl[i] === 0) nuclearAnchors++; break;
      case T.PARK:    parks++; break;
      case T.STADIUM: if (g.lvl[i] === 0) stadiums++; break;
      case T.SEAPORT: if (g.lvl[i] === 0) seaports++; break;
      case T.AIRPORT: if (g.lvl[i] === 0) airports++; break;
    }
  }
  const income = (g.pop * 1.2 + g.jobs * 0.6) * g.taxRate / 100 / 2;

  const roadExp   = roads * 0.10 * (g.budget.road / 100) + rails * 0.20 * (g.budget.road / 100);
  const policeExp = police * 15 * (g.budget.police / 100);
  const fireExp   = fireSts * 12 * (g.budget.fire / 100);
  const otherExp  = plants * 25 + nuclearAnchors * 40 + parks * 2
                    + stadiums * 20 + seaports * 15 + airports * 30;

  g.finYear.tax    += income;
  g.finYear.road   += roadExp;
  g.finYear.police += policeExp;
  g.finYear.fire   += fireExp;
  g.finYear.other  += otherExp;

  // 道路劣化: 予算が低いと道路・線路が破損する
  if (g.budget.road < 60) {
    const prob = (60 - g.budget.road) / 4000;
    let degraded = false;
    for (let i = 0; i < W * H; i++) {
      if ((g.t[i] === T.ROAD || g.t[i] === T.RAIL) && rnd() < prob) {
        g.t[i] = T.RUBBLE;
        g.lvl[i] = 0;
        g.fireT[i] = 0;
        degraded = true;
      }
    }
    if (degraded && rnd() < 0.05) toast('🚧 道路が傷んでいます');
  }

  const totalExpense = roadExp + policeExp + fireExp + otherExp;
  g.funds += Math.round(income - totalExpense);
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
  updateTraffic();
  updateCrime();
  calcStats();
  zoneGrowth();
  fireStep();
  actorsStep();
  economy();
  computeEvaluation();
  g.month++;
  checkMilestones();
  // 1月(毎年1月): 年度財政退避・リセット・予算ウィンドウ表示フラグ
  if (g.month % 12 === 0) {
    g.lastFin = Object.assign({}, g.finYear);
    g.finYear = { tax: 0, road: 0, police: 0, fire: 0, other: 0 };
    g.pendingBudget = true;
  }
  // 12ヶ月ごと自動セーブ
  if (g.month % 12 === 0) saveGame(true);
  // 自動災害
  if (g.month > 24 && g.autoDisaster && rnd() < 0.004) {
    const r = rnd();
    if (r < 0.50) triggerDisaster('fire');
    else if (r < 0.70) triggerDisaster('flood');
    else if (r < 0.85) triggerDisaster('tornado');
    else if (r < 0.95) triggerDisaster('quake');
    else {
      // monster only when avg pollution is high
      let totalP = 0, cnt = 0;
      for (let i = 0; i < W * H; i++) { if (pollution[i] > 0) { totalP += pollution[i]; cnt++; } }
      const avgP = cnt > 0 ? totalP / cnt : 0;
      if (avgP > 20 || rnd() < 0.3) triggerDisaster('monster');
    }
  }
  updateHUD();
}

let simTimer = null;
const SPEED_INTERVALS = [0, 2400, 1000, 400]; // 停止/ゆっくり/ふつう/はやい
const SPEED_LABELS = ['⏸', '▶', '▶▶', '▶▶▶'];
function setSpeed(s) {
  g.speed = s;
  if (simTimer) { clearInterval(simTimer); simTimer = null; }
  if (s > 0 && g.running) {
    simTimer = setInterval(simMonth, SPEED_INTERVALS[s]);
  }
  $('btn-speed').textContent = SPEED_LABELS[s];
}

/* =========================================================
 * セーブ・ロード
 * ========================================================= */
function saveGame(auto) {
  if (!g.running) return;
  try {
    const data = {
      v: 2,
      funds: g.funds,
      month: g.month,
      taxRate: g.taxRate,
      milestone: g.milestone,
      t: Array.from(g.t),
      lvl: Array.from(g.lvl),
      fireT: Array.from(g.fireT),
      budget: Object.assign({}, g.budget),
      autoDisaster: g.autoDisaster,
      finYear: Object.assign({}, g.finYear),
      lastFin: Object.assign({}, g.lastFin),
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
    if (!data || !Array.isArray(data.t) || data.t.length !== W * H) return false;
    if (data.v !== 1 && data.v !== 2) return false;
    g.t.set(data.t);
    g.lvl.set(data.lvl);
    g.fireT.set(data.fireT);
    g.funds = data.funds;
    g.month = data.month;
    g.taxRate = data.taxRate;
    g.milestone = data.milestone || 0;
    // v2フィールド(v1の場合はデフォルト値を補う)
    g.budget = data.budget ? Object.assign({}, data.budget)
                           : { road: 100, police: 100, fire: 100, autoShow: true };
    g.autoDisaster = data.autoDisaster !== undefined ? data.autoDisaster : true;
    g.finYear = data.finYear ? Object.assign({}, data.finYear)
                             : { tax: 0, road: 0, police: 0, fire: 0, other: 0 };
    g.lastFin = data.lastFin ? Object.assign({}, data.lastFin)
                             : { tax: 0, road: 0, police: 0, fire: 0, other: 0 };
    g.actors = [];
    g.eval = { score: 0, approval: 50, problems: [] };
    g.pendingBudget = false;
    g.shakeT = 0;
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

// マルチタイル建物のアンカー(左上)座標を求める
function bigAnchor(tx, ty) {
  const size = BIG[g.t[idx(tx, ty)]];
  const p = g.lvl[idx(tx, ty)]; // 足元内の位置 dy*size+dx
  return [tx - (p % size), ty - Math.floor(p / size)];
}

// (tx,ty)を左上として size×size の建物を建てられるか
function canPlaceBig(tx, ty, size) {
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      if (!inB(tx + dx, ty + dy)) return false;
      const t = g.t[idx(tx + dx, ty + dy)];
      if (t !== T.GRASS && t !== T.TREE) return false;
    }
  }
  return true;
}

// 足元が水に面しているか(港の建設条件)
function touchesWater(tx, ty, size) {
  for (let dy = -1; dy <= size; dy++) {
    for (let dx = -1; dx <= size; dx++) {
      if (dy >= 0 && dy < size && dx >= 0 && dx < size) continue;
      if (inB(tx + dx, ty + dy) && g.t[idx(tx + dx, ty + dy)] === T.WATER) return true;
    }
  }
  return false;
}

function placeTool(tx, ty) {
  if (!inB(tx, ty)) return;
  const i = idx(tx, ty);
  const cur = g.t[i];

  if (currentTool === 'bulldoze') {
    if (cur === T.GRASS || cur === T.WATER) return;
    if (!spend(1)) return;
    if (isBig(cur)) {
      // マルチタイル建物は一括撤去
      const size = BIG[cur];
      const [ax, ay] = bigAnchor(tx, ty);
      for (let dy = 0; dy < size; dy++) {
        for (let dx = 0; dx < size; dx++) {
          const ni = idx(ax + dx, ay + dy);
          g.t[ni] = T.GRASS;
          g.lvl[ni] = 0;
          g.fireT[ni] = 0;
        }
      }
    } else {
      g.t[i] = T.GRASS;
      g.lvl[i] = 0;
      g.fireT[i] = 0;
    }
    updateHUD();
    return;
  }

  const tileType = TOOL_TILE[currentTool];
  if (tileType === undefined) return;
  if (cur === tileType) return;

  // マルチタイル建物(タップ位置を左上として建設)
  if (isBig(tileType)) {
    const size = BIG[tileType];
    if (!canPlaceBig(tx, ty, size)) {
      toast(`⛔ ${size}×${size}の空き地が必要です`);
      return;
    }
    if (tileType === T.SEAPORT && !touchesWater(tx, ty, size)) {
      toast('⚓ 港は水辺にしか建設できません');
      return;
    }
    if (!spend(toolCost(currentTool))) return;
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        const ni = idx(tx + dx, ty + dy);
        g.t[ni] = tileType;
        g.lvl[ni] = dy * size + dx;
        g.fireT[ni] = 0;
      }
    }
    if (tileType === T.NUCLEAR) computePower();
    updateHUD();
    return;
  }

  // 道路・線路・送電線は水上にも建設できる(橋・水上線、費用3倍)
  let cost = toolCost(currentTool);
  if (cur === T.WATER) {
    if (tileType !== T.ROAD && tileType !== T.WIRE && tileType !== T.RAIL) return;
    cost *= 3;
  } else if (cur !== T.GRASS && cur !== T.TREE) {
    // 既存の構造物の上には建てられない(先に整地が必要)
    if (cur === T.RUBBLE) toast('🚜 がれきは整地してから建設できます');
    return;
  }

  if (!spend(cost)) return;
  g.t[i] = tileType;
  // 水上に建てた道路・線路・送電線は橋になる(lvl=1を橋フラグとして使う)
  g.lvl[i] = cur === T.WATER ? 1 : 0;
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

/* --- 描画ヘルパー ---
 * スプライトは幅ts×高さts*2のキャンバス。下半分(y=ts〜2ts)が地面で、
 * 建物は上半分にはみ出して立体感を出す。 */

function groundGrass(c, ts, parity) {
  c.fillStyle = parity ? '#6fb44a' : '#77bb51';
  c.fillRect(0, ts, ts, ts);
  c.fillStyle = 'rgba(255,255,255,0.07)';
  const d = Math.max(1, ts * 0.06);
  c.fillRect(ts * 0.2, ts * 1.3, d, d);
  c.fillRect(ts * 0.65, ts * 1.6, d, d);
}

function groundWater(c, ts) {
  c.fillStyle = '#3a7bd5';
  c.fillRect(0, ts, ts, ts);
  c.strokeStyle = 'rgba(255,255,255,0.3)';
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(ts * 0.12, ts * 1.35);
  c.quadraticCurveTo(ts * 0.28, ts * 1.28, ts * 0.44, ts * 1.35);
  c.moveTo(ts * 0.5, ts * 1.7);
  c.quadraticCurveTo(ts * 0.66, ts * 1.63, ts * 0.82, ts * 1.7);
  c.stroke();
}

// 雷マーク
function boltShape(c, x, y, s, color) {
  c.fillStyle = color;
  c.beginPath();
  c.moveTo(x + 0.12 * s, y - 0.5 * s);
  c.lineTo(x - 0.26 * s, y + 0.12 * s);
  c.lineTo(x - 0.02 * s, y + 0.12 * s);
  c.lineTo(x - 0.12 * s, y + 0.5 * s);
  c.lineTo(x + 0.26 * s, y - 0.12 * s);
  c.lineTo(x + 0.02 * s, y - 0.12 * s);
  c.closePath();
  c.fill();
}

// 立体感のある建物(落ち影+壁+右側面の陰+窓+屋根)を描く
function drawBox(c, ts, opt) {
  const m = opt.m !== undefined ? opt.m : ts * 0.14;
  const w = ts - 2 * m;
  const baseY = ts * 2 - m * 0.8; // 建物の足元
  const wallTop = baseY - opt.wallH;
  // 落ち影
  c.fillStyle = 'rgba(0,0,0,0.22)';
  c.fillRect(m + ts * 0.07, baseY - ts * 0.05, w, ts * 0.1);
  // 壁
  c.fillStyle = opt.wall;
  c.fillRect(m, wallTop, w, opt.wallH);
  // 右側面の陰
  const sw = Math.max(1.5, ts * 0.1);
  c.fillStyle = opt.wallDark;
  c.fillRect(m + w - sw, wallTop, sw, opt.wallH);
  // 窓
  if (opt.floors) {
    c.fillStyle = opt.win || '#fff3b0';
    const cols = opt.cols || 3;
    const fH = opt.wallH / opt.floors;
    for (let f = 0; f < opt.floors; f++) {
      for (let k = 0; k < cols; k++) {
        const wx = m + (w * (k + 0.5)) / cols - w * 0.1;
        const wy = wallTop + fH * (f + 0.28);
        c.fillRect(wx, wy, w * 0.2, fH * 0.44);
      }
    }
  }
  // ドア
  if (opt.door) {
    c.fillStyle = opt.door;
    c.fillRect(m + w / 2 - ts * 0.08, baseY - ts * 0.2, ts * 0.16, ts * 0.2);
  }
  // 屋根
  if (opt.roofType === 'pitched') {
    c.fillStyle = opt.roof;
    c.beginPath();
    c.moveTo(m - ts * 0.05, wallTop);
    c.lineTo(m + w / 2, wallTop - opt.roofH);
    c.lineTo(m + w + ts * 0.05, wallTop);
    c.closePath();
    c.fill();
    c.fillStyle = 'rgba(255,255,255,0.15)';
    c.beginPath();
    c.moveTo(m - ts * 0.05, wallTop);
    c.lineTo(m + w / 2, wallTop - opt.roofH);
    c.lineTo(m + w * 0.3, wallTop);
    c.closePath();
    c.fill();
  } else {
    const rd = opt.roofD !== undefined ? opt.roofD : ts * 0.28;
    c.fillStyle = opt.roof;
    c.fillRect(m, wallTop - rd, w, rd);
    c.fillStyle = 'rgba(255,255,255,0.2)';
    c.fillRect(m, wallTop - rd, w, Math.max(1, rd * 0.25));
  }
  return { m, w, baseY, wallTop };
}

// 煙突+煙
function drawChimney(c, x, y, cw, ch) {
  c.fillStyle = '#9aa0a6';
  c.fillRect(x, y - ch, cw, ch);
  c.fillStyle = '#c0392b';
  c.fillRect(x, y - ch, cw, Math.max(1, ch * 0.18));
  c.fillStyle = 'rgba(220,220,220,0.55)';
  c.beginPath(); c.arc(x + cw * 0.5, y - ch - cw * 0.7, cw * 0.55, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.arc(x + cw * 1.2, y - ch - cw * 1.5, cw * 0.75, 0, Math.PI * 2); c.fill();
}

// 木(影+幹+樹冠)
function drawTreeShape(c, ts, scale, ox, oy) {
  const x = ts / 2 + ox, by = ts * 1.8 + oy;
  c.save();
  c.translate(x, by);
  c.scale(1, 0.45);
  c.fillStyle = 'rgba(0,0,0,0.25)';
  c.beginPath(); c.arc(0, 0, ts * 0.3 * scale, 0, Math.PI * 2); c.fill();
  c.restore();
  c.fillStyle = '#7a5230';
  c.fillRect(x - ts * 0.05 * scale, by - ts * 0.5 * scale, ts * 0.1 * scale, ts * 0.5 * scale);
  c.fillStyle = '#2f7d32';
  c.beginPath(); c.arc(x, by - ts * 0.62 * scale, ts * 0.3 * scale, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#4caf50';
  c.beginPath(); c.arc(x - ts * 0.08 * scale, by - ts * 0.7 * scale, ts * 0.16 * scale, 0, Math.PI * 2); c.fill();
}

// 道路:隣接マスク(北1/東2/南4/西8)に応じて道とセンターラインの向きが変わる
function drawRoadTile(c, ts, mask, bridge) {
  if (bridge) groundWater(c, ts); else groundGrass(c, ts, 0);
  const GY = ts;
  const pad = ts * 0.14;
  const m = mask === 0 ? 10 : mask; // 孤立タイルは東西の道として描く
  // 橋桁の影
  if (bridge) {
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.fillRect(pad * 0.6, GY + pad * 0.6, ts - pad * 1.2, ts - pad * 1.2);
  }
  // アスファルト本体(中央+接続方向への腕)
  c.fillStyle = bridge ? '#5a5f66' : '#4b4b50';
  c.fillRect(pad, GY + pad, ts - 2 * pad, ts - 2 * pad);
  if (m & 1) c.fillRect(pad, GY, ts - 2 * pad, pad + 1);
  if (m & 4) c.fillRect(pad, GY + ts - pad - 1, ts - 2 * pad, pad + 1);
  if (m & 8) c.fillRect(0, GY + pad, pad + 1, ts - 2 * pad);
  if (m & 2) c.fillRect(ts - pad - 1, GY + pad, pad + 1, ts - 2 * pad);
  // 縁石(道がつながっていない側)
  c.fillStyle = bridge ? '#aab2bb' : '#9e9e9e';
  const cb = Math.max(1, ts * 0.05);
  if (!(m & 1)) c.fillRect(pad, GY + pad, ts - 2 * pad, cb);
  if (!(m & 4)) c.fillRect(pad, GY + ts - pad - cb, ts - 2 * pad, cb);
  if (!(m & 8)) c.fillRect(pad, GY + pad, cb, ts - 2 * pad);
  if (!(m & 2)) c.fillRect(ts - pad - cb, GY + pad, cb, ts - 2 * pad);
  // センターライン:道の向きに合わせる
  const lw = Math.max(1, ts * 0.06);
  const dash = Math.max(2, ts * 0.16);
  const bits = (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);
  c.fillStyle = '#e6c84f';
  if (m === 10 || m === 2 || m === 8) {
    // 東西方向 → 横向きの破線
    for (let x = ts * 0.06; x < ts - 2; x += dash * 2) {
      c.fillRect(x, GY + ts / 2 - lw / 2, dash, lw);
    }
  } else if (m === 5 || m === 1 || m === 4) {
    // 南北方向 → 縦向きの破線
    for (let y = GY + ts * 0.06; y < GY + ts - 2; y += dash * 2) {
      c.fillRect(ts / 2 - lw / 2, y, lw, dash);
    }
  } else if (bits >= 3) {
    // 交差点 → 横断歩道
    c.fillStyle = 'rgba(255,255,255,0.8)';
    const sw2 = Math.max(1, ts * 0.07);
    for (let k = 0; k < 4; k++) {
      const off = pad + ts * 0.08 + k * ts * 0.18;
      if (off > ts - pad - ts * 0.08) break;
      if (m & 1) c.fillRect(off, GY + 1, sw2, pad * 0.8);
      if (m & 4) c.fillRect(off, GY + ts - pad * 0.8 - 1, sw2, pad * 0.8);
      if (m & 8) c.fillRect(1, GY + off, pad * 0.8, sw2);
      if (m & 2) c.fillRect(ts - pad * 0.8 - 1, GY + off, pad * 0.8, sw2);
    }
  }
}

// 送電線:隣接マスクに応じてケーブルの向きが変わる+鉄塔
function drawWireTile(c, ts, mask, bridge) {
  if (bridge) groundWater(c, ts); else groundGrass(c, ts, 0);
  const GY = ts;
  const m = mask === 0 ? 10 : mask;
  const cy = GY + ts * 0.5;
  c.strokeStyle = '#3b3b3b';
  c.lineWidth = Math.max(1, ts * 0.05);
  c.beginPath();
  if (m & 1) { c.moveTo(ts / 2, GY); c.lineTo(ts / 2, cy); }
  if (m & 4) { c.moveTo(ts / 2, GY + ts); c.lineTo(ts / 2, cy); }
  if (m & 8) { c.moveTo(0, cy); c.lineTo(ts / 2, cy); }
  if (m & 2) { c.moveTo(ts, cy); c.lineTo(ts / 2, cy); }
  c.stroke();
  // 鉄塔(上にはみ出して立体感を出す)
  const px = ts / 2;
  c.save();
  c.translate(px, GY + ts * 0.82);
  c.scale(1, 0.4);
  c.fillStyle = 'rgba(0,0,0,0.2)';
  c.beginPath(); c.arc(0, 0, ts * 0.18, 0, Math.PI * 2); c.fill();
  c.restore();
  c.strokeStyle = '#8a7a5a';
  c.lineWidth = Math.max(1, ts * 0.07);
  c.beginPath();
  c.moveTo(px, GY + ts * 0.82);
  c.lineTo(px, GY - ts * 0.25);
  c.moveTo(px - ts * 0.25, GY - ts * 0.1);
  c.lineTo(px + ts * 0.25, GY - ts * 0.1);
  c.stroke();
  c.fillStyle = '#ddd';
  c.fillRect(px - ts * 0.25, GY - ts * 0.14, Math.max(1, ts * 0.06), Math.max(1, ts * 0.08));
  c.fillRect(px + ts * 0.19, GY - ts * 0.14, Math.max(1, ts * 0.06), Math.max(1, ts * 0.08));
}

// 線路:隣接マスクに応じて枕木とレールの向きが変わる
function drawRailTile(c, ts, mask, bridge) {
  if (bridge) groundWater(c, ts); else groundGrass(c, ts, 0);
  const GY = ts;
  const m = mask === 0 ? 10 : mask;
  // 砂利の路盤
  const pad = ts * 0.22;
  c.fillStyle = bridge ? '#6e6257' : '#8a7f6e';
  c.fillRect(pad, GY + pad, ts - 2 * pad, ts - 2 * pad);
  if (m & 1) c.fillRect(pad, GY, ts - 2 * pad, pad + 1);
  if (m & 4) c.fillRect(pad, GY + ts - pad - 1, ts - 2 * pad, pad + 1);
  if (m & 8) c.fillRect(0, GY + pad, pad + 1, ts - 2 * pad);
  if (m & 2) c.fillRect(ts - pad - 1, GY + pad, pad + 1, ts - 2 * pad);
  const tie = Math.max(1, ts * 0.07);   // 枕木の太さ
  const railW = Math.max(1, ts * 0.06); // レールの太さ
  const r1 = ts * 0.38, r2 = ts * 0.56; // 2本のレール位置
  const horiz = m === 10 || m === 2 || m === 8;
  const vert = m === 5 || m === 1 || m === 4;
  c.fillStyle = '#5d4a36';
  if (horiz) {
    for (let x = ts * 0.06; x < ts - 2; x += ts * 0.22) {
      c.fillRect(x, GY + ts * 0.3, tie, ts * 0.4);
    }
  } else if (vert) {
    for (let y = GY + ts * 0.06; y < GY + ts - 2; y += ts * 0.22) {
      c.fillRect(ts * 0.3, y, ts * 0.4, tie);
    }
  }
  c.fillStyle = '#aeb6bd';
  if (horiz) {
    c.fillRect(0, GY + r1, ts, railW);
    c.fillRect(0, GY + r2, ts, railW);
  } else if (vert) {
    c.fillRect(r1, GY, railW, ts);
    c.fillRect(r2, GY, railW, ts);
  } else {
    // 交差・分岐は両方向のレールを描く
    if (m & 8 || m & 2) { c.fillRect(0, GY + r1, ts, railW); c.fillRect(0, GY + r2, ts, railW); }
    if (m & 1 || m & 4) { c.fillRect(r1, GY, railW, ts); c.fillRect(r2, GY, railW, ts); }
  }
}

// 未開発の区画(色付きの更地+ラベル)
function zonePlot(c, ts, fill, border, label, labelColor) {
  groundGrass(c, ts, 0);
  c.fillStyle = fill;
  c.fillRect(1, ts + 1, ts - 2, ts - 2);
  c.strokeStyle = border;
  c.lineWidth = 1;
  c.strokeRect(1.5, ts + 1.5, ts - 3, ts - 3);
  c.fillStyle = labelColor;
  c.font = 'bold ' + Math.floor(ts * 0.42) + 'px sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(label, ts / 2, ts * 1.52);
}

// 開発済み区画の地面(薄い色+細い枠)
function zoneGroundDev(c, ts, fill, border) {
  c.fillStyle = fill;
  c.fillRect(0, ts, ts, ts);
  c.strokeStyle = border;
  c.lineWidth = 1;
  c.strokeRect(0.5, ts + 0.5, ts - 1, ts - 1);
}

// マルチタイル建物のスプライト(幅size*ts × 高さ(size+1)*ts、上1タイルがはみ出し分)
// 暫定のプレースホルダー描画。本格的なグラフィックは個別関数で差し替える
function bigSpritePlaceholder(c, ts, size, label, wall, wallDark, roof) {
  const w = size * ts;
  // 地面(舗装)
  c.fillStyle = '#b0b4b8';
  c.fillRect(1, ts + 1, w - 2, size * ts - 2);
  c.strokeStyle = '#7d8186';
  c.lineWidth = 1;
  c.strokeRect(1.5, ts + 1.5, w - 3, size * ts - 3);
  // 建物本体
  const m = ts * 0.18;
  const bw = w - 2 * m;
  const baseY = ts + size * ts - m;
  const wallH = ts * 0.8;
  const wallTop = baseY - wallH;
  c.fillStyle = 'rgba(0,0,0,0.22)';
  c.fillRect(m + ts * 0.08, baseY - ts * 0.06, bw, ts * 0.12);
  c.fillStyle = wall;
  c.fillRect(m, wallTop, bw, wallH);
  c.fillStyle = wallDark;
  c.fillRect(m + bw - ts * 0.14, wallTop, ts * 0.14, wallH);
  c.fillStyle = roof;
  c.fillRect(m, wallTop - ts * 0.35, bw, ts * 0.35);
  c.fillStyle = 'rgba(255,255,255,0.2)';
  c.fillRect(m, wallTop - ts * 0.35, bw, ts * 0.09);
  c.fillStyle = '#fff';
  c.font = 'bold ' + Math.max(7, Math.floor(ts * 0.34)) + 'px sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(label, m + bw / 2, wallTop + wallH * 0.45);
}

function tileSprite(type, lvl, variant, ts) {
  const key = type + '_' + lvl + '_' + variant + '_' + ts;
  let sp = spriteCache.get(key);
  if (sp) return sp;
  if (spriteCache.size > 800) spriteCache.clear();

  const size = BIG[type] || 1;
  sp = document.createElement('canvas');
  sp.width = ts * size;
  sp.height = ts * (size + 1);
  const c = sp.getContext('2d');

  if (size > 1) {
    const styles = {
      [T.NUCLEAR]: ['原子力', '#7d858d', '#646b72', '#4a4e54'],
      [T.STADIUM]: ['スタジアム', '#c9a86a', '#ab8c52', '#8d6e63'],
      [T.SEAPORT]: ['港', '#7a93a8', '#5f7689', '#4a5d6d'],
      [T.AIRPORT]: ['空港', '#9aa5b1', '#7e8894', '#5f6873'],
    };
    const st = styles[type] || ['?', '#999', '#777', '#555'];
    bigSpritePlaceholder(c, ts, size, st[0], st[1], st[2], st[3]);
    spriteCache.set(key, sp);
    return sp;
  }

  switch (type) {
    case T.GRASS:
      groundGrass(c, ts, lvl % 2);
      break;
    case T.WATER:
      groundWater(c, ts);
      break;
    case T.TREE:
      groundGrass(c, ts, 0);
      drawTreeShape(c, ts, 1, 0, 0);
      break;
    case T.ROAD:
      drawRoadTile(c, ts, variant, lvl === 1);
      break;
    case T.WIRE:
      drawWireTile(c, ts, variant, lvl === 1);
      break;
    case T.RAIL:
      drawRailTile(c, ts, variant, lvl === 1);
      break;
    case T.FLOOD:
      // 洪水(明るい水色で land との違いを出す)
      c.fillStyle = '#5b9be0';
      c.fillRect(0, ts, ts, ts);
      c.fillStyle = 'rgba(255,255,255,0.35)';
      c.fillRect(ts * 0.1, ts * 1.3, ts * 0.35, Math.max(1, ts * 0.07));
      c.fillRect(ts * 0.5, ts * 1.65, ts * 0.35, Math.max(1, ts * 0.07));
      break;
    case T.RES: {
      if (lvl === 0) { zonePlot(c, ts, 'rgba(129,199,132,0.45)', '#2e7d32', '住', '#1b5e20'); break; }
      zoneGroundDev(c, ts, '#9ccc8f', '#2e7d32');
      if (lvl === 1) {
        drawBox(c, ts, { m: ts * 0.2, wallH: ts * 0.28, wall: '#f0e2c0', wallDark: '#d6c49e',
          roofType: 'pitched', roof: '#c4513c', roofH: ts * 0.3, door: '#7a5230' });
      } else if (lvl === 2) {
        drawBox(c, ts, { m: ts * 0.15, wallH: ts * 0.4, wall: '#efe0bd', wallDark: '#d2c096',
          roofType: 'pitched', roof: '#a8433a', roofH: ts * 0.32, door: '#6b4626',
          floors: 1, cols: 2, win: '#fff3b0' });
      } else if (lvl === 3) {
        drawBox(c, ts, { m: ts * 0.13, wallH: ts * 0.62, wall: '#e3cfa8', wallDark: '#c4af87',
          roof: '#8d6e63', floors: 3, cols: 3, win: '#fff3b0', door: '#5d4037' });
      } else {
        const b = drawBox(c, ts, { m: ts * 0.11, wallH: ts * 0.9, wall: '#dfe3e8', wallDark: '#b9bfc7',
          roof: '#7a7f87', floors: 5, cols: 3, win: '#9fc6e8', door: '#455a64' });
        c.fillStyle = '#99a1ab'; // 屋上の貯水タンク
        c.fillRect(b.m + b.w * 0.6, b.wallTop - ts * 0.42, b.w * 0.22, ts * 0.16);
      }
      break;
    }
    case T.COM: {
      if (lvl === 0) { zonePlot(c, ts, 'rgba(100,181,246,0.45)', '#1565c0', '商', '#0d47a1'); break; }
      zoneGroundDev(c, ts, '#9fc3e0', '#1565c0');
      if (lvl === 1) {
        const b = drawBox(c, ts, { m: ts * 0.18, wallH: ts * 0.32, wall: '#f5f5f5', wallDark: '#d9d9d9',
          roof: '#90a4ae', door: '#546e7a' });
        // 店先の縞模様のひさし
        const ah = ts * 0.12;
        for (let k = 0; k < 4; k++) {
          c.fillStyle = k % 2 ? '#fff' : '#ef6c00';
          c.fillRect(b.m + (b.w * k) / 4, b.wallTop + ts * 0.02, b.w / 4, ah);
        }
      } else if (lvl === 2) {
        const b = drawBox(c, ts, { m: ts * 0.15, wallH: ts * 0.5, wall: '#dde7ee', wallDark: '#bccad4',
          roof: '#607d8b', floors: 2, cols: 2, win: '#fffde7', door: '#37474f' });
        c.fillStyle = '#e2554d'; // 看板
        c.fillRect(b.m, b.wallTop + ts * 0.02, b.w, ts * 0.1);
      } else if (lvl === 3) {
        drawBox(c, ts, { m: ts * 0.13, wallH: ts * 0.72, wall: '#7fb3d9', wallDark: '#5d8fb5',
          roof: '#455a64', floors: 4, cols: 3, win: '#d9ecf7' });
      } else {
        const b = drawBox(c, ts, { m: ts * 0.11, wallH: ts * 0.94, wall: '#5f87b8', wallDark: '#476a94',
          roof: '#37474f', floors: 6, cols: 3, win: '#cfe6f7' });
        // 屋上アンテナ
        c.strokeStyle = '#cfd8dc';
        c.lineWidth = Math.max(1, ts * 0.05);
        c.beginPath();
        c.moveTo(b.m + b.w / 2, b.wallTop - ts * 0.28);
        c.lineTo(b.m + b.w / 2, b.wallTop - ts * 0.55);
        c.stroke();
        c.fillStyle = '#ff5252';
        c.beginPath();
        c.arc(b.m + b.w / 2, b.wallTop - ts * 0.55, Math.max(1, ts * 0.05), 0, Math.PI * 2);
        c.fill();
      }
      break;
    }
    case T.IND: {
      if (lvl === 0) { zonePlot(c, ts, 'rgba(255,213,79,0.5)', '#ef6c00', '工', '#bf5e00'); break; }
      zoneGroundDev(c, ts, '#d9c98e', '#ef6c00');
      const wallH = ts * (0.26 + lvl * 0.09);
      const b = drawBox(c, ts, { m: ts * 0.13, wallH, wall: '#b9b3a6', wallDark: '#9b9588',
        roof: '#857f70', floors: 1, cols: 3, win: '#cfd8dc', door: '#5f5950' });
      if (lvl >= 2) drawChimney(c, b.m + b.w * 0.15, b.wallTop - ts * 0.2, Math.max(2, ts * 0.12), ts * 0.3);
      if (lvl >= 3) drawChimney(c, b.m + b.w * 0.55, b.wallTop - ts * 0.2, Math.max(2, ts * 0.12), ts * 0.38);
      if (lvl >= 4) {
        c.fillStyle = '#7d8a8f'; // 貯蔵タンク
        c.beginPath();
        c.arc(b.m + b.w * 0.85, b.wallTop + wallH * 0.4, ts * 0.12, 0, Math.PI * 2);
        c.fill();
      }
      break;
    }
    case T.POWER: {
      groundGrass(c, ts, 0);
      c.fillStyle = '#b0b4b8';
      c.fillRect(1, ts + 1, ts - 2, ts - 2);
      const b = drawBox(c, ts, { m: ts * 0.12, wallH: ts * 0.55, wall: '#6b7077', wallDark: '#565b61',
        roof: '#4a4e54' });
      drawChimney(c, b.m + b.w * 0.12, b.wallTop - ts * 0.22, Math.max(2, ts * 0.14), ts * 0.42);
      drawChimney(c, b.m + b.w * 0.6, b.wallTop - ts * 0.22, Math.max(2, ts * 0.14), ts * 0.34);
      boltShape(c, b.m + b.w / 2, b.wallTop + ts * 0.28, ts * 0.4, '#ffd835');
      break;
    }
    case T.POLICE: {
      groundGrass(c, ts, 0);
      const b = drawBox(c, ts, { m: ts * 0.14, wallH: ts * 0.46, wall: '#eef2f5', wallDark: '#cfd6db',
        roof: '#3f6fb5', door: '#37474f' });
      c.fillStyle = '#2a5fa8';
      c.fillRect(b.m, b.wallTop + ts * 0.02, b.w, ts * 0.2);
      c.fillStyle = '#fff';
      c.font = 'bold ' + Math.max(6, Math.floor(ts * 0.18)) + 'px sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('警察', b.m + b.w / 2, b.wallTop + ts * 0.12);
      break;
    }
    case T.FIRE_ST: {
      groundGrass(c, ts, 0);
      const b = drawBox(c, ts, { m: ts * 0.14, wallH: ts * 0.46, wall: '#f7efe9', wallDark: '#dcd2ca',
        roof: '#c43c3c', door: '#8d3b32' });
      c.fillStyle = '#c43c3c';
      c.fillRect(b.m, b.wallTop + ts * 0.02, b.w, ts * 0.2);
      c.fillStyle = '#fff';
      c.font = 'bold ' + Math.max(6, Math.floor(ts * 0.18)) + 'px sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('消防', b.m + b.w / 2, b.wallTop + ts * 0.12);
      break;
    }
    case T.PARK: {
      c.fillStyle = '#8fd06a';
      c.fillRect(0, ts, ts, ts);
      c.fillStyle = '#d9c79b'; // 小道
      c.fillRect(ts * 0.42, ts, ts * 0.16, ts);
      drawTreeShape(c, ts, 0.7, -ts * 0.22, -ts * 0.05);
      const fl = ['#f06292', '#fff176', '#ef5350'];
      const fd = Math.max(1, ts * 0.08);
      for (let k = 0; k < 3; k++) {
        c.fillStyle = fl[k];
        c.fillRect(ts * (0.65 + 0.09 * k), ts * (1.55 + 0.1 * (k % 2)), fd, fd);
      }
      break;
    }
    case T.RUBBLE: {
      c.fillStyle = '#8d7a6a';
      c.fillRect(0, ts, ts, ts);
      c.fillStyle = '#6b5a4d';
      c.fillRect(ts * 0.15, ts * 1.25, ts * 0.25, ts * 0.2);
      c.fillRect(ts * 0.55, ts * 1.5, ts * 0.28, ts * 0.22);
      c.fillStyle = '#a39281';
      c.fillRect(ts * 0.4, ts * 1.6, ts * 0.18, ts * 0.14);
      c.strokeStyle = '#574a3f';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(ts * 0.2, ts * 1.7);
      c.lineTo(ts * 0.45, ts * 1.45);
      c.stroke();
      break;
    }
    case T.FIRE: {
      c.fillStyle = '#4e342e';
      c.fillRect(0, ts, ts, ts);
      // 炎(外側→内側)
      c.fillStyle = '#e64a19';
      c.beginPath();
      c.moveTo(ts * 0.2, ts * 1.85);
      c.quadraticCurveTo(ts * 0.05, ts * 1.3, ts * 0.35, ts * 0.95);
      c.quadraticCurveTo(ts * 0.42, ts * 1.25, ts * 0.5, ts * 0.8);
      c.quadraticCurveTo(ts * 0.62, ts * 1.2, ts * 0.75, ts * 1.0);
      c.quadraticCurveTo(ts * 0.95, ts * 1.45, ts * 0.8, ts * 1.85);
      c.closePath();
      c.fill();
      c.fillStyle = '#ffb300';
      c.beginPath();
      c.moveTo(ts * 0.35, ts * 1.82);
      c.quadraticCurveTo(ts * 0.3, ts * 1.4, ts * 0.5, ts * 1.15);
      c.quadraticCurveTo(ts * 0.7, ts * 1.4, ts * 0.65, ts * 1.82);
      c.closePath();
      c.fill();
      c.fillStyle = '#fff59d';
      c.beginPath();
      c.arc(ts * 0.5, ts * 1.7, ts * 0.12, 0, Math.PI * 2);
      c.fill();
      break;
    }
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

// 隣接タイルとの接続マスク(北=1, 東=2, 南=4, 西=8)
function connMask(x, y, type) {
  const match = (nx, ny) => {
    if (!inB(nx, ny)) return false;
    const t = g.t[idx(nx, ny)];
    if (type === T.ROAD) return t === T.ROAD;
    if (type === T.RAIL) return t === T.RAIL;
    return t === T.WIRE || t === T.POWER || t === T.NUCLEAR;
  };
  return (match(x, y - 1) ? 1 : 0) | (match(x + 1, y) ? 2 : 0) |
         (match(x, y + 1) ? 4 : 0) | (match(x - 1, y) ? 8 : 0);
}

/* --- 描画拡張フック(各システムの実装側で上書きする) --- */
// 交通量の多い道路に車を描く
let renderCars = function (ts, x0, y0, x1, y1) {};
// 移動型の災害(竜巻・怪獣)を描く
let renderActors = function (ts) {};
// データマップのオーバーレイを描く
let renderOverlay = function (ts, x0, y0, x1, y1) {};

function draw() {
  const ts = Math.max(4, Math.round(BASE_TILE * cam.zoom));
  const vw = cv.clientWidth, vh = cv.clientHeight;
  cx.fillStyle = '#142014';
  cx.fillRect(0, 0, vw, vh);

  // マルチタイル建物のアンカーが画面外でも足元が見えるよう、左・上に1タイル余分に走査
  const x0 = Math.max(0, Math.floor(cam.x / ts) - 1);
  const y0 = Math.max(0, Math.floor(cam.y / ts) - 1);
  const x1 = Math.min(W - 1, Math.ceil((cam.x + vw) / ts));
  // 建物が上にはみ出して見えるよう、下端の1行先まで描く
  const y1 = Math.min(H - 1, Math.ceil((cam.y + vh) / ts) + 1);
  const blink = ((Date.now() / 450) | 0) % 2 === 0;
  const bolts = [];

  // 奥(上)から手前(下)へ描くと、はみ出した建物が正しく重なる
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = idx(x, y);
      const t = g.t[i];
      let lvl = g.lvl[i];
      let variant = 0;
      // マルチタイル建物はアンカー(左上)だけが足元全体のスプライトを描く
      if (isBig(t) && lvl !== 0) continue;
      if (t === T.GRASS) lvl = (x * 7 + y * 13) % 2;
      else if (t === T.ROAD || t === T.WIRE || t === T.RAIL) variant = connMask(x, y, t);
      const px = Math.round(x * ts - cam.x);
      const py = Math.round(y * ts - cam.y);
      cx.drawImage(tileSprite(t, lvl, variant, ts), px, py - ts);

      if (blink && !g.powered[i] &&
          (isZone(t) || t === T.POLICE || t === T.FIRE_ST || isBig(t))) {
        bolts.push([px, py]);
      }
    }
  }

  renderCars(ts, x0, y0, x1, y1);
  renderActors(ts);

  // 電気が来ていないマーク(建物に隠れないよう最後に描く)
  for (const [px, py] of bolts) {
    cx.fillStyle = 'rgba(0,0,0,0.45)';
    cx.beginPath();
    cx.arc(px + ts * 0.3, py + ts * 0.3, ts * 0.26, 0, Math.PI * 2);
    cx.fill();
    boltShape(cx, px + ts * 0.3, py + ts * 0.3, ts * 0.42, '#ffeb3b');
  }

  renderOverlay(ts, x0, y0, x1, y1);
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
  // 支持率をHUDに表示
  $('hud-approval').textContent = '😊' + g.eval.approval + '%';
  // オーバーレイバッジ
  const badge = $('hud-overlay-badge');
  if (g.overlayMode && g.overlayMode !== 'none') {
    const modeLabels = {
      power: '⚡電力', pollution: '🏭公害', crime: '🚔犯罪',
      landvalue: '🏠地価', traffic: '🚗交通', police: '🚓警察', fire: '🚒消防',
    };
    badge.textContent = modeLabels[g.overlayMode] || g.overlayMode;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
  // pendingBudget 消費: 1月に自動で予算ウィンドウを開く
  if (g.pendingBudget) {
    g.pendingBudget = false;
    if (g.budget.autoShow && g.running) {
      openBudgetPanel();
    }
  }
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
                 '工業地', '発電所', '警察署', '消防署', '公園', 'がれき', '火災',
                 '線路', '洪水', '原子力発電所', 'スタジアム', '港', '空港'];
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
    } else if (!isBig(TOOL_TILE[currentTool])) {
      // マルチタイル建物はドラッグ連続建設の対象外
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
 * パネル開閉ヘルパー
 * ========================================================= */

// パネルを開いている間のゲーム速度退避(予算ウィンドウ用)
let _budgetPrevSpeed = 1;

function openBudgetPanel() {
  // ゲームを一時停止(現在の速度を覚えて speed=0 にする)
  _budgetPrevSpeed = g.speed;
  if (g.running && g.speed > 0) setSpeed(0);

  // 前年度収支を反映
  $('fin-tax').textContent    = Math.round(g.lastFin.tax).toLocaleString();
  $('fin-road').textContent   = Math.round(g.lastFin.road).toLocaleString();
  $('fin-police').textContent = Math.round(g.lastFin.police).toLocaleString();
  $('fin-fire').textContent   = Math.round(g.lastFin.fire).toLocaleString();
  $('fin-other').textContent  = Math.round(g.lastFin.other).toLocaleString();
  $('budget-funds').textContent = g.funds.toLocaleString();

  // 予算%スライダーを反映
  $('budget-road-val').textContent   = g.budget.road   + '%';
  $('budget-police-val').textContent = g.budget.police + '%';
  $('budget-fire-val').textContent   = g.budget.fire   + '%';

  // チェックボックスを反映
  $('budget-autoshow').checked = g.budget.autoShow;

  $('budget-panel').classList.remove('hidden');
}

function closeBudgetPanel() {
  $('budget-panel').classList.add('hidden');
  // ゲームを開く前の速度に復元
  if (g.running) setSpeed(_budgetPrevSpeed);
}

function openDisasterPanel() {
  // 自動災害チェックボックスを反映
  $('auto-disaster').checked = g.autoDisaster;
  $('disaster-panel').classList.remove('hidden');
}

function closeDisasterPanel() {
  $('disaster-panel').classList.add('hidden');
}

function openEvalPanel() {
  // 最新の評価を反映
  $('eval-approval').textContent = g.eval.approval + '%';
  $('eval-score').textContent    = g.eval.score.toLocaleString();
  $('eval-pop').textContent      = g.pop.toLocaleString();

  const ul = $('eval-problems');
  ul.innerHTML = '';
  if (g.eval.problems.length === 0) {
    const li = document.createElement('li');
    li.className = 'no-problems';
    li.textContent = '特になし';
    ul.appendChild(li);
  } else {
    for (const prob of g.eval.problems) {
      const li = document.createElement('li');
      li.textContent = prob;
      ul.appendChild(li);
    }
  }

  $('eval-panel').classList.remove('hidden');
}

function closeEvalPanel() {
  $('eval-panel').classList.add('hidden');
}

function openMapPanel() {
  // 現在のオーバーレイモードに合わせてボタンのアクティブ状態を更新
  document.querySelectorAll('.map-opt-btn').forEach((btn) => {
    btn.classList.toggle('active-map', btn.dataset.mode === g.overlayMode);
  });
  $('map-panel').classList.remove('hidden');
}

function closeMapPanel() {
  $('map-panel').classList.add('hidden');
}

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
  setSpeed((g.speed + 1) % SPEED_INTERVALS.length);
  const names = ['停止', 'ゆっくり', 'ふつう', 'はやい'];
  toast('⏱ 時間の速さ: ' + names[g.speed]);
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

// ===== 予算ウィンドウ =====
$('btn-open-budget').addEventListener('click', () => {
  $('menu-panel').classList.add('hidden');
  openBudgetPanel();
});

$('btn-close-budget').addEventListener('click', closeBudgetPanel);

// 予算% ステッパー(−/+)
document.querySelectorAll('.budget-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.target; // 'road' | 'police' | 'fire'
    const dir    = parseInt(btn.dataset.dir, 10); // -1 | +1
    g.budget[target] = clamp(g.budget[target] + dir * 10, 0, 100);
    $('budget-' + target + '-val').textContent = g.budget[target] + '%';
  });
});

// autoShow チェックボックス
$('budget-autoshow').addEventListener('change', (e) => {
  g.budget.autoShow = e.target.checked;
});

// HUDの支持率タップで評価パネルを開く
$('hud-approval').addEventListener('click', () => {
  if (g.running) openEvalPanel();
});

// ===== 災害メニュー =====
$('btn-open-disaster').addEventListener('click', () => {
  $('menu-panel').classList.add('hidden');
  openDisasterPanel();
});

$('btn-close-disaster').addEventListener('click', closeDisasterPanel);

document.querySelectorAll('.disaster-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    triggerDisaster(btn.dataset.kind);
    closeDisasterPanel();
  });
});

$('auto-disaster').addEventListener('change', (e) => {
  g.autoDisaster = e.target.checked;
});

// ===== 市民評価パネル =====
$('btn-open-eval').addEventListener('click', () => {
  $('menu-panel').classList.add('hidden');
  openEvalPanel();
});

$('btn-close-eval').addEventListener('click', closeEvalPanel);

// ===== データマップ選択 =====
$('btn-open-map').addEventListener('click', () => {
  $('menu-panel').classList.add('hidden');
  openMapPanel();
});

$('btn-close-map').addEventListener('click', closeMapPanel);

document.querySelectorAll('.map-opt-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    g.overlayMode = btn.dataset.mode;
    // アクティブ表示を切り替え
    document.querySelectorAll('.map-opt-btn').forEach((b) =>
      b.classList.toggle('active-map', b.dataset.mode === g.overlayMode));
    updateHUD();
    closeMapPanel();
  });
});

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
  g.budget = { road: 100, police: 100, fire: 100, autoShow: true };
  g.finYear = { tax: 0, road: 0, police: 0, fire: 0, other: 0 };
  g.lastFin = { tax: 0, road: 0, police: 0, fire: 0, other: 0 };
  g.pendingBudget = false;
  g.autoDisaster = true;
  g.actors = [];
  g.eval = { score: 0, approval: 50, problems: [] };
  g.shakeT = 0;
  g.overlayMode = 'none';
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
