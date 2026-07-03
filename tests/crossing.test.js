// 立体交差(電線オーバーレイ・踏切)のテスト
'use strict';
const { createGame, assert } = require('./harness');

console.log('[crossing.test] 立体交差');
const G = createGame();
const { g, T, W, H, idx, newGame, startGame, place, computePower } = G;

newGame();
startGame();
g.funds = 99999;

// テスト用エリアを直接整地(ランダム地形に依存しない)
const bx = 10, by = 20;
for (let y = by; y < by + 8; y++) {
  for (let x = bx; x < bx + 14; x++) {
    g.t[idx(x, y)] = T.GRASS;
    g.lvl[idx(x, y)] = 0;
    g.fireT[idx(x, y)] = 0;
    g.wireOver[idx(x, y)] = 0;
  }
}

// 東西の道路を敷く
for (let x = bx; x < bx + 10; x++) place('road', x, by + 3);

// 1. 送電線を道路の上に引く → 電線オーバーレイになる
place('wire', bx + 5, by + 3);
assert(g.t[idx(bx + 5, by + 3)] === T.ROAD, '電線を引いても道路は道路のまま');
assert(g.wireOver[idx(bx + 5, by + 3)] === 1, '道路に電線オーバーレイが付く');

// 2. 電気が道路を横切って伝わる
// 発電所 → 電線(北側) → 道路上のオーバーレイ → 電線(南側) → 住宅
place('power', bx + 5, by);
place('wire', bx + 5, by + 1);
place('wire', bx + 5, by + 2);
place('wire', bx + 5, by + 4);
place('res', bx + 5, by + 5);
computePower();
assert(g.powered[idx(bx + 5, by + 3)] === 1, '道路上のオーバーレイに通電する');
assert(g.powered[idx(bx + 5, by + 5)] === 1, '道路の向こう側の区画に電気が届く');

// 3. 道路を既存の電線の上に通す → 道路化+オーバーレイ
place('wire', bx + 8, by + 5);
place('road', bx + 8, by + 5);
assert(g.t[idx(bx + 8, by + 5)] === T.ROAD, '電線の上に道路を通せる');
assert(g.wireOver[idx(bx + 8, by + 5)] === 1, '道路化しても電線はオーバーレイとして残る');

// 4. 道路×線路 → 踏切
place('rail', bx + 2, by + 3);
assert(g.t[idx(bx + 2, by + 3)] === T.CROSSING, '道路に線路を通すと踏切になる');
place('rail', bx + 2, by + 4);
place('road', bx + 2, by + 4); // 線路に道路 → 踏切
assert(g.t[idx(bx + 2, by + 4)] === T.CROSSING, '線路に道路を通しても踏切になる');

// 5. 整地は電線→本体の2段階
const wi = idx(bx + 5, by + 3);
place('bulldoze', bx + 5, by + 3);
assert(g.wireOver[wi] === 0 && g.t[wi] === T.ROAD, '1回目の整地で電線だけ撤去され道路が残る');
place('bulldoze', bx + 5, by + 3);
assert(g.t[wi] === T.GRASS, '2回目の整地で道路が撤去される');

// 6. セーブv3ラウンドトリップ(wireOverが保存される)
const { saveGame, loadGame } = G;
place('wire', bx + 6, by + 3); // オーバーレイを作り直す
assert(g.wireOver[idx(bx + 6, by + 3)] === 1, 'セーブ前にオーバーレイが存在する');
saveGame(true);
g.wireOver.fill(0);
assert(loadGame(), 'v3セーブをロードできる');
assert(g.wireOver[idx(bx + 6, by + 3)] === 1, 'ロードでwireOverが復元される');

// 7. v2形式(wireOverなし)のロード互換
const slotKeyKey = G.slotKey(1); // デフォルトはslot1
const data = JSON.parse(G.store[slotKeyKey]);
data.v = 2;
delete data.wireOver;
G.store[slotKeyKey] = JSON.stringify(data);
assert(loadGame(), 'v2形式もロードできる');
let anyWire = 0;
for (let i = 0; i < W * H; i++) anyWire += g.wireOver[i];
assert(anyWire === 0, 'v2ロード時はwireOverがゼロ初期化される');
