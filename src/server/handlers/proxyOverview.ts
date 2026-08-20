import type { IncomingMessage, ServerResponse } from "node:http";
import type { RequestContext } from "../context.js";
import { batchProbeSnapshot } from "../context.js";
import { sendJson } from "../httpIO.js";

export async function handleProxyOverview(
  _req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  ctx: RequestContext
): Promise<boolean> {
  const { store, probes, batchProbeProgress } = ctx;
  // GET /admin/api/proxy-pool
  if (method === "GET" && path === "/admin/api/proxy-pool") {
    const s = store.get();
    sendJson(res, 200, {
      proxyPool: s.proxyPool,
      proxySubscriptions: s.proxySubscriptions,
      probeResults: probes.getAll(),
      batchProbe: batchProbeSnapshot(batchProbeProgress),
    });
    return true;
  }

  if (method === "GET" && path === "/admin/api/proxy-pool/test-batch/status") {
    sendJson(res, 200, {
      ...batchProbeSnapshot(batchProbeProgress),
    });
    return true;
  }


  return false;
}
