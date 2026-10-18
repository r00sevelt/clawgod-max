import { parsePatchSource, walk } from '../semantic.mjs';
import { visitors as coreVisitors } from './core.mjs';
import { visitors as chromeVisitors } from './chrome.mjs';
import { visitors as agentsVisitors } from './agents.mjs';

const ALL_VISITORS = Object.freeze([...coreVisitors, ...chromeVisitors, ...agentsVisitors]);
export const BATCH2_ANCHOR_IDS = Object.freeze(ALL_VISITORS.map(visitor => visitor.id));

if (new Set(BATCH2_ANCHOR_IDS).size !== BATCH2_ANCHOR_IDS.length) {
  throw new Error('Duplicate batch2 AST anchor ID');
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

export function scanBatch2Anchors(code, { tree = parsePatchSource(code), ids = BATCH2_ANCHOR_IDS } = {}) {
  const selected = new Set(ids);
  const active = ALL_VISITORS.filter(visitor => selected.has(visitor.id));
  const results = Object.fromEntries(active.map(visitor => [
    visitor.id,
    { matches: [], present: false, patched: false, ambiguous: false },
  ]));
  const parents = buildParents(tree);
  const context = {
    code,
    results,
    parents,
    edit(id, node, replacement) {
      results[id].matches.push({ start: node.start, end: node.end, replacement });
    },
    present(id) {
      results[id].present = true;
    },
    patched(id) {
      results[id].patched = true;
    },
    ambiguous(id) {
      results[id].ambiguous = true;
    },
  };
  walk(tree, node => {
    for (const visitor of active) visitor.visit?.(node, context);
  });
  for (const visitor of active) visitor.finalize?.(context);
  return results;
}
