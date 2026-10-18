#!/usr/bin/env bun
import assert from 'node:assert/strict';
import acorn from '../src/generic/patcher/vendor/acorn.cjs';
import { scanBatch2Anchors } from '../src/generic/patcher/ast-anchors2/index.mjs';
import { applyAstEdits } from '../src/generic/patcher/semantic.mjs';
import { coreRegistry, findNodes } from '../src/generic/patcher/core.mjs';

const SEPARATOR = '\n/*__CLAWGOD_MODULE_BOUNDARY__*/\n';
const ENV_EXPR = '(+process.env.CLAUDE_CODE_CONTEXT_LIMIT||+process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS||200000)';
const REFRESH_MARKER = 'globalThis.__clawgod_context_limit_refresh_v1__=';
const REFRESH_CALL = ',globalThis.__clawgod_context_limit_refresh_v1__?.()';
const TERMINAL_MARKER = '/*__clawgod_terminal_reply_fragments__*/';
const CONTEXT_ID = 'context-limit-ast';
const TERMINAL_ID = 'terminal-reply-ast';

function applyAnchor(source, id) {
  const results = scanBatch2Anchors(source, { ids: [id] });
  return { result: results[id], code: applyAstEdits(source, results[id].matches) };
}

function applyAnchorModules(source, id) {
  return source.split(SEPARATOR).map(module => applyAnchor(module, id).code).join(SEPARATOR);
}

// Verbatim reference of core.mjs applyContextLimitPatch (acorn always
// available in the patcher bundle), used to prove byte-identical output.
function referenceContextLimit(source) {
  const dualRe = /var\s+([\w$]+)\s*=\s*200000\s*,\s*([\w$]+)\s*=\s*200000\s*,\s*([\w$]+)\s*=\s*32000\s*,\s*([\w$]+)\s*=\s*128000(?:\s*,\s*([\w$]+)\s*=\s*1e6)?(?=\s*;)/;
  const alreadyRe = new RegExp('var\\s+([\\w$]+)\\s*=\\s*\\(\\+process\\.env\\.CLAUDE_CODE_CONTEXT_LIMIT\\|\\|\\+process\\.env\\.CLAUDE_CODE_MAX_CONTEXT_TOKENS\\|\\|200000\\)\\s*,\\s*([\\w$]+)\\s*=\\s*\\(\\+process\\.env\\.CLAUDE_CODE_CONTEXT_LIMIT\\|\\|\\+process\\.env\\.CLAUDE_CODE_MAX_CONTEXT_TOKENS\\|\\|200000\\)\\s*,\\s*[\\w$]+\\s*=\\s*32000\\s*,\\s*[\\w$]+\\s*=\\s*128000(?:\\s*,\\s*[\\w$]+\\s*=\\s*1e6)?(?=\\s*;)');

  const dualMatch = dualRe.exec(source);
  const alreadyMatch = alreadyRe.exec(source);
  if (!dualMatch && !alreadyMatch) return source;

  const match = dualMatch || alreadyMatch;
  const [, varA, varB, varC, varD, varE] = match;
  const replacements = [];
  const codeSplit = source.includes(SEPARATOR);
  const refreshRegistration = `;${REFRESH_MARKER}()=>{${varA}=${ENV_EXPR};${varB}=${ENV_EXPR}}`;
  if (dualMatch) {
    replacements.push({
      start: dualMatch.index,
      end: dualMatch.index + dualMatch[0].length,
      replacement: `var ${varA}=${ENV_EXPR},${varB}=${ENV_EXPR},${varC}=32000,${varD}=128000${varE ? `,${varE}=1e6` : ''}${codeSplit && !source.includes(REFRESH_MARKER) ? refreshRegistration : ''}`,
    });

    const cmpRe = /\breturn ([\w$]+)\?([\w$]+)\(\1\)>200000:!1/g;
    let cm;
    while ((cm = cmpRe.exec(source)) !== null) {
      const comparison = `${cm[2]}(${cm[1]})>200000`;
      const start = cm.index + cm[0].indexOf(comparison);
      replacements.push({
        start,
        end: start + comparison.length,
        replacement: `${cm[2]}(${cm[1]})>${ENV_EXPR}`,
      });
    }
  }

  if (codeSplit && alreadyMatch && !source.includes(REFRESH_MARKER)) {
    replacements.push({ start: match.index + match[0].length, end: match.index + match[0].length, replacement: refreshRegistration });
  }

  const envReassign = `;${varA}=${ENV_EXPR};${varB}=${ENV_EXPR};`;
  const isEnvAssign = node =>
    node?.type === 'CallExpression' &&
    node.callee?.type === 'MemberExpression' &&
    node.callee.object?.name === 'Object' &&
    node.callee.property?.name === 'assign' &&
    node.arguments?.length >= 2 &&
    node.arguments[0]?.type === 'MemberExpression' &&
    node.arguments[0].object?.name === 'process' &&
    node.arguments[0].property?.name === 'env';

  const modules = codeSplit ? source.split(SEPARATOR) : [source];
  let moduleOffset = 0;
  let envAssignCount = 0;
  for (const moduleSource of modules) {
    if (envAssignCount >= 6) break;
    if (!moduleSource.includes('Object.assign(process.env')) {
      moduleOffset += moduleSource.length + (codeSplit ? SEPARATOR.length : 0);
      continue;
    }
    try {
      const ast = acorn.parse(moduleSource, {
        ecmaVersion: 'latest',
        sourceType: codeSplit ? 'module' : 'script',
        allowReturnOutsideFunction: !codeSplit,
      });
      const statements = findNodes(ast, node => node.type === 'ExpressionStatement');
      for (const statement of statements) {
        const directCalls = statement.expression?.type === 'SequenceExpression'
          ? statement.expression.expressions.filter(isEnvAssign)
          : isEnvAssign(statement.expression) ? [statement.expression] : [];
        for (const call of directCalls) {
          if (envAssignCount >= 6) break;
          const insertion = codeSplit ? REFRESH_CALL : envReassign;
          const localEnd = codeSplit ? call.end : statement.end;
          const end = moduleOffset + localEnd;
          if (!source.startsWith(insertion, end)) replacements.push({ start: end, end, replacement: insertion });
          envAssignCount++;
        }
      }
    } catch {}
    moduleOffset += moduleSource.length + (codeSplit ? SEPARATOR.length : 0);
  }

  replacements.sort((left, right) => right.start - left.start);
  let next = source;
  for (const replacement of replacements) {
    next = next.slice(0, replacement.start) + replacement.replacement + next.slice(replacement.end);
  }
  return next;
}

