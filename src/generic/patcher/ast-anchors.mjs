import { gate } from './runtime-features.mjs';
import { hasGate, literal, member, parsePatchSource, walk } from './semantic.mjs';

// Regex patches that are migrating to structural anchors. Each ID is applied
// through the same semantic batch as semantic.mjs; the regex metadata on the
// descriptor stays in place for the reviewed Task 5 snapshot tests.
export const ANCHOR_PATCH_IDS = Object.freeze([
  'auto-mode-helper-gate',
  'auto-mode-inline-gate',
  'ultrareview-v215',
  'agent-teams',
]);

const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const isFunction = node => FUNCTION_TYPES.has(node?.type);
const isIdentifier = node => node?.type === 'Identifier';
const isCall = node => node?.type === 'CallExpression';
const isString = node => node?.type === 'Literal' && typeof node.value === 'string';
const isTrue = node => literal(node, true) ||
  (node?.type === 'UnaryExpression' && node.operator === '!' && literal(node.argument, 0));
const isFalse = node => literal(node, false) ||
  (node?.type === 'UnaryExpression' && node.operator === '!' && literal(node.argument, 1));
const returnsFalse = node => node?.type === 'IfStatement' &&
  node.consequent?.type === 'ReturnStatement' && isFalse(node.consequent.argument);
const singleReturn = node => node?.body?.type === 'BlockStatement' &&
  node.body.body.length === 1 && node.body.body[0].type === 'ReturnStatement'
  ? node.body.body[0]
  : null;

function containsString(node, value) {
  let found = false;
  walk(node, child => {
    if (isString(child) && child.value === value) found = true;
  });
  return found;
}

function containsStringMatching(node, pattern) {
  let found = false;
  walk(node, child => {
    if (isString(child) && pattern.test(child.value)) found = true;
  });
  return found;
}

function buildParents(tree) {
  const parents = new Map();
  walk(tree, node => {
    for (const value of Object.values(node)) {
      if (value?.type) parents.set(value, node);
      else if (Array.isArray(value)) {
        for (const child of value) if (child?.type) parents.set(child, node);
      }
    }
  });
  return parents;
}

function enclosingFunction(node, parents) {
  let current = parents.get(node);
  while (current) {
    if (isFunction(current)) return current;
    current = parents.get(current);
  }
  return null;
}

// Like walk(), but stop at nested functions so a lookahead cannot leak into a
// different function body.
function walkWithinFunction(root, visit) {
  const pending = [root];
  while (pending.length) {
    const node = pending.pop();
    visit(node);
    for (const value of Object.values(node)) {
      if (value?.type) {
        if (value !== root && isFunction(value)) continue;
        pending.push(value);
      } else if (Array.isArray(value)) {
        for (const child of value) {
          if (child?.type && (child === root || !isFunction(child))) pending.push(child);
        }
      }
    }
  }
}

function edit(result, node, replacement) {
  result.matches.push({ start: node.start, end: node.end, replacement });
}

