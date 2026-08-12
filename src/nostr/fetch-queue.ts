export interface MissingObjectRequest {
  objectId: string;
  objectType: 'block' | 'tx';
  firstSeenSeq: bigint;
  attempts: number;
  nextRetryMs: number | null;
  sourceRelayUrl: string | null;
}

export class MissingObjectQueue {
  private readonly entries = new Map<string, MissingObjectRequest>();
  private readonly maxEntries: number;

  public constructor(maxEntries = 2048) {
    this.maxEntries = maxEntries;
  }

  public add(request: MissingObjectRequest): void {
    const existing = this.entries.get(request.objectId);
    if (existing !== undefined) {
      this.entries.set(request.objectId, {
        ...existing,
        sourceRelayUrl: existing.sourceRelayUrl ?? request.sourceRelayUrl
      });
      return;
    }
    this.entries.set(request.objectId, request);
    this.enforceBounds();
  }

  public remove(objectId: string): void {
    this.entries.delete(objectId);
  }

  public has(objectId: string): boolean {
    return this.entries.has(objectId);
  }

  public markAttempt(objectId: string, nowMs: number): MissingObjectRequest | null {
    const existing = this.entries.get(objectId);
    if (existing === undefined) {
      return null;
    }
    const attempts = existing.attempts + 1;
    const boundedDelayMs = Math.min(60_000, 1_000 * (2 ** Math.min(attempts, 6)));
    const updated: MissingObjectRequest = {
      ...existing,
      attempts,
      nextRetryMs: nowMs + boundedDelayMs
    };
    this.entries.set(objectId, updated);
    return updated;
  }

  public listDue(nowMs: number): MissingObjectRequest[] {
    return [...this.entries.values()].filter((entry) => entry.nextRetryMs === null || entry.nextRetryMs <= nowMs);
  }

  public size(): number {
    return this.entries.size;
  }

  private enforceBounds(): void {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (typeof oldest !== 'string') {
        break;
      }
      this.entries.delete(oldest);
    }
  }
}
