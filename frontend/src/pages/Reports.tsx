/**
 * OpenVox GUI - Reports.tsx
 * 
 * Component documentation to be expanded.
 */
import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Title, Table, Card, Loader, Center, Alert, TextInput, Stack, Group, Text, Grid,
  Select, Badge, Collapse, ActionIcon, ScrollArea, Button, Divider, Switch,
} from '@mantine/core';
import { IconSearch, IconChevronDown, IconChevronRight, IconSend, IconTrash, IconPlus } from '@tabler/icons-react';
import { useApi } from '../hooks/useApi';
import { reports, enc, nodes as nodesApi } from '../services/api';
import { useAppTheme } from '../hooks/ThemeContext';
import { StatusBadge } from '../components/StatusBadge';
import { ExportActions } from '../components/ExportActions';


/* ── REPORT-O-SCOPE 9000 — report analysis machine ──────── */
function ReportOScope() {
  return (
    <svg viewBox="0 0 500 300" style={{ maxHeight: 340, display: 'block', margin: '0 auto' }}>
      <defs>
        <linearGradient id="rpt-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1a1b2e" />
          <stop offset="100%" stopColor="#252540" />
        </linearGradient>
        <linearGradient id="rpt-machine" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#556677" />
          <stop offset="100%" stopColor="#3d4d5d" />
        </linearGradient>
        <linearGradient id="rpt-screen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0a1a2a" />
          <stop offset="100%" stopColor="#112233" />
        </linearGradient>
      </defs>

      <rect width="500" height="300" fill="url(#rpt-sky)" />

      {/* Stars */}
      <circle cx="12" cy="8" r="1" fill="#fff" opacity="0.5" />
      <circle cx="40" cy="20" r="1.2" fill="#fff" opacity="0.6" />
      <circle cx="70" cy="5" r="1" fill="#fff" opacity="0.4" />
      <circle cx="95" cy="35" r="1.5" fill="#fff" opacity="0.5" />
      <circle cx="120" cy="12" r="1" fill="#fff" opacity="0.7" />
      <circle cx="155" cy="42" r="1" fill="#fff" opacity="0.3" />
      <circle cx="175" cy="8" r="1.5" fill="#fff" opacity="0.5" />
      <circle cx="200" cy="28" r="1" fill="#fff" opacity="0.7" />
      <circle cx="230" cy="5" r="1" fill="#fff" opacity="0.4" />
      <circle cx="260" cy="38" r="1.5" fill="#fff" opacity="0.6" />
      <circle cx="285" cy="14" r="1" fill="#fff" opacity="0.5" />
      <circle cx="310" cy="32" r="1" fill="#fff" opacity="0.3" />
      <circle cx="335" cy="8" r="1.5" fill="#fff" opacity="0.6" />
      <circle cx="350" cy="45" r="1" fill="#fff" opacity="0.4" />
      <circle cx="380" cy="18" r="1" fill="#fff" opacity="0.7" />
      <circle cx="405" cy="40" r="1.5" fill="#fff" opacity="0.5" />
      <circle cx="420" cy="8" r="1" fill="#fff" opacity="0.6" />
      <circle cx="445" cy="30" r="1" fill="#fff" opacity="0.4" />
      <circle cx="460" cy="12" r="1.5" fill="#fff" opacity="0.5" />
      <circle cx="485" cy="25" r="1" fill="#fff" opacity="0.7" />
      <circle cx="15" cy="55" r="1" fill="#fff" opacity="0.3" />
      <circle cx="55" cy="60" r="1" fill="#fff" opacity="0.5" />
      <circle cx="130" cy="52" r="1.5" fill="#fff" opacity="0.4" />
      <circle cx="300" cy="50" r="1" fill="#fff" opacity="0.6" />
      <circle cx="470" cy="48" r="1" fill="#fff" opacity="0.4" />
      <circle cx="490" cy="5" r="1" fill="#fff" opacity="0.5" />
      <circle cx="5" cy="30" r="1" fill="#fff" opacity="0.6" />
      <circle cx="245" cy="18" r="1" fill="#fff" opacity="0.3" />

      {/* Ground */}
      <rect x="0" y="245" width="500" height="55" fill="#1a1a2e" />
      <rect x="0" y="245" width="500" height="2" fill="#333355" />

      {/* ── THE MACHINE ── */}
      <rect x="140" y="90" width="220" height="150" fill="url(#rpt-machine)" rx="8" stroke="#7788aa" strokeWidth="1.5" />

      {/* Machine label */}
      <rect x="170" y="100" width="160" height="20" fill="#334455" rx="3" />
      <text x="250" y="114" textAnchor="middle" fill="#44aaff" fontSize="9" fontFamily="monospace" fontWeight="bold">
        REPORT-O-SCOPE 9000
      </text>

      {/* Screen */}
      <rect x="160" y="128" width="180" height="80" fill="url(#rpt-screen)" rx="4" stroke="#44aaff" strokeWidth="1" opacity="0.8" />

      {/* Scrolling report lines on screen */}
      <g>
        <rect x="168" y="135" width="80" height="6" fill="#335566" rx="1" opacity="0.6">
          <animate attributeName="x" values="168;168;168" dur="3s" repeatCount="indefinite" />
        </rect>
        <rect x="260" y="135" width="16" height="6" fill="#44cc44" rx="1" opacity="0.8" />
        <text x="268" y="140" textAnchor="middle" fill="#fff" fontSize="5">✓</text>
      </g>
      <g>
        <rect x="168" y="146" width="65" height="6" fill="#335566" rx="1" opacity="0.5" />
        <rect x="260" y="146" width="16" height="6" fill="#44cc44" rx="1" opacity="0.8" />
        <text x="268" y="151" textAnchor="middle" fill="#fff" fontSize="5">✓</text>
      </g>
      <g>
        <rect x="168" y="157" width="90" height="6" fill="#335566" rx="1" opacity="0.6" />
        <rect x="260" y="157" width="16" height="6" fill="#ff4444" rx="1" opacity="0.9">
          <animate attributeName="opacity" values="0.9;0.4;0.9" dur="1.5s" repeatCount="indefinite" />
        </rect>
        <text x="268" y="162" textAnchor="middle" fill="#fff" fontSize="5">✗</text>
      </g>
      <g>
        <rect x="168" y="168" width="72" height="6" fill="#335566" rx="1" opacity="0.5" />
        <rect x="260" y="168" width="16" height="6" fill="#ffaa22" rx="1" opacity="0.8" />
        <text x="268" y="173" textAnchor="middle" fill="#fff" fontSize="5">△</text>
      </g>
      <g>
        <rect x="168" y="179" width="85" height="6" fill="#335566" rx="1" opacity="0.6" />
        <rect x="260" y="179" width="16" height="6" fill="#44cc44" rx="1" opacity="0.8" />
        <text x="268" y="184" textAnchor="middle" fill="#fff" fontSize="5">✓</text>
      </g>
      <g>
        <rect x="168" y="190" width="60" height="6" fill="#335566" rx="1" opacity="0.4" />
        <rect x="260" y="190" width="16" height="6" fill="#ffaa22" rx="1" opacity="0.8" />
        <text x="268" y="195" textAnchor="middle" fill="#fff" fontSize="5">△</text>
      </g>

      {/* Scan line */}
      <rect x="160" y="135" width="180" height="2" fill="#44aaff" opacity="0.3">
        <animate attributeName="y" values="128;206;128" dur="3s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.3;0.6;0.3" dur="3s" repeatCount="indefinite" />
      </rect>

      {/* Screen reflection */}
      <rect x="160" y="128" width="180" height="20" fill="#ffffff" opacity="0.03" rx="4" />

      {/* Status lights */}
      <circle cx="170" cy="220" r="4" fill="#44ff44">
        <animate attributeName="fill" values="#44ff44;#22aa22;#44ff44" dur="1.5s" repeatCount="indefinite" />
      </circle>
      <circle cx="183" cy="220" r="4" fill="#ffaa22">
        <animate attributeName="fill" values="#ffaa22;#cc8811;#ffaa22" dur="2s" repeatCount="indefinite" />
      </circle>
      <circle cx="196" cy="220" r="4" fill="#ff4444">
        <animate attributeName="fill" values="#ff4444;#cc2222;#ff4444" dur="2.5s" repeatCount="indefinite" />
      </circle>

      {/* Data readout panel */}
      <rect x="220" y="212" width="120" height="22" fill="#223344" rx="3" stroke="#445566" strokeWidth="0.5" />
      <text x="228" y="226" fill="#44ff44" fontSize="8" fontFamily="monospace">
        <animate attributeName="textContent" values="ANALYZING...;PROCESSING...;SCANNING..." dur="4s" repeatCount="indefinite" />
        ANALYZING...
      </text>

      {/* ── Magnifying glass / telescope arm ── */}
      {/* Arm extending left */}
      <rect x="60" y="148" width="84" height="10" fill="#667788" rx="3" />
      <circle cx="142" cy="153" r="8" fill="#556677" stroke="#7788aa" strokeWidth="1" />

      {/* Magnifying glass */}
      <circle cx="42" cy="140" r="28" fill="none" stroke="#88aacc" strokeWidth="4" />
      <circle cx="42" cy="140" r="24" fill="#112233" opacity="0.6" />
      {/* Lens glare */}
      <ellipse cx="34" cy="130" rx="8" ry="5" fill="#ffffff" opacity="0.1" transform="rotate(-20,34,130)" />

      {/* Report page being examined */}
      <rect x="28" y="126" width="28" height="28" fill="#ddeeff" rx="2" opacity="0.15" />
      <rect x="31" y="130" width="18" height="2" fill="#88aacc" opacity="0.3" />
      <rect x="31" y="134" width="14" height="2" fill="#88aacc" opacity="0.3" />
      <rect x="31" y="138" width="20" height="2" fill="#88aacc" opacity="0.3" />
      <rect x="31" y="142" width="12" height="2" fill="#88aacc" opacity="0.3" />
      <rect x="31" y="146" width="16" height="2" fill="#88aacc" opacity="0.3" />

      {/* Lens pulse */}
      <circle cx="42" cy="140" r="24" fill="none" stroke="#44aaff" strokeWidth="1" opacity="0.4">
        <animate attributeName="r" values="22;26;22" dur="2s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.4;0.1;0.4" dur="2s" repeatCount="indefinite" />
      </circle>

      {/* ── Printer arm extending right ── */}
      <rect x="358" y="148" width="60" height="10" fill="#667788" rx="3" />
      <circle cx="360" cy="153" r="8" fill="#556677" stroke="#7788aa" strokeWidth="1" />

      {/* Printed reports coming out */}
      <g>
        <rect x="415" y="120" width="30" height="38" fill="#ddeeff" rx="2" opacity="0.9">
          <animate attributeName="y" values="140;120;120" dur="4s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0;0.9;0.9" dur="4s" repeatCount="indefinite" />
        </rect>
        <rect x="419" y="128" width="18" height="2" fill="#667788" opacity="0.5">
          <animate attributeName="y" values="148;128;128" dur="4s" repeatCount="indefinite" />
        </rect>
        <rect x="419" y="133" width="14" height="2" fill="#667788" opacity="0.4">
          <animate attributeName="y" values="153;133;133" dur="4s" repeatCount="indefinite" />
        </rect>
        <rect x="419" y="138" width="20" height="2" fill="#667788" opacity="0.5">
          <animate attributeName="y" values="158;138;138" dur="4s" repeatCount="indefinite" />
        </rect>
        {/* Checkmark stamp */}
        <text x="430" y="150" textAnchor="middle" fill="#44cc44" fontSize="12" opacity="0.8">
          <animate attributeName="y" values="170;150;150" dur="4s" repeatCount="indefinite" />
          ✓
        </text>
      </g>

      {/* Stacked finished reports */}
      <rect x="440" y="210" width="30" height="35" fill="#ccddee" rx="2" opacity="0.3" />
      <rect x="443" y="213" width="24" height="29" fill="#ddeeff" rx="1" opacity="0.4" />
      <rect x="446" y="216" width="18" height="23" fill="#eef4ff" rx="1" opacity="0.5" />

      {/* ── Little robot operator ── */}
      {/* Body */}
      <rect x="380" y="210" width="20" height="28" fill="#667788" rx="3" />
      {/* Head */}
      <rect x="383" y="198" width="14" height="14" fill="#778899" rx="2" />
      {/* Eyes */}
      <rect x="386" y="202" width="3" height="3" fill="#44aaff" rx="0.5">
        <animate attributeName="fill" values="#44aaff;#88ccff;#44aaff" dur="2s" repeatCount="indefinite" />
      </rect>
      <rect x="391" y="202" width="3" height="3" fill="#44aaff" rx="0.5">
        <animate attributeName="fill" values="#44aaff;#88ccff;#44aaff" dur="2s" repeatCount="indefinite" />
      </rect>
      {/* Antenna */}
      <line x1="390" y1="198" x2="390" y2="190" stroke="#8899bb" strokeWidth="1.5" />
      <circle cx="390" cy="188" r="2.5" fill="#44aaff">
        <animate attributeName="fill" values="#44aaff;#88ccff;#44aaff" dur="1.5s" repeatCount="indefinite" />
      </circle>
      {/* Arms */}
      <line x1="380" y1="218" x2="370" y2="225" stroke="#667788" strokeWidth="2" />
      <line x1="400" y1="218" x2="415" y2="215" stroke="#667788" strokeWidth="2" />
      {/* Legs */}
      <line x1="385" y1="238" x2="382" y2="247" stroke="#667788" strokeWidth="2" />
      <line x1="395" y1="238" x2="398" y2="247" stroke="#667788" strokeWidth="2" />

      {/* Clipboard in hand */}
      <rect x="365" y="222" width="10" height="14" fill="#bbccdd" rx="1" />
      <rect x="367" y="225" width="6" height="1.5" fill="#667788" opacity="0.6" />
      <rect x="367" y="228" width="4" height="1.5" fill="#667788" opacity="0.5" />
      <rect x="367" y="231" width="5" height="1.5" fill="#667788" opacity="0.6" />

      {/* ── Gears ── */}
      <circle cx="155" cy="100" r="10" fill="none" stroke="#88aacc" strokeWidth="1.5" strokeDasharray="3 2">
        <animateTransform attributeName="transform" type="rotate" values="0 155 100;360 155 100" dur="4s" repeatCount="indefinite" />
      </circle>
      <circle cx="155" cy="100" r="3.5" fill="#445566" />
      <circle cx="345" cy="100" r="10" fill="none" stroke="#88aacc" strokeWidth="1.5" strokeDasharray="3 2">
        <animateTransform attributeName="transform" type="rotate" values="360 345 100;0 345 100" dur="4s" repeatCount="indefinite" />
      </circle>
      <circle cx="345" cy="100" r="3.5" fill="#445566" />

      {/* Caption */}
      <text x="250" y="267" textAnchor="middle" fill="#8899aa" fontSize="11" fontFamily="monospace">
        The Report-O-Scope 9000
      </text>
      <text x="250" y="283" textAnchor="middle" fill="#556677" fontSize="9" fontFamily="monospace">
        cataloging openvox runs so you don&#39;t have to
      </text>
    </svg>
  );
}

