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
// 難易度ごとの初期資金・自動災害発生確率
const DIFFICULTY_FUNDS = { easy: 30000, normal: 20000, hard: 10000 };
const DIFFICULTY_DISASTER_RATE = { easy: 0.002, normal: 0.004, hard: 0.008 };
const HISTORY_MAX = 240; // 統計グラフ用履歴の最大件数(20年分)
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
  CROSSING: 20, // 道路×線路の踏切
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
  wireOver: new Uint8Array(W * H), // v3: 送電線オーバーレイ(道路・線路・踏切の上を電線が横切る)
  funds: START_FUNDS,
  month: 0,                       // 開始からの経過月数
  taxRate: 7,
  // v4: 都市名・難易度
  name: 'わたしのまち',
  difficulty: 'normal',           // 'easy' | 'normal' | 'hard'
  // v4: 統計グラフ用履歴(毎月記録、最大HISTORY_MAX件)
  history: { pop: [], funds: [], approval: [] },
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
function isRoadLike(t) { return t === T.ROAD || t === T.CROSSING; }
function isRailLike(t) { return t === T.RAIL || t === T.CROSSING; }
function conducts(t) {
  return t === T.WIRE || t === T.POWER || t === T.POLICE ||
         t === T.FIRE_ST || isZone(t) || isBig(t);
}
// タイル単位の導電判定(送電線オーバーレイも電気を通す)
// オーバーレイは道路・線路・踏切の上にある場合のみ有効(下が壊れたら電線も失われる)
function wireOverAt(i) {
  return g.wireOver[i] === 1 && (isRoadLike(g.t[i]) || g.t[i] === T.RAIL);
}
function conductsAt(i) {
  return conducts(g.t[i]) || wireOverAt(i);
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
  g.wireOver.fill(0);

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

  // 湖:2〜4個のランダムな楕円形の湖(川と重なってもよい)
  const lakeCount = 2 + Math.floor(rnd() * 3); // 2〜4個
  for (let l = 0; l < lakeCount; l++) {
    const lcx = Math.floor(rnd() * W), lcy = Math.floor(rnd() * H);
    const rx = 2 + Math.floor(rnd() * 3); // 2〜4
    const ry = 2 + Math.floor(rnd() * 3); // 2〜4
    for (let dy = -ry; dy <= ry; dy++) {
      for (let dx = -rx; dx <= rx; dx++) {
        const x2 = lcx + dx, y2 = lcy + dy;
        if (!inB(x2, y2)) continue;
        if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1) {
          g.t[idx(x2, y2)] = T.WATER;
        }
      }
    }
  }

  // 森:ランダムウォークで木の群生をつくる
  for (let c = 0; c < 18; c++) {
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
      if (!g.powered[ni] && conductsAt(ni)) {
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
      if (t === T.ROAD || t === T.RAIL || t === T.CROSSING) {
        // 道路・線路・踏切から2タイル以内が「道路近接」(RAILも輸送アクセスに含める)
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
          if (inB(x + dx, y + dy) && isRailLike(g.t[idx(x + dx, y + dy)])) nearRail = true;
        }
      }
      if (nearRail) continue;
      const add = g.lvl[i] * 3;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx, ny = y + dy;
          if (!inB(nx, ny)) continue;
          const ni = idx(nx, ny);
          if (isRoadLike(g.t[ni])) {
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
          if (isRoadLike(g.t[ni])) {
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
    if (wireOverAt(i)) wires++;
    switch (g.t[i]) {
      case T.ROAD:    roads++; break;
      case T.RAIL:    rails++; break;
      case T.CROSSING: roads++; rails++; break;
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
  // 自動災害(難易度で発生確率が変わる)
  const disasterRate = DIFFICULTY_DISASTER_RATE[g.difficulty] !== undefined
    ? DIFFICULTY_DISASTER_RATE[g.difficulty] : DIFFICULTY_DISASTER_RATE.normal;
  if (g.month > 24 && g.autoDisaster && rnd() < disasterRate) {
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
  // v4: 統計グラフ用履歴を毎月記録(最大HISTORY_MAX件、超えたら古い方から破棄)
  g.history.pop.push(g.pop);
  g.history.funds.push(g.funds);
  g.history.approval.push(g.eval.approval);
  if (g.history.pop.length > HISTORY_MAX) g.history.pop.shift();
  if (g.history.funds.length > HISTORY_MAX) g.history.funds.shift();
  if (g.history.approval.length > HISTORY_MAX) g.history.approval.shift();
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
 * セーブ・ロード(4スロット対応)
 * ========================================================= */
let currentSlot = 1; // 選択中のセーブスロット(1〜4)

// スロット番号からlocalStorageキーを求める
function slotKey(n) {
  return SAVE_KEY + '_slot' + n;
}

// 使用するスロットを切り替える
function setSlot(n) {
  currentSlot = clamp(Math.round(n), 1, 4);
}

// セーブデータ(t/lvl配列)から人口を概算する(ロードせずに概要を出すため)
function popFromData(data) {
  let pop = 0;
  if (Array.isArray(data.t) && Array.isArray(data.lvl)) {
    for (let i = 0; i < data.t.length; i++) {
      if (data.t[i] === T.RES) pop += (data.lvl[i] || 0) * 16;
    }
  }
  return pop;
}

// 指定スロットのセーブ概要を、ロードせずに返す
function getSlotInfo(n) {
  try {
    const raw = localStorage.getItem(slotKey(n));
    if (raw === null) return { exists: false };
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.t) || data.t.length !== W * H) return { exists: false };
    return {
      exists: true,
      name: data.name || 'わたしのまち',
      pop: popFromData(data),
      year: START_YEAR + Math.floor((data.month || 0) / 12),
      month: ((data.month || 0) % 12) + 1,
      savedAt: data.savedAt || 0,
    };
  } catch (e) {
    return { exists: false };
  }
}

// 指定スロットのセーブデータを削除する
function deleteSlot(n) {
  try {
    localStorage.removeItem(slotKey(n));
  } catch (e) {
    // 何もしない
  }
}

// 旧バージョン(スロット制導入前)のセーブを slot1 へ移行する。起動時に一度呼ぶ。
function migrateLegacySave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw === null) return;
    if (localStorage.getItem(slotKey(1)) === null) {
      localStorage.setItem(slotKey(1), raw);
    }
    localStorage.removeItem(SAVE_KEY);
  } catch (e) {
    // 移行に失敗しても起動は継続する
  }
}

function saveGame(auto) {
  if (!g.running) return;
  try {
    const data = {
      v: 4,
      name: g.name,
      difficulty: g.difficulty,
      savedAt: Date.now(),
      funds: g.funds,
      month: g.month,
      taxRate: g.taxRate,
      milestone: g.milestone,
      t: Array.from(g.t),
      lvl: Array.from(g.lvl),
      fireT: Array.from(g.fireT),
      wireOver: Array.from(g.wireOver),
      budget: Object.assign({}, g.budget),
      autoDisaster: g.autoDisaster,
      finYear: Object.assign({}, g.finYear),
      lastFin: Object.assign({}, g.lastFin),
      history: {
        pop: g.history.pop.slice(),
        funds: g.history.funds.slice(),
        approval: g.history.approval.slice(),
      },
    };
    localStorage.setItem(slotKey(currentSlot), JSON.stringify(data));
    if (!auto) toast('💾 セーブしました');
  } catch (e) {
    toast('セーブに失敗しました');
  }
}

function hasSave() {
  return localStorage.getItem(slotKey(currentSlot)) !== null;
}

