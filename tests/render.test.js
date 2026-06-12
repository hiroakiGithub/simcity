// 描画スモークテスト:厳密な2Dコンテキストモックで全スプライト生成とdraw()完走を確認
'use strict';
const fs = require('fs');
const path = require('path');
const { assert } = require('./harness');

console.log('[render.test] 描画');

// 使用許可するCanvas APIのみ実装(未実装の呼び出しは例外)
const ALLOWED_METHODS = [
  'fillRect', 'strokeRect', 'clearRect', 'fillText', 'beginPath', 'closePath',
  'moveTo', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo', 'arc', 'ellipse',
  'fill', 'stroke', 'save', 'restore', 'translate', 'rotate', 'scale',
  'drawImage', 'setTransform', 'clip', 'rect',
];
const ALLOWED_PROPS = [
  'fillStyle', 'strokeStyle', 'lineWidth', 'font', 'textAlign', 'textBaseline',
  'globalAlpha', 'lineCap', 'lineJoin', 'canvas',
];
function makeStrictCtx(owner) {
  const ctx = { canvas: owner };
  for (const m of ALLOWED_METHODS) {
    ctx[m] = (...args) => {
      for (const a of args) {
        if (typeof a === 'number' && !Number.isFinite(a)) {
          throw new Error(`${m}() に不正な数値: [${args.join(',')}]`);
        }
      }
    };
  }
  return new Proxy(ctx, {
    get(t, p) {
      if (p in t || typeof p !== 'string' || ALLOWED_PROPS.includes(p)) return t[p];
      throw new Error('未実装のcanvas API: ' + p);
    },
    set(t, p, v) {
      if (typeof p === 'string' && !ALLOWED_PROPS.includes(p) && !ALLOWED_METHODS.includes(p)) {
        throw new Error('未実装のcanvasプロパティ: ' + p);
      }
      t[p] = v;
      return true;
    },
  });
}
function makeCanvas() {
  const cvs = { width: 0, height: 0, clientWidth: 400, clientHeight: 700 };
  cvs.getContext = () => makeStrictCtx(cvs);
  cvs.addEventListener = () => {};
  cvs.setPointerCapture = () => {};
  return cvs;
}
function makeEl(id) {
  return {
    id, style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    dataset: {}, textContent: '', innerHTML: '', value: '', checked: false, disabled: false,
    addEventListener() {}, appendChild() {}, remove() {},
    querySelectorAll() { return []; },
  };
}
const elements = { game: makeCanvas() };
global.document = {
  getElementById(id) { return elements[id] || (elements[id] = makeEl(id)); },
  createElement(tag) { return tag === 'canvas' ? makeCanvas() : makeEl(tag); },
  querySelectorAll() { return []; },
  addEventListener() {},
  visibilityState: 'visible',
};
global.window = { devicePixelRatio: 2, addEventListener() {} };
const store = {};
global.localStorage = {
  getItem(k) { return k in store ? store[k] : null; },
  setItem(k, v) { store[k] = String(v); },
  removeItem(k) { delete store[k]; },
};
let rafCount = 0;
global.requestAnimationFrame = () => ++rafCount;
global.confirm = () => true;
global.setInterval = () => 0;
global.clearInterval = () => {};

const src = fs.readFileSync(path.join(__dirname, '..', 'game.js'), 'utf8');
// eslint-disable-next-line no-eval
eval(src + `
;globalThis.__r = { g, T, W, H, BIG: typeof BIG !== 'undefined' ? BIG : {}, MAX_LEVEL,
  idx, newGame, startGame, tileSprite, draw, cam, connMask,
  place:(tool,x,y)=>{currentTool=tool;placeTool(x,y);} };
`);
const { g, T, W, H, BIG, MAX_LEVEL, idx, newGame, startGame, tileSprite, draw, cam } = globalThis.__r;

newGame();
startGame();

function check(fn, label) {
  try { fn(); console.log('  PASS: ' + label); }
  catch (e) { assert(false, label + ' → ' + e.message); }
}

check(() => {
  for (const ts of [8, 16, 24, 48]) {
    for (const [name, type] of Object.entries(T)) {
      const size = BIG[type] || 1;
      const masked = type === T.ROAD || type === T.WIRE || (T.RAIL !== undefined && type === T.RAIL);
      const maxLvl = masked ? 1 : MAX_LEVEL;
      const maxVar = masked ? 15 : 0;
      for (let lvl = 0; lvl <= maxLvl; lvl++) {
        for (let v = 0; v <= maxVar; v++) {
          const sp = tileSprite(type, lvl, v, ts);
          if (!sp || sp.width !== ts * size || sp.height !== ts * (size + 1)) {
            throw new Error(`${name} lvl${lvl} var${v} ts${ts}: サイズ ${sp && sp.width}x${sp && sp.height}`);
          }
        }
      }
    }
  }
}, '全スプライト生成(種別×レベル×接続×ズーム)');

check(() => {
  const before = rafCount;
  cam.x = 0; cam.y = 0; cam.zoom = 1.5;
  draw();
  if (rafCount !== before + 1) throw new Error('requestAnimationFrameが呼ばれていない');
}, 'draw()が例外なく完走する');

check(() => {
  cam.zoom = 0.5; draw();
  cam.zoom = 4; cam.x = W * 64; cam.y = H * 64; draw();
}, '極端なズーム・カメラ位置でも完走する');
