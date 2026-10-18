// Batch-2 Agents structural anchor:
// - agents-session-metadata-ast (agents order 6, regex patch)
// The dispatcher calls every visitor once per AST node. Keep matchers
// read-only: return edits through context.edit(id, node, replacement).
import { literal, member, walk } from '../semantic.mjs';

const ID = 'agents-session-metadata-ast';
const MARKER = '/*__clawgod_agents_session_id__*/';
const DEBUG_FLAGS = [
  '=--debug',
  '=-d',
  '=--debug-to-stderr',
  '=-d2e',
  's--debug=',
  's--debug-file=',
];

const isIdentifier = node => node?.type === 'Identifier';
const isString = (node, value) => literal(node, value) && typeof value === 'string';
const isTrue = node => literal(node, true) ||
  (node?.type === 'UnaryExpression' && node.operator === '!' && literal(node.argument, 0));
const isFalse = node => literal(node, false) ||
  (node?.type === 'UnaryExpression' && node.operator === '!' && literal(node.argument, 1));
const isLengthOf = (node, name) => member(node, 'length') &&
  node.object?.type === 'Identifier' && node.object.name === name;

function isElementOf(node, args, index) {
  return node?.type === 'MemberExpression' && node.computed &&
    node.object?.type === 'Identifier' && node.object.name === args &&
    isIdentifier(node.property) && node.property.name === index;
}

function isIndexPlusOne(node, index) {
  return node?.type === 'BinaryExpression' && node.operator === '+' &&
    isIdentifier(node.left) && node.left.name === index && literal(node.right, 1);
}

function checkSignature(node, argument) {
  if (node?.type === 'BinaryExpression' && node.operator === '===' &&
      isIdentifier(node.left) && node.left.name === argument &&
      node.right?.type === 'Literal' && typeof node.right.value === 'string') {
    return `=${node.right.value}`;
  }
  if (node?.type === 'CallExpression' && member(node.callee, 'startsWith') &&
      node.callee.object?.type === 'Identifier' && node.callee.object.name === argument &&
      node.arguments.length === 1 && node.arguments[0]?.type === 'Literal' &&
      typeof node.arguments[0].value === 'string') {
    return `s${node.arguments[0].value}`;
  }
  return null;
}

function flattenOr(node, out = []) {
  if (node?.type === 'LogicalExpression' && node.operator === '||') {
    flattenOr(node.left, out);
    flattenOr(node.right, out);
  } else out.push(node);
  return out;
}

// `if(<debug flags>)continue;` – the debug flag list is a set match so a
// reordered upstream list still anchors, while an added/removed flag is drift.
function isDebugContinue(statement, argument) {
  if (statement?.type !== 'IfStatement' || statement.consequent?.type !== 'ContinueStatement') {
    return false;
  }
  const checks = flattenOr(statement.test).map(node => checkSignature(node, argument));
  if (checks.length !== DEBUG_FLAGS.length || checks.includes(null)) return false;
  const seen = new Set(checks);
  return seen.size === DEBUG_FLAGS.length && DEBUG_FLAGS.every(flag => seen.has(flag));
}

// `if(<argument>===<flag>&&<index>+1<<args>.length){<index>++;continue}`
function isSkipPair(statement, argument, index, args, flag) {
  if (statement?.type !== 'IfStatement') return false;
  const test = statement.test;
  if (test?.type !== 'LogicalExpression' || test.operator !== '&&') return false;
  if (test.left?.type !== 'BinaryExpression' || test.left.operator !== '===' ||
      !isIdentifier(test.left.left) || test.left.left.name !== argument ||
      !isString(test.left.right, flag)) return false;
  if (test.right?.type !== 'BinaryExpression' || test.right.operator !== '<' ||
      !isIndexPlusOne(test.right.left, index) || !isLengthOf(test.right.right, args)) return false;
  const body = statement.consequent;
  if (body?.type !== 'BlockStatement' || body.body.length !== 2) return false;
  const [increment, next] = body.body;
  return increment.type === 'ExpressionStatement' &&
    increment.expression?.type === 'UpdateExpression' && increment.expression.operator === '++' &&
    !increment.expression.prefix && isIdentifier(increment.expression.argument) &&
    increment.expression.argument.name === index &&
    next.type === 'ContinueStatement';
}

