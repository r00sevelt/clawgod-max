#!/usr/bin/env bun
import assert from 'node:assert/strict';
import { scanAstAnchors } from '../src/generic/patcher/ast-anchors.mjs';
import { applyAstEdits } from '../src/generic/patcher/semantic.mjs';

const gate = id => `globalThis.__clawgodPatches?.[${JSON.stringify(id)}]!==!1`;

function apply(source, id) {
  const results = scanAstAnchors(source);
  return { results, result: results[id], patched: applyAstEdits(source, results[id].matches) };
}

{
  const source = 'function teams(){if(!enabled(process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS)&&!local())return!1;if(!flag("tengu_amber_flint",!0))return!1;return!0}';
  const expected = `function teams(){if(${gate('agent-teams')})return!0;if(!enabled(process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS)&&!local())return!1;if(!flag("tengu_amber_flint",!0))return!1;return!0}`;
  const { result, patched } = apply(source, 'agent-teams');
  assert.equal(result.matches.length, 1, 'Agent Teams must match the environment-check shape');
  assert.equal(patched, expected, 'Agent Teams gate must be inserted at the body start');
  const again = scanAstAnchors(expected);
  assert.equal(again['agent-teams'].patched, true, 'Agent Teams gate must be idempotent');
  assert.equal(again['agent-teams'].matches.length, 0, 'Agent Teams must not add a second gate');
}

{
  const source = 'function teams(){if(!cfg.enabled&&!local())return!1;if(!flag("tengu_amber_flint",!0))return!1;return!0}';
  const { result } = apply(source, 'agent-teams');
  assert.equal(result.matches.length, 1, 'Agent Teams must accept the member-flag variant');
}

{
  const source = 'function other(){if(!enabled(process.env.OTHER)&&!local())return!1;if(!flag("tengu_amber_flint",!0))return!1;return!0}';
  const { result } = apply(source, 'agent-teams');
  assert.equal(result.matches.length, 0, 'Agent Teams must not match a different environment flag');
  assert.equal(result.present, false, 'a different environment flag is not an Agent Teams drift');
}

{
  const source = 'const decoy = \'function teams(){if(!enabled(process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS)&&!local())return!1;if(!flag("tengu_amber_flint",!0))return!1;return!0}\';';
  const { result } = apply(source, 'agent-teams');
  assert.equal(result.matches.length, 0, 'string decoys must not create Agent Teams matches');
}

{
  const source = 'function g(x){if(!eligible(x))return!1;if(x!=="firstParty")return!0;return!0}';
  const expected = `function g(x){if(${gate('auto-mode-helper-gate')}===!1&&!eligible(x))return!1;if(x!=="firstParty")return!0;return!0}`;
  const { result, patched } = apply(source, 'auto-mode-helper-gate');
  assert.equal(result.matches.length, 1, 'auto-mode helper gate must match the negated-call shape');
  assert.equal(patched, expected, 'auto-mode helper gate must wrap the test');
  const again = scanAstAnchors(expected);
  assert.equal(again['auto-mode-helper-gate'].patched, true, 'auto-mode helper gate must be idempotent');
}

{
  const source = 'function g(x){if(!eligible(x))return!1;return!0}';
  const { result } = apply(source, 'auto-mode-helper-gate');
  assert.equal(result.matches.length, 0, 'auto-mode helper gate must require firstParty context');
  assert.equal(result.present, false, 'missing firstParty context is not a drift');
}

{
  const source = 'function g(x){if(!eligible(x,y))return!1;if(x!=="firstParty")return!0;return!0}';
  const { result } = apply(source, 'auto-mode-helper-gate');
  assert.equal(result.matches.length, 0, 'unexpected argument shape must not be patched');
  assert.equal(result.present, true, 'unexpected argument shape must be reported as stale');
}

{
  const source = 'function h(m){if(m!=="firstParty"&&(m!=="anthropicAws"||!isEnabled(m)))return!1;return!0}';
  const expected = `function h(m){if(${gate('auto-mode-inline-gate')}===!1&&m!=="firstParty"&&(m!=="anthropicAws"||!isEnabled(m)))return!1;return!0}`;
  const { result, patched } = apply(source, 'auto-mode-inline-gate');
  assert.equal(result.matches.length, 1, 'auto-mode inline gate must match firstParty/anthropicAws');
  assert.equal(patched, expected, 'auto-mode inline gate must wrap the test');
  const again = scanAstAnchors(expected);
  assert.equal(again['auto-mode-inline-gate'].patched, true, 'auto-mode inline gate must be idempotent');
}

{
  const source = 'function h(){if(auto()&&(model==="claude-opus-4-6"||model==="claude-sonnet-4-6"||model.includes("haiku")))return!1;return!0}';
  const { result } = apply(source, 'auto-mode-inline-gate');
  assert.equal(result.matches.length, 1, 'auto-mode inline gate must match the model-id shape');
}

{
  const source = 'function h(){if(auto()&&(model==="claude-opus-5-0"||model.includes("haiku")))return!1;return!0}';
  const { result } = apply(source, 'auto-mode-inline-gate');
  assert.equal(result.matches.length, 1, 'auto-mode inline gate must not depend on a specific model version');
}

{
  const source = 'function h(m){if(m!=="firstParty")return!1;return!0}';
  const { result } = apply(source, 'auto-mode-inline-gate');
  assert.equal(result.matches.length, 0, 'auto-mode inline gate must require the full third-party condition');
  assert.equal(result.present, true, 'a firstParty marker without a full shape must be reported as stale');
}

{
  const source = 'var ulu="tengu_review_bughunter_config";\nfunction Bot(){return et(ulu,null)}\nfunction oQt(){return Bot()?.enabled===!0&&ru()&&!X6()}';
  const expected = `var ulu="tengu_review_bughunter_config";\nfunction Bot(){return et(ulu,null)}\nfunction oQt(){return ${gate('ultrareview-v215')}?!0:(Bot()?.enabled===!0&&ru()&&!X6())}`;
  const { result, patched } = apply(source, 'ultrareview-v215');
  assert.equal(result.matches.length, 1, 'Ultrareview v2.1.215 must bind the getter by its config literal');
  assert.equal(patched, expected, 'Ultrareview v2.1.215 must preserve the original gate expression');
  const again = scanAstAnchors(expected);
  assert.equal(again['ultrareview-v215'].patched, true, 'Ultrareview v2.1.215 must be idempotent');
  assert.equal(again['ultrareview-v215'].matches.length, 0, 'Ultrareview v2.1.215 must not add a second gate');
}

{
  const source = 'var cfg="tengu_review_bughunter_config";\nfunction get(){return read(cfg,null)}\nfunction gateFn(){return get()?.enabled===!0&&ready()&&!disabled()}';
  const { result } = apply(source, 'ultrareview-v215');
  assert.equal(result.matches.length, 1, 'Ultrareview must not depend on the compressed ulu sentinel');
}

{
  const source = 'var ulu="tengu_review_bughunter_config";\nfunction Bot(){return et(ulu,null)}\nfunction oQt(){return Bot()?.enabled===!0}';
  const { result } = apply(source, 'ultrareview-v215');
  assert.equal(result.matches.length, 0, 'a shape drift must not be patched');
  assert.equal(result.present, true, 'a shape drift must be reported as stale');
}

{
  const source = 'function plain(){return true}';
  const { result } = apply(source, 'ultrareview-v215');
  assert.equal(result.matches.length, 0, 'a missing feature must not match');
  assert.equal(result.present, false, 'a missing feature must stay skipped');
}

console.log('AST anchor checks passed');
