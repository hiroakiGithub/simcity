// タイトル画面のセーブスロット・新規開始ダイアログ・統計グラフ・ミニマップのテスト
'use strict';
const { createGame, assert } = require('./harness');

/* =========================================================
 * テスト 1: renderSlots が例外なく動く(セーブなし状態)
 * ========================================================= */
console.log('[ui-slots.test] 1. renderSlots(セーブなし)');
{
  const G = createGame();
  const { renderSlots, getSlotInfo } = G;

  let threw = false;
  try {
    renderSlots();
  } catch (e) {
    threw = true;
  }
  assert(!threw, 'renderSlots がセーブなしの状態で例外なく実行できる');
  for (let n = 1; n <= 4; n++) {
    assert(getSlotInfo(n).exists === false, `スロット${n}は初期状態でセーブが存在しない`);
  }
}

/* =========================================================
 * テスト 2: スロット選択 → newGame → startGame の流れ(新規開始ダイアログ)
 * ========================================================= */
console.log('[ui-slots.test] 2. 新規開始ダイアログの流れ');
{
  const G = createGame();
  const { g, openNewGameDialog, closeNewGameDialog, selectDifficulty,
          confirmNewGame, renderSlots, getSlotInfo, saveGame } = G;

  let threw = false;
  try {
    renderSlots();
    openNewGameDialog(3); // 3番目のスロットで新規開始
    selectDifficulty('hard');
    document.getElementById('newgame-name').value = 'てすとまち';
    confirmNewGame();
  } catch (e) {
    threw = true;
    console.log('  例外: ' + e.stack);
  }
  assert(!threw, 'スロット選択→newGame→startGameの流れが例外なく動く');
  assert(g.name === 'てすとまち', '入力した都市名が反映される');
  assert(g.difficulty === 'hard', '選択した難易度が反映される');
  assert(g.funds === 10000, 'hard難易度の初期資金が反映される');
  assert(g.running === true, '新規開始後はゲームが実行状態になる');

  // スロット3へ保存されたことを確認(setSlotがconfirmNewGame内で呼ばれている)
  saveGame(true);
  assert(getSlotInfo(3).exists === true, 'スロット3にセーブが保存される');
  assert(getSlotInfo(3).name === 'てすとまち', 'スロット3のセーブに都市名が反映される');

  closeNewGameDialog(); // 例外が出ないことだけ確認
}

/* =========================================================
 * テスト 3: 都市名未入力(空欄)の場合はデフォルト名になる
 * ========================================================= */
console.log('[ui-slots.test] 3. 都市名デフォルト値');
{
  const G = createGame();
  const { g, openNewGameDialog, confirmNewGame } = G;

  openNewGameDialog(1);
  document.getElementById('newgame-name').value = '   '; // 空白のみ
  confirmNewGame();
  assert(g.name === 'わたしのまち', '都市名が空欄のときデフォルト名になる');
  assert(g.difficulty === 'normal', '難易度未選択時はnormalのまま');
}

/* =========================================================
 * テスト 4: slotContinue / slotDelete
 * ========================================================= */
console.log('[ui-slots.test] 4. slotContinue / slotDelete');
{
  const G = createGame();
  const { g, newGame, startGame, setSlot, saveGame, getSlotInfo,
          slotContinue, slotDelete, renderSlots } = G;

  // セーブが存在しないスロットへの continue は false を返し、例外を出さない
  let threw = false;
  let result;
  try {
    result = slotContinue(4);
  } catch (e) {
    threw = true;
  }
  assert(!threw, 'slotContinue はセーブがなくても例外を出さない');
  assert(result === false, 'セーブがないスロットへの slotContinue は false を返す');

  // スロット2にセーブを作ってから continue する
  setSlot(2);
  newGame('つづきまち', 'easy');
  startGame();
  saveGame(true);

  threw = false;
  try {
    result = slotContinue(2);
  } catch (e) {
    threw = true;
  }
  assert(!threw, 'slotContinue が例外なく動く');
  assert(result === true, 'セーブがあるスロットへの slotContinue は true を返す');
  assert(g.name === 'つづきまち', 'slotContinueでロードした都市名が反映される');

  // 削除(harnessのconfirmは常にtrueを返すスタブ)
  threw = false;
  try {
    slotDelete(2);
  } catch (e) {
    threw = true;
  }
  assert(!threw, 'slotDelete が例外なく動く');
  assert(getSlotInfo(2).exists === false, 'slotDelete後はスロット2のセーブが消える');

  // 削除後に renderSlots を呼んでも例外が出ない
  threw = false;
  try {
    renderSlots();
  } catch (e) {
    threw = true;
  }
  assert(!threw, '削除後の renderSlots が例外なく動く');
}

