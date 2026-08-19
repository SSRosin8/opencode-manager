/**
 * Build undici dispatchers for HTTP and SOCKS proxies.
 */

import { ProxyAgent, type Dispatcher } from "undici";
import { socksDispatcher } from "fetch-socks";
import type { AccountProxy } from "../relay/accounts.js";
import { normalizeProtocol, proxyToUri } from "./pool.js";

export function createProxyDispatcher(proxy: NonNullable<AccountProxy>): Dispatcher {
  const type = normalizeProtocol(proxy.type || "http");

  if (type === "socks5" || type === "socks4") {
    return socksDispatcher({
      type: type === "socks4" ? 4 : 5,
      host: proxy.host,
      port: proxy.port,
      userId: proxy.username,
      password: proxy.password,
    }) as unknown as Dispatcher;
  }

  // HTTP / HTTPS CONNECT proxy
  return new ProxyAgent(proxyToUri(proxy));
}
