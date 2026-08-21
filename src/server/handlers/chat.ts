import type { IncomingMessage, ServerResponse } from "node:http";
import type { RequestContext } from "../context.js";
import { parseUsageFromObject, parseUsageFromSseBuffer } from "../../settings/workerStats.js";
import { HOP_BY_HOP, clientHeadersFrom, pipeUpstream, readBody, readStreamFully, rejectUnavailableWorkerPool, sendJson } from "../httpIO.js";

export async function handleChat(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  ctx: RequestContext
): Promise<boolean> {
  const { store, upstream, workerStats, freeModels } = ctx;
  // OpenAI-compatible chat completions and Responses API.
  const isResponses = path === "/v1/responses" || path === "/responses";
  if (
    method === "POST" &&
    (isResponses || path === "/v1/chat/completions" || path === "/chat/completions")
  ) {
    const raw = await readBody(req);
    let body: unknown;
    try {
      body = JSON.parse(raw.toString("utf8") || "{}");
    } catch {
      store.recordGatewayRejection({
        method,
        path,
        status: 400,
        type: "invalid_request_error",
      });
      sendJson(res, 400, {
        error: { message: "Invalid JSON body", type: "invalid_request_error" },
      });
      return true;
    }
    if (rejectUnavailableWorkerPool(res, store, path, method)) return true;
    const stream = Boolean(
      body &&
        typeof body === "object" &&
        !Array.isArray(body) &&
        (body as { stream?: boolean }).stream
    );

    // Free-only enforcement: refuse paid / unknown models up front.
    const reqModel = body && typeof body === "object" && !Array.isArray(body)
      ? String((body as { model?: unknown }).model ?? "").replace(/^opencode\//, "")
      : "";
    if (reqModel && !freeModels.has(reqModel)) {
      store.recordGatewayRejection({
        method,
        path,
        status: 403,
        type: "model_not_allowed",
        model: reqModel,
      });
      sendJson(res, 403, {
        error: {
          message: `Model "${reqModel}" is not a free model and is not served by this gateway (free-only).`,
          type: "model_not_allowed",
        },
      });
      return true;
    }
    if (reqModel && body && typeof body === "object" && !Array.isArray(body)) {
      body = { ...(body as Record<string, unknown>), model: reqModel };
    }

    try {
      const result = await upstream.chatCompletions({
        body,
        stream,
        clientHeaders: clientHeadersFrom(req),
        protocol: isResponses ? "responses" : "chat",
      });
      store.recordRequest(
        path,
        result.status,
        result.status >= 400 ? `upstream ${result.status}` : undefined
      );
      store.updateReadyCount(
        upstream.rotator.readyCount(),
        upstream.rotator.getAccounts().length
      );

      if (!stream && result.body && result.status >= 200 && result.status < 300) {
        // Buffer non-stream body to extract usage, then forward intact.
        const buf = await readStreamFully(result.body);
        try {
          const parsed = JSON.parse(buf.toString("utf8")) as unknown;
          const usage = parseUsageFromObject(parsed);
          if (usage) workerStats.addTokens(result.accountId, usage, reqModel);
          else workerStats.recordMissingUsage(result.accountId);
        } catch {
          workerStats.recordMissingUsage(result.accountId);
        }
        const headers: Record<string, string> = {};
        result.headers.forEach((value, key) => {
          if (HOP_BY_HOP.has(key.toLowerCase())) return;
          headers[key] = value;
        });
        headers["Access-Control-Allow-Origin"] = "*";
        headers["Access-Control-Allow-Headers"] = "*";
        headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS";
        headers["Content-Length"] = String(buf.length);
        res.writeHead(result.status, headers);
        res.end(buf);
      } else if (stream && result.body) {
        const decoder = new TextDecoder();
        let sseText = "";
        await pipeUpstream(res, result, {
          onChunk: (chunk) => {
            sseText += decoder.decode(chunk, { stream: true });
            // Cap buffer to avoid unbounded growth on long streams
            if (sseText.length > 512_000) {
              sseText = sseText.slice(-256_000);
            }
          },
        });
        sseText += decoder.decode();
        const usage = parseUsageFromSseBuffer(sseText);
        if (usage) workerStats.addTokens(result.accountId, usage, reqModel);
        else if (result.status >= 200 && result.status < 300) workerStats.recordMissingUsage(result.accountId);
      } else {
        await pipeUpstream(res, result);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      store.recordRequest(path, 502, message);
      sendJson(res, 502, {
        error: {
          message: `Upstream ${isResponses ? "responses" : "chat"} failed: ${message}`,
          type: "upstream_error",
        },
      });
    }
    return true;
  }



  return false;
}
