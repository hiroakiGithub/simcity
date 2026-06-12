// マルチタイル建物(2×2)のテスト
'use strict';
const { createGame, assert } = require('./harness');

console.log('[bigbuilding.test] マルチタイル建物');
const G = createGame();
const { g, T, BIG, W, H, idx, newGame, startGame, place, computePower } = G;

newGame();
startGame();
g.funds = 99999;

// 草地エリアを探す(水を避ける)
function findLand(w, h) {
  for (let y = 5; y < H - h - 5; y++) {
    outer:
    for (let x = 5; x < W - w - 5; x++) {
      for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) {
          if (g.t[idx(x + dx, y + dy)] !== T.GRASS && g.t[idx(x + dx, y + dy)] !== T.TREE) continue outer;
        }
      }
      return [x, y];
    }
  }
  return null;
}
const [bx, by] = findLand(8, 8);

// 2×2のスタジアムを建設
place('stadium', bx, by);
assert(g.t[idx(bx, by)] === T.STADIUM && g.lvl[idx(bx, by)] === 0, 'アンカーがlvl=0で置かれる');
assert(g.t[idx(bx + 1, by)] === T.STADIUM && g.lvl[idx(bx + 1, by)] === 1, '右タイルがlvl=1');
assert(g.t[idx(bx, by + 1)] === T.STADIUM && g.lvl[idx(bx, by + 1)] === 2, '下タイルがlvl=2');
assert(g.t[idx(bx + 1, by + 1)] === T.STADIUM && g.lvl[idx(bx + 1, by + 1)] === 3, '右下タイルがlvl=3');

// 既存建物と重なる位置には建たない
const before = g.funds;
place('airport', bx + 1, by + 1);
assert(g.t[idx(bx + 2, by + 1)] !== T.AIRPORT, '重なる位置には建設できない');
assert(g.funds === before, '建設失敗時は資金が減らない');

// 港は水辺のみ
let waterSpot = null;
outer:
for (let y = 1; y < H - 3; y++) {
  for (let x = 1; x < W - 3; x++) {
    // 2×2が陸地で、その周囲に水がある場所
    let land = true;
    for (let dy = 0; dy < 2 && land; dy++)
      for (let dx = 0; dx < 2 && land; dx++)
        if (g.t[idx(x + dx, y + dy)] !== T.GRASS && g.t[idx(x + dx, y + dy)] !== T.TREE) land = false;
    if (!land) continue;
    let water = false;
    for (let dy = -1; dy <= 2 && !water; dy++)
      for (let dx = -1; dx <= 2 && !water; dx++)
        if ((dy < 0 || dy > 1 || dx < 0 || dx > 1) &&
            x + dx >= 0 && y + dy >= 0 && x + dx < W && y + dy < H &&
            g.t[idx(x + dx, y + dy)] === T.WATER) water = true;
    if (water) { waterSpot = [x, y]; break outer; }
  }
}
assert(waterSpot !== null, '水辺の建設地が見つかる');
place('seaport', bx + 4, by + 4); // 内陸 → 失敗するはず
assert(g.t[idx(bx + 4, by + 4)] !== T.SEAPORT, '内陸に港は建たない');
place('seaport', waterSpot[0], waterSpot[1]);
assert(g.t[idx(waterSpot[0], waterSpot[1])] === T.SEAPORT, '水辺に港を建設できる');

// 原子力発電所が通電する
place('nuclear', bx + 4, by + 4);
assert(g.t[idx(bx + 4, by + 4)] === T.NUCLEAR, '原子力発電所を建設できる');
computePower();
assert(g.powered[idx(bx + 4, by + 4)] === 1, '原子力発電所が電源になる');

// どのタイルを整地しても建物全体が消える
place('bulldoze', bx + 1, by + 1); // スタジアムの右下を整地
for (let dy = 0; dy < 2; dy++) {
  for (let dx = 0; dx < 2; dx++) {
    assert(g.t[idx(bx + dx, by + dy)] === T.GRASS, `整地で全体が更地に戻る(${dx},${dy})`);
  }
}
