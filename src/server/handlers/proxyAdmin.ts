import type { IncomingMessage, ServerResponse } from "node:http";
import type { RequestContext } from "../context.js";
import { handleClashAdmin } from "./clashAdmin.js";
import { handleProxyOverview } from "./proxyOverview.js";
import { handleProxyPool } from "./proxyPool.js";
import { handleProxyProbes } from "./proxyProbes.js";
import { handleSubscriptionRefresh } from "./subscriptionRefresh.js";
import { handleSubscriptions } from "./subscriptions.js";
import { handleWorkerTests } from "./workerTests.js";

export async function handleProxyAdmin(
  req: IncomingMessage, res: ServerResponse, method: string, path: string, ctx: RequestContext
): Promise<boolean> {
  if (await handleWorkerTests(req, res, method, path, ctx)) return true;
  if (await handleProxyOverview(req, res, method, path, ctx)) return true;
  if (await handleProxyProbes(req, res, method, path, ctx)) return true;
  if (await handleProxyPool(req, res, method, path, ctx)) return true;
  if (await handleSubscriptions(req, res, method, path, ctx)) return true;
  if (await handleClashAdmin(req, res, method, path, ctx)) return true;
  return handleSubscriptionRefresh(req, res, method, path, ctx);
}