function loadGame() {
  try {
    const data = JSON.parse(localStorage.getItem(slotKey(currentSlot)));
    if (!data || !Array.isArray(data.t) || data.t.length !== W * H) return false;
    if (data.v !== 1 && data.v !== 2 && data.v !== 3 && data.v !== 4) return false;
    g.t.set(data.t);
    g.lvl.set(data.lvl);
    g.fireT.set(data.fireT);
    if (Array.isArray(data.wireOver) && data.wireOver.length === W * H) {
      g.wireOver.set(data.wireOver);
    } else {
      g.wireOver.fill(0);
    }
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
    // v4フィールド(v3以前の場合はデフォルト値を補う)
    g.name = data.name || 'わたしのまち';
    g.difficulty = data.difficulty || 'normal';
    g.history = (data.history && Array.isArray(data.history.pop))
      ? {
          pop: data.history.pop.slice(),
          funds: Array.isArray(data.history.funds) ? data.history.funds.slice() : [],
          approval: Array.isArray(data.history.approval) ? data.history.approval.slice() : [],
        }
      : { pop: [], funds: [], approval: [] };
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
    // 電線オーバーレイがあるタイルは、まず電線だけを撤去する
    if (wireOverAt(i)) {
      if (!spend(1)) return;
      g.wireOver[i] = 0;
      toast('🗼 電線を撤去しました');
      computePower();
      updateHUD();
      return;
    }
    g.wireOver[i] = 0; // 残留フラグの掃除
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

  // --- 立体交差の変換ルール ---
  // 送電線を道路・線路・踏切の上に引く → 電線オーバーレイ(費用2倍)
  if (tileType === T.WIRE && (isRoadLike(cur) || cur === T.RAIL) && g.lvl[i] === 0) {
    if (g.wireOver[i]) return;
    if (!spend(toolCost(currentTool) * 2)) return;
    g.wireOver[i] = 1;
    computePower();
    updateHUD();
    return;
  }
  // 道路・線路を送電線の上に通す → タイルを道路/線路化して電線オーバーレイ化(費用2倍)
  if ((tileType === T.ROAD || tileType === T.RAIL) && cur === T.WIRE && g.lvl[i] === 0) {
    if (!spend(toolCost(currentTool) * 2)) return;
    g.t[i] = tileType;
    g.lvl[i] = 0;
    g.wireOver[i] = 1;
    computePower();
    updateHUD();
    return;
  }
  // 道路×線路 → 踏切(費用2倍)
  if ((tileType === T.ROAD && cur === T.RAIL || tileType === T.RAIL && cur === T.ROAD) &&
      g.lvl[i] === 0) {
    if (!spend(toolCost(currentTool) * 2)) return;
    g.t[i] = T.CROSSING;
    g.lvl[i] = 0;
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
  g.wireOver[i] = 0; // 残留フラグの掃除
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

// 踏切:道路の上を線路が横切る(roadMask/railMaskで両方の向きを表現)
function drawCrossingTile(c, ts, roadMask, railMask) {
  const GY = ts;
  const rm = roadMask === 0 ? 10 : roadMask;
  // まず道路を描く
  drawRoadTile(c, ts, rm, false);
  // 線路の向き(道路と直交をデフォルトに)
  let km = railMask;
  if (km === 0) km = (rm === 10 || rm === 2 || rm === 8) ? 5 : 10;
  const railW = Math.max(1, ts * 0.06);
  const r1 = ts * 0.38, r2 = ts * 0.56;
  const railHoriz = km === 10 || km === 2 || km === 8;
  // レール(道路を貫通)
  c.fillStyle = '#aeb6bd';
  if (railHoriz) {
    c.fillRect(0, GY + r1, ts, railW);
    c.fillRect(0, GY + r2, ts, railW);
  } else {
    c.fillRect(r1, GY, railW, ts);
    c.fillRect(r2, GY, railW, ts);
  }
  // 踏切の警告ゼブラ(レールの両側に黄と黒の縞)
  const zw = Math.max(1, ts * 0.08);
  for (let k = 0; k < 3; k++) {
    c.fillStyle = k % 2 ? '#2b2b2b' : '#ffd835';
    if (railHoriz) {
      c.fillRect(ts * (0.15 + 0.25 * k), GY + r1 - zw - 1, ts * 0.14, zw);
      c.fillRect(ts * (0.15 + 0.25 * k), GY + r2 + railW + 1, ts * 0.14, zw);
    } else {
      c.fillRect(r1 - zw - 1, GY + ts * (0.15 + 0.25 * k), zw, ts * 0.14);
      c.fillRect(r2 + railW + 1, GY + ts * (0.15 + 0.25 * k), zw, ts * 0.14);
    }
  }
}

/* --- 電線オーバーレイ(道路・線路を横切る送電線)--- */
const wireOverCache = new Map();
function wireOverSprite(mask, ts) {
  const key = mask + '_' + ts;
  let sp = wireOverCache.get(key);
  if (sp) return sp;
  if (wireOverCache.size > 100) wireOverCache.clear();
  sp = document.createElement('canvas');
  sp.width = ts;
  sp.height = ts * 2;
  const c = sp.getContext('2d');
  const GY = ts;
  const m = mask === 0 ? 5 : mask; // 孤立時は南北の電線として描く
  const vert = (m & 5) !== 0 && (m & 10) === 0 ? true
             : (m & 10) !== 0 && (m & 5) === 0 ? false
             : (m & 5) !== 0; // 両方向あるときは縦を優先
  const lw = Math.max(1, ts * 0.05);
  // 電線の影(路面に落ちる)
  c.strokeStyle = 'rgba(0,0,0,0.2)';
  c.lineWidth = lw;
  c.beginPath();
  if (vert) { c.moveTo(ts * 0.54, GY); c.lineTo(ts * 0.54, GY + ts); }
  else { c.moveTo(0, GY + ts * 0.54); c.lineTo(ts, GY + ts * 0.54); }
  c.stroke();
  // 電線本体(少し高い位置=影とずらして架線感を出す)
  c.strokeStyle = '#2f2f2f';
  c.beginPath();
  if (vert) { c.moveTo(ts * 0.5, GY - ts * 0.06); c.lineTo(ts * 0.5, GY + ts); }
  else { c.moveTo(0, GY + ts * 0.42); c.lineTo(ts, GY + ts * 0.42); }
  c.stroke();
  // 両端の電柱(道路の路肩に立つ)
  const poleW = Math.max(1.5, ts * 0.08);
  const drawPole = (px, py) => {
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.fillRect(px - poleW * 0.5 + 1, py + 1, poleW, poleW);
    c.strokeStyle = '#7a5c3a';
    c.lineWidth = poleW;
    c.beginPath();
    c.moveTo(px, py);
    c.lineTo(px, py - ts * 0.45);
    c.stroke();
    c.strokeStyle = '#5d4a36';
    c.lineWidth = Math.max(1, poleW * 0.6);
    c.beginPath();
    c.moveTo(px - ts * 0.12, py - ts * 0.38);
    c.lineTo(px + ts * 0.12, py - ts * 0.38);
    c.stroke();
  };
  if (vert) {
    drawPole(ts * 0.5, GY + ts * 0.1);
    drawPole(ts * 0.5, GY + ts * 0.96);
  } else {
    drawPole(ts * 0.08, GY + ts * 0.5);
    drawPole(ts * 0.92, GY + ts * 0.5);
  }
  wireOverCache.set(key, sp);
  return sp;
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

// ===== 2×2 マルチタイル建物スプライト =====
// スプライト: 幅 size*ts × 高さ (size+1)*ts。
// 下 size*ts が地面、上 1ts 分が建物のはみ出し部分。
// 「落ち影+壁+右側面の陰+屋根」で立体感を演出。

// 原子力発電所スプライト
// 白いドーム+冷却塔(台形)+湯気+雷マーク+舗装地面
function drawNuclearSprite(c, ts) {
  const w = 2 * ts;
  const gY = ts; // 地面の上端 y 座標

  // 舗装地面(コンクリート)
  c.fillStyle = '#9aa0a6';
  c.fillRect(0, gY, w, 2 * ts);
  c.fillStyle = '#7d8389';
  c.strokeStyle = '#6a7076';
  c.lineWidth = Math.max(1, ts * 0.04);
  // 舗装タイル目地
  c.strokeRect(Math.max(1, ts * 0.06), gY + ts * 0.06, w - Math.max(2, ts * 0.12), 2 * ts - Math.max(2, ts * 0.12));

  // 落ち影
  c.fillStyle = 'rgba(0,0,0,0.28)';
  c.fillRect(ts * 0.35, gY + ts * 1.7, ts * 1.3, ts * 0.2);

  // 冷却塔1 (左・大): 台形+湯気
  const t1x = ts * 0.18;
  const t1bot = gY + ts * 1.75;
  const t1top = gY + ts * 0.35;
  const t1w = ts * 0.55;
  const t1tw = ts * 0.3;
  c.fillStyle = '#c8cdd2';
  c.beginPath();
  c.moveTo(t1x, t1bot);
  c.lineTo(t1x + t1w, t1bot);
  c.lineTo(t1x + (t1w + t1tw) / 2, t1top);
  c.lineTo(t1x + (t1w - t1tw) / 2, t1top);
  c.closePath();
  c.fill();
  // 右側面の陰
  c.fillStyle = 'rgba(0,0,0,0.2)';
  c.beginPath();
  c.moveTo(t1x + t1w * 0.7, t1bot);
  c.lineTo(t1x + t1w, t1bot);
  c.lineTo(t1x + (t1w + t1tw) / 2, t1top);
  c.lineTo(t1x + (t1w * 0.7 + t1tw) / 2, t1top);
  c.closePath();
  c.fill();
  // 湯気(半透明の円)
  c.fillStyle = 'rgba(230,230,230,0.55)';
  c.beginPath();
  c.arc(t1x + t1w * 0.4, t1top - ts * 0.12, ts * 0.1, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.arc(t1x + t1w * 0.55, t1top - ts * 0.22, ts * 0.14, 0, Math.PI * 2);
  c.fill();

  // 冷却塔2 (右・小): 台形+湯気
  const t2x = ts * 0.85;
  const t2bot = gY + ts * 1.65;
  const t2top = gY + ts * 0.55;
  const t2w = ts * 0.44;
  const t2tw = ts * 0.24;
  c.fillStyle = '#bdc3c8';
  c.beginPath();
  c.moveTo(t2x, t2bot);
  c.lineTo(t2x + t2w, t2bot);
  c.lineTo(t2x + (t2w + t2tw) / 2, t2top);
  c.lineTo(t2x + (t2w - t2tw) / 2, t2top);
  c.closePath();
  c.fill();
  c.fillStyle = 'rgba(0,0,0,0.18)';
  c.beginPath();
  c.moveTo(t2x + t2w * 0.7, t2bot);
  c.lineTo(t2x + t2w, t2bot);
  c.lineTo(t2x + (t2w + t2tw) / 2, t2top);
  c.lineTo(t2x + (t2w * 0.7 + t2tw) / 2, t2top);
  c.closePath();
  c.fill();
  c.fillStyle = 'rgba(230,230,230,0.5)';
  c.beginPath();
  c.arc(t2x + t2w * 0.4, t2top - ts * 0.1, ts * 0.09, 0, Math.PI * 2);
  c.fill();

  // 原子炉ドーム(白い半円+側面の陰)
  const dCx = ts * 1.44;
  const dCy = gY + ts * 1.42;
  const dR  = ts * 0.5;
  // 落ち影
  c.fillStyle = 'rgba(0,0,0,0.25)';
  c.save();
  c.translate(dCx, dCy + dR * 0.18);
  c.scale(1, 0.35);
  c.beginPath();
  c.arc(0, 0, dR, 0, Math.PI * 2);
  c.fill();
  c.restore();
  // ドーム本体(半円)
  c.fillStyle = '#eaecee';
  c.beginPath();
  c.arc(dCx, dCy, dR, Math.PI, 0, false);
  c.closePath();
  c.fill();
  // ドーム右側の陰
  c.fillStyle = 'rgba(0,0,0,0.18)';
  c.beginPath();
  c.arc(dCx, dCy, dR, Math.PI * 0.35, 0, false);
  c.closePath();
  c.fill();
  // ドームの光沢ハイライト
  c.fillStyle = 'rgba(255,255,255,0.25)';
  c.beginPath();
  c.arc(dCx - dR * 0.2, dCy - dR * 0.25, dR * 0.3, Math.PI, 0, false);
  c.closePath();
  c.fill();
  // ドームの台座(円柱の切り口)
  c.fillStyle = '#c8cdd2';
  c.fillRect(dCx - dR, dCy, dR * 2, ts * 0.12);
  c.fillStyle = 'rgba(0,0,0,0.18)';
  c.fillRect(dCx + dR * 0.5, dCy, dR * 0.5, ts * 0.12);

  // 黄色い雷マーク
  boltShape(c, dCx, dCy - dR * 0.3, dR * 0.8, '#ffd835');
}

// スタジアムスプライト
// 楕円の観客席+緑のフィールド+白いライン+照明塔
function drawStadiumSprite(c, ts) {
  const w = 2 * ts;
  const gY = ts;

  // 外壁の地面(コンクリート舗装)
  c.fillStyle = '#c0c6cc';
  c.fillRect(0, gY, w, 2 * ts);

  // 外壁(落ち影+壁+右側面の陰+屋根)
  const em = ts * 0.1;
  const ew = w - 2 * em;
  const eBaseY = gY + ts * 1.9;
  const eWallH = ts * 0.95;
  const eWallTop = eBaseY - eWallH;
  // 落ち影
  c.fillStyle = 'rgba(0,0,0,0.25)';
  c.fillRect(em + ts * 0.06, eBaseY - ts * 0.06, ew, ts * 0.12);
  // 外壁
  c.fillStyle = '#d4b96a';
  c.fillRect(em, eWallTop, ew, eWallH);
  // 右側面の陰
  const esw = Math.max(2, ts * 0.14);
  c.fillStyle = '#b09248';
  c.fillRect(em + ew - esw, eWallTop, esw, eWallH);
  // 屋根(庇)
  c.fillStyle = '#8d6e3a';
  c.fillRect(em, eWallTop - ts * 0.22, ew, ts * 0.22);
  c.fillStyle = 'rgba(255,255,255,0.18)';
  c.fillRect(em, eWallTop - ts * 0.22, ew, ts * 0.06);
  // アーチ窓(装飾)
  c.fillStyle = 'rgba(0,0,0,0.2)';
  const archW = Math.max(2, ts * 0.13);
  const archH = ts * 0.3;
  for (let k = 0; k < 6; k++) {
    const ax = em + (ew / 7) * (k + 1) - archW / 2;
    const ay = eWallTop + eWallH * 0.3;
    c.fillRect(ax, ay, archW, archH);
  }

  // フィールド(楕円)
  const fCx = w * 0.5;
  const fCy = gY + ts * 1.2;
  const fRx = ts * 0.72;
  const fRy = ts * 0.42;
  c.fillStyle = '#2e7d32';
  c.save();
  c.translate(fCx, fCy);
  c.scale(1, fRy / fRx);
  c.beginPath();
  c.arc(0, 0, fRx, 0, Math.PI * 2);
  c.fill();
  c.restore();
  // フィールドの芝の縞模様
  c.fillStyle = 'rgba(0,0,0,0.1)';
  for (let k = 0; k < 3; k++) {
    c.save();
    c.translate(fCx, fCy);
    c.scale(1, fRy / fRx);
    c.beginPath();
    const sr = fRx * (0.3 + k * 0.22);
    c.arc(0, 0, sr, 0, Math.PI * 2);
    c.arc(0, 0, Math.max(1, sr - ts * 0.08), 0, Math.PI * 2, true);
    c.fill();
    c.restore();
  }
  // センターライン
  c.strokeStyle = 'rgba(255,255,255,0.7)';
  c.lineWidth = Math.max(1, ts * 0.04);
  c.beginPath();
  c.moveTo(fCx - fRx * 0.5, fCy - ts * 0.04);
  c.lineTo(fCx + fRx * 0.5, fCy + ts * 0.04);
  c.stroke();
  // センターサークル
  c.strokeStyle = 'rgba(255,255,255,0.6)';
  c.lineWidth = Math.max(1, ts * 0.04);
  c.save();
  c.translate(fCx, fCy);
  c.scale(1, fRy / fRx);
  c.beginPath();
  c.arc(0, 0, fRx * 0.18, 0, Math.PI * 2);
  c.stroke();
  c.restore();

  // 照明塔(四隅)
  const poles = [[em + ts * 0.12, eWallTop - ts * 0.15], [w - em - ts * 0.12, eWallTop - ts * 0.15]];
  for (const [px, py] of poles) {
    c.strokeStyle = '#8a8a7a';
    c.lineWidth = Math.max(1, ts * 0.06);
    c.beginPath();
    c.moveTo(px, py);
    c.lineTo(px, py - ts * 0.55);
    c.stroke();
    // 照明ヘッド
    c.fillStyle = '#f5f0d0';
    c.fillRect(px - ts * 0.1, py - ts * 0.6, ts * 0.2, ts * 0.08);
  }
}

// 港スプライト
// 岸壁+クレーン(L字の鉄骨)+コンテナの山+係留された船シルエット
function drawSeaportSprite(c, ts) {
  const w = 2 * ts;
  const gY = ts;

  // 海側の水(右寄り)
  c.fillStyle = '#2d6eb5';
  c.fillRect(ts * 0.95, gY, ts * 1.05, 2 * ts);
  // 水の波紋
  c.strokeStyle = 'rgba(255,255,255,0.25)';
  c.lineWidth = Math.max(1, ts * 0.04);
  c.beginPath();
  c.moveTo(ts * 1.1, gY + ts * 0.5);
  c.lineTo(ts * 1.85, gY + ts * 0.5);
  c.moveTo(ts * 1.1, gY + ts * 1.1);
  c.lineTo(ts * 1.85, gY + ts * 1.1);
  c.moveTo(ts * 1.1, gY + ts * 1.7);
  c.lineTo(ts * 1.85, gY + ts * 1.7);
  c.stroke();

  // 岸壁(コンクリート)
  c.fillStyle = '#8d8d82';
  c.fillRect(0, gY, ts * 1.0, 2 * ts);
  // 岸壁の縁石
  c.fillStyle = '#6a6a60';
  c.fillRect(ts * 0.9, gY, ts * 0.1, 2 * ts);

  // 係留柱(ボラード)
  c.fillStyle = '#5a5a50';
  for (let k = 0; k < 3; k++) {
    const bx = ts * 0.92;
    const by = gY + ts * (0.35 + k * 0.6);
    c.fillRect(bx, by, ts * 0.07, ts * 0.12);
    c.fillStyle = '#3a3a30';
    c.fillRect(bx - ts * 0.02, by, ts * 0.11, ts * 0.04);
    c.fillStyle = '#5a5a50';
  }

  // コンテナ (カラフルに積み上げ)
  const containers = [
    { x: 0.06, y: 1.55, w: 0.26, h: 0.18, col: '#e74c3c', dark: '#c0392b' },
    { x: 0.35, y: 1.55, w: 0.26, h: 0.18, col: '#3498db', dark: '#2980b9' },
    { x: 0.63, y: 1.55, w: 0.22, h: 0.18, col: '#2ecc71', dark: '#27ae60' },
    { x: 0.06, y: 1.33, w: 0.26, h: 0.18, col: '#f39c12', dark: '#d68910' },
    { x: 0.35, y: 1.33, w: 0.26, h: 0.18, col: '#9b59b6', dark: '#8e44ad' },
    { x: 0.12, y: 1.11, w: 0.26, h: 0.18, col: '#e74c3c', dark: '#c0392b' },
    { x: 0.41, y: 1.11, w: 0.22, h: 0.18, col: '#3498db', dark: '#2980b9' },
  ];
  for (const ct of containers) {
    const cx2 = ct.x * ts, cy2 = gY + ct.y * ts;
    const cw2 = ct.w * ts, ch2 = ct.h * ts;
    // 落ち影
    c.fillStyle = 'rgba(0,0,0,0.22)';
    c.fillRect(cx2 + cw2 * 0.05, cy2 + ch2 * 0.9, cw2, ch2 * 0.18);
    // コンテナ本体
    c.fillStyle = ct.col;
    c.fillRect(cx2, cy2, cw2, ch2);
    // 右側面の陰
    const csw = Math.max(1, cw2 * 0.14);
    c.fillStyle = ct.dark;
    c.fillRect(cx2 + cw2 - csw, cy2, csw, ch2);
    // コンテナのリブ(縦線)
    c.strokeStyle = 'rgba(0,0,0,0.2)';
    c.lineWidth = Math.max(1, ts * 0.025);
    c.beginPath();
    c.moveTo(cx2 + cw2 * 0.35, cy2);
    c.lineTo(cx2 + cw2 * 0.35, cy2 + ch2);
    c.moveTo(cx2 + cw2 * 0.65, cy2);
    c.lineTo(cx2 + cw2 * 0.65, cy2 + ch2);
    c.stroke();
  }

  // クレーン(L字の鉄骨)
  const crX = ts * 0.42;
  const crBaseY = gY + ts * 1.85;
  const crTopY  = gY + ts * 0.1;
  const crArmEnd = ts * 1.88;
  c.strokeStyle = '#7a7060';
  c.lineWidth = Math.max(2, ts * 0.1);
  // 縦柱
  c.beginPath();
  c.moveTo(crX, crBaseY);
  c.lineTo(crX, crTopY);
  c.stroke();
  // 水平アーム
  c.lineWidth = Math.max(2, ts * 0.08);
  c.beginPath();
  c.moveTo(crX, crTopY);
  c.lineTo(crArmEnd, crTopY);
  c.stroke();
  // ワイヤー
  c.strokeStyle = '#555545';
  c.lineWidth = Math.max(1, ts * 0.04);
  c.beginPath();
  c.moveTo(crArmEnd - ts * 0.05, crTopY);
  c.lineTo(crArmEnd - ts * 0.05, crTopY + ts * 0.55);
  c.stroke();
  // フック
  c.fillStyle = '#444434';
  c.fillRect(crArmEnd - ts * 0.1, crTopY + ts * 0.52, ts * 0.1, ts * 0.08);

  // 船シルエット(水上に係留)
  const sY = gY + ts * 1.3;
  const sX = ts * 1.08;
  const shipW = ts * 0.8;
  const shipH = ts * 0.2;
  // 船体の落ち影
  c.fillStyle = 'rgba(0,0,0,0.3)';
  c.fillRect(sX + ts * 0.04, sY + shipH, shipW, ts * 0.07);
  // 船体
  c.fillStyle = '#4a4a40';
  c.beginPath();
  c.moveTo(sX, sY + shipH * 0.5);
  c.lineTo(sX + shipW * 0.12, sY + shipH);
  c.lineTo(sX + shipW, sY + shipH);
  c.lineTo(sX + shipW, sY + shipH * 0.5);
  c.closePath();
  c.fill();
  // 船体の上構造
  c.fillStyle = '#6a6a5a';
  c.fillRect(sX + shipW * 0.2, sY + shipH * 0.1, shipW * 0.45, shipH * 0.4);
  // マスト
  c.strokeStyle = '#555545';
  c.lineWidth = Math.max(1, ts * 0.04);
  c.beginPath();
  c.moveTo(sX + shipW * 0.4, sY + shipH * 0.5);
  c.lineTo(sX + shipW * 0.4, sY - ts * 0.2);
  c.stroke();
}

// 空港スプライト
// 滑走路(アスファルト+白い破線)+管制塔(高い塔+ガラス)+小さな旅客機シルエット
function drawAirportSprite(c, ts) {
  const w = 2 * ts;
  const gY = ts;

  // 地面(アスファルト)
  c.fillStyle = '#3a3d42';
  c.fillRect(0, gY, w, 2 * ts);

  // 誘導路(少し明るいアスファルト)
  c.fillStyle = '#4a4d52';
  c.fillRect(ts * 0.08, gY, w - ts * 0.16, 2 * ts);

  // 滑走路(中央、濃いアスファルト)
  const rwY = gY + ts * 0.55;
  const rwH = ts * 0.85;
  c.fillStyle = '#2e3035';
  c.fillRect(0, rwY, w, rwH);
  // 滑走路の縁ライン(白)
  c.fillStyle = 'rgba(255,255,255,0.7)';
  const edgeLw = Math.max(1, ts * 0.04);
  c.fillRect(0, rwY, w, edgeLw);
  c.fillRect(0, rwY + rwH - edgeLw, w, edgeLw);
  // 滑走路の中心線(破線)
  const clY = rwY + rwH / 2;
  const dashW = Math.max(2, ts * 0.18);
  const dashGap = ts * 0.12;
  c.fillStyle = 'rgba(255,255,255,0.8)';
  for (let x = 0; x < w; x += dashW + dashGap) {
    c.fillRect(x, clY - Math.max(1, ts * 0.04) / 2, dashW, Math.max(1, ts * 0.04));
  }
  // 閾値マーカー(エンドゾーンの縞)
  c.fillStyle = 'rgba(255,255,255,0.5)';
  const tmW = Math.max(2, ts * 0.08);
  const tmH = ts * 0.25;
  const tmGap = ts * 0.09;
  for (let k = 0; k < 3; k++) {
    c.fillRect(ts * 0.2 + k * (tmW + tmGap), rwY + (rwH - tmH) / 2, tmW, tmH);
    c.fillRect(w - ts * 0.2 - (k + 1) * (tmW + tmGap), rwY + (rwH - tmH) / 2, tmW, tmH);
  }

  // ターミナルビル(低い横長の建物)
  const tbX = ts * 0.08;
  const tbBaseY = gY + ts * 1.92;
  const tbH = ts * 0.48;
  const tbW = ts * 1.25;
  const tbTop = tbBaseY - tbH;
  // 落ち影
  c.fillStyle = 'rgba(0,0,0,0.22)';
  c.fillRect(tbX + ts * 0.06, tbBaseY - ts * 0.04, tbW, ts * 0.1);
  // 壁
  c.fillStyle = '#b0bac4';
  c.fillRect(tbX, tbTop, tbW, tbH);
  // 右側面の陰
  const tbsw = Math.max(2, ts * 0.12);
  c.fillStyle = '#8d9aa4';
  c.fillRect(tbX + tbW - tbsw, tbTop, tbsw, tbH);
  // 屋根
  c.fillStyle = '#6a7880';
  c.fillRect(tbX, tbTop - ts * 0.18, tbW, ts * 0.18);
  c.fillStyle = 'rgba(255,255,255,0.15)';
  c.fillRect(tbX, tbTop - ts * 0.18, tbW, ts * 0.05);
  // ターミナルの窓帯
  c.fillStyle = 'rgba(180,230,255,0.7)';
  c.fillRect(tbX + ts * 0.06, tbTop + tbH * 0.2, tbW - ts * 0.12 - tbsw, tbH * 0.35);

  // 管制塔(高い塔)
  const twX = ts * 1.55;
  const twBaseY = gY + ts * 1.92;
  const twW = ts * 0.28;
  const twH = ts * 1.3; // 上に大きくはみ出す
  const twTop = twBaseY - twH;
  // 塔の落ち影
  c.fillStyle = 'rgba(0,0,0,0.22)';
  c.fillRect(twX + ts * 0.04, twBaseY - ts * 0.03, twW, ts * 0.08);
  // 塔の柱
  c.fillStyle = '#c8cdd2';
  c.fillRect(twX + twW * 0.2, twTop + twH * 0.3, twW * 0.6, twH * 0.7);
  // 右側面の陰
  c.fillStyle = '#a0a8ae';
  c.fillRect(twX + twW * 0.6, twTop + twH * 0.3, twW * 0.2, twH * 0.7);
  // 管制室(ガラス張りの頭部)
  const chY = twTop;
  const chH = twH * 0.28;
  c.fillStyle = '#d0dce6';
  c.fillRect(twX, chY, twW, chH);
  // ガラス(青みがかった窓)
  c.fillStyle = 'rgba(100,200,255,0.6)';
  c.fillRect(twX + twW * 0.1, chY + chH * 0.15, twW * 0.65, chH * 0.6);
  // 右側面の陰(管制室)
  c.fillStyle = 'rgba(0,0,0,0.18)';
  c.fillRect(twX + twW * 0.75, chY, twW * 0.25, chH);
  // アンテナ
  c.strokeStyle = '#9aa0a6';
  c.lineWidth = Math.max(1, ts * 0.05);
  c.beginPath();
  c.moveTo(twX + twW / 2, chY);
  c.lineTo(twX + twW / 2, chY - ts * 0.22);
  c.stroke();

  // 旅客機シルエット(滑走路上を横切る)
  const plY = rwY + rwH * 0.38;
  const plX = ts * 0.18;
  const plW = ts * 0.65;
  const plH = ts * 0.12;
  // 胴体
  c.fillStyle = '#d0d8e0';
  c.beginPath();
  c.moveTo(plX, plY + plH * 0.5);
  c.lineTo(plX + plW * 0.08, plY);
  c.lineTo(plX + plW, plY + plH * 0.3);
  c.lineTo(plX + plW * 0.92, plY + plH);
  c.lineTo(plX + plW * 0.04, plY + plH);
  c.closePath();
  c.fill();
  // 翼
  c.fillStyle = '#b0b8c0';
  c.beginPath();
  c.moveTo(plX + plW * 0.3, plY + plH * 0.4);
  c.lineTo(plX + plW * 0.5, plY - plH * 0.5);
  c.lineTo(plX + plW * 0.62, plY + plH * 0.55);
  c.closePath();
  c.fill();
  // 尾翼
  c.beginPath();
  c.moveTo(plX + plW * 0.82, plY + plH * 0.3);
  c.lineTo(plX + plW * 0.88, plY - plH * 0.2);
  c.lineTo(plX + plW * 0.95, plY + plH * 0.3);
  c.closePath();
  c.fill();
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
    // 各建物タイプ専用のスプライト関数を呼ぶ
    if (type === T.NUCLEAR)      drawNuclearSprite(c, ts);
    else if (type === T.STADIUM) drawStadiumSprite(c, ts);
    else if (type === T.SEAPORT) drawSeaportSprite(c, ts);
    else if (type === T.AIRPORT) drawAirportSprite(c, ts);
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
    case T.CROSSING:
      // variantの下位4bitが道路マスク、上位4bitが線路マスク
      drawCrossingTile(c, ts, variant & 15, (variant >> 4) & 15);
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
    if (type === T.ROAD) return isRoadLike(t);
    if (type === T.RAIL) return isRailLike(t);
    return t === T.WIRE || t === T.POWER || t === T.NUCLEAR || wireOverAt(idx(nx, ny));
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

// ===== 描画フック実装 =====

// 渋滞の見える化:交通量の多い道路タイルに小さな車を描く
renderCars = function (ts, x0, y0, x1, y1) {
  if (ts < 6) return; // タイルが小さすぎる場合はスキップ
  const now = Date.now();
  // 車の色テーブル(タイル座標から決定論的に選ぶ)
  const CAR_COLORS = ['#e53935', '#ffffff', '#1565c0', '#f9a825', '#388e3c', '#6a1520'];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = idx(x, y);
      if (g.t[i] !== T.ROAD) continue;
      const tv = traffic[i];
      if (tv <= 60) continue;

      // 接続マスクで道路の軸を判定
      const mask = connMask(x, y, T.ROAD);
      const isHoriz = (mask & 10) && !(mask & 5); // 東西のみ
      const isVert  = (mask & 5)  && !(mask & 10); // 南北のみ
      // 交差点は描かない
      if (!isHoriz && !isVert) continue;

      // 渋滞度に応じて車の台数を決める(渋滞なら3台、それ以外は1〜2台)
      const congested = tv > CONGESTION;
      const carCount = congested ? 3 : (tv > 120 ? 2 : 1);
      // 渋滞時は動きを遅くする
      const speed = congested ? 20 : 40;

      const pxBase = Math.round(x * ts - cam.x);
      const pyBase = Math.round(y * ts - cam.y);

      for (let ci = 0; ci < carCount; ci++) {
        // 位置は時間+タイル座標+インデックスから決定論的に計算
        const offset = ((now / speed + x * 31 + y * 57 + ci * 23) % ts + ts) % ts;
        // 車のサイズ
        const carW = Math.max(2, ts * 0.22);
        const carH = Math.max(2, ts * 0.14);
        const roofH = Math.max(1, carH * 0.45);
        // 色はタイル座標とインデックスから
        const colorIdx = (x * 7 + y * 11 + ci * 17) % CAR_COLORS.length;
        const carColor = CAR_COLORS[colorIdx];

        let carX, carY;
        if (isHoriz) {
          // 東西方向: x軸に沿って動く
          const lane = (x * 3 + y + ci) % 2 === 0 ? ts * 0.38 : ts * 0.52;
          carX = pxBase + offset;
          carY = pyBase + lane;
        } else {
          // 南北方向: y軸に沿って動く
          const lane = (x + y * 3 + ci) % 2 === 0 ? ts * 0.38 : ts * 0.52;
          carX = pxBase + lane;
          carY = pyBase + offset;
        }
        // 車の落ち影
        cx.fillStyle = 'rgba(0,0,0,0.3)';
        cx.fillRect(carX + carW * 0.1, carY + carH * 0.85, carW, carH * 0.25);
        // 車体
        cx.fillStyle = carColor;
        cx.fillRect(carX, carY, carW, carH);
        // 屋根(少し暗め)
        cx.fillStyle = 'rgba(0,0,0,0.35)';
        cx.fillRect(carX + carW * 0.15, carY, carW * 0.7, roofH);
      }
    }
  }
};

// 竜巻・怪獣の描画
renderActors = function (ts) {
  const now = Date.now();
  for (const a of g.actors) {
    if (a.ttl <= 0) continue;
    const px = Math.round(a.x * ts - cam.x);
    const py = Math.round(a.y * ts - cam.y);

    if (a.kind === 'tornado') {
      // 下に楕円の影
      cx.fillStyle = 'rgba(0,0,0,0.3)';
      cx.save();
      cx.translate(px + ts * 0.5, py + ts * 0.88);
      cx.scale(1, 0.3);
      cx.beginPath();
      cx.arc(0, 0, ts * 0.38, 0, Math.PI * 2);
      cx.fill();
      cx.restore();

      // 竜巻: 漏斗(下が細く上が太い)を3〜4段重ねる
      // Date.now() ベースで左右に揺らす
      const sway = Math.sin(now / 200) * ts * 0.12;
      const layers = [
        { ry: 0.82, rx: 0.06, alpha: 0.75 }, // 最下(最細)
        { ry: 0.58, rx: 0.16, alpha: 0.65 },
        { ry: 0.35, rx: 0.28, alpha: 0.55 },
        { ry: 0.08, rx: 0.38, alpha: 0.45 }, // 最上(最太)
      ];
      for (let li = 0; li < layers.length; li++) {
        const layer = layers[li];
        const phase = (now / 180 + li * 0.8) % (Math.PI * 2);
        const lSway = sway * (1 - layer.ry * 0.6) + Math.sin(phase) * ts * 0.04;
        const cx2 = px + ts * 0.5 + lSway;
        const cy2 = py + ts * layer.ry;
        const rx = Math.max(1, ts * layer.rx);
        const ry = Math.max(1, rx * 0.5);
        cx.fillStyle = `rgba(140,145,155,${layer.alpha})`;
        cx.save();
        cx.translate(cx2, cy2);
        cx.scale(1, ry / rx);
        cx.beginPath();
        cx.arc(0, 0, rx, 0, Math.PI * 2);
        cx.fill();
        cx.restore();
        // 回転感: 内側に少し暗いハイライト
        cx.fillStyle = `rgba(80,85,95,${layer.alpha * 0.4})`;
        cx.save();
        cx.translate(cx2 + rx * 0.2, cy2);
        cx.scale(1, ry / rx);
        cx.beginPath();
        cx.arc(0, 0, rx * 0.45, 0, Math.PI * 2);
        cx.fill();
        cx.restore();
      }

    } else if (a.kind === 'monster') {
      // 1.5タイル分の大きさ
      const mS = ts * 1.5;
      const mX = px - ts * 0.25;
      const mY = py - ts * 0.8;

      // 足元の楕円の影
      cx.fillStyle = 'rgba(0,0,0,0.35)';
      cx.save();
      cx.translate(px + ts * 0.5, py + ts * 0.85);
      cx.scale(1, 0.28);
      cx.beginPath();
      cx.arc(0, 0, ts * 0.6, 0, Math.PI * 2);
      cx.fill();
      cx.restore();

      // 足(左右2本)
      cx.fillStyle = '#1b5e20';
      const fW = Math.max(2, mS * 0.18);
      const fH = Math.max(2, mS * 0.28);
      cx.fillRect(mX + mS * 0.18, mY + mS * 0.72, fW, fH);
      cx.fillRect(mX + mS * 0.58, mY + mS * 0.72, fW, fH);
      // 足の陰
      cx.fillStyle = 'rgba(0,0,0,0.2)';
      cx.fillRect(mX + mS * 0.28, mY + mS * 0.72, fW * 0.5, fH);
      cx.fillRect(mX + mS * 0.68, mY + mS * 0.72, fW * 0.5, fH);

      // 胴体(濃緑の矩形)
      cx.fillStyle = '#2e7d32';
      cx.fillRect(mX + mS * 0.1, mY + mS * 0.35, mS * 0.8, mS * 0.42);
      // 胴体右側面の陰
      cx.fillStyle = '#1b5e20';
      cx.fillRect(mX + mS * 0.74, mY + mS * 0.35, mS * 0.16, mS * 0.42);

      // 腕(左右)
      cx.fillStyle = '#388e3c';
      const aW = Math.max(2, mS * 0.14);
      const aH = Math.max(2, mS * 0.3);
      cx.fillRect(mX, mY + mS * 0.4, aW, aH);
      cx.fillRect(mX + mS * 0.86, mY + mS * 0.4, aW, aH);

      // 頭
      const hW = mS * 0.5;
      const hH = mS * 0.3;
      const hX = mX + (mS - hW) / 2;
      const hY = mY + mS * 0.08;
      cx.fillStyle = '#2e7d32';
      cx.fillRect(hX, hY, hW, hH);
      // 頭の右側面の陰
      cx.fillStyle = '#1b5e20';
      cx.fillRect(hX + hW * 0.8, hY, hW * 0.2, hH);
      // 頭の落ち影
      cx.fillStyle = 'rgba(0,0,0,0.22)';
      cx.fillRect(hX + hW * 0.1, hY + hH * 0.85, hW, hH * 0.18);

      // 白い目(怒り眉付き)
      const eyeY = hY + hH * 0.3;
      const eyeR = Math.max(1.5, mS * 0.06);
      const eyePositions = [hX + hW * 0.28, hX + hW * 0.62];
      for (const ex of eyePositions) {
        // 目
        cx.fillStyle = '#ffffff';
        cx.beginPath();
        cx.arc(ex, eyeY, eyeR, 0, Math.PI * 2);
        cx.fill();
        // 瞳
        cx.fillStyle = '#b71c1c';
        cx.beginPath();
        cx.arc(ex + eyeR * 0.2, eyeY, eyeR * 0.55, 0, Math.PI * 2);
        cx.fill();
      }
      // 怒り眉(左右に傾いた線)
      cx.strokeStyle = '#ffffff';
      cx.lineWidth = Math.max(1, mS * 0.04);
      cx.beginPath();
      cx.moveTo(eyePositions[0] - eyeR * 1.0, eyeY - eyeR * 1.3);
      cx.lineTo(eyePositions[0] + eyeR * 0.5, eyeY - eyeR * 1.8);
      cx.moveTo(eyePositions[1] + eyeR * 1.0, eyeY - eyeR * 1.3);
      cx.lineTo(eyePositions[1] - eyeR * 0.5, eyeY - eyeR * 1.8);
      cx.stroke();
    }
  }
};

// データマップオーバーレイ
renderOverlay = function (ts, x0, y0, x1, y1) {
  if (!g.overlayMode || g.overlayMode === 'none') return;

  const vw = cv.clientWidth, vh = cv.clientHeight;
  // まず全体に暗幕を掛ける
  cx.fillStyle = 'rgba(0,0,0,0.35)';
  cx.fillRect(0, 0, vw, vh);

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = idx(x, y);
      const pxT = Math.round(x * ts - cam.x);
      const pyT = Math.round(y * ts - cam.y);
      let color = null;

      if (g.overlayMode === 'power') {
        if (g.powered[i]) {
          color = 'rgba(76,175,80,0.45)'; // 通電: 緑
        } else if (conductsAt(i) || isZone(g.t[i]) || isBig(g.t[i])) {
          color = 'rgba(244,67,54,0.55)'; // 導電だが無電: 赤
        } else {
          color = 'rgba(0,0,0,0.1)';
        }

      } else if (g.overlayMode === 'pollution') {
        const v = clamp(pollution[i] / 150, 0, 1);
        if (v > 0.01) {
          const r = Math.round(255 * Math.min(1, v * 2));
          const gr = Math.round(200 * Math.max(0, 1 - v * 1.5));
          color = `rgba(${r},${gr},0,${0.15 + v * 0.55})`;
        }

      } else if (g.overlayMode === 'crime') {
        const v = clamp(crime[i] / 250, 0, 1);
        if (v > 0.01) {
          const r = Math.round(255 * Math.min(1, v * 2));
          const gr = Math.round(180 * Math.max(0, 1 - v * 1.5));
          color = `rgba(${r},${gr},0,${0.15 + v * 0.55})`;
        }

      } else if (g.overlayMode === 'traffic') {
        const v = clamp(traffic[i] / 400, 0, 1);
        if (v > 0.01) {
          const r = Math.round(255 * Math.min(1, v * 2));
          const gr = Math.round(200 * Math.max(0, 1 - v * 1.5));
          color = `rgba(${r},${gr},0,${0.15 + v * 0.55})`;
        }

      } else if (g.overlayMode === 'landvalue') {
        const v = clamp(landValue[i] / 80, 0, 1);
        if (v > 0.01) {
          // 低: 緑 → 高: 金色
          const r = Math.round(30 + v * 225);
          const gr = Math.round(140 + v * 115);
          const b = Math.round(v < 0.5 ? 40 : 40 - (v - 0.5) * 80);
          color = `rgba(${r},${gr},${b},${0.12 + v * 0.5})`;
        }

      } else if (g.overlayMode === 'police') {
        const v = clamp(policeCov[i] / 40, 0, 1);
        if (v > 0.01) {
          color = `rgba(30,100,255,${0.1 + v * 0.45})`;
        }

      } else if (g.overlayMode === 'fire') {
        const v = fireCov[i] > 0 ? 1 : 0;
        if (v > 0) {
          color = 'rgba(244,67,54,0.4)';
        }
      }

      if (color) {
        cx.fillStyle = color;
        cx.fillRect(pxT, pyT, ts, ts);
      }
    }
  }
};

function draw() {
  const ts = Math.max(4, Math.round(BASE_TILE * cam.zoom));
  const vw = cv.clientWidth, vh = cv.clientHeight;
  cx.fillStyle = '#142014';
  cx.fillRect(0, 0, vw, vh);

  // 地震による画面揺れ(g.shakeT > 0 の間、世界描画全体を±5pxずらす)
  // フレームごとに g.shakeT を1減らす
  const shaking = g.shakeT > 0;
  if (shaking) {
    const sx = ((g.shakeT * 7) % 11) - 5;
    const sy = ((g.shakeT * 13) % 9) - 4;
    cx.save();
    cx.translate(sx, sy);
    g.shakeT--;
  }

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
      else if (t === T.CROSSING) {
        // 下位4bit=道路マスク、上位4bit=線路マスク
        variant = connMask(x, y, T.ROAD) | (connMask(x, y, T.RAIL) << 4);
      }
      const px = Math.round(x * ts - cam.x);
      const py = Math.round(y * ts - cam.y);
      cx.drawImage(tileSprite(t, lvl, variant, ts), px, py - ts);

      // 電線オーバーレイ(道路・線路を横切る送電線)
      if (wireOverAt(i)) {
        cx.drawImage(wireOverSprite(connMask(x, y, T.WIRE), ts), px, py - ts);
      }

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

  // 画面揺れの save に対応する restore
  if (shaking) cx.restore();

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
                 '線路', '洪水', '原子力発電所', 'スタジアム', '港', '空港', '踏切'];
  let msg = names[g.t[i]];
  if (wireOverAt(i)) msg += '(電線が横断)';
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
  drawMinimap();
  $('map-panel').classList.remove('hidden');
}

function closeMapPanel() {
  $('map-panel').classList.add('hidden');
}

/* =========================================================
 * ミニマップ(データマップパネル内)
 * ========================================================= */
const MINIMAP_TILE_PX = 2;

// タイル種別をミニマップ色に変換する(水=青、草木=緑、道路=灰、線路=茶、
// 区画=R緑/C青/I黄(発展済みは濃く)、施設=白系、がれき/火=赤系)
function minimapColor(i) {
  const t = g.t[i];
  switch (t) {
    case T.WATER: return '#3a7bd5';
    case T.FLOOD: return '#4fc3f7';
    case T.GRASS: return '#5da344';
    case T.TREE: return '#2f7d32';
    case T.ROAD: case T.CROSSING: return '#808080';
    case T.RAIL: return '#8a6d4a';
    case T.WIRE: return '#6b6b6b';
    case T.RES: return g.lvl[i] > 0 ? '#1b5e20' : '#a5d6a7';
    case T.COM: return g.lvl[i] > 0 ? '#0d47a1' : '#90caf9';
    case T.IND: return g.lvl[i] > 0 ? '#f57f17' : '#fff59d';
    case T.POWER: case T.NUCLEAR: case T.POLICE: case T.FIRE_ST:
    case T.PARK: case T.STADIUM: case T.SEAPORT: case T.AIRPORT:
      return '#f5f5f5';
    case T.RUBBLE: return '#c62828';
    case T.FIRE: return '#ff5252';
    default: return '#5da344';
  }
}

// ミニマップを再描画する(パネルを開くたびに呼ばれる)
function drawMinimap() {
  const canvas = $('minimap-canvas');
  const ctx = canvas.getContext('2d');
  const w = W * MINIMAP_TILE_PX, h = H * MINIMAP_TILE_PX;
  ctx.clearRect(0, 0, w, h);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      ctx.fillStyle = minimapColor(idx(x, y));
      ctx.fillRect(x * MINIMAP_TILE_PX, y * MINIMAP_TILE_PX, MINIMAP_TILE_PX, MINIMAP_TILE_PX);
    }
  }
  // 現在のビューポート範囲を白枠で表示
  const ts = BASE_TILE * cam.zoom;
  const vx = (cam.x / ts) * MINIMAP_TILE_PX;
  const vy = (cam.y / ts) * MINIMAP_TILE_PX;
  const vw = (cv.clientWidth / ts) * MINIMAP_TILE_PX;
  const vh = (cv.clientHeight / ts) * MINIMAP_TILE_PX;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.strokeRect(vx + 0.5, vy + 0.5, vw, vh);
}

