import type { IncomingMessage, ServerResponse } from "node:http";
import type { RequestContext } from "../context.js";
import { HOP_BY_HOP, UpstreamResponseTooLargeError, clientHeadersFrom, pipeUpstream, readStreamFully, rejectUnavailableWorkerPool, sendJson } from "../httpIO.js";

const MAX_MODELS_RESPONSE_BYTES = 4 * 1024 * 1024;

function sendBufferedUpstream(
  res: ServerResponse,
  result: Awaited<ReturnType<RequestContext["upstream"]["listModels"]>>,
  body: Buffer
): void {
  const headers: Record<string, string> = {};
  result.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers[key] = value;
  });
  headers["Access-Control-Allow-Origin"] = "*";
  headers["Access-Control-Allow-Headers"] = "*";
  headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS";
  headers["Content-Length"] = String(body.length);
  res.writeHead(result.status, headers);
  res.end(body);
}

export async function handleModels(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  ctx: RequestContext
): Promise<boolean> {
  const { store, upstream, freeModels } = ctx;
  // OpenAI-compatible models
  if (method === "GET" && (path === "/v1/models" || path === "/models")) {
    if (rejectUnavailableWorkerPool(res, store, path, method)) return true;
    try {
      const result = await upstream.listModels(clientHeadersFrom(req));
      store.recordRequest(path, result.status);
      store.updateReadyCount(
        upstream.rotator.readyCount(),
        upstream.rotator.getAccounts().length
      );
      // Serve ONLY free models: buffer the JSON payload and drop paid ids.
      if (result.status < 400 && result.body) {
        const buf = await readStreamFully(result.body, MAX_MODELS_RESPONSE_BYTES);
        let payload: unknown = null;
        try {
          payload = JSON.parse(buf.toString("utf8"));
        } catch {
          /* upstream 200 but not JSON — fall through to passthrough */
        }
        if (payload && typeof payload === "object" && !Array.isArray(payload)) {
          const obj = payload as { object?: unknown; data?: unknown };
          const data = Array.isArray(obj.data) ? obj.data : [];
          const kept = data.filter((m): boolean => {
            if (!m || typeof m !== "object") return false;
            const id = String((m as { id?: unknown }).id ?? "");
            return freeModels.has(id);
          });
          sendJson(res, result.status, {
            ...payload as Record<string, unknown>,
            object: obj.object ?? "list",
            data: kept,
          });
          return true;
        }
        sendBufferedUpstream(res, result, buf);
        return true;
      }
      await pipeUpstream(res, result);
    } catch (err) {
      if (err instanceof UpstreamResponseTooLargeError) {
        store.recordRequest(path, 502, err.message);
        sendJson(res, 502, {
          error: { message: err.message, type: "upstream_response_too_large" },
        });
        return true;
      }
      const message = err instanceof Error ? err.message : String(err);
      store.recordRequest(path, 502, message);
      sendJson(res, 502, {
        error: { message: `Upstream models failed: ${message}`, type: "upstream_error" },
      });
    }
    return true;
  }


  return false;
}
