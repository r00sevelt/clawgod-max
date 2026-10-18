#!/usr/bin/env bun
import assert from 'node:assert/strict';
import { scanBatch2Anchors } from '../src/generic/patcher/ast-anchors2/index.mjs';
import { applyAstEdits } from '../src/generic/patcher/semantic.mjs';
import { chromeRegistry } from '../src/generic/patcher/enhancements/chrome.mjs';
import { createAgentsRegistry } from '../src/generic/patcher/enhancements/agents.mjs';

const chromeState = chromeRegistry.patches.find(patch => patch.order === 13);
const agentsMetadata = createAgentsRegistry({ chromeEnabled: false })
  .patches.find(patch => patch.order === 6);

assert.equal(chromeState.semanticId, 'chrome-agents-config-ast',
  'chrome agents config state must route through its AST anchor');
assert.equal(agentsMetadata.semanticId, 'agents-session-metadata-ast',
  'agents session metadata must route through its AST anchor');

function scan(source, id) {
  const results = scanBatch2Anchors(source, { ids: [id] });
  return {
    result: results[id],
    patched: applyAstEdits(source, results[id].matches),
  };
}

const regexApply = (source, descriptor) => source.replace(descriptor.pattern, descriptor.replacer);
const scanAgain = (source, id) => scanBatch2Anchors(source, { ids: [id] })[id];

// ── Chrome: agents config state ─────────────────────────────────────────────
{
  const source = 'function Iur(e){let t=!1,r,n={addDir:[],pluginDir:[],pluginDirNoMcp:[],settings:void 0,mcpConfig:[],strictMcpConfig:!1},o=[];return{config:n,rest:o}}';
  const expected = regexApply(source, chromeState);
  assert.notEqual(expected, source, 'the regex replacer must patch the canonical config state');
  const { result, patched } = scan(source, 'chrome-agents-config-ast');
  assert.equal(result.matches.length, 1, 'the AST anchor must match the canonical config state');
  assert.equal(patched, expected, 'the AST replacement must be byte-identical to the regex replacer');
  assert.ok(patched.includes('strictMcpConfig:!1,chrome:!1,noChrome:!1'), 'chrome/noChrome must follow strictMcpConfig');

  const again = scanAgain(patched, 'chrome-agents-config-ast');
  assert.equal(again.matches.length, 0, 'a second scan must not add a duplicate chrome/noChrome pair');
  assert.equal(again.patched, true, 'the patched config state must report as already applied');
}

{
  // Key order is irrelevant to the AST anchor, unlike the regex.
  const source = 'let t=!1,n={strictMcpConfig:!1,mcpConfig:[],settings:void 0,pluginDirNoMcp:[],pluginDir:[],addDir:[]},o=[];';
  assert.equal(regexApply(source, chromeState), source, 'the regex must not match a reordered config state');
  const { result, patched } = scan(source, 'chrome-agents-config-ast');
  assert.equal(result.matches.length, 1, 'the AST anchor must accept key-order drift');
  assert.equal(patched,
    'let t=!1,n={strictMcpConfig:!1,chrome:!1,noChrome:!1,mcpConfig:[],settings:void 0,pluginDirNoMcp:[],pluginDir:[],addDir:[]},o=[];',
    'key-order drift must keep the original key order and only add the two flags');
}

{
  const decoy = [
    'let s="n={addDir:[],pluginDir:[],pluginDirNoMcp:[],settings:void 0,mcpConfig:[],strictMcpConfig:!1}";',
    '// n={addDir:[],pluginDir:[],pluginDirNoMcp:[],settings:void 0,mcpConfig:[],strictMcpConfig:!1}',
  ].join('\n');
  assert.notEqual(regexApply(decoy, chromeState), decoy, 'the regex trap must fire inside string/comment decoys');
  const { result, patched } = scan(decoy, 'chrome-agents-config-ast');
  assert.equal(result.matches.length, 0, 'string and comment decoys must not match the AST anchor');
  assert.equal(patched, decoy, 'decoys must not be rewritten');
}

