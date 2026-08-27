/** Models-page fragment for the self-contained admin console. */
export const ADMIN_MODELS_MARKUP = `        <!-- Models -->
        <div class="page" id="page-models" data-page="models">
          <div class="page-head">
            <div>
              <h1 data-i18n="navModels">Models</h1>
              <p class="sub" data-i18n="modelsSub">Free models detected from the official OpenCode Zen catalog.</p>
            </div>
            <div class="page-actions">
              <button type="button" class="btn btn-primary" id="btn-refresh-models" data-i18n="refreshModels">Refresh catalog</button>
            </div>
          </div>
          <div class="metrics models-metrics" id="models-metrics"></div>
          <div class="panel" style="margin-top:12px">
            <div class="panel-hd">
              <div>
                <h2 data-i18n="detectedModels">Detected free models</h2>
                <p class="panel-sub" id="models-catalog-detail"></p>
              </div>
            </div>
            <div class="panel-bd">
              <div class="table-tools">
                <div class="search">
                  <input class="input" id="model-search" type="search" data-i18n-placeholder="searchModels" placeholder="Search models..." />
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3-3"/></svg>
                </div>
              </div>
              <div class="model-list" id="model-list"></div>
              <div class="table-foot"><div class="sum" id="models-sum"></div></div>
            </div>
          </div>
        </div>

`;