// Descriptors keep their original regex/custom metadata; the semantic IDs are
// what routes them through the batch-2 runner.
const contextDescriptor = coreRegistry.customPatches.find(descriptor => descriptor.order === 61);
assert.equal(contextDescriptor.name, 'Context limit configurable');
assert.equal(contextDescriptor.semanticId, CONTEXT_ID, 'order 61 must route through context-limit-ast');
const terminalDescriptor = coreRegistry.patches.find(descriptor => descriptor.order === 90);
assert.equal(terminalDescriptor.id, 'terminal-reply-fragments');
assert.equal(terminalDescriptor.semanticId, TERMINAL_ID, 'order 90 must route through terminal-reply-ast');

// ── context-limit: legacy single-file fixture ──────────────────────────────
const legacy = `/* Version: 2.1.218 */
var dJt=200000,UAe=200000,xag=32000,kag=128000,Dag=1e6;
function Rxe(n){return n}
function hasLargeMessage(n){return n?Rxe(n)>200000:!1}
function unrelatedGreater(n){return n>200000}
function unrelatedGreaterEqual(n){return n>=200000}
function unchangedCatalog(){return {context:{window:200000,supports_1m_context:!0}}}
function loadSettingsEnv(e){Object.assign(process.env,e.env||{});return currentLimit()}
function nestedAssign(e){return Boolean(Object.assign(process.env,e.env||{}))}
function currentLimit(){return dJt}
`;
{
  const { result, code } = applyAnchor(legacy, CONTEXT_ID);
  assert.equal(result.matches.length, 3, 'legacy fixture: declaration, comparison and env assign');
  assert.equal(code, referenceContextLimit(legacy), 'legacy fixture must be byte-identical to applyContextLimitPatch');
  assert.match(code, new RegExp(`var dJt=\\(\\+process\\.env\\.CLAUDE_CODE_CONTEXT_LIMIT\\|\\|\\+process\\.env\\.CLAUDE_CODE_MAX_CONTEXT_TOKENS\\|\\|200000\\),UAe=\\(\\+process\\.env\\.CLAUDE_CODE_CONTEXT_LIMIT\\|\\|\\+process\\.env\\.CLAUDE_CODE_MAX_CONTEXT_TOKENS\\|\\|200000\\),xag=32000,kag=128000,Dag=1e6;`));
  assert.match(code, /Object\.assign\(process\.env,e\.env\|\|\{\}\);;dJt=\(\+process\.env\.CLAUDE_CODE_CONTEXT_LIMIT\|\|\+process\.env\.CLAUDE_CODE_MAX_CONTEXT_TOKENS\|\|200000\);UAe=\(\+process\.env\.CLAUDE_CODE_CONTEXT_LIMIT\|\|\+process\.env\.CLAUDE_CODE_MAX_CONTEXT_TOKENS\|\|200000\);return currentLimit/);
  assert.match(code, /function unrelatedGreater\(n\)\{return n>200000\}/, 'unrelated > comparisons stay untouched');
  assert.match(code, /function unrelatedGreaterEqual\(n\)\{return n>=200000\}/, 'unrelated >= comparisons stay untouched');
  assert.match(code, /return Boolean\(Object\.assign\(process\.env,e\.env\|\|\{\}\)\)\}/, 'nested Object.assign calls stay untouched');
  assert.match(code, /context:\{window:200000,supports_1m_context:!0\}/, 'catalog metadata stays untouched');
  assert.doesNotMatch(code, new RegExp(REFRESH_MARKER), 'legacy mode must not register the refresh callback');

  const again = applyAnchor(code, CONTEXT_ID);
  assert.equal(again.result.matches.length, 0, 'second scan must not add edits');
  assert.equal(again.result.patched, true, 'second scan must report the patched declaration');
  assert.equal(again.code, code, 'second scan must be byte-identical');
}

