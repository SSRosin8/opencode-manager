import { describe, expect, it } from "vitest";
import { UsageTimeline, USAGE_TIMELINE_MAX_HOURS } from "../src/settings/usageTimeline.js";

const NOW = Date.parse("2026-09-13T10:30:00.000Z");

describe("UsageTimeline", () => {
  it("aggregates attempts, tokens, coverage, and fills empty hours", () => {
    const timeline = new UsageTimeline({ now: () => NOW });
    timeline.recordAttempt("worker-a", "chat", 200, "2026-09-13T08:10:00.000Z");
    timeline.recordAttempt("worker-a", "chat", 503, "2026-09-13T08:15:00.000Z");
    timeline.recordAttempt("worker-b", "models", 200, "2026-09-13T09:05:00.000Z");
    timeline.addTokens("worker-a", {
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
      cacheReadTokens: 40,
      cacheWriteTokens: 2,
      cacheMissTokens: 60,
    });
    timeline.recordMissingUsage("worker-b");

    expect(timeline.get(undefined, 3)).toEqual([
      expect.objectContaining({ requestCount: 2, successCount: 1, failureCount: 1, startAt: "2026-09-13T08:00:00.000Z" }),
      expect.objectContaining({ requestCount: 1, successCount: 1, startAt: "2026-09-13T09:00:00.000Z" }),
      expect.objectContaining({ requestCount: 0, totalTokens: 120, usageReportedCount: 1, usageMissingCount: 1, startAt: "2026-09-13T10:00:00.000Z" }),
    ]);
    expect(timeline.get(["worker-a"], 3)[1].requestCount).toBe(0);
    expect(timeline.get(["worker-a"], 3)[2].totalTokens).toBe(120);
  });

  it("keeps only the seven-day window and rejects unsafe persisted values", () => {
    const timeline = new UsageTimeline({ now: () => NOW });
    for (let index = 0; index < USAGE_TIMELINE_MAX_HOURS + 20; index += 1) {
      const at = NOW - index * 60 * 60 * 1000;
      timeline.recordAttempt("worker-a", "chat", 200, new Date(at).toISOString());
    }
    const persisted = timeline.serialize();
    expect(persisted["worker-a"]).toHaveLength(USAGE_TIMELINE_MAX_HOURS);
    expect(persisted["worker-a"][0].startAt).toBe("2026-09-06T11:00:00.000Z");

    const restored = new UsageTimeline({ now: () => NOW });
    restored.load(JSON.parse('{"worker-a":[{"startAt":"not-a-date","requestCount":99},{"startAt":"2026-09-13T10:00:00.000Z","requestCount":"4","totalTokens":-4}],"__proto__":[{"startAt":"2026-09-13T10:00:00.000Z","requestCount":9}]}'));
    expect(restored.get(undefined, 1)[0]).toMatchObject({ requestCount: 4, totalTokens: 0 });
    expect(Object.keys(restored.serialize())).toEqual(["worker-a"]);
  });

  it("resets one worker or the complete timeline", () => {
    const timeline = new UsageTimeline({ now: () => NOW });
    timeline.recordAttempt("worker-a", "chat", 200, new Date(NOW).toISOString());
    timeline.recordAttempt("worker-b", "chat", 200, new Date(NOW).toISOString());
    timeline.reset("worker-a");
    expect(timeline.get(["worker-a"], 1)[0].requestCount).toBe(0);
    expect(timeline.get(["worker-b"], 1)[0].requestCount).toBe(1);
    timeline.reset();
    expect(timeline.serialize()).toEqual({});
  });
});