// ─── Grouped Reports View ──────────────────────────────────
interface GroupedReports {
  [groupName: string]: {
    nodes: string[];
    reports: any[];
    latestReportByNode?: Record<string, any>;
    status: 'unchanged' | 'changed' | 'failed';
  };
}

function getGroupStatus(reports: any[]): 'unchanged' | 'changed' | 'failed' {
  if (reports.length === 0) return 'unchanged';
  // Only consider the last 10 reports (most recent) for badge status
  const recentReports = reports.slice(0, 10);
  const hasFailed = recentReports.some(r => r.status === 'failed');
  if (hasFailed) return 'failed';
  const hasChanged = recentReports.some(r => r.status === 'changed');
  if (hasChanged) return 'changed';
  return 'unchanged';
}

function getStatusBadgeProps(status: 'unchanged' | 'changed' | 'failed') {
  switch (status) {
    case 'failed':
      return { color: 'red', label: 'Failed' };
    case 'changed':
      return { color: 'orange', label: 'Changed' };
    default:
      return { color: 'green', label: 'Unchanged' };
  }
}

export function ReportsPage() {
  const { isRobots } = useAppTheme();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  // Executive Summary Report (Fleet Health) recipients
  const [execRecipients, setExecRecipients] = useState<any[]>([]);
  const [newRecipientEmail, setNewRecipientEmail] = useState('');
  const [execLoading, setExecLoading] = useState(false);
  const [execError, setExecError] = useState<string | null>(null);
  const [execSuccess, setExecSuccess] = useState<string | null>(null);

  // From address and schedule (minimal feature port from referenced work)
  const [fromEmail, setFromEmail] = useState('');
  const [schedEnabled, setSchedEnabled] = useState(true);
  const [schedDay, setSchedDay] = useState(0);
  const [schedTime, setSchedTime] = useState('08:00');

  // Fetch hierarchy (groups and nodes)
  const { data: hierarchy, loading: hierarchyLoading } = useApi(
    () => enc.getHierarchy(),
    []
  );

  // Fetch reports
  const { data: reportList, loading: reportsLoading, error } = useApi(
    () => reports.list({ status: statusFilter || undefined, limit: 200 }),
    [statusFilter]
  );

  const loading = hierarchyLoading || reportsLoading;

  // Build group → nodes mapping and group reports
  const groupedReports: GroupedReports = useMemo(() => {
    if (!hierarchy || !reportList) return {};

    // Defensive dedup of the raw report list by hash (defensive against any
    // backend duplication, similar to node dedup in hierarchy and group building).
    const dedupedReportList = Array.from(
      new Map(reportList.map((r: any) => [r.hash, r])).values()
    );

    const groups: GroupedReports = {};

    // Build group → nodes map from hierarchy
    const groupNodes: Record<string, string[]> = {};
    hierarchy.groups?.forEach((group: any) => {
      groupNodes[group.name] = [];
    });

    // Assign nodes to groups — use Set per group to guarantee uniqueness.
    // A node appearing multiple times in hierarchy.nodes (intermittent source
    // data glitches, races, or stale ENC entries) must never produce duplicate
    // entries in a group's node list or inflate the "X nodes" counts.
    hierarchy.nodes?.forEach((node: any) => {
      // Nodes may have groups array (group names) or group_ids
      const nodeGroups = node.groups || [];
      if (nodeGroups.length > 0) {
        nodeGroups.forEach((g: string) => {
          if (!groupNodes[g]) groupNodes[g] = [];
          groupNodes[g].push(node.certname);
        });
      } else {
        // Node without explicit group - put in "Ungrouped"
        if (!groupNodes['Ungrouped']) groupNodes['Ungrouped'] = [];
        groupNodes['Ungrouped'].push(node.certname);
      }
    });

    // If no groups exist, create "All Nodes" group
    if (Object.keys(groupNodes).length === 0) {
      const allCerts = hierarchy.nodes?.map((n: any) => n.certname) || [];
      groupNodes['All Nodes'] = Array.from(new Set(allCerts));
    }

    // Group reports by node groups
    Object.entries(groupNodes).forEach(([groupName, nodeList]) => {
      // Deduplicate per-group node list (defensive — Set above on push sites
      // plus this final pass guarantees one entry per certname).
      const uniqueNodeList = Array.from(new Set(nodeList));
      // Sort the node's certnames alphabetically (defensive; backend hierarchy
      // now also returns nodes sorted, but per-group lists benefit from explicit sort).
      const sortedNodeList = [...uniqueNodeList].sort((a, b) => a.localeCompare(b));

      // Filter reports for this group and sort by certname so nodes appear
      // in alphabetical order when the group is expanded (consistent with
      // all other node lists/dropdowns/selectors in the app).
      let groupReports = dedupedReportList
        .filter((r: any) => sortedNodeList.includes(r.certname));
      // Deduplicate reports by hash (defensive — similar to node deduping in
      // hierarchy to avoid duplicate entries in the expanded report list or
      // inflated counts/behavior).
      const seenReports = new Set<string>();
      groupReports = groupReports.filter((r: any) => {
        if (seenReports.has(r.hash)) return false;
        seenReports.add(r.hash);
        return true;
      });
      groupReports.sort((a: any, b: any) => (a.certname || '').localeCompare(b.certname || ''));

      // Build map of latest report per node (for displaying one row per node in the list,
      // using the most recent report for that node).
      const latestReportByNode: Record<string, any> = {};
      for (const r of groupReports) {
        const existing = latestReportByNode[r.certname];
        if (!existing || (r.start_time && (!existing.start_time || new Date(r.start_time) > new Date(existing.start_time)))) {
          latestReportByNode[r.certname] = r;
        }
      }

      groups[groupName] = {
        nodes: sortedNodeList,
        reports: groupReports,
        latestReportByNode,
        status: getGroupStatus(groupReports),
      };
    });

    return groups;
  }, [hierarchy, reportList]);

  // Filter groups and reports by search
  const filteredGroups = useMemo(() => {
    if (!search) return groupedReports;
    const searchLower = search.toLowerCase();
    const filtered: GroupedReports = {};
    Object.entries(groupedReports).forEach(([groupName, data]) => {
      const groupMatches = groupName.toLowerCase().includes(searchLower);
      let finalNodes = data.nodes;
      let finalReports = data.reports;
      let finalLatest = data.latestReportByNode || {};
      if (!groupMatches) {
        const nodeCerts = new Set<string>(data.nodes.filter((n: string) => n.toLowerCase().includes(searchLower)));
        data.reports.forEach((r: any) => {
          if (r.certname.toLowerCase().includes(searchLower)) nodeCerts.add(r.certname);
        });
        finalNodes = Array.from(nodeCerts).filter((n: string) => data.nodes.includes(n));
        finalReports = data.reports.filter((r: any) => finalNodes.includes(r.certname));
        finalLatest = {};
        finalNodes.forEach((n: string) => {
          if (data.latestReportByNode && data.latestReportByNode[n]) {
            finalLatest[n] = data.latestReportByNode[n];
          }
        });
      }
      if (groupMatches || finalNodes.length > 0 || finalReports.length > 0) {
        filtered[groupName] = {
          ...data,
          nodes: finalNodes,
          reports: finalReports,
          latestReportByNode: finalLatest,
        };
      }
    });
    return filtered;
  }, [groupedReports, search]);

  const toggleGroup = (groupName: string) => {
    setExpandedGroups(prev => ({ ...prev, [groupName]: !prev[groupName] }));
  };

  // Executive Summary recipients management
  const loadExecutiveRecipients = async () => {
    setExecLoading(true);
    setExecError(null);
    try {
      const data = await reports.listExecutiveRecipients();
      setExecRecipients(Array.isArray(data) ? data : []);

      // Load from + schedule config
      try {
        const cfg = await reports.getExecutiveConfig();
        if (cfg) {
          if (cfg.from_email) setFromEmail(cfg.from_email);
          if (typeof cfg.schedule_enabled === 'boolean') setSchedEnabled(cfg.schedule_enabled);
          if (typeof cfg.schedule_day === 'number') setSchedDay(cfg.schedule_day);
          if (typeof cfg.schedule_hour === 'number' && typeof cfg.schedule_minute === 'number') {
            const h = String(cfg.schedule_hour).padStart(2, '0');
            const m = String(cfg.schedule_minute).padStart(2, '0');
            setSchedTime(`${h}:${m}`);
          }
        }
      } catch {}
    } catch (e: any) {
      setExecError(e?.message || 'Failed to load recipients');
      setExecRecipients([]);
    } finally {
      setExecLoading(false);
    }
  };

  const addExecutiveRecipient = async () => {
    const email = newRecipientEmail.trim();
    if (!email || !email.includes('@')) {
      setExecError('Please enter a valid email address');
      return;
    }
    setExecError(null);
    setExecSuccess(null);
    try {
      await reports.addExecutiveRecipient(email);
      setNewRecipientEmail('');
      await loadExecutiveRecipients();
      setExecSuccess(`Added ${email}`);
      setTimeout(() => setExecSuccess(null), 2500);
    } catch (e: any) {
      setExecError(e?.message || 'Failed to add recipient');
    }
  };

  const removeExecutiveRecipient = async (id: number) => {
    setExecError(null);
    setExecSuccess(null);
    try {
      await reports.deleteExecutiveRecipient(id);
      await loadExecutiveRecipients();
    } catch (e: any) {
      setExecError(e?.message || 'Failed to remove recipient');
    }
  };

  const saveExecutiveConfig = async () => {
    setExecError(null);
    setExecSuccess(null);
    try {
      const [h, m] = schedTime.split(':').map((x: string) => parseInt(x, 10) || 0);
      await reports.updateExecutiveConfig({
        from_email: fromEmail.trim() || null,
        schedule_enabled: schedEnabled,
        schedule_day: schedDay,
        schedule_hour: h,
        schedule_minute: m,
      });
      await loadExecutiveRecipients();
      setExecSuccess('Configuration saved');
      setTimeout(() => setExecSuccess(null), 2500);
    } catch (e: any) {
      setExecError(e?.message || 'Failed to save config');
    }
  };

  const sendAdHocReport = async (emails?: string[]) => {
    setExecError(null);
    setExecSuccess(null);
    try {
      await reports.sendExecutiveReport(emails, fromEmail || undefined);
      const target = emails && emails.length ? emails.join(', ') : 'all recipients';
      setExecSuccess(`Ad-hoc report queued for ${target}. Check server logs / mail for delivery.`);
      setTimeout(() => setExecSuccess(null), 4000);
      await loadExecutiveRecipients();
    } catch (e: any) {
      setExecError(e?.message || 'Failed to send report');
    }
  };

  useEffect(() => {
    loadExecutiveRecipients();
  }, []);

  if (loading) return <Center h={400}><Loader size="xl" /></Center>;
  if (error) return <Alert color="red" title="Error">{error}</Alert>;

  // Sort group names alphabetically for consistent ordering (like other lists in the app).
  // Note: filteredGroups may have fewer groups due to search, so we sort what's visible.
  const groupNames = Object.keys(filteredGroups).sort((a, b) => a.localeCompare(b));
  const totalReports = Object.values(filteredGroups).reduce((sum, g) => sum + g.reports.length, 0);

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Reports ({totalReports})</Title>
        <Group>
          <Select
            placeholder="Filter by status"
            data={[
              { value: '', label: 'All' },
              { value: 'changed', label: 'Changed' },
              { value: 'unchanged', label: 'Unchanged' },
              { value: 'failed', label: 'Failed' },
            ]}
            value={statusFilter}
            onChange={setStatusFilter}
            clearable
            style={{ width: 160 }}
          />
          <TextInput
            placeholder="Search by certname..."
            leftSection={<IconSearch size={16} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            style={{ width: 250 }}
          />
          <ExportActions
            results={Object.values(filteredGroups).flatMap(g => g.reports || [])}
            filenameBase="reports-export"
            variant="compact"
          />
        </Group>
      </Group>

      {/* Report-O-Scope illustration (casual only) */}
      {isRobots && (
        <Card withBorder shadow="sm" padding={0} style={{ overflow: 'hidden', background: 'linear-gradient(to bottom, #1a1b2e, #252540)' }}>
          <ReportOScope />
        </Card>
      )}

      {/* Grouped reports */}
      {groupNames.length === 0 ? (
        <Card withBorder shadow="sm">
          <Text c="dimmed" ta="center">No reports found</Text>
        </Card>
      ) : (
        <Stack gap="md">
          {groupNames.map((groupName) => {
            const groupData = filteredGroups[groupName];
            const { status, reports: groupReports, nodes, latestReportByNode = {} } = groupData;
            const badgeProps = getStatusBadgeProps(status);
            const isExpanded = expandedGroups[groupName] ?? false;

            return (
              <Card key={groupName} withBorder shadow="sm">
                <Group justify="space-between" style={{ cursor: 'pointer' }} onClick={() => toggleGroup(groupName)}>
                  <Group>
                    <ActionIcon variant="subtle" size="sm">
                      {isExpanded ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
                    </ActionIcon>
                    <Text fw={700}>{groupName}</Text>
                    <Text c="dimmed" size="sm">({nodes.length} node{nodes.length !== 1 ? 's' : ''})</Text>
                  </Group>
                  <Badge color={badgeProps.color} variant="filled" size="sm">
                    {badgeProps.label}
                  </Badge>
                </Group>
                <Collapse in={isExpanded}>
                  <ScrollArea mah={480} mt="sm" type="auto" offsetScrollbars scrollbarSize={6}>
                    <Table striped highlightOnHover withTableBorder>
                          <Table.Thead>
                            <Table.Tr>
                              <Table.Th>Certname</Table.Th>
                              <Table.Th>Status</Table.Th>
                              <Table.Th>Type</Table.Th>
                              <Table.Th>Environment</Table.Th>
                              <Table.Th>Start Time</Table.Th>
                              <Table.Th>OpenVox Version</Table.Th>
                            </Table.Tr>
                          </Table.Thead>
                          <Table.Tbody>
                            {nodes.length === 0 ? (
                              <Table.Tr>
                                <Table.Td colSpan={6}><Text c="dimmed" ta="center">No nodes for this group</Text></Table.Td>
                              </Table.Tr>
                            ) : (
                              nodes.map((certname: string) => {
                                const report = latestReportByNode[certname];
                                return (
                                  <Table.Tr
                                    key={certname}
                                    style={{ cursor: report ? 'pointer' : 'default' }}
                                    onClick={() => {
                                      if (report) navigate(`/reports/${report.hash}`);
                                      else navigate(`/nodes/${certname}`);
                                    }}
                                  >
                                    <Table.Td><Text fw={500}>{certname}</Text></Table.Td>
                                    <Table.Td>{report ? <StatusBadge status={report.status} /> : <Text c="dimmed">—</Text>}</Table.Td>
                                    <Table.Td>
                                      {report ? (
                                        report.corrective_change ? (
                                          <Badge color="orange" variant="light" size="sm">Corrective</Badge>
                                        ) : report.noop ? (
                                          <Badge color="blue" variant="light" size="sm">Noop</Badge>
                                        ) : (
                                          <Badge color="gray" variant="light" size="sm">Intentional</Badge>
                                        )
                                      ) : <Text c="dimmed">—</Text>}
                                    </Table.Td>
                                    <Table.Td>{report ? report.environment || '—' : '—'}</Table.Td>
                                    <Table.Td>{report && report.start_time ? new Date(report.start_time).toLocaleString() : '—'}</Table.Td>
                                    <Table.Td>{report ? report.puppet_version || '—' : '—'}</Table.Td>
                                  </Table.Tr>
                                );
                              })
                            )}
                          </Table.Tbody>
                        </Table>
                  </ScrollArea>
                </Collapse>
              </Card>
            );
          })}
        </Stack>
      )}

      {/* Executive Summary Report configuration pane (at bottom of Reports page) */}
      <Divider my="xl" />
      <Stack>
        <Group justify="space-between" align="center">
          <div>
            <Title order={3}>Executive Summary Report</Title>
            <Text size="sm" c="dimmed">
              Recipients for the weekly one-page Fleet Health PDF. Ad-hoc delivery uses live data from the server.
            </Text>
          </div>
          <Button
            leftSection={<IconSend size={16} />}
            onClick={() => sendAdHocReport()}
            disabled={execRecipients.length === 0}
            variant="light"
          >
            Send to all now
          </Button>
        </Group>

        {execError && (
          <Alert color="red" title="Error" onClose={() => setExecError(null)} withCloseButton>
            {execError}
          </Alert>
        )}
        {execSuccess && (
          <Alert color="green" title="Success" onClose={() => setExecSuccess(null)} withCloseButton>
            {execSuccess}
          </Alert>
        )}

        {/* Add new recipient */}
        <Group>
          <TextInput
            placeholder="Add email recipient (e.g. manager@company.com)"
            value={newRecipientEmail}
            onChange={(e) => setNewRecipientEmail(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addExecutiveRecipient();
            }}
            style={{ flex: 1, maxWidth: 420 }}
          />
          <Button
            leftSection={<IconPlus size={16} />}
            onClick={addExecutiveRecipient}
            disabled={!newRecipientEmail.trim()}
          >
            Add Recipient
          </Button>
        </Group>

        {/* Recipients list */}
        <Card withBorder shadow="sm" p="sm">
          {execLoading ? (
            <Center py="md"><Loader size="sm" /></Center>
          ) : execRecipients.length === 0 ? (
            <Text c="dimmed" ta="center" py="sm">No recipients configured yet. Add emails above.</Text>
          ) : (
            <Table striped highlightOnHover withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Email</Table.Th>
                  <Table.Th>Added</Table.Th>
                  <Table.Th>Last Sent</Table.Th>
                  <Table.Th style={{ width: 160 }}>Actions</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {execRecipients.map((rec: any) => (
                  <Table.Tr key={rec.id}>
                    <Table.Td>
                      <Text fw={500}>{rec.email}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" c="dimmed">
                        {rec.added_at ? new Date(rec.added_at).toLocaleString() : '—'}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" c="dimmed">
                        {rec.last_sent_at ? new Date(rec.last_sent_at).toLocaleString() : 'Never'}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Group gap="xs">
                        <Button
                          size="xs"
                          variant="light"
                          leftSection={<IconSend size={14} />}
                          onClick={() => sendAdHocReport([rec.email])}
                        >
                          Send now
                        </Button>
                        <ActionIcon
                          color="red"
                          variant="subtle"
                          onClick={() => removeExecutiveRecipient(rec.id)}
                          title="Remove recipient"
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Card>

        {/* From email and schedule (referenced minimal feature) */}
        <Divider my="sm" />
        <Text size="sm" fw={500}>From address</Text>
        <Group>
          <TextInput
            placeholder="reports@yourcompany.com (optional custom From:)"
            value={fromEmail}
            onChange={(e) => setFromEmail(e.currentTarget.value)}
            style={{ flex: 1, maxWidth: 420 }}
          />
          <Button size="sm" onClick={saveExecutiveConfig}>Save</Button>
        </Group>

        <Text size="sm" fw={500} mt="sm">Schedule</Text>
        <Group>
          <Switch
            label="Enable scheduled"
            checked={schedEnabled}
            onChange={(e) => setSchedEnabled(e.currentTarget.checked)}
          />
          <Select
            label="Day"
            data={[{value:'0',label:'Mon'},{value:'1',label:'Tue'},{value:'2',label:'Wed'},{value:'3',label:'Thu'},{value:'4',label:'Fri'},{value:'5',label:'Sat'},{value:'6',label:'Sun'}]}
            value={String(schedDay)}
            onChange={(v) => setSchedDay(parseInt(v||'0',10))}
            style={{width:100}}
          />
          <TextInput
            label="Time"
            type="time"
            value={schedTime}
            onChange={(e) => setSchedTime(e.currentTarget.value)}
            style={{width:120}}
          />
          <Button size="sm" onClick={saveExecutiveConfig}>Save Schedule</Button>
        </Group>

        <Text size="xs" c="dimmed">
          Scheduled runs use the server timer + script (honors day/time). Ad-hoc always available. From address used for email.
        </Text>

        <Text size="xs" c="dimmed">
          The scheduled Monday 8AM report will also pick up this list (via the GUI API when no value is set in .env).
          Make sure <code>mail</code> or <code>mailx</code> works on the server for email delivery.
        </Text>
      </Stack>
    </Stack>
  );
}
