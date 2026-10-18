#!/usr/bin/env bun
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from './fixtures/acorn-8.16.0.cjs';

import {
  adaptCellRenderer,
  adaptCellRendererAst,
} from '../src/generic/runtime/post-processor.mjs';

const MARKER = 'stylePool;charPool;native=';
const CHUNKS = {
  darwin: { shared: 'chunk-9bpwkp0k.js', ansi: 'chunk-h7pqjkwe.js', text: 'chunk-kkq7q3vx.js' },
  linux: { shared: 'chunk-stw100w7.js', ansi: 'chunk-2p6bc6n4.js', text: 'chunk-jnazex8d.js' },
  win32: { shared: 'chunk-cz9nz8bx.js', ansi: 'chunk-zk5r3sp1.js', text: 'chunk-xw69qbhq.js' },
};

const fixture = (platform, kind = '') =>
  readFileSync(new URL(`./fixtures/cell-renderer-2.1.302-${platform}${kind}.txt`, import.meta.url), 'utf8');

function dependencies(platform) {
  const ids = CHUNKS[platform];
  return new Map([
    [ids.shared, fixture(platform, '-shared')],
    [ids.ansi, fixture(platform, '-ansi')],
    [ids.text, fixture(platform, '-text')],
  ]);
}

function parseModule(source) {
  return parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
}

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`PASS ${name}`);
}

check('AST fallback 在 302 三平台真实夹具上成功并且只替换行格类', () => {
  for (const platform of Object.keys(CHUNKS)) {
    const source = fixture(platform);
    const adapted = adaptCellRendererAst(source, dependencies(platform));
    assert.notEqual(adapted, null, `${platform}: fallback 必须成功`);
    assert.match(adapted, /ClawGod: public-Bun replacement/);
    assert.match(adapted, /function writeCell\(/);
    assert.match(adapted, /function paintCells\(/);
    assert.doesNotMatch(adapted, new RegExp(MARKER), `${platform}: 行格类标记必须随 span 一起消失`);
    assert.doesNotMatch(adapted, /new Bun\.ant\.CellSegmenter/);
    assert.match(adapted, /keepColumns\(/, `${platform}: 302 writeLine 的裁剪语义必须保留`);
    const ast = parseModule(adapted);
    const rowClass = ast.body.find(node => node.type === 'ClassDeclaration' && node.id?.name === 'rf');
    assert.ok(rowClass, `${platform}: 行格类必须保留原名`);
    assert.match(adapted.slice(rowClass.start, rowClass.end), /paintCells\(/,
      `${platform}: 行格类必须是公开实现`);
  }
});

check('错误堆栈类诱饵不会被选中', () => {
  const source = fixture('linux');
  const decoy = 'class Gd{constructor(){this.ignoredPackages=[];this.nodeInternals=[]}'
    + 'stack(n){return this.ignoredPackages.includes(n)||this.nodeInternals.includes(n)}}';
  const withDecoy = source.replace('function tabClip(', `${decoy}\nfunction tabClip(`);
  const adapted = adaptCellRendererAst(withDecoy, dependencies('linux'));
  assert.notEqual(adapted, null, '诱饵类不能影响结构定位');
  assert.ok(adapted.includes(decoy), '诱饵类必须原样保留');
  assert.ok(adapted.includes('class rf {'), '真正的行格类必须被替换');
  assert.doesNotMatch(adapted, /class rf\{stylePool/);
});

check('候选歧义一律 fail-closed', () => {
  const source = fixture('linux');
  const row = parseModule(source).body.find(node => node.type === 'ClassDeclaration'
    && source.slice(node.start, node.end).includes(MARKER));
  assert.ok(row, '夹具必须包含行格类');
  const clone = source.slice(row.start, row.end).replace(/^class\s+[\w$]+/, 'class Rf');
  const duplicate = `${source.slice(0, row.end)}\n${clone}${source.slice(row.end)}`;
  assert.equal(adaptCellRendererAst(duplicate, dependencies('linux')), null, '两个行格类候选');

  const twoAnsi = new Map(dependencies('linux'));
  twoAnsi.set('chunk-copy-ansi.js', fixture('linux', '-ansi'));
  const withSecondAnsi = `${source}\nimport"/$bunfs/root/chunk-copy-ansi.js";`;
  assert.equal(adaptCellRendererAst(withSecondAnsi, twoAnsi), null, '两个 ANSI 依赖候选');
});

check('结构守卫与替换后校验失败都 fail-closed', () => {
  const source = fixture('linux');
  const deps = dependencies('linux');
  assert.equal(adaptCellRendererAst(source, deps, { writeLineSource: 'function yC(n,u,f,m,p,g,R){' }), null,
    '替换结果必须重新通过 parse 守卫');
  const unmarked = `${source.replace(MARKER, 'stylePool ;charPool ;native =')}\n/*${MARKER}*/\n`;
  assert.ok(unmarked.includes(MARKER), '标记只留在注释里');
  assert.equal(adaptCellRendererAst(unmarked, deps), null, '行格类本身缺少结构标记必须拒绝');
});

check('冻结档案 fast path 先于 AST fallback', () => {
  const source = fixture('linux');
  const withoutText = new Map([...dependencies('linux')]
    .filter(([name]) => name !== CHUNKS.linux.text));
  assert.notEqual(adaptCellRenderer(source, undefined, withoutText), null,
    '冻结档案不依赖名称校验分块，必须成功');
  assert.equal(adaptCellRendererAst(source, withoutText), null,
    'AST fallback 需要名称校验分块；它能成功就说明冻结档案被绕过');
});

check('已知版本的模块漂移不得降级到 AST fallback', () => {
  const source = fixture('linux');
  const ids = CHUNKS.linux;
  for (const [name, text] of [
    ['共享工厂', fixture('linux', '-shared') + '\n// drift'],
    ['ANSI 分块', fixture('linux', '-ansi') + '\n// drift'],
  ]) {
    const deps = dependencies('linux');
    deps.set(name === '共享工厂' ? ids.shared : ids.ansi, text);
    assert.equal(adaptCellRenderer(source, undefined, deps), null, `${name}漂移必须拒绝`);
  }
});

check('冻结档案全失配后才对新版本启用 AST fallback', () => {
  const source = fixture('linux')
    .replace('function cs(', 'function zz(')
    .replaceAll('=cs(', '=zz(')
    .replace('class rf{', 'class Qq{')
    .replace('function o1(', 'function Zx(')
    .replace('function yC(', 'function Yy(')
    .replace('function cd(', 'function qq(')
    .replaceAll('cd(Re)', 'qq(Re)');
  const adapted = adaptCellRenderer(source, undefined, dependencies('linux'));
  assert.notEqual(adapted, null, '结构未漂移的新版本应进入 fallback');
  assert.match(adapted, /class Qq \{/);
  assert.match(adapted, /function zz\(\)/);
  assert.doesNotMatch(adapted, /class rf\{stylePool/);
  parseModule(adapted);
});

console.log(`${checks} 项行格渲染器 AST fallback 检查通过`);
