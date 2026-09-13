import type { ModelTokenUsage } from "./tokenUsage.js";
import type { WorkerStatSnapshot } from "./workerStats.js";

export type WorkerStatsTotals = {
  requestCount: number;
  chatCount: number;
  modelsCount: number;
  modelUsage: Record<string, number>;
  modelAttemptUsage: Record<string, number>;
  modelTokenUsage: Record<string, ModelTokenUsage>;
  distinctModelCount: number;
  generationAttemptCount: number;
  generationSuccessCount: number;
  generationErrorCount: number;
  generationRequestCount: number;
  generationCompletedSuccessCount: number;
  generationCompletedErrorCount: number;
  usageReportedCount: number;
  usageMissingCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cacheMissTokens: number;
  cacheRate: number | null;
};

function mergeModelUsage(target: Record<string, number>, source: Record<string, number>): void {
  for (const [model, count] of Object.entries(source)) {
    const current = Object.hasOwn(target, model) ? target[model] : 0;
    Object.defineProperty(target, model, {
      value: current + count,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
}

function mergeModelTokens(target: Record<string, ModelTokenUsage>, source: Record<string, ModelTokenUsage>): void {
  for (const [model, sourceUsage] of Object.entries(source)) {
    let targetUsage = Object.hasOwn(target, model) ? target[model] : undefined;
    if (!targetUsage) {
      targetUsage = {
        requestCount: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cacheMissTokens: 0,
      };
      Object.defineProperty(target, model, {
        value: targetUsage,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    targetUsage.requestCount += sourceUsage.requestCount;
    targetUsage.promptTokens += sourceUsage.promptTokens;
    targetUsage.completionTokens += sourceUsage.completionTokens;
    targetUsage.totalTokens += sourceUsage.totalTokens;
    targetUsage.cacheReadTokens += sourceUsage.cacheReadTokens;
    targetUsage.cacheWriteTokens += sourceUsage.cacheWriteTokens;
    targetUsage.cacheMissTokens += sourceUsage.cacheMissTokens;
  }
}

function cacheRate(read: number, prompt: number): number | null {
  return prompt > 0 ? Math.min(1, read / prompt) : null;
}

export function totalWorkerStats(list: WorkerStatSnapshot[]): WorkerStatsTotals {
  const totals = {
    requestCount: 0,
    chatCount: 0,
    modelsCount: 0,
    modelUsage: {} as Record<string, number>,
    modelAttemptUsage: {} as Record<string, number>,
    modelTokenUsage: {} as Record<string, ModelTokenUsage>,
    generationAttemptCount: 0,
    generationSuccessCount: 0,
    generationErrorCount: 0,
    generationRequestCount: 0,
    generationCompletedSuccessCount: 0,
    generationCompletedErrorCount: 0,
    usageReportedCount: 0,
    usageMissingCount: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cacheMissTokens: 0,
  };
  for (const stat of list) {
    totals.requestCount += stat.requestCount;
    totals.chatCount += stat.chatCount;
    totals.modelsCount += stat.modelsCount;
    totals.generationAttemptCount += stat.generationAttemptCount;
    totals.generationSuccessCount += stat.generationSuccessCount;
    totals.generationErrorCount += stat.generationErrorCount;
    totals.generationRequestCount += stat.generationRequestCount;
    totals.generationCompletedSuccessCount += stat.generationCompletedSuccessCount;
    totals.generationCompletedErrorCount += stat.generationCompletedErrorCount;
    totals.usageReportedCount += stat.usageReportedCount;
    totals.usageMissingCount += stat.usageMissingCount;
    mergeModelUsage(totals.modelUsage, stat.modelUsage);
    mergeModelUsage(totals.modelAttemptUsage, stat.modelAttemptUsage);
    mergeModelTokens(totals.modelTokenUsage, stat.modelTokenUsage);
    totals.promptTokens += stat.promptTokens;
    totals.completionTokens += stat.completionTokens;
    totals.totalTokens += stat.totalTokens;
    totals.cacheReadTokens += stat.cacheReadTokens;
    totals.cacheWriteTokens += stat.cacheWriteTokens;
    totals.cacheMissTokens += stat.cacheMissTokens;
  }
  return {
    ...totals,
    distinctModelCount: Object.keys(totals.modelUsage).length,
    cacheRate: cacheRate(totals.cacheReadTokens, totals.promptTokens),
  };
}