// ミニマップ上のピクセル座標(canvas座標系)へカメラをジャンプさせる
function minimapJumpToPixel(px, py) {
  const ts = BASE_TILE * cam.zoom;
  const tileX = px / MINIMAP_TILE_PX;
  const tileY = py / MINIMAP_TILE_PX;
  cam.x = tileX * ts - cv.clientWidth / 2;
  cam.y = tileY * ts - cv.clientHeight / 2;
  clampCamera();
}

/* =========================================================
 * 統計グラフパネル
 * ========================================================= */
let graphSeries = 'pop';
const GRAPH_COLORS = { pop: '#66bb6a', funds: '#ffd54f', approval: '#4dd0e1' };

function openGraphPanel() {
  document.querySelectorAll('.graph-opt-btn').forEach((btn) => {
    btn.classList.toggle('active-graph', btn.dataset.series === graphSeries);
  });
  drawGraph();
  $('graph-panel').classList.remove('hidden');
}

function closeGraphPanel() {
  $('graph-panel').classList.add('hidden');
}

function setGraphSeries(series) {
  graphSeries = series;
  document.querySelectorAll('.graph-opt-btn').forEach((b) =>
    b.classList.toggle('active-graph', b.dataset.series === graphSeries));
  drawGraph();
}

// g.history[graphSeries] を折れ線グラフとして #graph-canvas に描く
function drawGraph() {
  const canvas = $('graph-canvas');
  const emptyEl = $('graph-empty');
  const data = (g.history && g.history[graphSeries]) || [];

  if (data.length < 2) {
    emptyEl.classList.remove('hidden');
    canvas.classList.add('hidden');
    $('graph-min').textContent = '最小: -';
    $('graph-max').textContent = '最大: -';
    $('graph-cur').textContent = '現在: -';
    return;
  }
  emptyEl.classList.add('hidden');
  canvas.classList.remove('hidden');

  const ctx = canvas.getContext('2d');
  const w = canvas.width || 320, h = canvas.height || 160;
  ctx.clearRect(0, 0, w, h);

  let min = Infinity, max = -Infinity;
  for (const v of data) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min === max) { min -= 1; max += 1; }

  const pad = 6;
  ctx.strokeStyle = GRAPH_COLORS[graphSeries] || '#ffffff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < data.length; i++) {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = h - pad - ((data[i] - min) / (max - min)) * (h - pad * 2);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  const fmt = (v) => Math.round(v).toLocaleString();
  $('graph-min').textContent = '最小: ' + fmt(min);
  $('graph-max').textContent = '最大: ' + fmt(max);
  $('graph-cur').textContent = '現在: ' + fmt(data[data.length - 1]);
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

