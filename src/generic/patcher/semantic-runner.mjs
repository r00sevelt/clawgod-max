import { ANCHOR_PATCH_IDS, scanAstAnchors } from './ast-anchors.mjs';
import { BATCH2_ANCHOR_IDS, scanBatch2Anchors } from './ast-anchors2/index.mjs';
import { AST_PATCH_IDS, applyAstEdits, parsePatchSource, scanAstPatches } from './semantic.mjs';

export const MODULE_SEPARATOR = '\n/*__CLAWGOD_MODULE_BOUNDARY__*/\n';

export class SourceCompatibilityError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'SourceCompatibilityError';
  }
}

export function applySemanticPatches(source, descriptors, { dryRun = false, verify = false } = {}) {
  const modules = source.split(MODULE_SEPARATOR);
  const anchorIds = new Set(descriptors
    .map(descriptor => descriptor.semanticId)
    .filter(id => id && (ANCHOR_PATCH_IDS.includes(id) || BATCH2_ANCHOR_IDS.includes(id))));
  const scans = [];
  for (let index = 0; index < modules.length; index++) {
    try {
      const tree = parsePatchSource(modules[index]);
      const anchors = anchorIds.size
        ? scanAstAnchors(modules[index], { tree, ids: anchorIds })
        : {};
      const anchors2 = anchorIds.size
        ? scanBatch2Anchors(modules[index], { tree, ids: anchorIds })
        : {};
      scans.push({
        ...scanAstPatches(modules[index], { tree }),
        ...anchors,
        ...anchors2,
      });
    } catch (error) {
      if (error?.name === 'SyntaxError') {
        throw new SourceCompatibilityError(`upstream bundle is not parseable (module ${index}): ${error.message}`, { cause: error });
      }
      throw error;
    }
  }
  const results = new Map();
  const edits = modules.map(() => []);
  for (const descriptor of descriptors) {
    const id = descriptor.semanticId;
    if (!AST_PATCH_IDS.includes(id) && !ANCHOR_PATCH_IDS.includes(id) && !BATCH2_ANCHOR_IDS.includes(id)) {
      throw new Error(`Unknown semantic patch: ${id}`);
    }
    const matches = scans.flatMap(scan => scan[id].matches);
    const present = scans.some(scan => scan[id].present);
    const patched = scans.some(scan => scan[id].patched);
    // The custom context-limit patch treats any 200000 in the bundle as a
    // stale recognizer when no declaration matches. Keep that fallback at
    // bundle scope, and let real matches win over another module's present.
    const staleFallback = id === 'context-limit-ast' && matches.length === 0 && !patched &&
      source.includes('200000');
    const stale = id === 'context-limit-ast'
      ? matches.length === 0 && !patched && (present || staleFallback)
      : present;
    if (scans.some(scan => scan[id].ambiguous) || (id === 'remote-settings-off' && matches.length > 1)) {
      results.set(descriptor, { status: 'failed', detail: `ambiguous AST patch sites: ${id}` });
    } else if (stale) {
      results.set(descriptor, { status: 'stale', detail: `AST matcher stale: ${id}` });
    } else if (matches.length) {
      results.set(descriptor, { status: verify ? 'verify' : 'applied', count: matches.length });
      for (let i = 0; i < scans.length; i++) edits[i].push(...scans[i][id].matches);
    } else {
      results.set(descriptor, { status: scans.some(scan => scan[id].patched) ? 'already' : 'skipped', detail: 'AST gate present or feature absent' });
    }
  }
  const next = modules.map((code, index) => {
    if (!edits[index].length) return code;
    const patched = applyAstEdits(code, edits[index]);
    parsePatchSource(patched);
    return patched;
  }).join(MODULE_SEPARATOR);
  return { code: dryRun || verify ? source : next, results };
}

export function applySemanticPatch(source, options = {}) {
  const descriptor = { semanticId: options.semanticId };
  const result = applySemanticPatches(source, [descriptor], options);
  return { ...result.results.get(descriptor), code: result.code };
}
