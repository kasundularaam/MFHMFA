function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const BR_SPLIT_RE = /<br\s*\/?>/i;
const QUOT_ENTITY_RE = /#quot;/g;
const WRAP_QUOTES_RE = /^["']|["']$/g;

/**
 * Extracts a clean display label for a Mermaid node ID from raw Mermaid source.
 */
export function extractNodeLabelFromMermaid(code: string, nodeId: string): string {
  const escaped = escapeRegExp(nodeId);

  // 1. Quoted shapes: Node["Label"], Node(["Label"]), Node[("Label")], Node[["Label"]], Node{{"Label"}}, Node(("Label")), Node("Label"), Node{"Label"}
  const quotedRe = new RegExp(
    `(?:^|[^A-Za-z0-9_-])${escaped}\\s*(?:\\[\\["|\\(\\["|\\[\\("|\\{\\{"|\\(\\("|\\["|\\("|\\{")([^"]+)"`,
    'm'
  );
  const qMatch = code.match(quotedRe);
  if (qMatch?.[1]) {
    const firstLine = qMatch[1].split(BR_SPLIT_RE)[0]!.replace(QUOT_ENTITY_RE, '"').trim();
    if (firstLine) return firstLine;
  }

  // 2. Subgraph header: subgraph Node["Label"]
  const subRe = new RegExp(`\\bsubgraph\\s+${escaped}\\s*\\["?([^"\\]]+)"?\\]`, 'm');
  const sMatch = code.match(subRe);
  if (sMatch?.[1]?.trim()) {
    return sMatch[1].trim();
  }

  // 3. Sequence participant/actor alias: participant Node as Label
  const partRe = new RegExp(
    `\\b(?:participant|actor)\\s+${escaped}\\s+as\\s+([^\\r\\n]+)`,
    'm'
  );
  const pMatch = code.match(partRe);
  if (pMatch?.[1]?.trim()) {
    return pMatch[1].trim().replace(WRAP_QUOTES_RE, '');
  }

  // 4. State alias: state "Label" as Node
  const stateRe = new RegExp(`\\bstate\\s+"([^"]+)"\\s+as\\s+${escaped}\\b`, 'm');
  const stMatch = code.match(stateRe);
  if (stMatch?.[1]?.trim()) {
    return stMatch[1].trim();
  }

  // 5. Unquoted simple bracket: Node[Label]
  const plainRe = new RegExp(`(?:^|[^A-Za-z0-9_-])${escaped}\\s*\\[([^\\]"]+)\\]`, 'm');
  const plMatch = code.match(plainRe);
  if (plMatch?.[1]?.trim()) {
    return plMatch[1].split(BR_SPLIT_RE)[0]!.trim();
  }

  return nodeId;
}
