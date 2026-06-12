// テストハーネス:DOM/canvasをスタブして game.js をNode上で実行する
'use strict';
const fs = require('fs');
const path = require('path');

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    console.log('  FAIL: ' + msg); // 検知のためstdoutへ出す
    failures++;
    process.exitCode = 1;
  } else {
    console.log('  PASS: ' + msg);
  }
}
function getFailures() { return failures; }

function makeCtxStub(owner) {
  const stub = new Proxy({ canvas: owner }, {
    get(t, p) {
      if (p === 'canvas') return t.canvas;
      return () => stub;
    },
    set() { return true; },
  });
  return stub;
}

function makeEl(id) {
  const el = {
    id, style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    dataset: {}, textContent: '', innerHTML: '', value: '', checked: false,
    disabled: false,
    addEventListener() {}, appendChild() {}, setPointerCapture() {}, remove() {},
    querySelectorAll() { return []; },
    clientWidth: 400, clientHeight: 700, width: 400, height: 700,
  };
  el.getContext = () => makeCtxStub(el);
  return el;
}

// game.js のスコープ内からテストへ公開する名前(存在しないものは無視される)
const EXPOSE = [
  'g', 'T', 'W', 'H', 'BIG', 'MAX_LEVEL', 'idx', 'inB', 'clamp',
  'genMap', 'newGame', 'startGame', 'simMonth', 'placeTool', 'placeLine',
  'computePower', 'computeMaps', 'calcStats', 'zoneGrowth', 'fireStep', 'economy',
  'saveGame', 'loadGame', 'hasSave', 'setSpeed', 'updateHUD',
  'tileSprite', 'draw', 'cam', 'connMask', 'roadNear', 'pollution', 'landValue',
  'fireCov', 'policeCov', 'traffic', 'crime', 'updateTraffic', 'updateCrime',
  'actorsStep', 'triggerDisaster', 'computeEvaluation', 'SAVE_KEY',
];

function createGame(opts = {}) {
  const elements = {};
  const gameCanvas = makeEl('game');
  elements.game = gameCanvas;

  global.document = {
    getElementById(id) { return elements[id] || (elements[id] = makeEl(id)); },
    createElement(tag) { return makeEl(tag); },
    querySelectorAll() { return []; },
    addEventListener() {},
    visibilityState: 'visible',
  };
  const store = opts.store || {};
  global.window = { devicePixelRatio: 1, addEventListener() {} };
  global.localStorage = {
    getItem(k) { return k in store ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; },
  };
  global.requestAnimationFrame = () => 0;
  global.confirm = () => true;
  global.setInterval = () => 0;
  global.clearInterval = () => {};
  global.setTimeout = global.setTimeout || (() => 0);

  const src = fs.readFileSync(path.join(__dirname, '..', 'game.js'), 'utf8');
  const exporter =
    ';globalThis.__exp = {};' +
    EXPOSE.map((n) =>
      `try{globalThis.__exp[${JSON.stringify(n)}]=eval(${JSON.stringify(n)})}catch(e){}`
    ).join(';') +
    // ツール切替+建設のヘルパー(currentToolはスコープ内変数のため)
    ';globalThis.__exp.place=(tool,x,y)=>{currentTool=tool;placeTool(x,y);}' +
    ';globalThis.__exp.setTool=(tool)=>{currentTool=tool;}';
  // eslint-disable-next-line no-eval
  eval(src + exporter);
  const api = globalThis.__exp;
  api.store = store;
  return api;
}

module.exports = { createGame, assert, getFailures, makeEl, makeCtxStub };
