// セーブスロット(4つ)のテスト
'use strict';
const { createGame, assert } = require('./harness');

console.log('[slots.test] セーブスロット');

/* =========================================================
 * テスト 1: スロットの独立性
 * ========================================================= */
console.log('[slots.test] 1. スロットの独立性');
{
  const G = createGame();
  const { g, T, idx, newGame, startGame, saveGame, loadGame,
          setSlot, getSlotInfo } = G;

  newGame('いちごまち', 'normal');
  startGame();
  // 住宅地を手動配置して人口を作る(地形に依存しない)
  const i1 = idx(10, 10), i2 = idx(11, 10);
  g.t[i1] = T.RES; g.lvl[i1] = 2;
  g.t[i2] = T.RES; g.lvl[i2] = 3;
  g.funds = 12345;
  saveGame(true); // デフォルトのslot1へ保存

  assert(getSlotInfo(1).exists === true, 'slot1にセーブが存在する');
  assert(getSlotInfo(2).exists === false, 'slot2にはまだセーブがない');

  setSlot(2);
  newGame('にばんめ', 'hard');
  startGame();
  const i3 = idx(20, 20);
  g.t[i3] = T.RES; g.lvl[i3] = 1;
  g.funds = 99999;
  saveGame(true); // slot2へ保存

  const info1 = getSlotInfo(1), info2 = getSlotInfo(2);
  assert(info1.exists && info2.exists, '両スロットにセーブが存在する');
  assert(info1.name === 'いちごまち', 'slot1の都市名が独立して保持される');
  assert(info2.name === 'にばんめ', 'slot2の都市名が独立して保持される');
  assert(info1.pop !== info2.pop, 'slot1とslot2で人口が独立している');

  // ロードして中身が混ざっていないことを確認
  setSlot(1);
  assert(loadGame(), 'slot1をロードできる');
  assert(g.funds === 12345, 'slot1のロードでfundsが復元される(slot2の値と混ざらない)');
  assert(g.t[i1] === T.RES && g.lvl[i1] === 2, 'slot1の区画が復元される');

  setSlot(2);
  assert(loadGame(), 'slot2をロードできる');
  assert(g.funds === 99999, 'slot2のロードでfundsが復元される');
  assert(g.t[i3] === T.RES && g.lvl[i3] === 1, 'slot2の区画が復元される');
}

/* =========================================================
 * テスト 2: getSlotInfoのname/pop/year
 * ========================================================= */
console.log('[slots.test] 2. getSlotInfoの概要情報');
{
  const G = createGame();
  const { newGame, startGame, simMonth, saveGame, getSlotInfo } = G;

  newGame('としょかんまち', 'normal');
  startGame();
  for (let i = 0; i < 26; i++) simMonth(); // 1990年1月開始 → 26ヶ月後
  saveGame(true);

  const info = getSlotInfo(1);
  assert(info.exists, 'セーブが存在する');
  assert(info.name === 'としょかんまち', '都市名が正しく返る');
  assert(info.year === 1992, '年が正しく計算される(1990+floor(26/12))');
  assert(info.month === 3, '月が正しく計算される((26%12)+1)');
  assert(typeof info.savedAt === 'number' && info.savedAt > 0, 'savedAtが記録される');
}

/* =========================================================
 * テスト 3: deleteSlot
 * ========================================================= */
console.log('[slots.test] 3. deleteSlot');
{
  const G = createGame();
  const { newGame, startGame, saveGame, getSlotInfo, deleteSlot } = G;

  newGame('けすまち', 'normal');
  startGame();
  saveGame(true);
  assert(getSlotInfo(1).exists === true, '削除前はセーブが存在する');

  deleteSlot(1);
  assert(getSlotInfo(1).exists === false, 'deleteSlot後はセーブが存在しない');
}

/* =========================================================
 * テスト 4: 旧セーブの移行(migrateLegacySave)
 * ========================================================= */
