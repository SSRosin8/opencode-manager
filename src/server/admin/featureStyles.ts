/** Proxy, Worker, modal, responsive, and other feature-level styles. */
export const ADMIN_FEATURE_STYLES = `    /* ── Proxy Pool layout ── */
    .pp-grid {
      display: grid;
      grid-template-columns: 1fr 320px;
      gap: 12px;
      align-items: start;
    }
    .pp-main { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
    .pp-side { display: flex; flex-direction: column; gap: 12px; min-width: 0; }

    /* Isolation map */
    .iso-body { display: grid; grid-template-columns: 1fr 150px; gap: 0; }
    .iso-map { padding: 10px 14px 12px; border-right: 1px solid var(--border); }
    .iso-cols {
      display: grid; grid-template-columns: 1fr 1.1fr 1fr; gap: 4px;
      font-size: 10px; color: var(--muted); text-transform: uppercase;
      letter-spacing: 0.04em; margin-bottom: 8px; font-weight: 600;
    }
    .iso-row {
      display: grid; grid-template-columns: 1fr auto 1.1fr auto 1fr;
      align-items: center; gap: 6px; margin-bottom: 8px;
    }
    .iso-node {
      background: var(--bg); border: 1px solid var(--border);
      border-radius: var(--radius-sm); padding: 8px 10px; min-width: 0;
    }
    .iso-node.shared { border-color: var(--warn-border); background: var(--warn-dim); }
    .iso-node .t { font-weight: 600; font-size: 12px; display: flex; align-items: center; gap: 6px; }
    .iso-node .s { font-family: var(--mono); font-size: 11px; color: var(--muted); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .iso-arrow { color: var(--faint); font-size: 12px; }
    .bridge-chip {
      font-size: 10px; font-weight: 600; color: var(--blue-hi);
      border: 1px dashed var(--blue-border); border-radius: 999px;
      padding: 2px 7px; white-space: nowrap; background: var(--blue-dim);
    }
    .dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
    .dot.ok { background: var(--ok); }
    .dot.warn { background: var(--warn); }
    .dot.err { background: var(--err); }
    .iso-legend {
      display: flex; align-items: center; justify-content: space-between;
      gap: 10px; flex-wrap: wrap; margin-top: 6px; padding-top: 8px;
      border-top: 1px solid var(--border); font-size: 11px; color: var(--muted);
    }
    .iso-legend .items { display: flex; gap: 12px; }
    .iso-legend .items span { display: inline-flex; align-items: center; gap: 5px; }
    .iso-health {
      padding: 16px 14px; display: flex; flex-direction: column; align-items: center;
      text-align: center; gap: 8px; justify-content: center;
    }
    .iso-health .big {
      font-size: 28px; font-weight: 700; line-height: 1; font-family: var(--mono);
    }
    .iso-health .big span { font-size: 14px; color: var(--muted); font-weight: 500; }
    .iso-health .desc { font-size: 12px; color: var(--muted); max-width: 130px; }
    .shield {
      width: 48px; height: 48px; border-radius: 50%;
      background: var(--ok-dim); border: 1px solid var(--ok-border);
      display: grid; place-items: center; color: var(--ok);
    }
    .shield.warn { background: var(--warn-dim); border-color: var(--warn-border); color: var(--warn); }
    .shield.err { background: var(--err-dim); border-color: var(--err-border); color: var(--err); }
    .iso-health .status-txt { font-weight: 600; font-size: 12px; color: var(--ok); }
    .iso-health .status-txt.warn { color: var(--warn); }
    .iso-health .status-txt.err { color: var(--err); }

    /* Subscriptions */
    .sub-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 10px;
    }
    .sub-card {
      background: var(--bg); border: 1px solid var(--border);
      border-radius: var(--radius); padding: 12px; display: flex; flex-direction: column; gap: 8px;
    }
    .sub-card.err { border-color: var(--err-border); }
    .sub-card .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
    .sub-card .name { font-weight: 600; font-size: 13px; }
    .sub-card .url {
      font-family: var(--mono); font-size: 11px; color: var(--muted);
      display: flex; align-items: center; gap: 4px; min-width: 0;
    }
    .sub-card .url span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sub-card .meta { font-size: 11px; color: var(--muted); display: flex; justify-content: space-between; gap: 8px; }
    .sub-card .proto { font-size: 11px; color: var(--text-2); }
    .sub-card .err-msg { font-size: 11px; color: var(--err); }
    .sub-card .acts { display: flex; gap: 6px; margin-top: auto; flex-wrap: wrap; }

    /* Table */
    .table-tools {
      display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
      padding: 10px 12px; border-bottom: 1px solid var(--border);
    }
    .table-tools .search {
      position: relative; flex: 1; min-width: 160px; max-width: 240px;
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
    table.nodes {
      width: 100%; border-collapse: collapse; font-size: 12px;
    }
    table.nodes th {
      text-align: left; padding: 8px 10px; color: var(--muted);
      font-weight: 600; font-size: 11px; border-bottom: 1px solid var(--border);
      position: sticky; top: 0; background: var(--panel); z-index: 1;
      white-space: nowrap;
    }
    table.nodes td {
      padding: 8px 10px; border-bottom: 1px solid var(--border);
      vertical-align: middle; white-space: nowrap;
    }
    table.nodes tr:hover td { background: rgba(255,255,255,0.02); }
    :root[data-theme="light"] table.nodes tr:hover td { background: rgba(15,23,42,0.025); }
    table.nodes tr.row-warn td { background: var(--warn-dim); }
    table.nodes tr.row-err td { background: rgba(239,68,68,0.06); }
    table.nodes .name-cell { display: flex; align-items: center; gap: 6px; font-weight: 500; }
    .table-foot {
      display: flex; justify-content: space-between; align-items: center;
      gap: 10px; flex-wrap: wrap; padding: 8px 12px; border-top: 1px solid var(--border);
      font-size: 11px; color: var(--muted);
    }
    .table-foot .sum b.ok { color: var(--ok); font-weight: 600; }
    .table-foot .sum b.warn { color: var(--warn); font-weight: 600; }
    .table-foot .sum b.err { color: var(--err); font-weight: 600; }
    .pager { display: flex; align-items: center; gap: 4px; }
    .pager button {
      min-width: 28px; height: 28px; padding: 0 6px;
      border: 1px solid var(--border); background: var(--bg);
      border-radius: var(--radius-sm); color: var(--text-2);
    }
    .pager button.active { background: var(--blue); border-color: var(--blue); color: #fff; }
    .pager button:disabled { opacity: 0.4; }
    .lat { font-family: var(--mono); font-size: 12px; }
    .lat.ok { color: var(--ok); }
    .lat.err { color: var(--err); }
    .lat.muted { color: var(--muted); }
    @keyframes spin { to { transform: rotate(360deg); } }
    .spin {
      display: inline-block; width: 12px; height: 12px;
      border: 2px solid var(--border-hi); border-top-color: var(--blue);
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
    .probe-ok.show { display: flex; }
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
      padding: 20px 12px; text-align: center; color: var(--muted);
    }
    .empty-dash .ico { font-size: 22px; margin-bottom: 6px; opacity: 0.6; }
    .empty-dash strong { display: block; color: var(--text-2); margin-bottom: 2px; }

    /* Other pages */
    .stack { display: flex; flex-direction: column; gap: 12px; max-width: 880px; }
    .worker-card {
      border: 1px solid var(--border); border-radius: var(--radius);
      background: var(--bg); padding: 12px 14px; margin-bottom: 10px;
    }
    .worker-card.disabled-worker { opacity: 0.68; }
    .workers-stack { max-width: none; }
    #accounts.worker-columns {
      display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px;
      align-items: start;
    }
    .worker-column {
      min-width: 0;
    }
    .worker-column-hd {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      padding: 10px 12px; border-bottom: 1px solid var(--border);
      color: var(--text); font-weight: 600;
    }
    .worker-column-count {
      min-width: 24px; padding: 1px 7px; border-radius: 999px;
      background: var(--panel-2); color: var(--text-2); text-align: center;
      font-family: var(--mono); font-size: 11px;
    }
    .worker-column-list { padding-top: 10px; }
    .worker-column-list.worker-list-scroll {
      max-height: calc(100vh - 235px); overflow: auto; padding-right: 6px;
    }
    .worker-column-list .worker-card:last-child { margin-bottom: 0; }
    .worker-column-empty {
      margin: 0; padding: 20px 10px; text-align: center; color: var(--muted);
    }
    .worker-card.is-collapsed-card { padding: 9px 12px; margin-bottom: 6px; }
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
      padding: 14px 16px; background: var(--panel); line-height: 1.7; color: var(--text-2);
    }
    .usage-box code {
      font-family: var(--mono); font-size: 12px; color: var(--blue-hi);
      background: var(--blue-dim); padding: 1px 5px; border-radius: 4px;
    }

    /* Toast / Modal */
    .toast {
      position: fixed; left: 20px; bottom: 20px; z-index: 100;
      display: none; align-items: center; gap: 10px;
      padding: 10px 12px; min-width: 240px; max-width: 380px;
      background: var(--panel); border: 1px solid var(--border);
      border-radius: var(--radius); box-shadow: var(--shadow); font-size: 13px;
    }
    .toast.show { display: flex; }
    .toast.ok { border-color: var(--ok-border); }
    .toast.fail { border-color: var(--err-border); }
    .toast .x { margin-left: auto; background: none; border: none; color: var(--muted); padding: 2px 4px; }
    .modal-root {
      position: fixed; inset: 0; z-index: 90; display: none;
      align-items: center; justify-content: center;
      background: rgba(0,0,0,0.45);
    }
    .modal-root.show { display: flex; }
    .modal {
      width: min(420px, calc(100vw - 32px));
      background: var(--panel); border: 1px solid var(--border);
      border-radius: 10px; box-shadow: var(--shadow); padding: 16px;
    }
    .modal h3 {
      margin: 0 0 6px; font-size: 15px; display: flex; align-items: center; gap: 8px;
    }
    .modal p { margin: 0 0 14px; color: var(--muted); font-size: 13px; }
    .modal .acts { display: flex; justify-content: flex-end; gap: 8px; }
    .modal.form .row { margin-bottom: 10px; }
    .confirm-float {
      position: fixed; right: 24px; bottom: 24px; z-index: 95;
      width: 300px; display: none;
      background: var(--panel); border: 1px solid var(--border);
      border-radius: 10px; box-shadow: var(--shadow); padding: 14px;
    }
    .confirm-float.show { display: block; }
    .confirm-float h3 {
      margin: 0 0 6px; font-size: 14px; display: flex; align-items: center; gap: 8px;
    }
    .confirm-float p { margin: 0 0 4px; color: var(--muted); font-size: 12px; }
    .confirm-float .acts { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
    .confirm-float .close {
      position: absolute; top: 10px; right: 10px;
      background: none; border: none; color: var(--muted); padding: 2px;
    }

    .toggle {
      position: relative; width: 36px; height: 20px; flex-shrink: 0;
    }
    .toggle input { opacity: 0; width: 0; height: 0; position: absolute; }
    .toggle span {
      position: absolute; inset: 0; border-radius: 999px;
      background: var(--faint); border: 1px solid var(--border); cursor: pointer;
      transition: background 0.15s;
    }
    .toggle span::after {
      content: ""; position: absolute; width: 14px; height: 14px; border-radius: 50%;
      background: #fff; top: 2px; left: 2px; transition: transform 0.15s;
    }
    .toggle input:checked + span { background: var(--blue); border-color: var(--blue); }
    .toggle input:checked + span::after { transform: translateX(16px); }

    .more-menu {
      position: absolute; right: 0; top: calc(100% + 4px); z-index: 30;
      min-width: 160px; background: var(--panel); border: 1px solid var(--border);
      border-radius: var(--radius); box-shadow: var(--shadow); display: none; padding: 4px;
    }
    .more-menu.show { display: block; }
    .more-menu button {
      width: 100%; text-align: left; background: none; border: none;
      color: var(--text); padding: 8px 10px; border-radius: 4px; font-size: 12px;
    }
    .more-menu button:hover { background: var(--blue-dim); }
    .rel { position: relative; }

    @media (max-width: 1200px) {
      .metrics { grid-template-columns: repeat(3, 1fr); }
      .pp-grid { grid-template-columns: 1fr; }
      .iso-body { grid-template-columns: 1fr; }
      .iso-map { border-right: none; border-bottom: 1px solid var(--border); }
    }
    @media (max-width: 900px) {
      .topbar { padding: 0 10px; gap: 8px; }
      .addr-box { display: none; }
      .body { flex-direction: column; }
      .sidebar {
        display: flex; width: 100%; height: 48px; padding: 6px;
        border-right: none; border-bottom: 1px solid var(--border);
        overflow-x: auto; overflow-y: hidden;
      }
      .nav { flex: none; flex-direction: row; gap: 4px; padding: 0; }
      .nav-item { width: auto; flex-shrink: 0; padding: 0 10px; }
      .nav-item.active::before {
        left: 10px; right: 10px; top: auto; bottom: -6px;
        width: auto; height: 2px; border-radius: 2px 2px 0 0;
      }
      .sidebar-foot { display: none; }
      .metrics { grid-template-columns: repeat(2, 1fr); }
      .row.two, .row.three { grid-template-columns: 1fr; }
      body { overflow: auto; }
      .app { height: auto; min-height: 100vh; }
      .content { overflow: visible; padding: 14px 12px 24px; }
      #accounts.worker-columns { grid-template-columns: 1fr; }
      .worker-column-list.worker-list-scroll { max-height: none; overflow: visible; padding-right: 0; }
      .worker-card .hd { flex-wrap: wrap; gap: 8px; }
      .worker-card .hd { position: relative; }
      .worker-card .worker-title { width: 100%; padding-right: 34px; }
      .worker-card .worker-actions { flex-wrap: wrap; }
      .worker-card .btn-toggle-worker { position: absolute; top: 0; right: 0; }
      .confirm-float { left: 12px; right: 12px; bottom: 12px; width: auto; }
    }
  </style>
`;
