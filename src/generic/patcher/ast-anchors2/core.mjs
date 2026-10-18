// Batch-2 core structural anchors. Assigned matcher IDs:
// - context-limit-ast (core order 61, custom patch)
// - terminal-reply-ast (core order 90, regex patch)
// The dispatcher calls every visitor once per AST node. Keep matchers
// read-only: return edits through context.edit(id, node, replacement).
import { literal, member } from '../semantic.mjs';
import { terminalReplyDelay } from '../terminal-reply-delay.mjs';

const CONTEXT_LIMIT_ID = 'context-limit-ast';
const TERMINAL_REPLY_ID = 'terminal-reply-ast';

// Byte-identical strings shared with core.mjs's order 61 custom patch.
const ENV_EXPR = '(+process.env.CLAUDE_CODE_CONTEXT_LIMIT||+process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS||200000)';
const REFRESH_MARKER = 'globalThis.__clawgod_context_limit_refresh_v1__=';
const REFRESH_CALL = ',globalThis.__clawgod_context_limit_refresh_v1__?.()';
const TERMINAL_MARKER = '/*__clawgod_terminal_reply_fragments__*/';

const STATE_KEY = '__clawgodAstAnchors2Core';
const SIMPLE_NAME = /^[A-Za-z0-9_$]+$/;

const stateFor = ctx => ctx[STATE_KEY] ??= {
  contextLimit: { declarations: [], comparisons: [], envStatements: [], esm: false, marker: false, patchedComparison: false },
  terminal: { sawField: false, matched: false },
};

const isSimpleIdentifier = node => node?.type === 'Identifier' && SIMPLE_NAME.test(node.name);
const numeric = node => node?.type === 'Literal' && typeof node.value === 'number' ? node.value : null;
const thisMember = (node, name) => member(node, name) && node.object?.type === 'ThisExpression';

function thisMemberChain(node, names) {
  let current = node;
  for (let i = names.length - 1; i >= 0; i--) {
    if (!member(current, names[i])) return false;
    current = current.object;
  }
  return current?.type === 'ThisExpression';
}

const isEnvOperand = (node, name) => node?.type === 'UnaryExpression' && node.operator === '+' &&
  member(node.argument, name) && member(node.argument.object, 'env') &&
  node.argument.object.object?.type === 'Identifier' && node.argument.object.object.name === 'process';

// (+process.env.CLAUDE_CODE_CONTEXT_LIMIT||+process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS||200000)
function isContextLimitEnvExpr(node) {
  if (node?.type !== 'LogicalExpression' || node.operator !== '||') return false;
  const left = node.left;
  return left?.type === 'LogicalExpression' && left.operator === '||' &&
    isEnvOperand(left.left, 'CLAUDE_CODE_CONTEXT_LIMIT') &&
    isEnvOperand(left.right, 'CLAUDE_CODE_MAX_CONTEXT_TOKENS') &&
    literal(node.right, 200000);
}

// var A=200000,B=200000,C=32000,D=128000[,E=1e6]; or the env-driven form.
function classifyContextDeclaration(node) {
  if (node?.type !== 'VariableDeclaration' || node.kind !== 'var') return null;
  const declarations = node.declarations;
  if (declarations.length !== 4 && declarations.length !== 5) return null;
  const names = declarations.map(declaration => isSimpleIdentifier(declaration.id) ? declaration.id.name : null);
  if (names.some(name => !name)) return null;
  if (numeric(declarations[2].init) !== 32000 || numeric(declarations[3].init) !== 128000) return null;
  if (declarations.length === 5 && numeric(declarations[4].init) !== 1000000) return null;
  const dual = literal(declarations[0].init, 200000) && literal(declarations[1].init, 200000);
  const already = isContextLimitEnvExpr(declarations[0].init) && isContextLimitEnvExpr(declarations[1].init);
  return { start: node.start, end: declarations[declarations.length - 1].end, names, dual, already, near: !dual && !already };
}

