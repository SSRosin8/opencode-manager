import { describe, expect, it } from "vitest";
import { ADMIN_CLIENT_ACTIONS } from "../src/server/admin/clientActions.js";
import { ADMIN_CLIENT_CORE } from "../src/server/admin/clientCore.js";
import { ADMIN_CLIENT_I18N } from "../src/server/admin/clientI18n.js";
import { ADMIN_CLIENT_PROXY_VIEWS } from "../src/server/admin/clientProxyViews.js";
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

  it("keeps secondary accent controls from crowding mobile language controls", () => {
    expect(ADMIN_FEATURE_STYLES).toMatch(/@media \(max-width: 900px\)[\s\S]*\.accent-switcher \{ display:none; \}/);
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

  it("explains isolation health with an accessible tooltip", () => {
    expect(ADMIN_MARKUP).toContain('class="info-tooltip" tabindex="0" aria-describedby="iso-tooltip"');
    expect(ADMIN_MARKUP).toContain('role="tooltip" data-i18n="isoTooltip"');
    expect(ADMIN_CLIENT_I18N).toContain('isoTooltip: "展示每个 Worker');
    expect(ADMIN_FEATURE_STYLES).toContain('.info-tooltip:hover [role="tooltip"]');
  });

  it("keeps anonymous Worker IDs available without showing long generated IDs in card titles", () => {
    expect(ADMIN_CLIENT_WORKER_VIEWS).toContain('t("anonymousWorkerName")(idx + 1)');
    expect(ADMIN_CLIENT_WORKER_VIEWS).toContain('title="\' + escapeAttr(a.id || displayName)');
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
