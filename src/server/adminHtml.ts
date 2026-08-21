import { ADMIN_CLIENT_ACTIONS } from "./admin/clientActions.js";
import { ADMIN_CLIENT_BATCH } from "./admin/clientBatch.js";
import { ADMIN_CLIENT_CORE } from "./admin/clientCore.js";
import { ADMIN_CLIENT_I18N } from "./admin/clientI18n.js";
import { ADMIN_CLIENT_PROXY_VIEWS } from "./admin/clientProxyViews.js";
import { ADMIN_CLIENT_TOOLTIPS } from "./admin/clientTooltips.js";
import { ADMIN_CLIENT_WORKER_VIEWS } from "./admin/clientWorkerViews.js";
import { ADMIN_DOCUMENT_HEAD } from "./admin/documentHead.js";
import { ADMIN_FEATURE_STYLES } from "./admin/featureStyles.js";
import { ADMIN_MARKUP } from "./admin/markup.js";

/** Self-contained admin console assembled from maintainable source fragments. */
export const ADMIN_HTML = [
  ADMIN_DOCUMENT_HEAD,
  ADMIN_FEATURE_STYLES,
  ADMIN_MARKUP,
  ADMIN_CLIENT_I18N,
  ADMIN_CLIENT_CORE,
  ADMIN_CLIENT_TOOLTIPS,
  ADMIN_CLIENT_PROXY_VIEWS,
  ADMIN_CLIENT_WORKER_VIEWS,
  ADMIN_CLIENT_BATCH,
  ADMIN_CLIENT_ACTIONS,
].join("");
