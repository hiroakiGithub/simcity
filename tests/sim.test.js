// シミュレーション基本テスト
'use strict';
const { createGame, assert } = require('./harness');

console.log('[sim.test] 基本シミュレーション');
const G = createGame();
const { g, T, W, H, idx, newGame, startGame, simMonth, saveGame, loadGame, place } = G;

newGame();
startGame();
g.autoDisaster = false; // ランダム災害でテストが不安定にならないよう無効化
assert(g.funds === 20000, '初期資金20000');

// 川を避けて建設可能な草地エリアを探す
function findLand(w, h) {
  for (let y = 5; y < H - h - 5; y++) {
    outer:
    for (let x = 5; x < W - w - 5; x++) {
      for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) {
          if (g.t[idx(x + dx, y + dy)] === T.WATER) continue outer;
        }
      }
      return [x, y];
    }
  }
  return null;
}
const spot = findLand(10, 8);
assert(spot !== null, '建設可能な草地エリアが存在する');
const [bx, by] = spot;

// 町を建設
place('power', bx, by);
assert(g.t[idx(bx, by)] === T.POWER, '発電所を建設できる');
for (let x = bx; x < bx + 9; x++) place('road', x, by + 2);
place('wire', bx, by + 1);
for (let x = bx + 1; x < bx + 4; x++) place('res', x, by + 1);
for (let x = bx + 4; x < bx + 6; x++) place('com', x, by + 1);
for (let x = bx + 6; x < bx + 8; x++) place('ind', x, by + 1);
place('fire_st', bx + 8, by + 1);
assert(g.t[idx(bx, by + 1)] === T.WIRE, '既存の送電線の上に区画は置けない');

const fundsAfterBuild = g.funds;
assert(fundsAfterBuild < 20000, '建設で資金が減る');

g.funds = 0;
place('power', bx + 10, by + 5);
assert(g.t[idx(bx + 10, by + 5)] !== T.POWER, '資金不足では建設できない');
g.funds = fundsAfterBuild;

// 10年シミュレーション
for (let i = 0; i < 120; i++) simMonth();
console.log(`  10年後: 人口=${g.pop} 雇用=${g.jobs} 資金=${g.funds}`);
assert(g.pop > 0, '人口が増える(区画が発展する)');
assert(g.month === 120, '月が進む');

let poweredZones = 0;
for (let i = 0; i < W * H; i++) {
  if ((g.t[i] === T.RES || g.t[i] === T.COM || g.t[i] === T.IND) && g.powered[i]) poweredZones++;
}
assert(poweredZones > 0, '区画に電気が届いている');

// セーブ→改変→ロード
saveGame(true);
const savedFunds = g.funds, savedMonth = g.month;
newGame();
assert(g.month === 0, '新規ゲームでリセットされる');
assert(loadGame(), 'セーブデータをロードできる');
assert(g.month === savedMonth && g.funds === savedFunds, 'ロードで月と資金が復元される');

startGame();
for (let i = 0; i < 12; i++) simMonth();
assert(g.month === savedMonth + 12, 'ロード後も続きからプレイできる');

place('bulldoze', bx, by);
assert(g.t[idx(bx, by)] === T.GRASS, '整地で更地に戻る');
