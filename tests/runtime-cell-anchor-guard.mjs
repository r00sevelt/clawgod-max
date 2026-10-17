#!/usr/bin/env bun
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  CELL_SEGMENTER_SHAPE,
  adaptCellRenderer,
  findDeclarationEnd,
  structuralModule,
} from '../src/generic/runtime/post-processor.mjs';

const MARKER = 'stylePool;charPool;native=';
const fixture = kind => readFileSync(new URL(`./fixtures/cell-renderer-2.1.299-win32-${kind}.txt`, import.meta.url), 'utf8');

// 2.1.299 按结构档案适配：真实模块的声明摘要由档案现场计算，因此摘要校验
// 挡不住"第二段锚到了错误堆栈类"，只有结构标记守卫能让它 fail-closed。
const source = fixture('full');
const imports = structuralModule(source).ast.body.filter(node => node.type === 'ImportDeclaration');
const dependencies = new Map([['chunk-szw2h651.js', fixture('ansi')]]);
for (const [kind, local] of [['tabs', 'mIe'], ['styles', 'hps'], ['chalk', 'ROe']]) {
  const imported = imports.find(node => node.specifiers.some(item => item.local.name === local));
  dependencies.set(imported.source.value.split('/').at(-1), fixture(kind));
}
dependencies.set('chunk-78t79vjt.js', fixture('shared'));
dependencies.set('chunk-text.js', fixture('text'));

const structure = structuralModule(source);
assert.notEqual(adaptCellRenderer(source, undefined, dependencies), null, '真实结构档案必须可适配，守卫不能误伤行格类');

// 把行格类内的标记改成空白（AST 与结构摘要不变），标记留在注释里骗过入口检查；
// 此时只有行格类 span 缺少风格池标记，适配必须拒绝。
const rowCell = structure.ast.body.find(node => node.type === 'ClassDeclaration'
  && source.slice(node.start, node.end).includes(MARKER));
assert.ok(rowCell, '夹具必须包含行格类声明');
const declaration = source.slice(rowCell.start, rowCell.end);
const mutated = `${source.slice(0, rowCell.start)}${declaration.replace(MARKER, 'stylePool ;charPool ;native =')}${source.slice(rowCell.end)}\n/*${MARKER}*/\n`;
assert.equal(structuralModule(mutated).digest, structure.digest, '空白改动不能改变结构摘要');
assert.ok(mutated.includes(MARKER), '标记仍出现在源码其他位置');
const mutatedEnd = findDeclarationEnd(mutated, rowCell.start);
assert.ok(mutatedEnd >= rowCell.start);
assert.doesNotMatch(mutated.slice(rowCell.start, mutatedEnd + 1), /stylePool;charPool;native=/);
assert.equal(adaptCellRenderer(mutated, undefined, dependencies), null, '行格类锚点缺少结构标记必须拒绝');

// 冻结 CELL_SEGMENTER_SHAPE 显式路径同样只认结构标记：第二段摘要按源码重算后，
// 无标记的等价声明仍必须被拒绝。
function frozenFixture(valid) {
  const declarations = CELL_SEGMENTER_SHAPE.map(({ header }, index) =>
    index === 1 && valid ? `${header}${MARKER}8;}` : `${header}}`);
  const text = [
    'import{hht,C8}from"./a.js";',
    'import{MNr,LNr,bGt}from"./b.js";',
    'var Ss="\\x1B]8;;";',
    'function useScreen(n){let ge=Dc(oe),ve=U.x2-B;return ge}',
    ...declarations,
  ].join('\n');
  const shape = CELL_SEGMENTER_SHAPE.map(({ header }, index) => {
    const start = text.indexOf(declarations[index]);
    const end = findDeclarationEnd(text, start + header.length - 1);
    return { header, digest: createHash('sha256').update(text.slice(start, end + 1)).digest('hex') };
  });
  return { text, shape };
}

const valid = frozenFixture(true);
assert.notEqual(adaptCellRenderer(valid.text, valid.shape), null, '带结构标记的冻结形态必须可适配');
const broken = frozenFixture(false);
assert.equal(adaptCellRenderer(broken.text, broken.shape), null, '重算第二段摘要后缺少结构标记仍必须拒绝');

console.log('行格类锚点守卫：真实结构档案与冻结形态都只认 stylePool;charPool;native= 标记');