function containsString(root, value) {
  let found = false;
  walk(root, node => {
    if (isString(node, value)) found = true;
  });
  return found;
}

// Validate the outer parser loop: function f(args){for(let i=0;i<args.length;i++)
// {let arg=args[i];...return!1}return!0}. Returns null when this is not that loop.
function readLoop(fn) {
  if (fn.type !== 'FunctionDeclaration' || !isIdentifier(fn.id) ||
      fn.async || fn.generator) return null;
  if (fn.params.length !== 1 || !isIdentifier(fn.params[0])) return null;
  const args = fn.params[0].name;
  const statements = fn.body?.type === 'BlockStatement' ? fn.body.body : null;
  if (!statements || statements.length !== 2) return null;
  const [loop, tail] = statements;
  if (loop.type !== 'ForStatement' || tail.type !== 'ReturnStatement' || !isTrue(tail.argument)) {
    return null;
  }
  const init = loop.init;
  if (init?.type !== 'VariableDeclaration' || init.kind !== 'let' ||
      init.declarations.length !== 1) return null;
  const declaration = init.declarations[0];
  if (!isIdentifier(declaration.id) || !literal(declaration.init, 0)) return null;
  const index = declaration.id.name;
  const test = loop.test;
  if (test?.type !== 'BinaryExpression' || test.operator !== '<' ||
      !isIdentifier(test.left) || test.left.name !== index ||
      !isLengthOf(test.right, args)) return null;
  const update = loop.update;
  if (update?.type !== 'UpdateExpression' || update.operator !== '++' || update.prefix ||
      !isIdentifier(update.argument) || update.argument.name !== index) return null;
  if (loop.body?.type !== 'BlockStatement') return null;
  const body = loop.body.body;
  if (body.length < 3) return null;
  const binding = body[0];
  if (binding.type !== 'VariableDeclaration' || binding.kind !== 'let' ||
      binding.declarations.length !== 1) return null;
  const element = binding.declarations[0];
  if (!isIdentifier(element.id) || !isElementOf(element.init, args, index)) return null;
  const last = body[body.length - 1];
  if (last.type !== 'ReturnStatement' || !isFalse(last.argument)) return null;
  return { args, index, argument: element.id.name, middle: body.slice(1, -1) };
}

function classify(fn) {
  const loop = readLoop(fn);
  if (!loop) return null;
  const { args, index, argument, middle } = loop;
  if (middle.length === 2 &&
      isDebugContinue(middle[0], argument) &&
      isSkipPair(middle[1], argument, index, args, '--debug-file')) {
    return { kind: 'match', insertAt: middle[1].end, argument, index, args };
  }
  if (middle.length === 3 &&
      isDebugContinue(middle[0], argument) &&
      isSkipPair(middle[1], argument, index, args, '--debug-file') &&
      isSkipPair(middle[2], argument, index, args, '--session-id')) {
    return { kind: 'patched' };
  }
  // Only flag drift when the loop still carries the --debug-file marker, so an
  // unrelated argument parser is skipped instead of reported as stale.
  return middle.some(statement => containsString(statement, '--debug-file'))
    ? { kind: 'drift' }
    : null;
}

export const visitors = [{
  id: ID,
  visit(node, ctx) {
    if (node.type !== 'FunctionDeclaration') return;
    const shape = classify(node);
    if (!shape) return;
    if (shape.kind === 'patched') {
      ctx.patched(ID);
      return;
    }
    if (shape.kind === 'drift') {
      if (!ctx.code.includes(MARKER)) ctx.present(ID);
      return;
    }
    // Insert after the --debug-file pair; the canonical bundle has no bytes
    // between that branch and `return!1`, so this matches the replacer exactly.
    ctx.edit(ID, { start: shape.insertAt, end: shape.insertAt },
      `if(${shape.argument}==="--session-id"${MARKER}&&${shape.index}+1<${shape.args}.length)` +
      `{${shape.index}++;continue}`);
  },
  finalize(ctx) {
    // Descriptor is `unique`: two parser loops would make the edit ambiguous.
    if (ctx.results[ID].matches.length > 1) ctx.ambiguous(ID);
    if (ctx.code.includes(MARKER)) ctx.patched(ID);
  },
}];
