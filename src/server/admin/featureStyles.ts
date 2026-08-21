/** Proxy, Worker, modal, responsive, and other feature-level styles. */
export const ADMIN_FEATURE_STYLES = `    /* ── Proxy Pool layout ── */
    .readiness-band { display:flex; align-items:center; justify-content:space-between; gap:16px; min-height:58px; padding:10px 14px; margin-bottom:12px; border:1px solid var(--border); border-left:3px solid var(--accent); border-radius:var(--radius-sm); background:var(--panel-solid); }
    .readiness-band.ok { border-left-color:var(--ok); }
    .readiness-band.warn { border-left-color:var(--warn); }
    .readiness-copy { min-width:0; }
    .readiness-title { font-weight:650; }
    .readiness-detail, .panel-sub { margin:2px 0 0; color:var(--muted); font-size:11px; font-weight:400; }
    .proxy-tabs { display:flex; align-items:center; gap:4px; width:max-content; max-width:100%; margin-bottom:14px; padding:3px; border:1px solid var(--border); border-radius:var(--radius); background:var(--panel-2); overflow-x:auto; }
    .proxy-tab { min-height:32px; border:1px solid transparent; border-radius:var(--radius-sm); background:transparent; color:var(--muted); padding:6px 12px; white-space:nowrap; font-weight:600; }
    .proxy-tab:hover { color:var(--text); background:var(--accent-surface); }
    .proxy-tab.active { color:var(--accent-hi); background:var(--panel-solid); border-color:var(--accent-border); box-shadow:var(--shadow-sm); }
    [data-proxy-section] { display:none; }
    [data-proxy-section].proxy-section-active { display:block; }
    .pp-grid {
      display: grid;
      grid-template-columns: 1fr 340px;
      gap: 14px;
      align-items: stretch;
    }
    .pp-grid.sources-view { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
    .pp-main { display: flex; flex-direction: column; gap: 14px; min-width: 0; height:100%; }
    .pp-side { display: flex; flex-direction: column; gap: 14px; min-width: 0; height:100%; }
    .pp-main > .proxy-section-active, .pp-side > .proxy-section-active { flex:1; }

    /* Isolation map */
    .iso-body { display: grid; grid-template-columns: 1fr 160px; gap: 0; }
    .iso-map { padding: 12px 16px 14px; border-right: 1px solid var(--border); }
    .iso-cols {
      display: grid; grid-template-columns: 1fr 1.1fr 1fr; gap: 4px;
      font-size: 10px; color: var(--muted); text-transform: uppercase;
      letter-spacing: 0; margin-bottom: 10px; font-weight: 600;
    }
    .iso-row {
      display: grid; grid-template-columns: 1fr auto 1.1fr auto 1fr;
      align-items: center; gap: 6px; margin-bottom: 8px;
      animation: fade-up 0.3s ease-out backwards;
    }
    .iso-row:nth-child(1) { animation-delay: 0ms; }
    .iso-row:nth-child(2) { animation-delay: 50ms; }
    .iso-row:nth-child(3) { animation-delay: 100ms; }
    .iso-row:nth-child(4) { animation-delay: 150ms; }
    .iso-row:nth-child(5) { animation-delay: 200ms; }
    @keyframes fade-up {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .iso-node {
      background: var(--bg-elevated); border: 1px solid var(--border);
      border-radius: var(--radius-sm); padding: 8px 10px; min-width: 0;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .iso-node:hover { border-color: var(--accent-border); box-shadow: 0 2px 8px var(--accent-glow); }
    .iso-node.shared { border-color: var(--warn-border); background: var(--warn-dim); }
    .iso-node .t { font-weight: 600; font-size: 12px; display: flex; align-items: center; gap: 6px; }
    .iso-node .s { font-family: var(--mono); font-size: 11px; color: var(--muted); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .iso-arrow { color: var(--faint); font-size: 12px; }
    .bridge-chip {
      font-size: 10px; font-weight: 600; color: var(--accent-hi);
      border: 1px dashed var(--accent-border); border-radius: 999px;
      padding: 2px 7px; white-space: nowrap; background: var(--accent-surface);
    }
    .dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
    .dot.ok { background: var(--ok); box-shadow: 0 0 6px var(--ok); }
    .dot.warn { background: var(--warn); box-shadow: 0 0 6px var(--warn); }
    .dot.err { background: var(--err); box-shadow: 0 0 6px var(--err); }
    .iso-legend {
      display: flex; align-items: center; justify-content: space-between;
      gap: 10px; flex-wrap: wrap; margin-top: 6px; padding-top: 8px;
      border-top: 1px solid var(--border); font-size: 11px; color: var(--muted);
    }
    .iso-legend .items { display: flex; gap: 12px; }
    .iso-legend .items span { display: inline-flex; align-items: center; gap: 5px; }
    .iso-health {
      padding: 18px 14px; display: flex; flex-direction: column; align-items: center;
      text-align: center; gap: 10px; justify-content: center;
    }
    .iso-health .big {
      font-size: 30px; font-weight: 700; line-height: 1; font-family: var(--mono);
    }
    .iso-health .big span { font-size: 14px; color: var(--muted); font-weight: 500; }
    .iso-health .desc { font-size: 12px; color: var(--muted); max-width: 130px; }
    .shield {
      width: 52px; height: 52px; border-radius: 50%;
      background: var(--ok-dim); border: 1px solid var(--ok-border);
      display: grid; place-items: center; color: var(--ok);
      box-shadow: 0 0 20px var(--ok-dim);
      animation: shield-pulse 3s ease-in-out infinite;
    }
    @keyframes shield-pulse {
      0%, 100% { box-shadow: 0 0 20px var(--ok-dim); }
      50% { box-shadow: 0 0 30px var(--ok-dim), 0 0 10px var(--ok-dim); }
    }
    .shield.warn { background: var(--warn-dim); border-color: var(--warn-border); color: var(--warn); box-shadow: 0 0 20px var(--warn-dim); }
    .shield.err { background: var(--err-dim); border-color: var(--err-border); color: var(--err); box-shadow: 0 0 20px var(--err-dim); }
    .iso-health .status-txt { font-weight: 600; font-size: 12px; color: var(--ok); }
    .iso-health .status-txt.warn { color: var(--warn); }
    .iso-health .status-txt.err { color: var(--err); }
    .hover-detail { cursor:help; outline:none; }
    .hover-detail:focus-visible { box-shadow:0 0 0 2px var(--accent-border); }
    .ui-tooltip {
      position:fixed; z-index:1000; width:max-content; max-width:min(320px, calc(100vw - 24px));
      max-height:calc(100vh - 24px); padding:8px 10px; border:1px solid var(--border-hi);
      border-radius:var(--radius); background:var(--panel-solid); color:var(--text-2);
      box-shadow:var(--shadow-lg);
      font-size:12px; font-weight:400; line-height:1.45; text-align:left; white-space:pre-line;
      overflow:hidden; pointer-events:none; opacity:0; transform:translateY(2px);
      transition:opacity .12s ease, transform .12s ease;
    }
    .ui-tooltip[hidden] { display:none; }
    .ui-tooltip.is-visible { opacity:1; transform:translateY(0); }
    .ui-tooltip-arrow {
      position:absolute; left:var(--tooltip-arrow-x); width:8px; height:8px;
      background:var(--panel-solid); border:solid var(--border-hi); transform:translateX(-50%) rotate(45deg);
    }
    .ui-tooltip[data-placement="top"] .ui-tooltip-arrow { bottom:-5px; border-width:0 1px 1px 0; }
    .ui-tooltip[data-placement="bottom"] .ui-tooltip-arrow { top:-5px; border-width:1px 0 0 1px; }

    /* Subscriptions */
    .sub-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px;
    }
    .sub-card {
      background: var(--accent-panel); backdrop-filter: blur(10px);
      border: 1px solid var(--accent-panel-border);
      border-radius: var(--radius); padding: 14px; display: flex; flex-direction: column; gap: 8px;
      transition: border-color 0.18s var(--ease-standard), box-shadow 0.18s var(--ease-standard);
    }
    .sub-card:hover { border-color: var(--accent-border); box-shadow: 0 4px 16px var(--accent-glow); }
    .sub-card.err { border-color: var(--err-border); }
    .sub-card .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
    .sub-card .name { font-weight: 600; font-size: 13px; }
    .sub-card .url {
      font-family: var(--mono); font-size: 11px; color: var(--muted);
      display: flex; align-items: center; gap: 4px; min-width: 0;
    }
    .sub-card .url span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sub-card .meta { font-size: 11px; color: var(--muted); display: flex; justify-content: space-between; gap: 8px; }
    .sub-card .diagnostics { display:grid; grid-template-columns:auto 1fr; gap:3px 8px; font-size:10px; color:var(--muted); }
    .sub-card .diagnostics b { color:var(--text-2); font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .sub-card .proto { font-size: 11px; color: var(--text-2); }
    .sub-card .err-msg { font-size: 11px; color: var(--err); }
    .sub-card .acts { display: flex; gap: 6px; margin-top: auto; flex-wrap: wrap; }

    /* Table */
    .table-tools {
      display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
      padding: 10px 14px; border-bottom: 1px solid var(--border);
    }
    .table-tools .search {
      position: relative; flex: 1; min-width: 160px; max-width: 260px;
    }
    .table-tools .search input { padding-right: 28px; }
    .table-tools .search svg {
      position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
      color: var(--muted); pointer-events: none;
    }
    .table-tools .select { width: auto; min-width: 120px; }
    .table-wrap { overflow: auto; max-height: 360px; }
    .attempts-table { min-width: 980px; }
    .attempts-table td { vertical-align: top; }
    .attempt-error {
      max-width: 260px; overflow: hidden; text-overflow: ellipsis;
      white-space: nowrap; color: var(--muted); font-size: 11px; margin-top: 3px;
    }
    .usage-summary { display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:1px; background:var(--border); border-bottom:1px solid var(--border); }
    .usage-summary-item { min-width:0; padding:12px 16px; background:var(--panel-solid); }
    .usage-summary-item .label { color:var(--muted); font-size:10px; text-transform:uppercase; }
    .usage-summary-item .value { margin-top:3px; color:var(--text); font-size:18px; font-weight:700; }
    .usage-summary-item .detail { display:none; }
    .metric-footline { color:var(--muted); font-size:11px; }
    .overview-workers-table { min-width:900px; table-layout:fixed; }
    .overview-workers-table th:nth-child(1) { width:23%; }
    .overview-workers-table th:nth-child(2) { width:20%; }
    .overview-workers-table th:nth-child(3), .overview-workers-table th:nth-child(4) { width:7%; }
    .overview-workers-table th:nth-child(5), .overview-workers-table th:nth-child(6) { width:14%; }
    .overview-workers-table th:nth-child(7) { width:7%; }
    .overview-workers-table th:nth-child(8) { width:8%; }
    table.nodes.overview-workers-table td { white-space:normal; overflow-wrap:anywhere; }
    .worker-route-primary { max-width:380px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .mobile-cell-label { display:none; }
    .worker-meta { display:flex; align-items:center; gap:6px; margin-top:4px; min-width:0; }
    .attempt-position { cursor:help; }
    table.nodes {
      width: 100%; border-collapse: collapse; font-size: 12px;
    }
    table.nodes th {
      text-align: left; padding: 8px 12px; color: var(--muted);
      font-weight: 600; font-size: 11px; border-bottom: 1px solid var(--border);
      position: sticky; top: 0; background: var(--panel-solid); z-index: 1;
      white-space: nowrap; text-transform: uppercase; letter-spacing: 0;
    }
    table.nodes td {
      padding: 8px 12px; border-bottom: 1px solid var(--border);
      vertical-align: middle; white-space: nowrap;
    }
    table.nodes tr { transition: background 0.15s; }
    table.nodes tr:hover td { background: var(--accent-surface); }
    table.nodes tr.row-warn td { background: var(--warn-dim); }
    table.nodes tr.row-err td { background: var(--err-dim); }
    table.nodes .name-cell { display: flex; align-items: center; gap: 6px; font-weight: 500; }
    .table-foot {
      display: flex; justify-content: space-between; align-items: center;
      gap: 10px; flex-wrap: wrap; padding: 10px 14px; border-top: 1px solid var(--border);
      font-size: 11px; color: var(--muted);
    }
    .table-foot .sum b.ok { color: var(--ok); font-weight: 600; }
    .table-foot .sum b.warn { color: var(--warn); font-weight: 600; }
    .table-foot .sum b.err { color: var(--err); font-weight: 600; }
    .pager { display: flex; align-items: center; gap: 4px; }
    .pager button {
      min-width: 28px; height: 28px; padding: 0 6px;
      border: 1px solid var(--border); background: var(--glass-bg);
      border-radius: var(--radius-sm); color: var(--text-2);
    }
    .pager button:hover { border-color: var(--accent-border); background: var(--accent-surface); }
    .pager button.active { background: var(--accent-solid); border-color: var(--accent-solid); color: var(--accent-on-solid); box-shadow: 0 2px 8px var(--accent-glow); }
    .pager button:disabled { opacity: 0.4; cursor:not-allowed; pointer-events:none; }
    .list-pagination[hidden] { display:none; }
    .worker-pagination { margin-top:2px; border:1px solid var(--border); border-radius:var(--radius-sm); }
    .lat { font-family: var(--mono); font-size: 12px; }
    .lat.ok { color: var(--ok); }
    .lat.err { color: var(--err); }
    .lat.muted { color: var(--muted); }
    @keyframes spin { to { transform: rotate(360deg); } }
    .spin {
      display: inline-block; width: 12px; height: 12px;
      border: 2px solid var(--border-hi); border-top-color: var(--accent);
      border-radius: 50%; animation: spin 0.7s linear infinite;
      vertical-align: -2px; margin-right: 4px;
    }

    /* Side cards */
    .bridge-form .row { margin-bottom: 8px; }
    .bridge-actions { display: flex; gap: 8px; margin-top: 4px; }
    .bridge-actions .btn { flex: 1; }
    .probe-ok {
      margin-top: 10px; padding: 8px 10px; border-radius: var(--radius-sm);
      background: var(--ok-dim); border: 1px solid var(--ok-border);
      color: var(--ok); font-size: 12px; display: none; align-items: center; gap: 6px;
    }
    .probe-ok.show { display: flex; animation: fade-up 0.25s ease-out; }
    .probe-ok.fail {
      background: var(--err-dim); border-color: var(--err-border); color: var(--err);
    }

    .activity-list { list-style: none; margin: 0; padding: 0; }
    .activity-list li {
      display: grid; grid-template-columns: 14px 1fr auto; gap: 8px;
      padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 12px;
    }
    .activity-list li:last-child { border-bottom: none; }
    .activity-list .title { font-weight: 500; }
    .activity-list .sub { color: var(--muted); font-size: 11px; margin-top: 2px; }
    .activity-list .time { color: var(--muted); font-size: 11px; white-space: nowrap; }
    .empty-dash {
      border: 1px dashed var(--border-hi); border-radius: var(--radius);
      padding: 24px 14px; text-align: center; color: var(--muted);
    }
    .empty-dash .ico { font-size: 24px; margin-bottom: 8px; opacity: 0.6; }
    .empty-dash strong { display: block; color: var(--text-2); margin-bottom: 2px; }

    /* Other pages */
    .stack { display: flex; flex-direction: column; gap: 14px; max-width: 880px; }
    .gateway-stack { max-width: 980px; }
    .gateway-flow {
      padding: 14px 16px; border: 1px solid var(--accent-border); border-radius: var(--radius);
      background: var(--accent-surface); box-shadow: var(--shadow-sm);
    }
    .gateway-flow-title { color: var(--accent-hi); font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0; }
    .gateway-flow-path { display: flex; align-items: center; gap: 8px; margin-top: 10px; overflow-x: auto; padding-bottom: 2px; }
    .gateway-flow-node { flex: 0 0 auto; padding: 7px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--panel-solid); color: var(--text-2); font-size: 12px; font-weight: 600; white-space: nowrap; }
    .gateway-flow-node.active { border-color: var(--accent-border); color: var(--accent-hi); box-shadow: 0 0 0 2px var(--accent-surface); }
    .gateway-flow-arrow { flex: 0 0 auto; color: var(--muted); }
    .gateway-flow-note { margin: 10px 0 0; color: var(--muted); font-size: 11px; }
    .gateway-panel .panel-hd { align-items: flex-start; }
    .gateway-advanced .panel-hd { background: var(--bg-elevated); }
    .gateway-advanced .panel-sub { max-width: 620px; }
    .nav-group-toggle { display:flex; align-items:center; gap:8px; width:100%; margin:14px 0 4px; padding:6px 10px; border:0; background:transparent; color:var(--muted); font-size:10px; font-weight:700; letter-spacing:0; text-align:left; text-transform:uppercase; }
    .nav-group-toggle:first-child { margin-top:2px; }
    .nav-group-toggle:hover { color:var(--text); }
    .nav-group-icon { color:var(--accent-hi); font-size:9px; }
    .nav-group-chevron { margin-left:auto; font-size:12px; }
    .nav-group.is-collapsed { display:none; }
    .sidebar.is-collapsed .nav-group-toggle { display:none; }
    .sidebar.is-collapsed .nav-group { display:block; margin-top:8px; padding-top:8px; border-top:1px solid var(--border); }
    .sidebar.is-collapsed .nav-group.is-collapsed { display:none; }
    .getting-started { margin: 14px 0; padding: 16px; border: 1px solid var(--accent-border); border-radius: var(--radius); background: var(--accent-surface); box-shadow: var(--shadow-sm); }
    .getting-started[hidden] { display:none; }
    .getting-started-head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }
    .getting-started h2 { margin:3px 0 0; font-size:16px; }
    .eyebrow { color:var(--accent-hi); font-size:10px; font-weight:700; letter-spacing:0; }
    .getting-started-steps { display:grid; grid-template-columns:repeat(5, minmax(0, 1fr)); gap:8px; margin-top:14px; }
    .getting-step { display:flex; align-items:flex-start; gap:8px; min-width:0; padding:10px; border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--panel-solid); color:var(--text); text-align:left; }
    .getting-step:hover { border-color:var(--accent-border); background:var(--accent-surface-hover); }
    .getting-step .step-num { display:grid; place-items:center; flex:0 0 22px; width:22px; height:22px; border-radius:50%; background:var(--accent-solid); color:var(--accent-on-solid); font-size:11px; font-weight:700; }
    .getting-step strong, .getting-step small { display:block; }
    .getting-step strong { font-size:12px; }
    .getting-step small { margin-top:3px; color:var(--muted); font-size:10px; line-height:1.35; }
    .guide-modal { max-width:560px; }
    .guide-list { display:grid; gap:12px; margin:16px 0; padding-left:24px; }
    .guide-list li { padding-left:4px; }
    .guide-list strong, .guide-list span { display:block; }
    .guide-list span { margin-top:3px; color:var(--muted); font-size:12px; line-height:1.45; }
    .guide-actions { display:flex; justify-content:flex-end; }
    .worker-card {
      border: 1px solid var(--accent-panel-border); border-radius: var(--radius);
      background: var(--accent-panel); backdrop-filter: blur(10px);
      padding: 14px 16px; margin-bottom: 10px;
      transition: border-color 0.18s var(--ease-standard), box-shadow 0.18s var(--ease-standard), opacity 0.18s var(--ease-standard);
    }
    .worker-card:hover { border-color: var(--accent-border); box-shadow: 0 4px 16px var(--accent-glow); }
    .worker-card.disabled-worker { opacity: 0.6; }
    .workers-stack { max-width: none; }
    #accounts.worker-columns {
      display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px;
      align-items: start;
    }
    .worker-column {
      min-width: 0;
    }
    .worker-column-hd {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      padding: 10px 14px; border-bottom: 1px solid var(--border);
      color: var(--text); font-weight: 600;
    }
    .worker-column-count {
      min-width: 24px; padding: 2px 8px; border-radius: 999px;
      background: var(--accent-surface); color: var(--accent-hi); text-align: center;
      font-family: var(--mono); font-size: 11px; font-weight: 600;
    }
    .worker-column-list { padding-top: 10px; }
    .worker-column-list.worker-list-scroll {
      max-height: calc(100vh - 235px); overflow: auto; padding-right: 6px;
    }
    .worker-column-list .worker-card:last-child { margin-bottom: 0; }
    .worker-column-empty {
      margin: 0; padding: 24px 10px; text-align: center; color: var(--muted);
    }
    .worker-card.is-collapsed-card { padding: 10px 14px; margin-bottom: 6px; }
    .worker-card.is-collapsed-card .hd { margin-bottom: 0; }
    .worker-card .hd {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 10px; font-weight: 600;
    }
    .worker-card .worker-actions {
      display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; align-items: center;
    }
    .worker-card .worker-title {
      min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .worker-card .worker-body.is-collapsed { display: none; }
    .worker-test-result {
      margin-top: 10px; padding: 8px 10px; border: 1px solid var(--border);
      border-radius: var(--radius); color: var(--text-2); font-size: 12px;
    }
    .worker-test-result.ok { border-color: rgba(34,197,94,.35); color: var(--ok); }
    .worker-test-result.fail { border-color: rgba(239,68,68,.35); color: var(--err); }
    .usage-box {
      border: 1px dashed var(--border-hi); border-radius: var(--radius);
      padding: 16px 18px; background: var(--glass-bg); backdrop-filter: blur(10px);
      line-height: 1.7; color: var(--text-2);
    }
    .usage-box code {
      font-family: var(--mono); font-size: 12px; color: var(--accent-hi);
      background: var(--accent-surface); padding: 2px 6px; border-radius: 4px;
    }

    /* Toast / Modal */
    .toast {
      position: fixed; left: 20px; bottom: 20px; z-index: 100;
      display: none; align-items: center; gap: 10px;
      padding: 12px 14px; min-width: 240px; max-width: 380px;
      background: var(--glass-bg); backdrop-filter: blur(var(--glass-blur)) saturate(1.2);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius); box-shadow: var(--shadow-lg); font-size: 13px;
    }
    .toast.show { display: flex; animation: toast-in 0.3s cubic-bezier(0.16, 1, 0.3, 1); }
    @keyframes toast-in {
      from { opacity: 0; transform: translateY(16px) scale(0.95); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    .toast.ok { border-color: var(--ok-border); }
    .toast.fail { border-color: var(--err-border); }
    .toast .x { margin-left: auto; background: none; border: none; color: var(--muted); padding: 2px 4px; }
    .modal-root {
      position: fixed; inset: 0; z-index: 90; display: none;
      align-items: center; justify-content: center;
      background: rgba(0,0,0,0.48); backdrop-filter: blur(4px);
    }
    .modal-root.show { display: flex; animation: modal-backdrop-in 0.2s ease-out; }
    @keyframes modal-backdrop-in { from { opacity: 0; } to { opacity: 1; } }
    .modal {
      width: min(440px, calc(100vw - 32px));
      background: var(--glass-bg); backdrop-filter: blur(var(--glass-blur)) saturate(1.2);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius); box-shadow: var(--shadow-lg); padding: 18px;
      animation: modal-enter 0.3s var(--ease-enter);
    }
    @keyframes modal-enter {
      from { opacity: 0; transform: translateY(12px) scale(0.96); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    .modal h3 {
      margin: 0 0 6px; font-size: 16px; font-weight: 700;
      display: flex; align-items: center; gap: 8px;
    }
    .modal p { margin: 0 0 14px; color: var(--muted); font-size: 13px; }
    .modal .acts { display: flex; justify-content: flex-end; gap: 8px; }
    .modal.form .row { margin-bottom: 10px; }
    .confirm-float {
      position: fixed; right: 24px; bottom: 24px; z-index: 95;
      width: 300px; display: none;
      background: var(--glass-bg); backdrop-filter: blur(var(--glass-blur)) saturate(1.2);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius); box-shadow: var(--shadow-lg); padding: 16px;
    }
    .confirm-float.show { display: block; animation: toast-in 0.3s cubic-bezier(0.16, 1, 0.3, 1); }
    .confirm-float h3 {
      margin: 0 0 6px; font-size: 14px; font-weight: 600;
      display: flex; align-items: center; gap: 8px;
    }
    .confirm-float p { margin: 0 0 4px; color: var(--muted); font-size: 12px; }
    .confirm-float .acts { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
    .confirm-float .close {
      position: absolute; top: 10px; right: 10px;
      background: none; border: none; color: var(--muted); padding: 2px;
    }

    .toggle {
      position: relative; width: 42px; height: 24px; flex-shrink: 0;
    }
    .toggle input { opacity: 0; width: 0; height: 0; position: absolute; }
    .toggle span {
      position: absolute; inset: 0; border-radius: 999px;
      background: var(--faint); border: 1px solid var(--border); cursor: pointer;
      transition: background 0.2s, border-color 0.2s;
    }
    .toggle span::after {
      content: ""; position: absolute; width: 16px; height: 16px; border-radius: 50%;
      background: #fff; top: 3px; left: 3px; box-shadow:0 1px 3px rgba(0,0,0,.24);
      transition: transform 0.2s var(--ease-standard);
    }
    .toggle input:focus-visible + span { outline:2px solid var(--accent); outline-offset:2px; }
    .toggle input:checked + span { background: var(--accent-solid); border-color: var(--accent-solid); box-shadow: 0 0 8px var(--accent-glow); }
    .toggle input:checked + span::after { transform: translateX(18px); }

    .more-menu {
      position: absolute; right: 0; top: calc(100% + 4px); z-index: 30;
      min-width: 180px; background: var(--glass-bg); backdrop-filter: blur(var(--glass-blur));
      border: 1px solid var(--glass-border);
      border-radius: var(--radius); box-shadow: var(--shadow-lg); display: none; padding: 5px;
    }
    .more-menu.show { display: block; animation: fade-up 0.2s ease-out; }
    .more-menu button {
      width: 100%; text-align: left; background: none; border: none;
      color: var(--text); padding: 9px 10px; border-radius: var(--radius-sm); font-size: 12px;
    }
    .source-menu { left:0; right:auto; min-width:240px; }
    .source-menu button { display:flex; flex-direction:column; gap:2px; }
    .source-menu strong { font-size:12px; font-weight:650; }
    .source-menu small { color:var(--muted); font-size:10px; }
    .more-menu button:hover { background: var(--accent-surface); color: var(--accent-hi); }
    .more-menu button.danger { color:var(--err); }
    .rel { position: relative; }

    @media (max-width: 1200px) {
      .metrics { grid-template-columns: repeat(2, 1fr); }
      .pp-grid { grid-template-columns: 1fr; }
      .pp-grid.sources-view { grid-template-columns: 1fr; }
      .pp-main, .pp-side { height:auto; }
      .pp-main > .proxy-section-active, .pp-side > .proxy-section-active { flex:none; }
      .iso-body { grid-template-columns: 1fr; }
      .iso-map { border-right: none; border-bottom: 1px solid var(--border); }
    }
    @media (max-width: 900px) {
      html, body, .app { max-width:100%; overflow-x:hidden; }
      .topbar { padding: 0 10px; gap: 8px; }
      .addr-box { display: none; }
      .accent-switcher { display:none; }
      .body { flex-direction: column; }
      .sidebar {
        display: flex; width: 100%; height: 52px; padding: 6px;
        border-right: none; border-bottom: 1px solid var(--border);
        overflow-x: auto; overflow-y: hidden;
      }
      .nav { flex: none; flex-direction: row; gap: 4px; padding: 0; }
      .nav-item { width: auto; flex-shrink: 0; padding: 0 10px; }
      .nav-item span { font-size:11px; }
      .nav-item.active::before {
        left: 10px; right: 10px; top: auto; bottom: -6px;
        width: auto; height: 2px; border-radius: 2px 2px 0 0;
      }
      .sidebar.is-collapsed { width:100%; }
      .sidebar.is-collapsed .nav { padding:0; }
      .sidebar.is-collapsed .nav-item { justify-content:flex-start; gap:10px; padding:0 10px; }
      .sidebar.is-collapsed .nav-item span { width:auto; opacity:1; overflow:visible; pointer-events:auto; }
      .nav-group-toggle { display:none; }
      .nav-group, .nav-group.is-collapsed { display:contents; }
      .sidebar-actions { display: none; }
      .metrics { grid-template-columns: repeat(2, 1fr); }
      .usage-summary { grid-template-columns:repeat(2, minmax(0, 1fr)); }
      .overview-workers-table, .attempts-table { min-width:0; }
      .overview-workers-table thead, .attempts-table thead { display:none; }
      .overview-workers-table tbody, .attempts-table tbody { display:block; padding:8px; }
      .overview-workers-table tr, .attempts-table tr { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:8px 12px; padding:12px; margin-bottom:8px; border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--panel-solid); }
      .overview-workers-table tr:last-child, .attempts-table tr:last-child { margin-bottom:0; }
      .overview-workers-table td, .attempts-table td { min-width:0; padding:0; border:0; position:static !important; background:transparent !important; }
      .overview-workers-table td:first-child, .attempts-table td:first-child { grid-column:1 / -1; }
      .overview-workers-table .mobile-cell-label { display:block; margin-bottom:3px; color:var(--muted); font:600 11px/1.2 var(--font); }
      .attempts-table td:nth-child(3), .attempts-table td:nth-child(4) { grid-column:1 / -1; }
      .worker-route-primary { max-width:none; }
      .row.two, .row.three { grid-template-columns: 1fr; }
      body { overflow: auto; }
      .app { height: auto; min-height: 100vh; }
      .content { overflow: visible; padding: 14px 12px 24px; }
      .page-head { align-items:flex-start; }
      .page-actions { width:100%; }
      .readiness-band { align-items:flex-start; flex-direction:column; gap:8px; }
      .readiness-band .btn { width:100%; }
      .pp-grid { grid-template-columns:minmax(0, 1fr); }
      .table-tools .search { max-width:none; width:100%; flex-basis:100%; }
      .table-tools .select { flex:1 1 100px; min-width:0; }
      .pager button:not(:first-child):not(:last-child):not(.active) { display:none; }
      table.nodes th:first-child, table.nodes td:first-child { position:sticky; left:0; z-index:2; background:var(--panel-solid); }
      table.nodes th:first-child { z-index:3; }
      #accounts.worker-columns { grid-template-columns: 1fr; }
      .worker-column-list.worker-list-scroll { max-height: none; overflow: visible; padding-right: 0; }
      .worker-card .hd { flex-wrap: wrap; gap: 8px; }
      .worker-card .hd { position: relative; }
      .worker-card .worker-title { width: 100%; padding-right: 34px; }
      .worker-card .worker-actions { flex-wrap: wrap; }
      .worker-card .btn-toggle-worker { position: absolute; top: 0; right: 0; }
      .confirm-float { left: 12px; right: 12px; bottom: 12px; width: auto; }
    }
    @media (max-width: 600px) {
      .getting-started-head { flex-direction:column; }
      .getting-started-steps { grid-template-columns:1fr; }
      .topbar { gap:6px; }
      .topbar-left, .topbar-mid, .topbar-right { gap:6px; }
      .brand { gap:7px; }
      .brand-name { font-size:13px; white-space:nowrap; }
      .run-pill { flex-shrink:0; padding:4px 8px; font-size:11px; white-space:nowrap; }
      #btn-top-refresh { display:none; }
      .topbar-right, .lang-switch { flex-shrink:0; }
      .lang-switch { gap:3px; font-size:11px; }
      .lang-switch button { padding-inline:2px; }
      .nav-item { min-height:44px; }
      .page-actions .btn:not(.btn-icon), .table-tools .btn:not(.btn-icon) { min-height:44px; }
      .pager button { min-width:44px; height:44px; }
    }
  </style>
`;
