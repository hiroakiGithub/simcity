// 全テスト実行: node tests/run-tests.js
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.js')).sort();
let failed = 0;
for (const f of files) {
  try {
    const out = execFileSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8' });
    process.stdout.write(out);
    if (out.includes('FAIL')) failed++;
  } catch (e) {
    process.stdout.write(String(e.stdout || ''));
    process.stderr.write(String(e.stderr || e.message));
    failed++;
  }
}
console.log(failed ? `\n=== ${failed}ファイルで失敗 ===` : '\n=== 全テスト成功 ===');
process.exit(failed ? 1 : 0);
