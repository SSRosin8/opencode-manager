/** Source fragment for overview usage trend rendering. */
export const ADMIN_CLIENT_USAGE_VIEWS = `    function renderUsageTimeline() {
      const chart = $("ov-usage-chart");
      const summary = $("ov-usage-timeline-summary");
      const legend = $("ov-usage-timeline-legend");
      if (!chart || !summary) return;
      const rangeButtons = document.querySelectorAll("[data-timeline-hours]");
      rangeButtons.forEach((button) => {
        const active = Number(button.dataset.timelineHours) === usageTimelineHours;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
        button.onclick = () => {
          usageTimelineHours = Number(button.dataset.timelineHours) === 168 ? 168 : 24;
          storageSet("opencode-manager-usage-range", String(usageTimelineHours));
          renderWorkerStats();
        };
      });
      const timeline = Array.isArray(status?.usageTimeline) ? status.usageTimeline : [];
      const items = timeline.slice(-usageTimelineHours);
      const hasActivity = items.some((item) => ["requestCount", "successCount", "failureCount", "totalTokens", "usageReportedCount", "usageMissingCount"]
        .some((key) => Number(item[key]) > 0));
      if (!items.length || !hasActivity) {
        chart.innerHTML = '<div class="usage-chart-empty">' + escapeHtml(t("noUsageTrend")) + '</div>';
        summary.innerHTML = "";
        if (legend) legend.hidden = true;
        return;
      }
      if (legend) legend.hidden = false;
      const maxRequests = Math.max(1, ...items.map((item) => Number(item.requestCount) || 0));
      const dateOptions = usageTimelineHours === 24
        ? { hour: "2-digit", minute: "2-digit" }
        : { month: "numeric", day: "numeric", hour: "2-digit" };
      const labelEvery = Math.max(1, Math.ceil(items.length / (usageTimelineHours === 24 ? 8 : 10)));
      chart.innerHTML = '<div class="usage-chart-bars">' + items.map((item, index) => {
        const requests = Number(item.requestCount) || 0;
        const success = Number(item.successCount) || 0;
        const failure = Number(item.failureCount) || 0;
        const time = new Date(item.startAt);
        const label = Number.isFinite(time.getTime()) ? time.toLocaleString(lang === "zh" ? "zh-CN" : "en-US", dateOptions) : "—";
        const coverageCount = (Number(item.usageReportedCount) || 0) + (Number(item.usageMissingCount) || 0);
        const coverage = coverageCount ? fmtRate((Number(item.usageReportedCount) || 0) / coverageCount) : "—";
        const tooltip = t("trendTooltip")(label, fmtNum(requests), fmtNum(success), fmtNum(failure), fmtNum(item.totalTokens), coverage);
        const successHeight = Math.min(100, success / maxRequests * 100);
        const failureHeight = Math.min(100, failure / maxRequests * 100);
        return '<div class="usage-bar hover-detail" tabindex="0" data-tooltip="' + escapeAttr(tooltip) + '" aria-label="' + escapeAttr(tooltip) + '">' +
          '<div class="usage-bar-track"><span class="usage-bar-segment failure" style="height:' + failureHeight.toFixed(2) + '%"></span><span class="usage-bar-segment success" style="height:' + successHeight.toFixed(2) + '%"></span></div>' +
          '<span class="usage-bar-label">' + (index % labelEvery === 0 || index === items.length - 1 ? escapeHtml(label) : "") + '</span></div>';
      }).join("") + '</div>';
      const aggregate = items.reduce((result, item) => {
        for (const key of ["requestCount", "successCount", "failureCount", "promptTokens", "completionTokens", "totalTokens", "cacheReadTokens", "cacheWriteTokens", "cacheMissTokens", "usageReportedCount", "usageMissingCount"]) {
          result[key] += Number(item[key]) || 0;
        }
        return result;
      }, { requestCount: 0, successCount: 0, failureCount: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cacheMissTokens: 0, usageReportedCount: 0, usageMissingCount: 0 });
      const finished = aggregate.successCount + aggregate.failureCount;
      const coverageCount = aggregate.usageReportedCount + aggregate.usageMissingCount;
      const cacheRate = aggregate.promptTokens ? aggregate.cacheReadTokens / aggregate.promptTokens : null;
      summary.innerHTML = [
        [t("trendRequests"), fmtNum(aggregate.requestCount)],
        [t("summarySuccessRate"), finished ? fmtRate(aggregate.successCount / finished) : "—"],
        [t("trendTokens"), fmtNum(aggregate.totalTokens)],
        [t("trendCoverage"), coverageCount ? fmtRate(aggregate.usageReportedCount / coverageCount) : "—"],
        [t("summaryCacheRate"), fmtRate(cacheRate)],
      ].map((item) => '<div class="usage-timeline-stat"><span>' + escapeHtml(item[0]) + '</span><strong>' + escapeHtml(item[1]) + '</strong></div>').join("");
    }
`;
