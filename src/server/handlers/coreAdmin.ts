import type { IncomingMessage, ServerResponse } from "node:http";
import type { RequestContext } from "../context.js";
import { handleCoreSettings } from "./coreSettings.js";
import { handleWorkersAdmin } from "./workersAdmin.js";

export async function handleCoreAdmin(
  req: IncomingMessage, res: ServerResponse, method: string, path: string, ctx: RequestContext
): Promise<boolean> {
  if (await handleCoreSettings(req, res, method, path, ctx)) return true;
  return handleWorkersAdmin(req, res, method, path, ctx);
}
