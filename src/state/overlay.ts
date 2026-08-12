import { UtxoRecord } from '../consensus/primitives';
import { UtxoView } from './utxo-view';

export class StateOverlay implements UtxoView {
  private readonly created = new Map<string, UtxoRecord>();
  private readonly deleted = new Set<string>();
  private readonly baseView: UtxoView;

  public constructor(baseView: UtxoView) {
    this.baseView = baseView;
  }

  public getUtxo(sourceId: Uint8Array, outputIndex: number): UtxoRecord | null {
    const compositeKey = key(sourceId, outputIndex);
    if (this.deleted.has(compositeKey)) {
      return null;
    }
    return this.created.get(compositeKey) ?? this.baseView.getUtxo(sourceId, outputIndex);
  }

  public listUtxosByOwner(owner: Uint8Array): UtxoRecord[] {
    const merged = new Map<string, UtxoRecord>();
    for (const utxo of this.baseView.listUtxosByOwner(owner)) {
      merged.set(key(utxo.sourceId, utxo.outputIndex), utxo);
    }
    for (const [compositeKey, utxo] of this.created.entries()) {
      if (Buffer.compare(utxo.owner, Buffer.from(owner)) === 0) {
        merged.set(compositeKey, utxo);
      }
    }
    for (const compositeKey of this.deleted) {
      merged.delete(compositeKey);
    }
    return [...merged.values()];
  }

  public listAllUtxos(): UtxoRecord[] {
    const merged = new Map<string, UtxoRecord>();
    for (const utxo of this.baseView.listAllUtxos()) {
      merged.set(key(utxo.sourceId, utxo.outputIndex), utxo);
    }
    for (const [compositeKey, utxo] of this.created.entries()) {
      merged.set(compositeKey, utxo);
    }
    for (const compositeKey of this.deleted) {
      merged.delete(compositeKey);
    }
    return [...merged.values()];
  }

  public consumeUtxo(sourceId: Uint8Array, outputIndex: number): void {
    const compositeKey = key(sourceId, outputIndex);
    this.created.delete(compositeKey);
    this.deleted.add(compositeKey);
  }

  public createUtxo(utxo: UtxoRecord): void {
    const compositeKey = key(utxo.sourceId, utxo.outputIndex);
    this.deleted.delete(compositeKey);
    this.created.set(compositeKey, utxo);
  }
}

function key(sourceId: Uint8Array, outputIndex: number): string {
  return `${Buffer.from(sourceId).toString('hex')}:${outputIndex}`;
}