function isProcessEnvAgentTeams(node) {
  return node?.type === 'MemberExpression' &&
    member(node, 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS') &&
    node.object?.type === 'MemberExpression' &&
    member(node.object, 'env') &&
    node.object.object?.name === 'process';
}

function isAgentTeamsEnvCall(node) {
  return isCall(node) && node.arguments.length === 1 && isProcessEnvAgentTeams(node.arguments[0]);
}

function agentTeamsFirstTest(test) {
  if (test?.type !== 'LogicalExpression' || test.operator !== '&&') return false;
  const envCall = node => node?.type === 'UnaryExpression' && node.operator === '!' &&
    isAgentTeamsEnvCall(node.argument);
  const memberFlag = node => node?.type === 'UnaryExpression' && node.operator === '!' &&
    node.argument?.type === 'MemberExpression';
  const localCall = node => node?.type === 'UnaryExpression' && node.operator === '!' &&
    isCall(node.argument) && node.argument.arguments.length === 0;
  return (envCall(test.left) && localCall(test.right)) ||
    (memberFlag(test.left) && localCall(test.right));
}

function agentTeamsSecondTest(test) {
  return test?.type === 'UnaryExpression' && test.operator === '!' &&
    isCall(test.argument) && test.argument.arguments.length === 2 &&
    literal(test.argument.arguments[0], 'tengu_amber_flint') &&
    isTrue(test.argument.arguments[1]);
}

function autoModeHelperFirstParty(node, parents) {
  const fn = enclosingFunction(node, parents);
  if (!fn) return false;
  let found = false;
  walkWithinFunction(fn, child => {
    if (child.type === 'BinaryExpression' && child.operator === '!==' &&
        isIdentifier(child.left) && literal(child.right, 'firstParty') &&
        child.start > node.end && child.start - node.end <= 300) found = true;
  });
  return found;
}

function autoModeInlineShapeA(test) {
  if (test?.type !== 'LogicalExpression' || test.operator !== '&&') return false;
  let firstParty = false;
  let anthropicAws = false;
  let negatedCall = false;
  walk(test, child => {
    if (child.type === 'BinaryExpression' && child.operator === '!==' &&
        isIdentifier(child.left) && literal(child.right, 'firstParty')) firstParty = true;
    if (child.type === 'BinaryExpression' && child.operator === '!==' &&
        literal(child.right, 'anthropicAws')) anthropicAws = true;
    if (child.type === 'UnaryExpression' && child.operator === '!' && isCall(child.argument)) negatedCall = true;
  });
  return firstParty && (anthropicAws || negatedCall);
}

function autoModeInlineShapeB(test) {
  if (test?.type !== 'LogicalExpression' || test.operator !== '&&') return false;
  if (!isCall(test.left) || test.left.arguments.length !== 0) return false;
  if (test.right?.type !== 'LogicalExpression' || test.right.operator !== '||') return false;
  let model = false;
  let haiku = false;
  walk(test.right, child => {
    if (isString(child) && /^claude-(?:opus|sonnet|haiku)-/.test(child.value)) model = true;
    if (isCall(child) && member(child.callee, 'includes') &&
        child.arguments.length === 1 && literal(child.arguments[0], 'haiku')) haiku = true;
  });
  return model || haiku;
}

function isUltrareviewGetter(arg, configName) {
  return isCall(arg) && arg.arguments.length === 2 &&
    isIdentifier(arg.arguments[0]) && arg.arguments[0].name === configName &&
    literal(arg.arguments[1], null);
}

function getterCallName(node) {
  const expression = node?.type === 'ChainExpression' ? node.expression : node;
  if (expression?.type !== 'MemberExpression' || !member(expression, 'enabled')) return null;
  const object = expression.object;
  if (!isCall(object) || object.arguments.length !== 0 || !isIdentifier(object.callee)) return null;
  return object.callee.name;
}

function isUltrareviewGateArg(arg, getterName) {
  if (arg?.type !== 'LogicalExpression' || arg.operator !== '&&') return false;
  const getterCheck = node => node?.type === 'BinaryExpression' && node.operator === '===' &&
    isTrue(node.right) && getterCallName(node.left) === getterName;
  const callCheck = node => isCall(node) && node.arguments.length === 0;
  const notCallCheck = node => node?.type === 'UnaryExpression' && node.operator === '!' &&
    isCall(node.argument) && node.argument.arguments.length === 0;
  // `a && b && c` is left-associative: ((a && b) && c). Accept the explicit
  // right-grouped form too in case a future bundle adds parentheses.
  if (getterCheck(arg.left) && arg.right?.type === 'LogicalExpression' &&
      arg.right.operator === '&&' && callCheck(arg.right.left) && notCallCheck(arg.right.right)) {
    return true;
  }
  return arg.left?.type === 'LogicalExpression' && arg.left.operator === '&&' &&
    getterCheck(arg.left.left) && callCheck(arg.left.right) && notCallCheck(arg.right);
}

function containsGetterCall(arg, getterName) {
  if (!arg) return false;
  let found = false;
  walk(arg, child => {
    if (isCall(child) && isIdentifier(child.callee) && child.callee.name === getterName &&
        child.arguments.length === 0) found = true;
  });
  return found;
}

function initResults(ids) {
  return Object.fromEntries(ids.map(id => [
    id,
    { matches: [], present: false, patched: false, ambiguous: false },
  ]));
}

export function scanAstAnchors(code, { tree = parsePatchSource(code), ids = ANCHOR_PATCH_IDS } = {}) {
  const selected = new Set(ids);
  const active = ANCHOR_PATCH_IDS.filter(id => selected.has(id));
  const results = initResults(active);
  const has = id => selected.has(id);
  const parents = buildParents(tree);
  const context = {
    results,
    getters: [],
    configName: null,
    saw: {},
  };

  if (has('ultrareview-v215')) for (const node of tree.body) {
    if (node.type === 'VariableDeclaration') {
      for (const declaration of node.declarations) {
        if (isIdentifier(declaration.id) && literal(declaration.init, 'tengu_review_bughunter_config')) {
          context.configName = declaration.id.name;
        }
      }
    }
  }
  if (context.configName) {
    for (const node of tree.body) {
      if (node.type !== 'FunctionDeclaration' || !isIdentifier(node.id)) continue;
      const ret = singleReturn(node);
      if (ret && isUltrareviewGetter(ret.argument, context.configName)) {
        context.getters.push({ node, name: node.id.name });
      }
    }
  }

  walk(tree, node => {
    // auto-mode helper gate: if(!provider(x))return!1; ... firstParty context
    if (has('auto-mode-helper-gate') && returnsFalse(node)) {
      const id = 'auto-mode-helper-gate';
      const result = results[id];
      if (hasGate(node.test, id)) {
        result.patched = true;
      } else if (autoModeHelperFirstParty(node, parents)) {
        context.saw[id] = true;
        if (node.test?.type === 'UnaryExpression' && node.test.operator === '!' &&
            isCall(node.test.argument) && node.test.argument.arguments.length === 1 &&
            isIdentifier(node.test.argument.arguments[0])) {
          edit(result, node.test, `${gate(id)}===!1&&${code.slice(node.test.start, node.test.end)}`);
        }
      }
    }

    // auto-mode inline gate: firstParty/anthropicAws or model-id branches
    if (has('auto-mode-inline-gate') && returnsFalse(node)) {
      const id = 'auto-mode-inline-gate';
      const result = results[id];
      if (hasGate(node.test, id)) {
        result.patched = true;
      } else if (autoModeInlineShapeA(node.test) || autoModeInlineShapeB(node.test)) {
        context.saw[id] = true;
        edit(result, node.test, `${gate(id)}===!1&&${code.slice(node.test.start, node.test.end)}`);
      } else if (containsString(node.test, 'firstParty') ||
          containsStringMatching(node.test, /^claude-(?:opus|sonnet|haiku)-/) ||
          containsString(node.test, 'haiku')) {
        context.saw[id] = true;
      }
    }

    // agent teams: function f(){if(!env&&!local())return!1;if(!flag("tengu_amber_flint",!0))return!1;return!0}
    if (has('agent-teams') && node.type === 'FunctionDeclaration' && node.params.length === 0 &&
        !node.async && !node.generator) {
      if (hasGate(node, 'agent-teams')) {
        results['agent-teams'].patched = true;
      } else {
        const body = node.body;
        if (body?.type === 'BlockStatement') {
          const [first, second, third] = body.body;
          const flagMarker = second?.test
            ? containsString(second.test, 'tengu_amber_flint') : false;
          const envMarker = first?.test
            ? containsString(first.test, 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS') : false;
          if (flagMarker && envMarker) context.saw['agent-teams'] = true;
          if (body.body.length === 3 && returnsFalse(first) && returnsFalse(second) &&
              third?.type === 'ReturnStatement' && isTrue(third.argument) &&
              agentTeamsFirstTest(first.test) && agentTeamsSecondTest(second.test)) {
            context.saw['agent-teams'] = true;
            edit(results['agent-teams'], body, `{if(${gate('agent-teams')})return!0;${code.slice(body.start + 1, body.end)}`);
          }
        }
      }
    }

    // ultrareview v2.1.215+: bind the getter by its config literal instead of
    // the compressed `ulu` sentinel.
    if (has('ultrareview-v215') && node.type === 'FunctionDeclaration' && context.configName && isIdentifier(node.id)) {
      const id = 'ultrareview-v215';
      const result = results[id];
      const ret = singleReturn(node);
      if (ret) {
        for (const getter of context.getters) {
          if (node.start <= getter.node.end || node.start - getter.node.end > 1500) continue;
          if (isUltrareviewGateArg(ret.argument, getter.name)) {
            context.saw[id] = true;
            edit(result, ret.argument, `${gate(id)}?!0:(${code.slice(ret.argument.start, ret.argument.end)})`);
          } else if (containsGetterCall(ret.argument, getter.name)) {
            context.saw[id] = true;
          }
        }
      }
      if (hasGate(node, id) && context.getters.some(getter =>
        node.start > getter.node.end && node.start - getter.node.end <= 1500)) {
        result.patched = true;
      }
    }
  });

  if (has('agent-teams')) {
    const result = context.results['agent-teams'];
    if (!result.patched && context.saw['agent-teams'] && result.matches.length === 0) result.present = true;
  }
  for (const id of ['auto-mode-helper-gate', 'auto-mode-inline-gate']) {
    if (!has(id)) continue;
    const result = context.results[id];
    if (!result.patched && context.saw[id] && result.matches.length === 0) result.present = true;
  }
  if (has('ultrareview-v215')) {
    const ultrareview = context.results['ultrareview-v215'];
    if (!ultrareview.patched && context.configName && ultrareview.matches.length === 0) ultrareview.present = true;
  }

  return results;
}
