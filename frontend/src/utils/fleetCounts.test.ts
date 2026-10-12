import { describe, expect, it } from 'vitest';
import {
  countActiveClassified,
  countDistinctReports,
  countFleetNodes,
  distinctNodeCount,
  groupClassifiedNodes,
} from './fleetCounts';

function node(
  certname: string,
  enc?: { environment?: string | null; groups?: string[] },
) {
  return {
    certname,
    enc_environment: enc?.environment ?? null,
    enc_groups: enc?.groups ?? [],
  };
}

describe('countFleetNodes', () => {
  it('counts the 3-node unclassified fleet from issue 104 once', () => {
    const fleet = [
      node('node1.example'),
      node('node2.example'),
      node('node3.example'),
    ];
    const counts = countFleetNodes(fleet);
    const groups = groupClassifiedNodes(fleet);
    const oldHeader =
      Object.values(groups).reduce((sum, group) => sum + group.nodes.length, 0)
      + (counts?.unclassified ?? 0);

    expect(counts).toMatchObject({ total: 3, classified: 0, unclassified: 3 });
    expect(counts!.classified + counts!.unclassified).toBe(counts!.total);
    expect(groups).toEqual({});
    expect(oldHeader).toBe(3);
    expect(counts!.unclassifiedCertnames).toEqual([
      'node1.example',
      'node2.example',
      'node3.example',
    ]);
  });

  it('counts a partially classified fleet without treating Ungrouped as unclassified', () => {
    const fleet = [
      node('web.example', { environment: 'production', groups: ['web'] }),
      node('lone.example', { environment: 'production', groups: [] }),
      node('new.example'),
    ];
    const counts = countFleetNodes(fleet);
    const groups = groupClassifiedNodes(fleet);

    expect(counts).toMatchObject({ total: 3, classified: 2, unclassified: 1 });
    expect(counts!.classified + counts!.unclassified).toBe(counts!.total);
    expect(groups.web.nodes.map((n) => n.certname)).toEqual(['web.example']);
    expect(groups.Ungrouped.nodes.map((n) => n.certname)).toEqual(['lone.example']);
    expect(groups.Ungrouped.nodes.some((n) => n.certname === 'new.example')).toBe(false);
  });

  it('counts a fully classified fleet, including a node that is in two groups, once', () => {
    const fleet = [
      node('a.example', { environment: 'production', groups: ['web', 'db'] }),
      node('b.example', { environment: 'production', groups: ['web'] }),
      node('c.example', { environment: 'staging', groups: ['db'] }),
    ];
    const counts = countFleetNodes(fleet);
    const groups = groupClassifiedNodes(fleet);
    const summedMemberships = Object.values(groups).reduce(
      (sum, group) => sum + group.nodes.length,
      0,
    );

    expect(counts).toMatchObject({ total: 3, classified: 3, unclassified: 0 });
    expect(counts!.classified + counts!.unclassified).toBe(counts!.total);
    expect(summedMemberships).toBe(4);
    expect(counts!.classified).toBe(3);
    expect(groups.web.nodes.map((n) => n.certname)).toEqual(['a.example', 'b.example']);
    expect(groups.db.nodes.map((n) => n.certname)).toEqual(['a.example', 'c.example']);
  });

  it('dedupes certname case and repeated rows before counting', () => {
    const fleet = [
      node('Node.Example', { environment: 'production', groups: ['web'] }),
      node('node.example', { environment: 'production', groups: ['db'] }),
      node('other.example'),
      node('OTHER.example'),
    ];
    const counts = countFleetNodes(fleet);
    expect(counts).toMatchObject({ total: 2, classified: 1, unclassified: 1 });
    expect(distinctNodeCount(fleet)).toBe(2);
  });

  it('counts an empty fleet as zero and a list that has not loaded as unknown', () => {
    expect(countFleetNodes([])).toMatchObject({
      total: 0,
      classified: 0,
      unclassified: 0,
    });
    expect(countFleetNodes(null)).toBeNull();
    expect(countFleetNodes(undefined)).toBeNull();
    expect(distinctNodeCount(null)).toBeNull();
    expect(distinctNodeCount([])).toBe(0);
  });

  it('does not add a separately loaded ENC roster onto a fleet that is still loading', () => {
    const encRoster = [
      node('a.example', { environment: 'production', groups: ['web'] }),
      node('b.example', { environment: 'production', groups: ['web'] }),
      node('c.example', { environment: 'production', groups: ['web'] }),
    ];
    expect(countFleetNodes(null)).toBeNull();
    expect(countActiveClassified(
      encRoster.map((n) => n.certname),
      null,
    )).toBeNull();

    const fleetWithoutJoin = [
      node('a.example'),
      node('b.example'),
      node('c.example'),
    ];
    const counts = countFleetNodes(fleetWithoutJoin);
    expect(counts?.total).toBe(3);
    expect(counts?.total).not.toBe(fleetWithoutJoin.length + encRoster.length);
  });
});

describe('countActiveClassified', () => {
  it('waits for both lists, then counts the certname intersection once', () => {
    expect(countActiveClassified(['a', 'b'], null)).toBeNull();
    expect(countActiveClassified(null, ['a'])).toBeNull();
    expect(countActiveClassified(['A.example', 'a.example', 'stale.example'], [
      'a.example',
      'other.example',
    ])).toBe(1);
    expect(countActiveClassified([], [])).toBe(0);
  });
});

describe('countDistinctReports', () => {
  it('counts a report once when the node is copied into two groups', () => {
    const shared = { hash: 'abc', certname: 'a.example' };
    const onlyWeb = { hash: 'def', certname: 'b.example' };
    const total = countDistinctReports({
      web: { reports: [shared, onlyWeb] },
      db: { reports: [shared] },
    });
    const summed = [shared, onlyWeb].length + [shared].length;
    expect(summed).toBe(3);
    expect(total).toBe(2);
  });
});