// The custom patch's regex requires the declarator list to be followed by `;`.
function declarationTerminated(code, declaration) {
  return /^\s*;/.test(code.slice(declaration.end, declaration.end + 16));
}

// Pathological shapes that still look like the context-default constants make
// the patch stale instead of silently skipped.
function looksLikeContextDefaults(node) {
  if (node?.type !== 'VariableDeclaration' || node.kind !== 'var') return false;
  const declarations = node.declarations;
  if (declarations.length < 4 || declarations.length > 6) return false;
  const firstTwo = declarations.slice(0, 2).some(declaration =>
    literal(declaration.init, 200000) || isContextLimitEnvExpr(declaration.init));
  const values = declarations.map(declaration => numeric(declaration.init));
  return firstTwo && values.includes(32000) && values.includes(128000);
}

const isFalseLiteral = node => node?.type === 'UnaryExpression' && node.operator === '!' && literal(node.argument, 1);

// return X?Y(X)>200000:!1
function comparisonMatch(node) {
  if (node?.type !== 'ReturnStatement' || node.argument?.type !== 'ConditionalExpression') return null;
  const conditional = node.argument;
  if (!isSimpleIdentifier(conditional.test) || !isFalseLiteral(conditional.alternate)) return null;
  const comparison = conditional.consequent;
  if (comparison?.type !== 'BinaryExpression' || comparison.operator !== '>' || !literal(comparison.right, 200000)) return null;
  const call = comparison.left;
  if (call?.type !== 'CallExpression' || call.arguments.length !== 1 ||
      !isSimpleIdentifier(call.callee) || !isSimpleIdentifier(call.arguments[0])) return null;
  if (call.arguments[0].name !== conditional.test.name) return null;
  return { comparison, callee: call.callee.name, name: conditional.test.name };
}

function isPatchedComparison(node) {
  return node?.argument?.consequent?.type === 'BinaryExpression' &&
    node.argument.consequent.operator === '>' && isContextLimitEnvExpr(node.argument.consequent.right);
}

const isEnvAssignCall = node => node?.type === 'CallExpression' &&
  member(node.callee, 'assign') &&
  node.callee.object?.type === 'Identifier' && node.callee.object.name === 'Object' &&
  node.arguments.length >= 2 &&
  member(node.arguments[0], 'env') &&
  node.arguments[0].object?.type === 'Identifier' && node.arguments[0].object.name === 'process';

