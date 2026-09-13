/** Feature styles for the overview usage trend. */
export const ADMIN_USAGE_STYLES = `    .usage-timeline { padding:14px 16px 12px; border-bottom:1px solid var(--border); }
    .usage-timeline-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-bottom:12px; }
    .usage-timeline-head h3 { margin:0; font-size:13px; font-weight:650; }
    .usage-range { display:flex; flex-shrink:0; gap:2px; padding:2px; border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--panel-2); }
    .usage-range .segment { min-height:28px; padding:4px 10px; border:0; border-radius:var(--radius-xs); color:var(--muted); background:transparent; font:600 11px var(--font); }
    .usage-range .segment:hover { color:var(--text); background:var(--accent-surface); }
    .usage-range .segment.active { color:var(--accent-hi); background:var(--panel-solid); box-shadow:var(--shadow-sm); }
    .usage-chart { overflow-x:auto; padding-bottom:2px; }
    .usage-chart-bars { display:grid; grid-auto-flow:column; grid-auto-columns:minmax(14px, 1fr); gap:4px; min-width:680px; height:142px; align-items:end; }
    .usage-bar { display:flex; min-width:0; height:100%; flex-direction:column; justify-content:flex-end; align-items:center; outline:none; }
    .usage-bar-track { display:flex; width:100%; max-width:28px; height:112px; flex-direction:column-reverse; justify-content:flex-start; overflow:hidden; border-radius:3px 3px 1px 1px; background:var(--bg-elevated); }
    .usage-bar-segment { display:block; width:100%; min-height:0; transition:height .18s ease; }
    .usage-bar-segment.success { background:var(--ok); }
    .usage-bar-segment.failure { background:var(--err); }
    .usage-bar-label { display:block; width:100%; min-height:16px; margin-top:5px; overflow:hidden; color:var(--muted); font-size:9px; line-height:1.2; text-align:center; white-space:nowrap; }
    .usage-chart-empty { display:grid; min-height:112px; place-items:center; color:var(--muted); font-size:12px; border:1px dashed var(--border); border-radius:var(--radius-sm); }
    .usage-timeline-summary { display:grid; grid-template-columns:repeat(5, minmax(0, 1fr)); gap:8px; margin-top:12px; }
    .usage-timeline-stat { min-width:0; padding-top:8px; border-top:1px solid var(--border); }
    .usage-timeline-stat span { display:block; overflow:hidden; color:var(--muted); font-size:10px; text-overflow:ellipsis; text-transform:uppercase; white-space:nowrap; }
    .usage-timeline-stat strong { display:block; margin-top:3px; color:var(--text); font:650 14px var(--mono); }
    .usage-timeline-legend { display:flex; gap:14px; margin-top:10px; color:var(--muted); font-size:10px; }
    .usage-timeline-legend span { display:inline-flex; align-items:center; gap:5px; }
    .usage-legend-dot { display:inline-block; width:7px; height:7px; border-radius:50%; }
    .usage-legend-dot.success { background:var(--ok); }
    .usage-legend-dot.failure { background:var(--err); }
    @media (max-width: 900px) {
      .usage-timeline-head { align-items:stretch; flex-direction:column; }
      .usage-range { align-self:flex-start; }
      .usage-timeline-summary { grid-template-columns:repeat(3, minmax(0, 1fr)); }
    }
    @media (max-width: 600px) {
      .usage-timeline { padding-inline:12px; }
      .usage-timeline-summary { grid-template-columns:repeat(2, minmax(0, 1fr)); gap:8px 12px; }
      .usage-chart-bars { min-width:620px; }
    }
`;
