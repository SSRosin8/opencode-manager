/** Shared, viewport-aware tooltip controller for the admin console. */
export const ADMIN_CLIENT_TOOLTIPS = `    const TOOLTIP_SAFE_AREA = 12;
    const TOOLTIP_GAP = 9;
    let activeTooltipTrigger = null;

    function tooltipLayer() {
      let layer = $("ui-tooltip");
      if (layer) return layer;
      layer = document.createElement("div");
      layer.id = "ui-tooltip";
      layer.className = "ui-tooltip";
      layer.setAttribute("role", "tooltip");
      layer.hidden = true;
      layer.innerHTML = '<span class="ui-tooltip-arrow" aria-hidden="true"></span><span class="ui-tooltip-content"></span>';
      document.body.appendChild(layer);
      return layer;
    }

    function positionTooltip(trigger, layer) {
      const triggerRect = trigger.getBoundingClientRect();
      const layerRect = layer.getBoundingClientRect();
      const maxLeft = Math.max(TOOLTIP_SAFE_AREA, window.innerWidth - layerRect.width - TOOLTIP_SAFE_AREA);
      const idealLeft = triggerRect.left + (triggerRect.width - layerRect.width) / 2;
      const left = Math.min(maxLeft, Math.max(TOOLTIP_SAFE_AREA, idealLeft));
      const topCandidate = triggerRect.top - layerRect.height - TOOLTIP_GAP;
      const bottomCandidate = triggerRect.bottom + TOOLTIP_GAP;
      const fitsAbove = topCandidate >= TOOLTIP_SAFE_AREA;
      const fitsBelow = bottomCandidate + layerRect.height <= window.innerHeight - TOOLTIP_SAFE_AREA;
      const placement = fitsAbove || (!fitsBelow && triggerRect.top > window.innerHeight - triggerRect.bottom)
        ? "top"
        : "bottom";
      const rawTop = placement === "top" ? topCandidate : bottomCandidate;
      const maxTop = Math.max(TOOLTIP_SAFE_AREA, window.innerHeight - layerRect.height - TOOLTIP_SAFE_AREA);
      const top = Math.min(maxTop, Math.max(TOOLTIP_SAFE_AREA, rawTop));
      const triggerCenter = triggerRect.left + triggerRect.width / 2;
      const arrowLeft = Math.min(layerRect.width - 14, Math.max(14, triggerCenter - left));
      layer.dataset.placement = placement;
      layer.style.left = Math.floor(left) + "px";
      layer.style.top = Math.floor(top) + "px";
      layer.style.setProperty("--tooltip-arrow-x", Math.round(arrowLeft) + "px");
    }

    function showTooltip(trigger) {
      const text = trigger.dataset.tooltip?.trim();
      if (!text) return;
      const layer = tooltipLayer();
      if (activeTooltipTrigger && activeTooltipTrigger !== trigger) {
        activeTooltipTrigger.removeAttribute("aria-describedby");
      }
      activeTooltipTrigger = trigger;
      layer.querySelector(".ui-tooltip-content").textContent = text;
      layer.hidden = false;
      layer.classList.remove("is-visible");
      trigger.setAttribute("aria-describedby", layer.id);
      positionTooltip(trigger, layer);
      requestAnimationFrame(() => {
        if (activeTooltipTrigger !== trigger || layer.hidden) return;
        positionTooltip(trigger, layer);
        layer.classList.add("is-visible");
      });
    }

    function hideTooltip(trigger) {
      if (trigger && activeTooltipTrigger !== trigger) return;
      const layer = $("ui-tooltip");
      activeTooltipTrigger?.removeAttribute("aria-describedby");
      activeTooltipTrigger = null;
      if (!layer) return;
      layer.classList.remove("is-visible");
      layer.hidden = true;
    }

    function initTooltips() {
      document.addEventListener("pointerover", (event) => {
        if (matchMedia("(hover: none)").matches) return;
        const trigger = event.target.closest?.("[data-tooltip]");
        if (!trigger || trigger.contains(event.relatedTarget)) return;
        showTooltip(trigger);
      });
      document.addEventListener("pointerout", (event) => {
        if (matchMedia("(hover: none)").matches) return;
        const trigger = event.target.closest?.("[data-tooltip]");
        if (!trigger || trigger.contains(event.relatedTarget)) return;
        if (document.activeElement === trigger && trigger.matches(":focus-visible")) return;
        hideTooltip(trigger);
      });
      document.addEventListener("focusin", (event) => {
        const trigger = event.target.closest?.("[data-tooltip]");
        if (trigger) showTooltip(trigger);
      });
      document.addEventListener("focusout", (event) => {
        const trigger = event.target.closest?.("[data-tooltip]");
        if (trigger && !trigger.contains(event.relatedTarget)) hideTooltip(trigger);
      });
      document.addEventListener("click", (event) => {
        const trigger = event.target.closest?.("[data-tooltip][tabindex]");
        if (!matchMedia("(hover: none)").matches) return;
        if (!trigger) { hideTooltip(); return; }
        if (activeTooltipTrigger === trigger) hideTooltip(trigger);
        else showTooltip(trigger);
      });
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") hideTooltip();
      });
      document.addEventListener("scroll", () => hideTooltip(), true);
      window.addEventListener("resize", () => hideTooltip());
    }
`;
