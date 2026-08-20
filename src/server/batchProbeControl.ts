export class BatchProbeControl {
  private paused = false;
  private cancelled = false;
  private waiters = new Set<(proceed: boolean) => void>();
  private abortController = new AbortController();

  reset(): void {
    this.paused = false;
    this.cancelled = false;
    this.releaseWaiters(true);
    this.abortController = new AbortController();
  }

  pause(): void {
    if (!this.cancelled) this.paused = true;
  }

  resume(): void {
    if (this.cancelled) return;
    this.paused = false;
    this.releaseWaiters(true);
  }

  cancel(): void {
    this.cancelled = true;
    this.paused = false;
    this.releaseWaiters(false);
    this.abortController.abort(new Error("Batch probe cancelled"));
  }

  isCancelled(): boolean {
    return this.cancelled;
  }

  signal(): AbortSignal {
    return this.abortController.signal;
  }

  async checkpoint(): Promise<boolean> {
    if (this.cancelled) return false;
    if (!this.paused) return true;
    return new Promise<boolean>((resolve) => this.waiters.add(resolve));
  }

  private releaseWaiters(proceed: boolean): void {
    for (const resolve of this.waiters) resolve(proceed);
    this.waiters.clear();
  }
}