{
  for (const source of [
    'let n={addDir:[],pluginDir:[],pluginDirNoMcp:[],settings:undefined,mcpConfig:[],strictMcpConfig:!1};',
    'let n={addDir:[1],pluginDir:[],pluginDirNoMcp:[],settings:void 0,mcpConfig:[],strictMcpConfig:!1};',
    'let n={addDir:[],pluginDir:[],pluginDirNoMcp:[],settings:void 0,mcpConfig:[],strictMcpConfig:!0};',
    'let x={};let n={...x,addDir:[],pluginDir:[],pluginDirNoMcp:[],settings:void 0,mcpConfig:[],strictMcpConfig:!1};',
    'use({addDir:[],pluginDir:[],pluginDirNoMcp:[],settings:void 0,mcpConfig:[],strictMcpConfig:!1});',
  ]) {
    assert.equal(scan(source, 'chrome-agents-config-ast').result.matches.length, 0,
      `wrong config shape must not match: ${source}`);
  }
}

// ── Agents: session metadata ────────────────────────────────────────────────
{
  const source = 'function vR(e){for(let t=0;t<e.length;t++){let r=e[t];if(r==="--debug"||r==="-d"||r==="--debug-to-stderr"||r==="-d2e"||r.startsWith("--debug=")||r.startsWith("--debug-file="))continue;if(r==="--debug-file"&&t+1<e.length){t++;continue}return!1}return!0}';
  const expected = regexApply(source, agentsMetadata);
  assert.notEqual(expected, source, 'the regex replacer must patch the canonical debug parser');
  const { result, patched } = scan(source, 'agents-session-metadata-ast');
  assert.equal(result.matches.length, 1, 'the AST anchor must match the canonical debug parser');
  assert.equal(patched, expected, 'the AST replacement must be byte-identical to the regex replacer');
  assert.ok(patched.includes('if(r==="--session-id"/*__clawgod_agents_session_id__*/&&t+1<e.length){t++;continue}'),
    'the --session-id branch must follow the --debug-file branch');

  const again = scanAgain(patched, 'agents-session-metadata-ast');
  assert.equal(again.matches.length, 0, 'a second scan must not add a duplicate --session-id branch');
  assert.equal(again.patched, true, 'the patched debug parser must report as already applied');
}

{
  const decoy = [
    'let s=`function vR(e){for(let t=0;t<e.length;t++){let r=e[t];if(r==="--debug"||r==="-d"||r==="--debug-to-stderr"||r==="-d2e"||r.startsWith("--debug=")||r.startsWith("--debug-file="))continue;if(r==="--debug-file"&&t+1<e.length){t++;continue}return!1}return!0}`;',
    '// function vR(e){for(let t=0;t<e.length;t++){let r=e[t];if(r.startsWith("--debug-file="))continue;return!1}return!0}',
  ].join('\n');
  assert.notEqual(regexApply(decoy, agentsMetadata), decoy, 'the regex trap must fire inside string/comment decoys');
  const { result, patched } = scan(decoy, 'agents-session-metadata-ast');
  assert.equal(result.matches.length, 0, 'string and comment decoys must not match the AST anchor');
  assert.equal(patched, decoy, 'decoys must not be rewritten');
}

{
  // A changed debug flag list is a known-shape drift, not a silent skip.
  const source = 'function vR(e){for(let t=0;t<e.length;t++){let r=e[t];if(r==="--debug"||r==="-d"||r==="--debug-to-stderr"||r==="-d2f"||r.startsWith("--debug=")||r.startsWith("--debug-file="))continue;if(r==="--debug-file"&&t+1<e.length){t++;continue}return!1}return!0}';
  const { result } = scan(source, 'agents-session-metadata-ast');
  assert.equal(result.matches.length, 0, 'an unknown debug flag list must not be patched');
  assert.equal(result.present, true, 'an unknown debug flag list must be reported as drift');
}

{
  for (const source of [
    'function vR(e){for(let t=0;t<=e.length;t++){let r=e[t];if(r.startsWith("--debug-file="))continue;if(r==="--debug-file"&&t+1<e.length){t++;continue}return!1}return!0}',
    'function vR(e,f){for(let t=0;t<e.length;t++){let r=e[t];if(r.startsWith("--debug-file="))continue;if(r==="--debug-file"&&t+1<e.length){t++;continue}return!1}return!0}',
    'function other(e){for(let t=0;t<e.length;t++){let r=e[t];if(r==="--other"&&t+1<e.length){t++;continue}return!1}return!0}',
  ]) {
    const { result } = scan(source, 'agents-session-metadata-ast');
    assert.equal(result.matches.length, 0, `wrong debug parser shape must not match: ${source}`);
    assert.equal(result.present, false, `an unrelated loop must not be reported as drift: ${source}`);
  }
}

console.log('batch-2 AST anchor enhancement checks passed');