// Class field `flushIncomplete=()=>{...}` with the four-statement DA1 loop.
function terminalReplyShape(node) {
  if (node?.type !== 'PropertyDefinition' || node.computed || node.static === true) return null;
  if (node.key?.type !== 'Identifier' || node.key.name !== 'flushIncomplete') return null;
  const fn = node.value;
  if (fn?.type !== 'ArrowFunctionExpression' || fn.async || fn.generator || fn.params.length !== 0) return null;
  const body = fn.body;
  if (body?.type !== 'BlockStatement' || body.body.length !== 4) return null;
  const [guardIf, bufferIf, nowDeclaration, applyStatement] = body.body;

  if (guardIf?.type !== 'IfStatement' || guardIf.consequent?.type !== 'ReturnStatement' || guardIf.consequent.argument !== null) return null;
  if (guardIf.test?.type !== 'SequenceExpression' || guardIf.test.expressions.length !== 2) return null;
  const [reset, guard] = guardIf.test.expressions;
  if (reset?.type !== 'AssignmentExpression' || reset.operator !== '=' ||
      !thisMember(reset.left, 'incompleteEscapeTimer') || !literal(reset.right, null)) return null;
  if (guard?.type !== 'UnaryExpression' || guard.operator !== '!' || guard.argument?.type !== 'CallExpression') return null;
  if (!isSimpleIdentifier(guard.argument.callee) || guard.argument.arguments.length !== 1 ||
      !thisMember(guard.argument.arguments[0], 'keyReader')) return null;

  if (bufferIf?.type !== 'IfStatement' || bufferIf.test?.type !== 'BinaryExpression' ||
      bufferIf.test.operator !== '>' || !thisMemberChain(bufferIf.test.left, ['props', 'stdin', 'readableLength']) ||
      !literal(bufferIf.test.right, 0)) return null;
  const bufferBody = bufferIf.consequent;
  if (bufferBody?.type !== 'BlockStatement' || bufferBody.body.length !== 2) return null;
  const [timerStatement, timerReturn] = bufferBody.body;
  if (timerStatement?.type !== 'ExpressionStatement' || timerStatement.expression?.type !== 'AssignmentExpression') return null;
  const timerAssignment = timerStatement.expression;
  if (timerAssignment.operator !== '=' || !thisMember(timerAssignment.left, 'incompleteEscapeTimer')) return null;
  const timerCall = timerAssignment.right;
  if (timerCall?.type !== 'CallExpression' || timerCall.callee?.type !== 'Identifier' ||
      timerCall.callee.name !== 'setTimeout' || timerCall.arguments.length !== 2) return null;
  if (!thisMember(timerCall.arguments[0], 'flushIncomplete') || !isSimpleIdentifier(timerCall.arguments[1])) return null;
  if (timerReturn?.type !== 'ReturnStatement' || timerReturn.argument !== null) return null;

  if (nowDeclaration?.type !== 'VariableDeclaration' || nowDeclaration.kind !== 'let' ||
      nowDeclaration.declarations.length !== 1) return null;
  const now = nowDeclaration.declarations[0];
  if (!isSimpleIdentifier(now.id) || now.init?.type !== 'CallExpression' || now.init.arguments.length !== 0) return null;
  if (!member(now.init.callee, 'now') || now.init.callee.object?.type !== 'Identifier' ||
      now.init.callee.object.name !== 'performance') return null;

  if (applyStatement?.type !== 'ExpressionStatement' || applyStatement.expression?.type !== 'CallExpression') return null;
  const apply = applyStatement.expression;
  if (!thisMember(apply.callee, 'applyKeysRead') || apply.arguments.length !== 2) return null;
  if (!isSimpleIdentifier(apply.arguments[1]) || apply.arguments[1].name !== now.id.name) return null;
  const flush = apply.arguments[0];
  if (flush?.type !== 'CallExpression' || !isSimpleIdentifier(flush.callee) || flush.arguments.length !== 2) return null;
  if (!thisMember(flush.arguments[0], 'keyReader') || !isSimpleIdentifier(flush.arguments[1]) ||
      flush.arguments[1].name !== now.id.name) return null;

  return { now: now.id.name, end: nowDeclaration.end };
}