// ── context-limit: chunked ESM bundle ──────────────────────────────────────
const contextChunk = `var vGe=200000,UN=200000,l3=32000,c3=128000;
function uV(n){return n}
function hasLargeMessage(n){return n?uV(n)>200000:!1}
function currentLimit(){return vGe}
export{currentLimit,hasLargeMessage};`;
const envChunk = `import { currentLimit } from "./context.js";
function loadSettingsEnv(e){Object.assign(process.env,e.env||{}),globalThis.__fixtureSideEffect__=!0;return currentLimit()}
export{loadSettingsEnv};`;
{
  const joined = [contextChunk, envChunk].join(SEPARATOR);
  const code = applyAnchorModules(joined, CONTEXT_ID);
  assert.equal(code, referenceContextLimit(joined), 'chunked fixture must be byte-identical to applyContextLimitPatch');
  assert.ok(code.split(SEPARATOR)[0].includes(`c3=128000;${REFRESH_MARKER}()=>{vGe=${ENV_EXPR};UN=${ENV_EXPR}};`),
    'chunk declaration must register the cross-module refresh callback');
  assert.match(code, /Object\.assign\(process\.env,e\.env\|\|\{\}\),globalThis\.__clawgod_context_limit_refresh_v1__\?\.\(\),globalThis\.__fixtureSideEffect__=!0/, 'chunk env loader must use the cross-module refresh callback');
  assert.match(code, /uV\(n\)>\(\+process\.env\.CLAUDE_CODE_CONTEXT_LIMIT\|\|\+process\.env\.CLAUDE_CODE_MAX_CONTEXT_TOKENS\|\|200000\)/, 'comparison in the declaring chunk must be patched');

  const modules = code.split(SEPARATOR);
  const again = applyAnchor(modules[0], CONTEXT_ID);
  assert.equal(again.result.matches.length, 0, 'patched declaration chunk must be idempotent');
  assert.equal(again.result.patched, true);
  const envAgain = applyAnchor(modules[1], CONTEXT_ID);
  assert.equal(envAgain.result.matches.length, 0, 'patched env chunk must not add a second refresh call');
  assert.equal(envAgain.code, modules[1]);
}
{
  // Already env-driven declaration in a split bundle: the registration insert
  // lands before the terminating semicolon, exactly like the custom patch.
  const alreadyChunk = `var vGe=${ENV_EXPR},UN=${ENV_EXPR},l3=32000,c3=128000;
function loadSettingsEnv(e){Object.assign(process.env,e.env||{});return currentLimit()}
export{loadSettingsEnv};`;
  const joined = [alreadyChunk, envChunk].join(SEPARATOR);
  const code = applyAnchorModules(joined, CONTEXT_ID);
  assert.equal(code, referenceContextLimit(joined), 'already-patched chunked fixture must match the custom patch');
  assert.equal(code.split(SEPARATOR)[0].includes(`${REFRESH_MARKER}()=>{vGe=`), true, 'registration must reference the declaration names');
  const again = applyAnchor(alreadyChunk, CONTEXT_ID);
  assert.equal(again.result.matches.length, 2, 'marker-free already-patched chunk must add the registration and refresh call');
  assert.ok(again.code.includes(`${REFRESH_MARKER}()=>{vGe=`), 'registration must reference the declaration names');
}