// ミニマップのタップでその場所へカメラをジャンプする
$('minimap-canvas').addEventListener('click', (e) => {
  const rect = $('minimap-canvas').getBoundingClientRect();
  minimapJumpToPixel(e.clientX - rect.left, e.clientY - rect.top);
  closeMapPanel();
});

// ===== 統計グラフパネル =====
$('btn-open-graph').addEventListener('click', () => {
  $('menu-panel').classList.add('hidden');
  openGraphPanel();
});
$('btn-close-graph').addEventListener('click', closeGraphPanel);
document.querySelectorAll('.graph-opt-btn').forEach((btn) => {
  btn.addEventListener('click', () => setGraphSeries(btn.dataset.series));
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

/* =========================================================
 * タイトル画面:セーブスロット(4枠)
 * ========================================================= */

// セーブありスロット:つづきから(読み込んで開始)
function slotContinue(n) {
  setSlot(n);
  if (loadGame()) {
    startGame();
    return true;
  }
  toast('セーブデータが読み込めませんでした');
  return false;
}

// セーブありスロット:削除(確認ダイアログ付き)
function slotDelete(n) {
  const info = getSlotInfo(n);
  const label = info.exists ? info.name : ('スロット' + n);
  if (!confirm(`「${label}」のセーブを削除しますか?この操作は取り消せません。`)) return false;
  deleteSlot(n);
  renderSlots();
  return true;
}

// タイトル画面のスロット一覧を最新のセーブ状況で描き直す
function renderSlots() {
  const list = $('slot-list');
  list.innerHTML = '';
  for (let n = 1; n <= 4; n++) {
    const info = getSlotInfo(n);
    const card = document.createElement('div');
    card.className = 'slot-card' + (info.exists ? '' : ' slot-empty');

    const infoDiv = document.createElement('div');
    infoDiv.className = 'slot-info';
    const cityDiv = document.createElement('div');
    cityDiv.className = 'slot-city';
    cityDiv.textContent = info.exists ? `🏙️ ${info.name}` : '(あきち)';
    infoDiv.appendChild(cityDiv);
    if (info.exists) {
      const metaDiv = document.createElement('div');
      metaDiv.className = 'slot-meta';
      metaDiv.textContent = `👥 ${info.pop.toLocaleString()}人 / ${info.year}年${info.month}月`;
      infoDiv.appendChild(metaDiv);
    }
    card.appendChild(infoDiv);

    const actions = document.createElement('div');
    actions.className = 'slot-actions';
    if (info.exists) {
      const btnContinue = document.createElement('button');
      btnContinue.className = 'slot-btn slot-continue';
      btnContinue.textContent = '▶ つづきから';
      btnContinue.addEventListener('click', () => slotContinue(n));
      actions.appendChild(btnContinue);

      const btnDelete = document.createElement('button');
      btnDelete.className = 'slot-btn slot-delete';
      btnDelete.textContent = '🗑 削除';
      btnDelete.addEventListener('click', () => slotDelete(n));
      actions.appendChild(btnDelete);
    } else {
      const btnStart = document.createElement('button');
      btnStart.className = 'slot-btn slot-start';
      btnStart.textContent = '★ はじめる';
      btnStart.addEventListener('click', () => openNewGameDialog(n));
      actions.appendChild(btnStart);
    }
    card.appendChild(actions);
    list.appendChild(card);
  }
}

/* ===== 新規開始ダイアログ ===== */
let newGameTargetSlot = 1;
let newGameDifficulty = 'normal';

// 難易度ボタンの選択状態を更新する
function selectDifficulty(level) {
  newGameDifficulty = level;
  document.querySelectorAll('.difficulty-btn').forEach((b) =>
    b.classList.toggle('active-diff', b.dataset.difficulty === newGameDifficulty));
}

function openNewGameDialog(slotN) {
  newGameTargetSlot = slotN;
  $('newgame-name').value = 'わたしのまち';
  selectDifficulty('normal');
  $('newgame-panel').classList.remove('hidden');
}

function closeNewGameDialog() {
  $('newgame-panel').classList.add('hidden');
}

// 「開始」ボタン:入力内容から新規ゲームを作成してスタートする
function confirmNewGame() {
  const raw = $('newgame-name').value;
  const name = (raw && raw.trim()) ? raw.trim().slice(0, 12) : 'わたしのまち';
  setSlot(newGameTargetSlot);
  newGame(name, newGameDifficulty);
  closeNewGameDialog();
  startGame();
}

document.querySelectorAll('.difficulty-btn').forEach((btn) => {
  btn.addEventListener('click', () => selectDifficulty(btn.dataset.difficulty));
});
$('btn-newgame-start').addEventListener('click', confirmNewGame);
$('btn-newgame-cancel').addEventListener('click', closeNewGameDialog);

function showTitle() {
  $('title-screen').classList.remove('hidden');
  renderSlots();
}

function newGame(name, difficulty) {
  genMap();
  g.name = name || 'わたしのまち';
  g.difficulty = (difficulty === 'easy' || difficulty === 'hard') ? difficulty : 'normal';
  g.funds = DIFFICULTY_FUNDS[g.difficulty] !== undefined
    ? DIFFICULTY_FUNDS[g.difficulty] : START_FUNDS;
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
  g.history = { pop: [], funds: [], approval: [] };
}

function startGame() {
  $('title-screen').classList.add('hidden');
  // HUDに都市名を表示
  $('hud-city').textContent = g.name;
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
migrateLegacySave(); // 旧バージョンのセーブ(スロット制導入前)をslot1へ移行
resizeCanvas();
buildToolbar();
showTitle();
updateHUD();
requestAnimationFrame(draw);