export const visitors = [
  {
    id: CONTEXT_LIMIT_ID,
    visit(node, ctx) {
      const state = stateFor(ctx).contextLimit;
      if (node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' ||
          node.type === 'ExportDefaultDeclaration' || node.type === 'ExportAllDeclaration') {
        state.esm = true;
        return;
      }
      if (node.type === 'VariableDeclaration') {
        if (node.kind !== 'var') return;
        const declaration = classifyContextDeclaration(node);
        if (!declaration) {
          if (looksLikeContextDefaults(node)) state.marker = true;
          return;
        }
        if (!declarationTerminated(ctx.code, declaration)) {
          state.marker = true;
          return;
        }
        state.declarations.push(declaration);
        return;
      }
      if (node.type === 'ReturnStatement') {
        const match = comparisonMatch(node);
        if (match) state.comparisons.push(match);
        else if (isPatchedComparison(node)) state.patchedComparison = true;
        return;
      }
      if (node.type !== 'ExpressionStatement') return;
      const expression = node.expression;
      const calls = expression?.type === 'SequenceExpression'
        ? expression.expressions.filter(isEnvAssignCall)
        : isEnvAssignCall(expression) ? [expression] : [];
      if (calls.length) state.envStatements.push({ statement: node, calls });
    },
    finalize(ctx) {
      const state = stateFor(ctx).contextLimit;
      const code = ctx.code;
      const declarations = [...state.declarations].sort((left, right) => left.start - right.start);
      const declaration = declarations.find(candidate => candidate.dual || candidate.already) ?? declarations[0] ?? null;
      const markerSeen = code.includes(REFRESH_MARKER);
      const registration = declaration && state.esm && !markerSeen
        ? `;${REFRESH_MARKER}()=>{${declaration.names[0]}=${ENV_EXPR};${declaration.names[1]}=${ENV_EXPR}}`
        : '';

      if (declaration?.dual) {
        const [, a, b, c, d, e] = declaration.names;
        ctx.edit(CONTEXT_LIMIT_ID,
          { type: 'ContextLimitDeclaration', start: declaration.start, end: declaration.end },
          `var ${a}=${ENV_EXPR},${b}=${ENV_EXPR},${c}=32000,${d}=128000${e ? `,${e}=1e6` : ''}${registration}`);
      } else if (declaration?.already) {
        ctx.patched(CONTEXT_LIMIT_ID);
        // The custom patch inserts the refresh registration before the `;`.
        if (registration) ctx.edit(CONTEXT_LIMIT_ID,
          { type: 'Insertion', start: declaration.end, end: declaration.end }, registration);
      } else if (declaration?.near || state.marker) {
        ctx.present(CONTEXT_LIMIT_ID);
      }
      if (state.patchedComparison) ctx.patched(CONTEXT_LIMIT_ID);

      for (const match of state.comparisons) {
        ctx.edit(CONTEXT_LIMIT_ID, match.comparison, `${match.callee}(${match.name})>${ENV_EXPR}`);
      }

      // Mirrors applyContextLimitPatch: only reach the env-reassign loop when
      // the numeric declaration matched (legacy) or the module is a split ESM
      // chunk that may share the declaration through the refresh callback.
      const applicable = (declaration?.dual || declaration?.already) || state.esm;
      if (!applicable) return;
      const direct = !state.esm && (declaration?.dual || declaration?.already);
      const insertion = direct
        ? `;${declaration.names[0]}=${ENV_EXPR};${declaration.names[1]}=${ENV_EXPR};`
        : REFRESH_CALL;
      let count = 0;
      for (const site of state.envStatements) {
        for (const call of site.calls) {
          if (count >= 6) break;
          const end = direct ? site.statement.end : call.end;
          if (!code.startsWith(insertion, end)) {
            ctx.edit(CONTEXT_LIMIT_ID, { type: 'Insertion', start: end, end }, insertion);
          }
          count++;
        }
      }
    },
  },
  {
    id: TERMINAL_REPLY_ID,
    visit(node, ctx) {
      if (node.type !== 'PropertyDefinition' ||
          node.key?.type !== 'Identifier' || node.key.name !== 'flushIncomplete') return;
      const state = stateFor(ctx).terminal;
      state.sawField = true;
      if (ctx.code.includes(TERMINAL_MARKER)) return;
      const shape = terminalReplyShape(node);
      if (!shape) return;
      state.matched = true;
      const insertion = `${TERMINAL_MARKER}const _clawgodReplyDelay=(${terminalReplyDelay.toString()})(this.querier,this.keyReader,${shape.now});` +
        'if(_clawgodReplyDelay>0){this.incompleteEscapeTimer=setTimeout(this.flushIncomplete,_clawgodReplyDelay);return}';
      ctx.edit(TERMINAL_REPLY_ID, { type: 'Insertion', start: shape.end, end: shape.end }, insertion);
    },
    finalize(ctx) {
      const state = stateFor(ctx).terminal;
      if (ctx.code.includes(TERMINAL_MARKER)) ctx.patched(TERMINAL_REPLY_ID);
      else if (state.sawField && !state.matched) ctx.present(TERMINAL_REPLY_ID);
    },
  },
];