console.log('[slots.test] 4. 旧セーブの移行');
{
  const G = createGame();
  const { T, W, H, SAVE_KEY, slotKey, migrateLegacySave, getSlotInfo, loadGame,
          setSlot, g, store } = G;

  // 旧バージョン(スロット制導入前)のv3形式データを旧キーへ手動で置く
  const legacyData = {
    v: 3,
    funds: 7777,
    month: 24,
    taxRate: 9,
    milestone: 1,
    t: new Array(W * H).fill(T.GRASS),
    lvl: new Array(W * H).fill(0),
    fireT: new Array(W * H).fill(0),
    wireOver: new Array(W * H).fill(0),
    budget: { road: 100, police: 100, fire: 100, autoShow: true },
    autoDisaster: true,
    finYear: { tax: 0, road: 0, police: 0, fire: 0, other: 0 },
    lastFin: { tax: 0, road: 0, police: 0, fire: 0, other: 0 },
  };
  store[SAVE_KEY] = JSON.stringify(legacyData);
  assert(store[slotKey(1)] === undefined, '移行前はslot1にセーブがない');

  migrateLegacySave();

  assert(store[SAVE_KEY] === undefined, '移行後は旧キーが消える');
  assert(getSlotInfo(1).exists === true, '移行後はslot1にセーブが存在する');

  setSlot(1);
  assert(loadGame(), '移行したセーブをロードできる');
  assert(g.funds === 7777, '移行したセーブのfundsが正しい');
  assert(g.month === 24, '移行したセーブのmonthが正しい');
  assert(g.name === 'わたしのまち', 'v3データのnameはデフォルト値で補完される');
  assert(g.difficulty === 'normal', 'v3データのdifficultyはデフォルト値で補完される');
}

/* =========================================================
 * テスト 5: 難易度による初期資金
 * ========================================================= */
console.log('[slots.test] 5. 難易度による初期資金');
{
  const G = createGame();
  const { g, newGame } = G;

  newGame('やさしいまち', 'easy');
  assert(g.funds === 30000, 'easyの初期資金は30000');

  newGame('ふつうのまち', 'normal');
  assert(g.funds === 20000, 'normalの初期資金は20000');

  newGame('むずかしいまち'); // 省略時はnormal扱い
  assert(g.funds === 20000, '難易度省略時はnormal扱い(20000)');

  newGame('げきむずまち', 'hard');
  assert(g.funds === 10000, 'hardの初期資金は10000');
}

/* =========================================================
 * テスト 6: 統計履歴(history)
 * ========================================================= */
console.log('[slots.test] 6. 統計履歴(history)');
{
  const G = createGame();
  const { g, newGame, startGame, simMonth, saveGame, loadGame } = G;

  newGame('れきしまち', 'normal');
  startGame();

  for (let i = 0; i < 10; i++) simMonth();
  assert(g.history.pop.length === 10, '10ヶ月のシミュレーションでhistoryが10件になる');
  assert(g.history.funds.length === 10, 'funds履歴も同じ件数になる');
  assert(g.history.approval.length === 10, 'approval履歴も同じ件数になる');

  for (let i = 0; i < 300; i++) simMonth(); // 合計310ヶ月分
  assert(g.history.pop.length === 240, 'historyは240件で頭打ちになる');
  assert(g.history.funds.length === 240, 'funds履歴も240件で頭打ちになる');
  assert(g.history.approval.length === 240, 'approval履歴も240件で頭打ちになる');

  const savedPopHistory = g.history.pop.slice();
  saveGame(true);
  newGame('べつのまち', 'normal');
  assert(g.history.pop.length === 0, 'newGameでhistoryがリセットされる');

  assert(loadGame(), 'セーブデータをロードできる');
  assert(g.history.pop.length === 240, 'ロードでhistoryが復元される');
  assert(JSON.stringify(g.history.pop) === JSON.stringify(savedPopHistory),
    'ロードしたhistoryの内容が一致する');
}

console.log('[slots.test] 完了');
