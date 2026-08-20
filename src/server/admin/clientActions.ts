/** Source fragment for the self-contained admin console. */
export const ADMIN_CLIENT_ACTIONS = `    $("btn-top-refresh").onclick = () => refreshAll();
    $("btn-nodes-refresh").onclick = () => refreshAll();
    $("btn-batch-test").onclick = () => batchTestProxies();
    $("btn-reset-stats").onclick = async () => {
      if (!confirm(t("confirmResetStats"))) return;
      const res = await fetch("/admin/api/worker-stats/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!res.ok) { toast(t("toastSaveFail"), false); return; }
      await loadStatus();
      renderStatusChrome();
      toast(t("toastStatsReset"));
    };

    $("btn-save-bridge").onclick = async () => {
      const body = { ...settings, clashBridge: collectBridge(), accounts: collectAccounts() };
      const res = await fetch("/admin/api/settings", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!res.ok) { toast(t("toastSaveFail"), false); return; }
      settings = await res.json();
      renderAll();
      toast(t("toastBridgeSaved"));
    };

    $("btn-probe-bridge").onclick = async () => {
      const msg = $("bridge-probe-msg");
      msg.className = "probe-ok show";
      msg.textContent = t("toastProbing");
      const res = await fetch("/admin/api/clash-bridge/probe", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(collectBridge()),
      });
      const data = await res.json();
      bridgeProbeOk = !!data.ok;
      msg.className = "probe-ok show" + (data.ok ? "" : " fail");
      msg.textContent = (data.ok ? "✓ " : "! ") + (data.message || "") + (data.groups ? " · " + data.groups.slice(0, 6).join(", ") : "");
      renderBridge();
      toast(data.ok ? t("toastClashOk") : t("toastClashFail"), data.ok);
    };

    $("btn-import-clash").onclick = async () => {
      const btn = $("btn-import-clash");
      btn.disabled = true;
      try {
        const bridge = collectBridge();
        const res = await fetch("/admin/api/clash-bridge/import", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(bridge),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || ("HTTP " + res.status));
        settings = data.settings;
        if (data.probeResults) probeResults = data.probeResults;
        bridgeProbeOk = true;
        await loadStatus();
        renderAll();
        const conflicts = data.bindingConflicts?.length || 0;
        const message = t("toastControllerImported")(data.imported || 0, data.group || bridge.selectorGroup) +
          (conflicts ? " · " + t("toastControllerConflicts")(conflicts) : "");
        toast(message, (data.imported || 0) > 0 && conflicts === 0);
      } catch (e) {
        toast(String(e.message || e), false);
      } finally {
        btn.disabled = false;
      }
    };

    $("btn-save-gateway").onclick = async () => {
      const body = {
        ...settings,
        routingStrategy: $("routing-strategy")?.value || settings.routingStrategy || "anonymous_first",
        baseUrl: $("baseUrl").value.trim(),
        relayAccessToken: $("relayAccessToken").value.trim(),
        port: Number($("port").value) || 9876,
        synthesizeCliHeaders: $("synthesizeCliHeaders").checked,
        cliUserAgent: $("cliUserAgent").value.trim(),
        cliClient: $("cliClient").value.trim(),
        cliProject: $("cliProject").value.trim(),
        clashBridge: collectBridge(),
        accounts: collectAccounts(),
      };
      const res = await fetch("/admin/api/settings", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!res.ok) { toast(t("toastSaveFail"), false); return; }
      settings = await res.json();
      await loadStatus();
      renderAll();
      toast(t("toastGatewaySaved"));
    };

    $("btn-save-accounts").onclick = async () => {
      if (await persistWorkerAccounts(collectAccounts())) toast(t("toastWorkersSaved"));
    };

    $("btn-assign-proxies").onclick = async () => {
      const btn = $("btn-assign-proxies");
      btn.disabled = true;
      try {
        // Prefer current form state so unsaved workers still get bindings
        const res = await fetch("/admin/api/workers/assign-proxies", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accounts: collectAccounts() }),
        });
        const data = await res.json();
        if (!res.ok) {
          const msg =
            data.error?.message && String(data.error.message).includes("No healthy")
              ? t("toastAssignNoHealthy")
              : (data.error?.message || t("toastAssignFail"));
          toast(msg, false);
          return;
        }
        settings = data.settings || settings;
        await loadStatus();
        renderAll();
        toast(t("toastAssignProxies")(data.assigned || 0, (settings.accounts || []).length, data.healthyAvailable || 0));
      } catch {
        toast(t("toastAssignFail"), false);
      } finally {
        btn.disabled = false;
      }
    };

    $("btn-add-account").onclick = () => {
      settings.accounts = collectAccounts();
      const used = new Set(settings.accounts.map((account) => account.id));
      let number = settings.accounts.length + 1;
      while (used.has("worker-" + number)) number += 1;
      settings.accounts.push({
        id: "worker-" + number,
        kind: "authenticated_zen", enabled: true, apiKey: "", proxyId: null, proxy: null,
      });
      renderAccounts();
    };

    $("btn-remove-all-workers").onclick = () => {
      if (document.querySelectorAll("#accounts .worker-card").length === 0) return;
      openConfirm(t("confirmRemoveAllWorkers"), t("confirmRemoveAllWorkersBody"), async () => {
        if (!await persistWorkerAccounts([])) return;
        collapsedWorkerIds.clear();
        persistCollapsedWorkers();
        toast(t("toastWorkersCleared"));
      });
    };

    $("btn-add-proxy").onclick = async () => {
      const host = $("pxHost").value.trim();
      const port = Number($("pxPort").value);
      if (!host || !port) { toast(t("toastHostPort"), false); return; }
      const res = await fetch("/admin/api/proxy-pool", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: $("pxName").value.trim() || undefined,
          type: $("pxType").value, host, port,
          username: $("pxUser").value || undefined,
          password: $("pxPass").value || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast(data.error?.message || t("toastAddFail"), false); return; }
      settings = data;
      ["pxHost","pxPort","pxName","pxUser","pxPass"].forEach((id) => { $(id).value = ""; });
      closeModal("modal-proxy");
      renderAll();
      toast(t("toastAddedPool"));
    };

    $("btn-add-sub").onclick = async () => {
      const url = $("subUrl").value.trim();
      if (!url) { toast(t("toastSubUrlReq"), false); return; }
      const res = await fetch("/admin/api/proxy-subscriptions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: $("subName").value.trim() || undefined, url }),
      });
      const data = await res.json();
      if (!res.ok) { toast(data.error?.message || t("toastAddFail"), false); return; }
      settings = data.settings;
      $("subUrl").value = "";
      $("subName").value = "";
      closeModal("modal-sub");
      renderAll();
      toast(t("toastSubAdded"));
    };

    $("btn-fetch-all").onclick = async () => {
      const btn = $("btn-fetch-all");
      btn.disabled = true;
      try {
        const res = await fetch("/admin/api/proxy-subscriptions/fetch-all", { method: "POST" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || ("HTTP " + res.status));
        settings = data.settings;
        renderAll();
        const ok = (data.results || []).filter((r) => r.ok).length;
        toast(t("toastFetchDone")(ok, (data.results || []).length));
      } catch (e) {
        toast(String(e.message || e), false);
      } finally { btn.disabled = false; }
    };

    initSectionCollapsibles();
    initAccentSwitcher();
    applyStaticI18n();
    showPage(page);
    $("run-label").textContent = t("loading");
    Promise.all([loadSettings(), loadStatus(), loadProbes()]).then(() => {
      renderAll();
      syncBatchProgress(batchProgress);
    }).catch((e) => toast(String(e), false));
  </script>
</body>
</html>
`;
