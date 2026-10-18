// Batch-2 Chrome structural anchor:
// - chrome-agents-config-ast (chrome order 13, regex patch)
// The dispatcher calls every visitor once per AST node. Keep matchers
// read-only: return edits through context.edit(id, node, replacement).
import { literal } from '../semantic.mjs';

const ID = 'chrome-agents-config-ast';
const REQUIRED = ['addDir', 'pluginDir', 'pluginDirNoMcp', 'settings', 'mcpConfig', 'strictMcpConfig'];

const emptyArray = node => node?.type === 'ArrayExpression' && node.elements.length === 0;
const voidZero = node => node?.type === 'UnaryExpression' && node.operator === 'void' &&
  literal(node.argument, 0);
const notTrue = node => node?.type === 'UnaryExpression' && node.operator === '!' &&
  literal(node.argument, 1);

function keyName(property) {
  if (property.computed) {
    return property.key?.type === 'Literal' && typeof property.key.value === 'string'
      ? property.key.value
      : null;
  }
  if (property.key?.type === 'Identifier') return property.key.name;
  if (property.key?.type === 'Literal' && typeof property.key.value === 'string') return property.key.value;
  return null;
}

// Locate the agents config initialiser by its key set, not key order. Spreads
// and duplicate keys make the runtime value order-dependent, so they are drift.
function configState(node) {
  if (node.type !== 'ObjectExpression') return null;
  const properties = new Map();
  for (const property of node.properties) {
    if (property.type !== 'Property' || property.kind !== 'init' || property.method) return null;
    const name = keyName(property);
    if (name === null || properties.has(name)) return null;
    properties.set(name, property);
  }
  if (!REQUIRED.every(name => properties.has(name))) return null;
  if (!emptyArray(properties.get('addDir').value) ||
      !emptyArray(properties.get('pluginDir').value) ||
      !emptyArray(properties.get('pluginDirNoMcp').value) ||
      !voidZero(properties.get('settings').value) ||
      !emptyArray(properties.get('mcpConfig').value) ||
      !notTrue(properties.get('strictMcpConfig').value)) return null;
  return properties;
}

export const visitors = [{
  id: ID,
  visit(node, ctx) {
    const properties = configState(node);
    if (!properties) return;
    const hasChrome = properties.has('chrome');
    const hasNoChrome = properties.has('noChrome');
    if (hasChrome || hasNoChrome) {
      if (hasChrome && hasNoChrome) ctx.patched(ID);
      else ctx.ambiguous(ID);
      return;
    }
    const parent = ctx.parents.get(node);
    const identifier = parent?.type === 'VariableDeclarator' && parent.init === node &&
      parent.id?.type === 'Identifier'
      ? parent.id
      : parent?.type === 'AssignmentExpression' && parent.right === node &&
        parent.operator === '=' && parent.left?.type === 'Identifier'
        ? parent.left
        : null;
    if (!identifier) return;
    const strict = properties.get('strictMcpConfig');
    // The regex match spans identifier start → strictMcpConfig value end, so the
    // same span keeps the replacement byte-identical for the canonical bundle.
    ctx.edit(ID, { start: identifier.start, end: strict.end },
      `${ctx.code.slice(identifier.start, strict.end)},chrome:!1,noChrome:!1`);
  },
}];
