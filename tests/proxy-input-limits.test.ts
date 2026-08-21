import { describe, expect, it } from "vitest";
import { fetchClashSubscription } from "../src/proxy/clash.js";

const EIGHT_MIB = 8 * 1024 * 1024;

describe("Clash subscription response limits", () => {
  it("rejects a declared oversized body and cancels it before reading", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });

    await expect(fetchClashSubscription({
      url: "https://example.invalid/subscription",
      subscriptionId: "sub",
      userAgent: "test",
      fetchImpl: async () => new Response(body, {
        status: 200,
        headers: { "content-length": String(EIGHT_MIB + 1) },
      }),
    })).rejects.toThrow("Subscription response is too large");
    expect(cancelled).toBe(true);
  });

  it("cancels a chunked body as soon as the streamed limit is exceeded", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(EIGHT_MIB));
        controller.enqueue(new Uint8Array(1));
      },
      cancel() {
        cancelled = true;
      },
    });

    await expect(fetchClashSubscription({
      url: "https://example.invalid/subscription",
      subscriptionId: "sub",
      userAgent: "test",
      fetchImpl: async () => new Response(body, { status: 200 }),
    })).rejects.toThrow("Subscription response is too large");
    expect(cancelled).toBe(true);
  });
});
