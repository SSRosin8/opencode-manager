/** Models-page behavior for the self-contained admin console. */
export const ADMIN_CLIENT_MODELS = `    let freeModelStatus = null;
    let modelsLoading = false;

    async function loadFreeModels() {
      const res = await fetch("/admin/api/free-models", { cache: "no-store" });
      if (!res.ok) throw new Error("free models " + res.status);
      freeModelStatus = await res.json();
    }

    function modelCatalogState() {
      if (!freeModelStatus) return { label: t("modelsLoading"), cls: "" };
      if (freeModelStatus.lastError) return { label: t("modelsRefreshFailed"), cls: "err" };
      if (freeModelStatus.usingBaseline) return { label: t("modelsBaseline"), cls: "warn" };
      return { label: t("modelsOfficial"), cls: "ok" };
    }

    function renderModels() {
      const ids = Array.isArray(freeModelStatus?.ids) ? freeModelStatus.ids : [];
      const query = ($("model-search")?.value || "").trim().toLowerCase();
      const filtered = query ? ids.filter((id) => id.toLowerCase().includes(query)) : ids;
      const catalog = modelCatalogState();
      const fetched = freeModelStatus?.lastFetchedAt
        ? relTime(freeModelStatus.lastFetchedAt)
        : t("neverFetched");
      $("models-metrics").innerHTML = [
        { label: t("detectedModels"), value: ids.length, cls: ids.length ? "ok" : "" },
        { label: t("catalogSource"), value: catalog.label, cls: catalog.cls },
        { label: t("lastCatalogRefresh"), value: fetched, cls: "" },
      ].map((item) => '<div class="metric"><div class="k">' + escapeHtml(item.label) + '</div><div class="v ' + item.cls + '">' + escapeHtml(item.value) + '</div></div>').join("");
      $("models-catalog-detail").textContent = freeModelStatus?.lastError
        ? t("modelsKeptPrevious") + " " + freeModelStatus.lastError
        : t("modelsCatalogDetail");
      $("model-list").innerHTML = filtered.length
        ? filtered.map((id) => '<div class="model-item"><code>' + escapeHtml(id) + '</code><span class="tag ok">' + escapeHtml(t("freeModel")) + '</span></div>').join("")
        : '<div class="empty-state">' + escapeHtml(query ? t("noMatchingModels") : t("noDetectedModels")) + '</div>';
      $("models-sum").textContent = t("modelsShown")(filtered.length, ids.length);
      const button = $("btn-refresh-models");
      if (button) {
        button.disabled = modelsLoading;
        button.textContent = t(modelsLoading ? "refreshingModels" : "refreshModels");
      }
    }

    async function refreshFreeModels() {
      if (modelsLoading) return;
      modelsLoading = true;
      renderModels();
      try {
        const res = await fetch("/admin/api/free-models/refresh", { method: "POST" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || ("HTTP " + res.status));
        freeModelStatus = data;
        toast(data.lastError ? t("toastModelsRefreshFailed") : t("toastModelsRefreshed"), !data.lastError);
      } catch (error) {
        toast(String(error.message || error), false);
      } finally {
        modelsLoading = false;
        renderModels();
      }
    }

    $("model-search").addEventListener("input", renderModels);
    $("btn-refresh-models").onclick = refreshFreeModels;

`;
