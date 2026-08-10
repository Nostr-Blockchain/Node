export interface MissingObjectRequest {
  objectId: string;
  objectType: 'block' | 'tx';
  firstSeenSeq: bigint;
  attempts: number;
  nextRetryMs: number | null;
}

export class MissingObjectQueue {
  private readonly entries = new Map<string, MissingObjectRequest>();

  public add(request: MissingObjectRequest): void {
    this.entries.set(request.objectId, request);
  }

  public remove(objectId: string): void {
    this.entries.delete(objectId);
  }

  public listDue(nowMs: number): MissingObjectRequest[] {
    return [...this.entries.values()].filter((entry) => entry.nextRetryMs === null || entry.nextRetryMs <= nowMs);
  }
}
