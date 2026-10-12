/**
 * Fleet counts are the number of node objects, keyed by certname.
 *
 * Do not add a classified slice to an unclassified slice, and do not add
 * per-group membership lists. Those views overlap: a node with no ENC
 * environment used to sit in the "Ungrouped" pseudo-group and in the
 * unclassified list, so the Nodes header showed 2N. A node in two ENC
 * groups was counted twice the same way.
 *
 * A missing list is `null` (still loading). An empty array is a real
 * fleet of zero. Callers must not treat "not loaded" as zero.
 */

export interface FleetNodeRef {
  certname?: string | null;
  enc_environment?: string | null;
  enc_groups?: readonly string[] | null;
}

export interface FleetNodeCounts {
  total: number;
  classified: number;
  unclassified: number;
  unclassifiedCertnames: string[];
}

export interface NamedNodeGroup<T> {
  nodes: T[];
}

export interface ReportRef {
  hash?: string | null;
  certname?: string | null;
  start_time?: string | null;
  receive_time?: string | null;
}

/** Case-insensitive certname. Empty names are not identities. */
export function certnameKey(certname: string | null | undefined): string {
  return (certname || '').trim().toLowerCase();
}

export function distinctByCertname<T extends { certname?: string | null }>(
  nodes: readonly T[],
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const node of nodes) {
    const key = certnameKey(node.certname);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(node);
  }
  return out;
}

/**
 * Length of a node list after certname dedupe.
 * `null` / `undefined` means the list has not arrived — not a fleet of zero.
 */
export function distinctNodeCount(
  nodes: readonly { certname?: string | null }[],
): number;
export function distinctNodeCount(
  nodes: readonly { certname?: string | null }[] | null | undefined,
): number | null;
export function distinctNodeCount(
  nodes: readonly { certname?: string | null }[] | null | undefined,
): number | null {
  if (nodes == null) return null;
  return distinctByCertname(nodes).length;
}

/**
 * Classified means the node row carries an ENC environment from the same
 * payload (GET /api/nodes/ joins ENC server-side). Missing or blank
 * environment is unclassified, including the old "Ungrouped" bucket that
 * was every node with an empty `enc_groups` array.
 */
export function isClassifiedNode(node: { enc_environment?: string | null }): boolean {
  return typeof node.enc_environment === 'string' && node.enc_environment.trim() !== '';
}

function uniqueGroupNames(groups: readonly string[] | null | undefined): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of groups || []) {
    const name = (raw || '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

/**
 * Counts for one authoritative node list.
 * Returns null when that list has not loaded, so a second request
 * (ENC roster, report list, …) cannot be added in while the fleet is absent.
 */
export function countFleetNodes<T extends FleetNodeRef>(
  nodes: readonly T[] | null | undefined,
): FleetNodeCounts | null {
  if (nodes == null) return null;
  const unique = distinctByCertname(nodes);
  const unclassified = unique.filter((node) => !isClassifiedNode(node));
  const classifiedCount = unique.length - unclassified.length;
  return {
    total: unique.length,
    classified: classifiedCount,
    unclassified: unclassified.length,
    unclassifiedCertnames: unclassified
      .map((node) => (node.certname || '').trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b)),
  };
}

/**
 * ENC groups for the Classified section. Unclassified nodes are omitted
 * entirely — they are not an "Ungrouped" classified group. Classified
 * nodes with no groups land in Ungrouped and still count as classified.
 * A node in several groups appears in each group once; callers must use
 * `countFleetNodes` for the section total, not the sum of these lists.
 */
export function groupClassifiedNodes<T extends FleetNodeRef>(
  nodes: readonly T[] | null | undefined,
): Record<string, NamedNodeGroup<T>> {
  const groups: Record<string, NamedNodeGroup<T>> = {};
  if (nodes == null) return groups;
  for (const node of distinctByCertname(nodes)) {
    if (!isClassifiedNode(node)) continue;
    const names = uniqueGroupNames(node.enc_groups);
    const labels = names.length > 0 ? names : ['Ungrouped'];
    for (const label of labels) {
      const bucket = groups[label] ?? { nodes: [] };
      bucket.nodes.push(node);
      groups[label] = bucket;
    }
  }
  return groups;
}

/**
 * How many ENC certnames are also on the live fleet.
 * Either list still loading → null, not 0. Intersection is by certname,
 * so duplicate ENC rows do not inflate the badge.
 */
export function countActiveClassified(
  encCertnames: readonly (string | null | undefined)[] | null | undefined,
  fleetCertnames: readonly (string | null | undefined)[] | null | undefined,
): number | null {
  if (encCertnames == null || fleetCertnames == null) return null;
  const fleet = new Set<string>();
  for (const certname of fleetCertnames) {
    const key = certnameKey(certname);
    if (key) fleet.add(key);
  }
  const active = new Set<string>();
  for (const certname of encCertnames) {
    const key = certnameKey(certname);
    if (key && fleet.has(key)) active.add(key);
  }
  return active.size;
}

/**
 * Report documents shown on the Reports page. The same report is copied
 * into every ENC group the node belongs to; the header must count each
 * hash once, not the sum of those copies.
 */
export function countDistinctReports(
  groups: Record<string, { reports?: readonly ReportRef[] | null }>,
): number {
  const seen = new Set<string>();
  for (const group of Object.values(groups)) {
    for (const report of group.reports || []) {
      const hash = (report.hash || '').trim();
      const id = hash
        || [
          certnameKey(report.certname),
          report.start_time || '',
          report.receive_time || '',
        ].join('|');
      if (!id || id === '||') continue;
      seen.add(id);
    }
  }
  return seen.size;
}
