// ビークル(列車・船・飛行機)と効果音のテスト
'use strict';
const { createGame, assert } = require('./harness');

console.log('[vehicles.test] ビークル・効果音');
const G = createGame();
const { g, T, W, H, idx, newGame, startGame, place, vehicles, updateVehicles,
  isRailLike, playSound, sound } = G;

newGame();
startGame();
g.autoDisaster = false;

/* ===== 1. 線路が無ければ列車は出現しない ===== */
for (let i = 0; i < 15; i++) updateVehicles(0.2); // 3秒分
assert(vehicles.filter((v) => v.kind === 'train').length === 0,
  '線路が無ければ列車は出現しない');

/* ===== 2. 線路が10タイル以上あれば列車が出現し、線路タイル上に留まる ===== */
// 川を避けて一直線に線路を敷けるエリアを探す
function findRailRow(len) {
  for (let y = 5; y < H - 5; y++) {
    let ok = true;
    for (let x = 5; x < 5 + len; x++) {
      if (g.t[idx(x, y)] === T.WATER) { ok = false; break; }
    }
    if (ok) return y;
  }
  return 5; // 見つからなくても橋として建設できるのでフォールバック
}
const RAIL_LEN = 14;
const railY = findRailRow(RAIL_LEN);
for (let x = 5; x < 5 + RAIL_LEN; x++) place('rail', x, railY);

let railCount = 0;
for (let i = 0; i < W * H; i++) if (isRailLike(g.t[i])) railCount++;
assert(railCount >= 10, '線路タイルが10以上敷設されている');

// 出現チェック(1秒に1回程度)が確実に走るよう十分な実時間分を進める
for (let i = 0; i < 20; i++) updateVehicles(0.2); // 4秒分

const trains = vehicles.filter((v) => v.kind === 'train');
assert(trains.length >= 1, '線路が10タイル以上あれば列車が出現する');

if (trains.length > 0) {
  const t0 = trains[0];
  assert(isRailLike(g.t[idx(t0.tx, t0.ty)]), '列車の現在タイルは線路(RAIL/CROSSING)上にある');

  // しばらく走らせても常に線路タイル上に留まり続けること
  let stillOnRail = true;
  for (let i = 0; i < 200; i++) {
    updateVehicles(0.05);
    for (const v of vehicles) {
      if (v.kind === 'train' && !isRailLike(g.t[idx(v.tx, v.ty)])) stillOnRail = false;
    }
  }
  assert(stillOnRail, '列車は走行中も常に線路タイル上に留まる(直進優先・行き止まりで反転)');
}

/* ===== 3. 最大編成数を超えて列車が増え続けないこと ===== */
for (let i = 0; i < 100; i++) updateVehicles(0.2); // 20秒分
const trainCountAfter = vehicles.filter((v) => v.kind === 'train').length;
assert(trainCountAfter <= 2, `列車は最大2編成まで(実際: ${trainCountAfter})`);

/* ===== 4. 効果音: AudioContextが無い環境でも例外を出さない ===== */
let threw = false;
try {
  for (const kind of ['build', 'bulldoze', 'money', 'siren', 'milestone', 'error', 'unknown']) {
    playSound(kind);
  }
} catch (e) {
  threw = true;
  console.log('  例外: ' + e.message);
}
assert(!threw, 'playSound() はAudioContext無しの環境でも例外を出さない');

sound.enabled = false;
let threwDisabled = false;
try {
  playSound('siren');
} catch (e) {
  threwDisabled = true;
}
assert(!threwDisabled, 'sound.enabled=false のときも playSound() は例外を出さない');
sound.enabled = true;

console.log('[vehicles.test] 完了');
