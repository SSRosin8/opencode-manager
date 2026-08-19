import type { IncomingMessage, ServerResponse } from "node:http";
import type { RequestContext } from "../context.js";
import { handleChat } from "./chat.js";
import { handleModels } from "./models.js";

export async function handleRelay(
  req: IncomingMessage, res: ServerResponse, method: string, path: string, ctx: RequestContext
): Promise<boolean> {
  if (await handleModels(req, res, method, path, ctx)) return true;
  return handleChat(req, res, method, path, ctx);
}