// ── context-limit: negative and drift shapes ──────────────────────────────
{
  const decoy = 'var note="var a=200000,b=200000,c=32000,d=128000";function f(n){return n>200000}';
  const { result } = applyAnchor(decoy, CONTEXT_ID);
  assert.equal(result.matches.length, 0, 'string decoys must not create context-limit matches');
  assert.equal(result.present, false, 'string decoys are not a drifted declaration');
}
{
  const unrelated = 'var a=1,b=2;function f(n){return n>200000}function g(n){return n>=200000}';
  const { result } = applyAnchor(unrelated, CONTEXT_ID);
  assert.equal(result.matches.length, 0);
  assert.equal(result.present, false);
  assert.equal(result.patched, false);
}
{
  const drifted = 'var dJt=200000,UAe=200000,xag=32000,kag=128000,killer=2;export{dJt};';
  const { result } = applyAnchor(drifted, CONTEXT_ID);
  assert.equal(result.matches.length, 0, 'drifted declaration must not be patched');
  assert.equal(result.present, true, 'drifted declaration must be reported as stale');
}
{
  const already = `var dJt=${ENV_EXPR},UAe=${ENV_EXPR},xag=32000,kag=128000;function limit(){return dJt}`;
  const { result, code } = applyAnchor(already, CONTEXT_ID);
  assert.equal(result.matches.length, 0, 'already-patched declaration must not be rewritten');
  assert.equal(result.patched, true);
  assert.equal(code, already);
}
{
  const noDeclaration = 'function f(e){Object.assign(process.env,e.env||{})}';
  const { result, code } = applyAnchor(noDeclaration, CONTEXT_ID);
  assert.equal(result.matches.length, 0, 'no context declaration in a legacy module must not touch env assignments');
  assert.equal(code, noDeclaration);
}

// ── terminal-reply: regex descriptor parity ────────────────────────────────
const referenceTerminal = source =>
  source.replace(terminalDescriptor.pattern, (...args) => terminalDescriptor.replacer(...args));

const terminalPositive = 'globalThis.App=class{flushIncomplete=()=>{if(this.incompleteEscapeTimer=null,!Hf(this.keyReader))return;if(this.props.stdin.readableLength>0){this.incompleteEscapeTimer=setTimeout(this.flushIncomplete,za);return}let t=performance.now();this.applyKeysRead(Ry(this.keyReader,t),t)}};';
{
  const { result, code } = applyAnchor(terminalPositive, TERMINAL_ID);
  assert.equal(result.matches.length, 1, 'terminal anchor must find the DA1 flush callback');
  assert.equal(code, referenceTerminal(terminalPositive), 'terminal anchor must be byte-identical to the regex replacer');
  assert.ok(code.includes(TERMINAL_MARKER));
  assert.ok(code.includes('const _clawgodReplyDelay='));
  assert.ok(code.includes('this.querier,this.keyReader,t'));

  const again = applyAnchor(code, TERMINAL_ID);
  assert.equal(again.result.matches.length, 0, 'terminal anchor must not add a second delay block');
  assert.equal(again.result.patched, true, 'marker must report the patch as already applied');
  assert.equal(again.code, code, 'terminal anchor must be idempotent');
}
{
  const renamed = 'globalThis.App=class{flushIncomplete=()=>{if(this.incompleteEscapeTimer=null,!zf(this.keyReader))return;if(this.props.stdin.readableLength>0){this.incompleteEscapeTimer=setTimeout(this.flushIncomplete,Lr);return}let n=performance.now();this.applyKeysRead(E0(this.keyReader,n),n)}};';
  const { code } = applyAnchor(renamed, TERMINAL_ID);
  assert.equal(code, referenceTerminal(renamed), 'terminal anchor must follow minified helper names');
  assert.ok(code.includes('this.querier,this.keyReader,n'));
}
{
  const noReset = 'globalThis.App=class{flushIncomplete=()=>{if(!Hf(this.keyReader))return;if(this.props.stdin.readableLength>0){this.incompleteEscapeTimer=setTimeout(this.flushIncomplete,za);return}let t=performance.now();this.applyKeysRead(Ry(this.keyReader,t),t)}};';
  const { result } = applyAnchor(noReset, TERMINAL_ID);
  assert.equal(result.matches.length, 0, 'a different input loop shape must not be patched');
  assert.equal(result.present, true, 'a flushIncomplete field with drift must be reported as stale');
}
{
  const mismatchedNow = 'globalThis.App=class{flushIncomplete=()=>{if(this.incompleteEscapeTimer=null,!Hf(this.keyReader))return;if(this.props.stdin.readableLength>0){this.incompleteEscapeTimer=setTimeout(this.flushIncomplete,za);return}let t=performance.now();this.applyKeysRead(Ry(this.keyReader,t),n)}};';
  const { result } = applyAnchor(mismatchedNow, TERMINAL_ID);
  assert.equal(result.matches.length, 0, 'the third now argument must be the same identifier');
  assert.equal(result.present, true);
}
{
  const decoy = `const source=${JSON.stringify(terminalPositive)};`;
  const { result } = applyAnchor(decoy, TERMINAL_ID);
  assert.equal(result.matches.length, 0, 'string decoys must not create terminal-reply matches');
  assert.equal(result.present, false);
}

console.log('batch-2 core AST anchor checks passed');
