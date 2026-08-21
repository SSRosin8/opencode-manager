import type { WorkerStatSnapshot } from "./workerStats.js";

export function emptyWorkerStat(accountId: string): WorkerStatSnapshot {
  return {
    accountId,
    requestCount: 0,
    chatCount: 0,
    modelsCount: 0,
    modelUsage: {},
    modelAttemptUsage: {},
    modelTokenUsage: {},
    distinctModelCount: 0,
    successCount: 0,
    errorCount: 0,
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
    cacheRate: null,
    lastRequestAt: null,
    lastStatus: null,
  };
}
