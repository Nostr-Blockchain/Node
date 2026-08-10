import { ParsedTransaction } from '../consensus/transaction-codec';
import { TxEvaluation } from '../consensus/transaction-validation';

export interface MempoolEntry {
  txId: string;
  transaction: ParsedTransaction;
  evaluation: TxEvaluation;
  receivedSeq: bigint;
}

export class Mempool {
  private readonly entries = new Map<string, MempoolEntry>();

  public add(entry: MempoolEntry): void {
    this.entries.set(entry.txId, entry);
  }

  public remove(txId: string): void {
    this.entries.delete(txId);
  }

  public get(txId: string): MempoolEntry | null {
    return this.entries.get(txId) ?? null;
  }

  public values(): MempoolEntry[] {
    return [...this.entries.values()];
  }

  public size(): number {
    return this.entries.size;
  }

  public replace(entries: readonly MempoolEntry[]): void {
    this.entries.clear();
    for (const entry of entries) {
      this.entries.set(entry.txId, entry);
    }
  }

  public clear(): void {
    this.entries.clear();
  }
}
