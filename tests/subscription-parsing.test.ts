import { describe, expect, it } from "vitest";
import {
  parseProxyUri,
  parseSubscriptionBody,
} from "../src/proxy/subscriptionParsing.js";

describe("subscription parsing compatibility", () => {
  it("parses raw Clash JSON and SIP008", () => {
    const clash = parseSubscriptionBody(
      JSON.stringify({
        proxies: [
          { name: "json", type: "http", server: "192.0.2.1", port: 8080 },
        ],
      }),
    );
    expect(clash.proxies[0].name).toBe("json");
    const sip = parseSubscriptionBody(
      JSON.stringify({
        version: 1,
        servers: [
          {
            remarks: "sip",
            server: "192.0.2.2",
            server_port: 8388,
            method: "aes-128-gcm",
            password: "secret",
          },
        ],
      }),
    );
    expect(sip.proxies[0]).toMatchObject({
      name: "sip",
      host: "192.0.2.2",
      port: 8388,
      type: "ss",
    });
  });

  it("parses vmess and Shadowsocks encoded links", () => {
    const vmess = Buffer.from(
      JSON.stringify({
        add: "vmess.example",
        port: 443,
        id: "00000000-0000-0000-0000-000000000001",
        ps: "VM",
      }),
    ).toString("base64");
    expect(parseProxyUri(`vmess://${vmess}`)?.name).toBe("VM");
    const ssPayload = Buffer.from(
      "aes-128-gcm:password@ss.example:443",
    ).toString("base64");
    expect(parseProxyUri(`ss://${ssPayload}#SS`)).toMatchObject({
      name: "SS",
      host: "ss.example",
      port: 443,
      type: "ss",
    });
    const credentials = Buffer.from("chacha20-ietf-poly1305:pass").toString(
      "base64url",
    );
    expect(
      parseProxyUri(`ss://${credentials}@sip002.example:8443#SIP002`),
    ).toMatchObject({ name: "SIP002", host: "sip002.example", port: 8443 });
  });

  it("parses SSR encoded links", () => {
    const password = Buffer.from("password").toString("base64url");
    const remarks = Buffer.from("SSR Node").toString("base64url");
    const payload = Buffer.from(
      `ssr.example:443:origin:aes-256-cfb:plain:${password}/?remarks=${remarks}`,
    ).toString("base64url");
    expect(parseProxyUri(`ssr://${payload}`)).toMatchObject({
      name: "SSR Node",
      host: "ssr.example",
      port: 443,
      type: "ssr",
    });
  });

  it("supports nested base64 URI lists up to three layers", () => {
    let body = "http://192.0.2.3:8080";
    for (let i = 0; i < 3; i++) body = Buffer.from(body).toString("base64");
    expect(parseSubscriptionBody(body).proxies).toHaveLength(1);
  });
});
