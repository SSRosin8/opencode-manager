import { describe, expect, it } from "vitest";
import { ADMIN_CLIENT_ACTIONS } from "../src/server/admin/clientActions.js";
import { ADMIN_CLIENT_CORE } from "../src/server/admin/clientCore.js";
import { ADMIN_CLIENT_I18N } from "../src/server/admin/clientI18n.js";
import { ADMIN_CLIENT_PROXY_VIEWS } from "../src/server/admin/clientProxyViews.js";
import { ADMIN_CLIENT_TOOLTIPS } from "../src/server/admin/clientTooltips.js";
import { ADMIN_CLIENT_WORKER_VIEWS } from "../src/server/admin/clientWorkerViews.js";
import { ADMIN_DOCUMENT_HEAD } from "../src/server/admin/documentHead.js";
import { ADMIN_MARKUP } from "../src/server/admin/markup.js";
import { ADMIN_FEATURE_STYLES } from "../src/server/admin/featureStyles.js";

describe("admin proxy-pool UX contracts", () => {
  it("keeps inactive batch controls hidden despite button display styles", () => {
    expect(ADMIN_DOCUMENT_HEAD).toContain("[hidden] { display: none !important; }");
    expect(ADMIN_MARKUP).toMatch(/id="btn-batch-pause"[^>]*hidden/);
    expect(ADMIN_MARKUP).toMatch(/id="btn-batch-cancel"[^>]*hidden/);
  });

  it("provides three persisted proxy workspace tabs with bilingual labels", () => {
    expect(ADMIN_MARKUP.match(/data-proxy-tab=/g)).toHaveLength(3);
    expect(ADMIN_CLIENT_CORE).toContain('"opencode-manager-proxy-tab"');
    expect(ADMIN_CLIENT_I18N).toContain('proxyTabSources: "Sources & bridge"');
    expect(ADMIN_CLIENT_I18N).toContain('proxyTabSources: "来源与桥接"');
  });

  it("uses one source menu and reserves bulk sync for multiple subscriptions", () => {
    expect(ADMIN_MARKUP).toContain('id="btn-add-source"');
    expect(ADMIN_MARKUP).toContain('id="menu-add-subscription"');
    expect(ADMIN_MARKUP).toContain('id="menu-add-proxy"');
    expect(ADMIN_MARKUP).not.toContain('id="btn-add-proxy-open"');
    expect(ADMIN_MARKUP).not.toContain('id="btn-add-sub-open"');
    expect(ADMIN_MARKUP).toMatch(/id="btn-fetch-all"[^>]*hidden/);
    expect(ADMIN_CLIENT_PROXY_VIEWS).toContain('$("btn-fetch-all").hidden = list.length < 2');
  });

  it("falls back to local readiness inference when status.readiness is absent", () => {
    expect(ADMIN_CLIENT_PROXY_VIEWS).toContain("function readinessFallback()");
    expect(ADMIN_CLIENT_PROXY_VIEWS).toContain("const supplied = status?.readiness");
    expect(ADMIN_CLIENT_PROXY_VIEWS).toContain(": fallback;");
  });

  it("moves destructive pool clearing into More and names refresh scope", () => {
    const menuStart = ADMIN_MARKUP.indexOf('id="more-menu"');
    const tableStart = ADMIN_MARKUP.indexOf('class="table-tools"');
    const removeAll = ADMIN_MARKUP.indexOf('id="btn-remove-all-proxies"');
    expect(removeAll).toBeGreaterThan(menuStart);
    expect(removeAll).toBeLessThan(tableStart);
    expect(ADMIN_MARKUP).toContain('data-i18n="refreshNodeStatus"');
  });

  it("syncs a newly added subscription immediately and records diagnostics", () => {
    expect(ADMIN_CLIENT_ACTIONS).toContain('encodeURIComponent(data.subscription.id) + "/fetch"');
    expect(ADMIN_CLIENT_ACTIONS).toContain("subscriptionDiagnostics.set(data.subscription.id, syncData)");
    for (const label of ["diagFormat", "diagUserAgent", "diagRawBytes", "diagParsed"]) {
      expect(ADMIN_CLIENT_PROXY_VIEWS).toContain(`t("${label}")`);
    }
  });

  it("saves gateway and Clash fields through domain-scoped APIs", () => {
    expect(ADMIN_CLIENT_ACTIONS).toContain('fetch("/admin/api/gateway-settings"');
    expect(ADMIN_CLIENT_ACTIONS).toContain('fetch("/admin/api/clash-bridge"');
    expect(ADMIN_CLIENT_ACTIONS).toMatch(/gateway-settings"[\s\S]*method: "PATCH"/);
    expect(ADMIN_CLIENT_ACTIONS).toMatch(/clash-bridge"[\s\S]*method: "PATCH"/);
  });

  it("frames gateway around the local request path and keeps CLI compatibility secondary", () => {
    expect(ADMIN_MARKUP).toContain('class="gateway-flow"');
    expect(ADMIN_MARKUP).toContain('data-i18n="gatewayFlowNote"');
    expect(ADMIN_MARKUP).toContain('data-collapse-key="gateway-advanced"');
    expect(ADMIN_MARKUP).toContain('data-collapse-default="1"');
    expect(ADMIN_MARKUP).toContain('id="gateway-advanced-body"');
    expect(ADMIN_CLIENT_CORE).toContain('btn.dataset.collapseDefault === "1"');
    expect(ADMIN_CLIENT_I18N).toContain('gatewayBasicTitle: "基础网关设置"');
    expect(ADMIN_FEATURE_STYLES).toContain(".gateway-flow-path");
  });

  it("provides a dismissible first-run guide with a reusable help entry", () => {
    expect(ADMIN_MARKUP).toContain('id="getting-started"');
    expect(ADMIN_MARKUP).toContain('id="btn-dismiss-getting-started"');
    expect(ADMIN_MARKUP).toContain('id="modal-guide"');
    expect(ADMIN_MARKUP).toContain('id="btn-guide"');
    expect(ADMIN_MARKUP.match(/data-guide-page=/g)).toHaveLength(5);
    expect(ADMIN_CLIENT_CORE).toContain('opencode-manager-getting-started-dismissed');
    expect(ADMIN_CLIENT_CORE).toContain('function initGuide()');
    expect(ADMIN_FEATURE_STYLES).toContain('.getting-started-steps');
    expect(ADMIN_FEATURE_STYLES).toContain('.guide-modal');
  });

  it("keeps secondary accent controls from crowding mobile language controls", () => {
    expect(ADMIN_FEATURE_STYLES).toMatch(/@media \(max-width: 900px\)[\s\S]*\.accent-switcher \{ display:none; \}/);
    expect(ADMIN_FEATURE_STYLES).toMatch(/@media \(max-width: 600px\)[\s\S]*#btn-top-refresh \{ display:none; \}/);
    expect(ADMIN_FEATURE_STYLES).toMatch(/@media \(max-width: 600px\)[\s\S]*\.run-pill \{[^}]*white-space:nowrap;/);
  });

  it("applies each accent through a complete theme hierarchy without replacing status colors", () => {
    for (const token of [
      "--accent-solid",
      "--accent-solid-hover",
      "--accent-on-solid",
      "--accent-surface",
      "--accent-surface-hover",
      "--accent-chrome",
      "--accent-panel",
      "--accent-panel-border",
    ]) {
      expect(ADMIN_DOCUMENT_HEAD).toContain(token);
    }
    for (const accent of ["violet", "green", "amber"]) {
      expect(ADMIN_DOCUMENT_HEAD).toContain(`data-accent="${accent}"`);
    }
    expect(ADMIN_DOCUMENT_HEAD).toContain("background: var(--accent-chrome)");
    expect(ADMIN_DOCUMENT_HEAD).toContain("background: var(--accent-solid); border-color: var(--accent-solid)");
    expect(ADMIN_DOCUMENT_HEAD).toContain("background: var(--accent-panel)");
    expect(ADMIN_DOCUMENT_HEAD).toContain("border: 1px solid var(--accent-panel-border)");
    expect(ADMIN_DOCUMENT_HEAD).toContain(".tag.accent");
    expect(ADMIN_DOCUMENT_HEAD).not.toContain(".tag.blue");
    expect(ADMIN_DOCUMENT_HEAD).not.toContain(".metric .v.blue");
    expect(ADMIN_DOCUMENT_HEAD).toContain(".run-pill {");
    expect(ADMIN_DOCUMENT_HEAD).toContain("background: var(--ok-dim); border: 1px solid var(--ok-border)");
    expect(ADMIN_DOCUMENT_HEAD).toContain("background: var(--err-dim); border-color: var(--err-border); color: var(--err)");
    expect(ADMIN_DOCUMENT_HEAD).toContain('--accent-solid: #047857;');
    expect(ADMIN_DOCUMENT_HEAD).toContain('--accent-solid: #b45309;');
    expect(ADMIN_DOCUMENT_HEAD).not.toMatch(/data-theme="light"[\s\S]{0,1200}--accent-chrome:\s*rgba\(255/);
  });

  it("keeps the admin surface compact, keyboard-visible, and free of layout-wide animation", () => {
    expect(ADMIN_DOCUMENT_HEAD).toContain("--radius: 8px");
    expect(ADMIN_DOCUMENT_HEAD).toContain("--radius-sm: 6px");
    expect(ADMIN_DOCUMENT_HEAD).toContain(":where(button, [tabindex], input, select, textarea):focus-visible");
    expect(ADMIN_DOCUMENT_HEAD).not.toContain("transition: all");
    expect(ADMIN_DOCUMENT_HEAD + ADMIN_FEATURE_STYLES).not.toMatch(/letter-spacing:\s*-/);
    expect(ADMIN_FEATURE_STYLES).toContain(".toggle input:focus-visible + span");
    expect(ADMIN_FEATURE_STYLES).toContain("pointer-events:none");
  });

  it("provides mobile touch targets without changing the desktop information density", () => {
    expect(ADMIN_FEATURE_STYLES).toMatch(/@media \(max-width: 600px\)[\s\S]*\.nav-item \{ min-height:44px; \}/);
    expect(ADMIN_FEATURE_STYLES).toMatch(/@media \(max-width: 600px\)[\s\S]*\.pager button \{ min-width:44px; height:44px; \}/);
    expect(ADMIN_FEATURE_STYLES).toContain("font:600 11px/1.2 var(--font)");
    expect(ADMIN_FEATURE_STYLES).not.toContain("var(--font-sans)");
  });

  it("validates persisted accent choices and exposes the selected swatch state", () => {
    expect(ADMIN_DOCUMENT_HEAD).toContain('["violet", "green", "amber"].includes(storedAccent)');
    expect(ADMIN_CLIENT_CORE).toContain('["blue", "violet", "green", "amber"].includes(accent)');
    expect(ADMIN_CLIENT_CORE).toContain('d.setAttribute("aria-pressed", String(d.dataset.accent === accent))');
    expect(ADMIN_MARKUP.match(/aria-pressed="(?:true|false)"/g)).toHaveLength(4);
  });

  it("does not present an empty Worker pool as fully ready", () => {
    expect(ADMIN_CLIENT_PROXY_VIEWS).toContain('enabledWorkers > 0 && ready === enabledWorkers ? "ok" : ""');
  });

  it("stretches paired desktop panels to a shared bottom edge", () => {
    expect(ADMIN_FEATURE_STYLES).toContain("align-items: stretch");
    expect(ADMIN_FEATURE_STYLES).toContain(".pp-main > .proxy-section-active, .pp-side > .proxy-section-active { flex:1; }");
    expect(ADMIN_FEATURE_STYLES).toContain(".pp-main, .pp-side { height:auto; }");
  });

  it("keeps Overview summaries concise and explains retry attempt positions", () => {
    expect(ADMIN_MARKUP).toContain('id="ov-usage-summary"');
    expect(ADMIN_MARKUP).toContain('id="ov-toggle-idle"');
    expect(ADMIN_MARKUP).not.toContain('data-collapse-key="overview-metrics"');
    expect(ADMIN_CLIENT_I18N).toContain('attemptPosition: (n, max) => "尝试 " + n + " / 最多 " + max');
    expect(ADMIN_FEATURE_STYLES).toContain(".overview-workers-table thead, .attempts-table thead { display:none; }");
  });

  it("separates Worker request outcomes into explicit columns", () => {
    expect(ADMIN_MARKUP).toContain('data-i18n="colSuccess"');
    expect(ADMIN_MARKUP).toContain('data-i18n="colFailures"');
    expect(ADMIN_CLIENT_WORKER_VIEWS).toContain('t("summaryAttempts")');
    expect(ADMIN_CLIENT_WORKER_VIEWS).toContain('t("modelDetail")');
    expect(ADMIN_CLIENT_WORKER_VIEWS).toContain('t("workerModelDetail")');
    expect(ADMIN_CLIENT_WORKER_VIEWS).toContain("w.modelAttemptUsage || w.modelUsage");
    expect(ADMIN_CLIENT_WORKER_VIEWS).toContain('totals.distinctModelCount');
    expect(ADMIN_CLIENT_WORKER_VIEWS).toContain('class="ok">\' + fmtNum(w.generationSuccessCount');
    expect(ADMIN_CLIENT_WORKER_VIEWS).toContain('class="err">\' + fmtNum(w.generationErrorCount');
    expect(ADMIN_CLIENT_WORKER_VIEWS).toContain('class="mobile-cell-label">\' + escapeHtml(t("colSuccess"))');
    expect(ADMIN_FEATURE_STYLES).toContain(".overview-workers-table .mobile-cell-label { display:block;");
    expect(ADMIN_FEATURE_STYLES).toContain(".overview-workers-table { min-width:900px; table-layout:fixed; }");
    expect(ADMIN_FEATURE_STYLES).toContain("table.nodes.overview-workers-table td { white-space:normal;");
    expect(ADMIN_CLIENT_I18N).toContain('生成请求（Chat/Responses）');
    expect(ADMIN_CLIENT_I18N).toContain('模型列表请求');
    expect(ADMIN_CLIENT_I18N).toContain('网关拒绝记录？');
    expect(ADMIN_CLIENT_WORKER_VIEWS).toContain('stats.modelTokenUsage');
    expect(ADMIN_CLIENT_I18N).toContain('含 usage 的响应');
  });

  it("uses one viewport-aware tooltip layer instead of card popovers", () => {
    expect(ADMIN_CLIENT_PROXY_VIEWS).toContain('class="metric hover-detail" tabindex="0" data-tooltip="');
    expect(ADMIN_CLIENT_WORKER_VIEWS).toContain('class="usage-summary-item hover-detail" tabindex="0" data-tooltip="');
    expect(ADMIN_CLIENT_CORE).not.toContain("function sparkSvg");
    expect(ADMIN_CLIENT_TOOLTIPS).toContain('layer.className = "ui-tooltip"');
    expect(ADMIN_CLIENT_TOOLTIPS).toContain('positionTooltip(trigger, layer)');
    expect(ADMIN_CLIENT_TOOLTIPS).toContain("TOOLTIP_SAFE_AREA = 12");
    expect(ADMIN_CLIENT_TOOLTIPS).toContain('layer.style.left = Math.floor(left) + "px"');
    expect(ADMIN_CLIENT_TOOLTIPS).toContain("positionTooltip(trigger, layer);");
    expect(ADMIN_CLIENT_TOOLTIPS).toContain('event.key === "Escape"');
    expect(ADMIN_CLIENT_TOOLTIPS).toContain('document.addEventListener("scroll", () => hideTooltip(), true)');
    expect(ADMIN_FEATURE_STYLES).toContain("position:fixed; z-index:1000");
    expect(ADMIN_FEATURE_STYLES).toContain(".hover-detail:focus-visible");
    expect(ADMIN_FEATURE_STYLES).not.toContain(".metric-popover");
    expect(ADMIN_FEATURE_STYLES).not.toContain(".usage-summary-popover");
    expect(ADMIN_CLIENT_PROXY_VIEWS + ADMIN_CLIENT_WORKER_VIEWS + ADMIN_MARKUP).not.toContain("ⓘ");
  });

  it("explains isolation health through the shared accessible tooltip", () => {
    expect(ADMIN_MARKUP).toContain('class="hover-detail" tabindex="0" data-i18n="isoTitle" data-i18n-tooltip="isoTooltip"');
    expect(ADMIN_CLIENT_I18N).toContain('isoTooltip: "展示每个 Worker');
    expect(ADMIN_CLIENT_TOOLTIPS).toContain('trigger.setAttribute("aria-describedby", layer.id)');
    expect(ADMIN_CLIENT_TOOLTIPS).toContain('activeTooltipTrigger?.removeAttribute("aria-describedby")');
  });

  it("keeps anonymous Worker IDs available without showing long generated IDs in card titles", () => {
    expect(ADMIN_CLIENT_WORKER_VIEWS).toContain('t("anonymousWorkerName")(idx + 1)');
    expect(ADMIN_CLIENT_WORKER_VIEWS).toContain('data-tooltip="\' + escapeAttr(a.id || displayName)');
    expect(ADMIN_CLIENT_WORKER_VIEWS).toContain('value="\' + escapeAttr(a.id || "")');
  });

  it("provides a persisted desktop sidebar toggle without redundant footer text", () => {
    expect(ADMIN_MARKUP).toContain('id="btn-sidebar-toggle"');
    expect(ADMIN_MARKUP).toContain('aria-controls="main-nav"');
    expect(ADMIN_MARKUP).not.toContain("v1.0.0");
    expect(ADMIN_MARKUP).not.toContain('data-i18n="selfHosted"');
    expect(ADMIN_CLIENT_CORE).toContain('"opencode-manager-sidebar-collapsed"');
    expect(ADMIN_CLIENT_CORE).toContain('sidebar.classList.toggle("is-collapsed", sidebarCollapsed)');
    expect(ADMIN_CLIENT_I18N).toContain('sidebarCollapse: "收起侧边栏"');
    expect(ADMIN_DOCUMENT_HEAD).toContain(".sidebar.is-collapsed { width: 60px; }");
    expect(ADMIN_FEATURE_STYLES).toContain(".sidebar-actions { display: none; }");
  });

  it("uses actionable navigation groups and keeps overview independent", () => {
    expect(ADMIN_MARKUP.match(/class="nav-group-toggle"/g)).toHaveLength(2);
    expect(ADMIN_MARKUP).toContain('data-nav-group="setup"');
    expect(ADMIN_MARKUP).toContain('data-nav-group="monitor"');
    expect(ADMIN_CLIENT_CORE).toContain('opencode-manager-nav-group-');
    expect(ADMIN_CLIENT_I18N).toContain('navSetupGroup: "资源配置"');
    expect(ADMIN_CLIENT_I18N).toContain('navMonitorGroup: "客户端接入"');
    expect(ADMIN_FEATURE_STYLES).toContain('.sidebar.is-collapsed .nav-group-toggle');
    expect(ADMIN_FEATURE_STYLES).toContain('.nav-group, .nav-group.is-collapsed { display:contents; }');
    expect(ADMIN_CLIENT_CORE).toContain('if (!["overview", "gateway", "proxy", "workers", "usage"].includes(page))');
    expect(ADMIN_CLIENT_CORE).toContain('groupContent.classList.remove("is-collapsed")');
  });

  it("shows the supported Responses endpoint in client usage without exposing admin routes", () => {
    expect(ADMIN_MARKUP).toContain("POST /v1/responses");
    expect(ADMIN_MARKUP).not.toContain('data-i18n="adminApis"');
  });

  it("paginates dense admin lists with one shared eight-item control", () => {
    expect(ADMIN_CLIENT_CORE).toContain("const PAGE_SIZE = 8");
    expect(ADMIN_CLIENT_CORE).toContain("function pageSlice(items, currentPage)");
    expect(ADMIN_CLIENT_CORE).toContain("function pagerHtml(pageNumber, totalPages)");
    expect(ADMIN_MARKUP).toContain('id="iso-pager"');
    expect(ADMIN_MARKUP).toContain('id="ov-workers-pager"');
    expect(ADMIN_MARKUP).toContain('id="ov-attempts-pager"');
    expect(ADMIN_MARKUP).toContain('id="ov-errors-pager"');
    expect(ADMIN_CLIENT_PROXY_VIEWS).toContain("pageSlice(rows, isolationPage)");
    expect(ADMIN_CLIENT_WORKER_VIEWS).toContain("pageSlice(items, workerPages[kind])");
    expect(ADMIN_CLIENT_WORKER_VIEWS).toContain("pageSlice(attempts, attemptPage)");
    expect(ADMIN_CLIENT_WORKER_VIEWS).toContain("position < (pageData.page - 1) * PAGE_SIZE");
    expect(ADMIN_CLIENT_ACTIONS).toContain("workerPages.authenticated_zen = Math.max");
  });
});