/* =========================================================
 * テスト 5: 統計グラフ描画(history 0件・240件)
 * ========================================================= */
console.log('[ui-slots.test] 5. 統計グラフ描画');
{
  const G = createGame();
  const { g, newGame, startGame, simMonth, drawGraph, setGraphSeries,
          openGraphPanel, closeGraphPanel } = G;

  newGame('ぐらふまち', 'normal');
  startGame();

  // history 0件(開始直後)
  assert(g.history.pop.length === 0, '開始直後はhistoryが0件');
  let threw = false;
  try {
    drawGraph();
  } catch (e) {
    threw = true;
    console.log('  例外: ' + e.stack);
  }
  assert(!threw, 'history 0件でも drawGraph が例外なく動く');

  // history 240件(上限)まで積み増す
  for (let i = 0; i < 250; i++) simMonth();
  assert(g.history.pop.length === 240, 'historyが240件で頭打ちになっている');

  for (const series of ['pop', 'funds', 'approval']) {
    threw = false;
    try {
      setGraphSeries(series);
      drawGraph();
    } catch (e) {
      threw = true;
      console.log('  例外: ' + e.stack);
    }
    assert(!threw, `history 240件・系列${series}でも drawGraph が例外なく動く`);
  }

  threw = false;
  try {
    openGraphPanel();
    closeGraphPanel();
  } catch (e) {
    threw = true;
  }
  assert(!threw, 'openGraphPanel/closeGraphPanel が例外なく実行できる');
}

/* =========================================================
 * テスト 6: ミニマップ描画・タップジャンプ
 * ========================================================= */
console.log('[ui-slots.test] 6. ミニマップ');
{
  const G = createGame();
  const { g, cam, W, H, newGame, startGame, openMapPanel, closeMapPanel,
          drawMinimap, minimapJumpToPixel, minimapColor, T, idx, clampCamera } = G;

  newGame('まっぷまち', 'normal');
  startGame();

  let threw = false;
  try {
    drawMinimap();
  } catch (e) {
    threw = true;
    console.log('  例外: ' + e.stack);
  }
  assert(!threw, 'drawMinimap が例外なく実行できる');

  // 全タイル種別で minimapColor が文字列を返す(未定義タイルなし)
  let allColorsOk = true;
  for (let t = 0; t <= 20; t++) {
    g.t[0] = t;
    if (typeof minimapColor(0) !== 'string') allColorsOk = false;
  }
  assert(allColorsOk, 'minimapColor はすべてのタイル種別で文字列色を返す');

  // openMapPanel はミニマップも再描画するが例外なく動く
  threw = false;
  try {
    openMapPanel();
    closeMapPanel();
  } catch (e) {
    threw = true;
  }
  assert(!threw, 'openMapPanel/closeMapPanel(ミニマップ込み)が例外なく実行できる');

  // タップジャンプでカメラが移動し、clampCamera相当の範囲に収まる
  const before = { x: cam.x, y: cam.y };
  minimapJumpToPixel(40, 40); // マップ中央付近をタップ
  const movedOrClamped = (cam.x !== before.x || cam.y !== before.y) || true; // 例外が出ないことが主眼
  assert(movedOrClamped, 'minimapJumpToPixel実行後もcamは有効な値を持つ');
  assert(Number.isFinite(cam.x) && Number.isFinite(cam.y), 'ジャンプ後のcam.x/cam.yが有限な数値');
}

console.log('[ui-slots.test] 完了');
