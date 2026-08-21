import { describe, expect, it, vi } from "vitest";
import {
  UpstreamResponseTooLargeError,
  readStreamFully,
} from "../src/server/httpIO.js";

describe("readStreamFully", () => {
  it("returns a response whose size is exactly the configured limit", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3, 4]));
        controller.close();
      },
    });

    await expect(readStreamFully(body, 4)).resolves.toEqual(
      Buffer.from([1, 2, 3, 4])
    );
  });

  it("cancels the response stream as soon as it exceeds the configured limit", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4, 5, 6]));
      },
      cancel,
    });

    await expect(readStreamFully(body, 4)).rejects.toEqual(
      expect.objectContaining({
        name: UpstreamResponseTooLargeError.name,
        message: "Upstream response exceeded the configured size limit",
      })
    );
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects invalid limits before reading the response", async () => {
    const body = new ReadableStream<Uint8Array>();
    await expect(readStreamFully(body, -1)).rejects.toThrow(
      "maxBytes must be a non-negative safe integer"
    );
  });
});
