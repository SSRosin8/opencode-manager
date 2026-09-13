import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import { describe, expect, it, vi } from "vitest";
import {
  RelayBodyTooLargeError,
  UpstreamResponseTooLargeError,
  readBody,
  readStreamFully,
} from "../src/server/httpIO.js";

function requestDouble(): IncomingMessage & { resume: ReturnType<typeof vi.fn> } {
  const request = new EventEmitter() as IncomingMessage & { resume: ReturnType<typeof vi.fn> };
  Object.assign(request, { headers: {}, resume: vi.fn() });
  return request;
}

describe("readBody", () => {
  it("reads a multimodal-sized body up to the configured bound", async () => {
    const request = requestDouble();
    const result = readBody(request, 4);
    request.emit("data", Buffer.from("ab"));
    request.emit("data", Buffer.from("cd"));
    request.emit("end");

    await expect(result).resolves.toEqual(Buffer.from("abcd"));
  });

  it("stops accumulating as soon as a request exceeds its bound", async () => {
    const request = requestDouble();
    const result = readBody(request, 4);
    request.emit("data", Buffer.from("abcde"));

    await expect(result).rejects.toEqual(
      expect.objectContaining({
        name: RelayBodyTooLargeError.name,
        message: "Relay request body exceeded the 4 byte limit",
      })
    );
    expect(request.resume).toHaveBeenCalledOnce();
  });
});

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
