/** First-run and reusable help fragments for the self-contained admin console. */
export const ADMIN_GETTING_STARTED = `
          <section class="getting-started" id="getting-started" aria-labelledby="getting-started-title">
            <div class="getting-started-head">
              <div>
                <span class="eyebrow" data-i18n="gettingStartedEyebrow">FIRST RUN</span>
                <h2 id="getting-started-title" data-i18n="gettingStartedTitle">Get started in 5 steps</h2>
                <p class="panel-sub" data-i18n="gettingStartedSub">Set up the gateway, add egress nodes, then bind Workers.</p>
              </div>
              <button type="button" class="btn btn-sm" id="btn-dismiss-getting-started" data-i18n="dismissGuide">Dismiss</button>
            </div>
            <div class="getting-started-steps">
              <button type="button" class="getting-step" data-guide-page="gateway"><span class="step-num">1</span><span><strong data-i18n="guideStepGateway">Configure gateway</strong><small data-i18n="guideStepGatewayHint">Keep the local port and upstream URL.</small></span></button>
              <button type="button" class="getting-step" data-guide-page="proxy" data-guide-tab="sources"><span class="step-num">2</span><span><strong data-i18n="guideStepSource">Add a node source</strong><small data-i18n="guideStepSourceHint">Import a subscription or Controller nodes.</small></span></button>
              <button type="button" class="getting-step" data-guide-page="proxy"><span class="step-num">3</span><span><strong data-i18n="guideStepTest">Test nodes</strong><small data-i18n="guideStepTestHint">Run a batch test and keep healthy routes.</small></span></button>
              <button type="button" class="getting-step" data-guide-page="workers"><span class="step-num">4</span><span><strong data-i18n="guideStepBind">Bind Workers</strong><small data-i18n="guideStepBindHint">Assign a proxy to each Worker for isolation.</small></span></button>
              <button type="button" class="getting-step" data-guide-page="usage"><span class="step-num">5</span><span><strong data-i18n="guideStepConnect">Connect OpenCode</strong><small data-i18n="guideStepConnectHint">Point your client to the local /v1 endpoint.</small></span></button>
            </div>
          </section>`;

export const ADMIN_GUIDE_MODAL = `
  <div class="modal-root" id="modal-guide">
    <div class="modal guide-modal" role="dialog" aria-modal="true" aria-labelledby="guide-modal-title" tabindex="-1">
      <div class="modal-title-row"><h3 id="guide-modal-title" data-i18n="guideTitle">Using opencode-manager</h3><button type="button" class="icon-btn" id="guide-close" data-i18n-tooltip="close" aria-label="Close">×</button></div>
      <p class="panel-sub" data-i18n="guideIntro">This is the recommended path for routing OpenCode through separate proxy IPs.</p>
      <ol class="guide-list">
        <li><strong data-i18n="guideStepGateway">Configure gateway</strong><span data-i18n="guideDetailGateway">Set the upstream URL and keep the listener on localhost.</span></li>
        <li><strong data-i18n="guideStepSource">Add a node source</strong><span data-i18n="guideDetailSource">Add a subscription, import a Clash/Mihomo Controller, or add a proxy manually.</span></li>
        <li><strong data-i18n="guideStepTest">Test nodes</strong><span data-i18n="guideDetailTest">Batch test nodes and use only healthy routes.</span></li>
        <li><strong data-i18n="guideStepBind">Bind Workers</strong><span data-i18n="guideDetailBind">Assign healthy nodes to Workers to keep egress IPs isolated.</span></li>
        <li><strong data-i18n="guideStepConnect">Connect OpenCode</strong><span data-i18n="guideDetailConnect">Use the displayed OpenAI-compatible base URL and your relay token if configured.</span></li>
      </ol>
      <div class="guide-actions"><button type="button" class="btn btn-primary" id="guide-go-overview" data-i18n="guideBackOverview">Back to overview</button></div>
    </div>
  </div>`;
