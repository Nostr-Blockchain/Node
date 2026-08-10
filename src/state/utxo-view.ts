import { UtxoRecord } from '../consensus/primitives';

export interface UtxoView {
  getUtxo(sourceId: Uint8Array, outputIndex: number): UtxoRecord | null;
  listUtxosByOwner(owner: Uint8Array): UtxoRecord[];
}

export class MemoryUtxoView implements UtxoView {
  private readonly utxos = new Map<string, UtxoRecord>();

  public constructor(initialUtxos: readonly UtxoRecord[] = []) {
    for (const utxo of initialUtxos) {
      this.setUtxo(utxo);
    }
  }

  public getUtxo(sourceId: Uint8Array, outputIndex: number): UtxoRecord | null {
    return this.utxos.get(key(sourceId, outputIndex)) ?? null;
  }

  public listUtxosByOwner(owner: Uint8Array): UtxoRecord[] {
    return [...this.utxos.values()].filter((utxo) => Buffer.compare(utxo.owner, Buffer.from(owner)) === 0);
  }

  public setUtxo(utxo: UtxoRecord): void {
    this.utxos.set(key(utxo.sourceId, utxo.outputIndex), utxo);
  }

  public deleteUtxo(sourceId: Uint8Array, outputIndex: number): void {
    this.utxos.delete(key(sourceId, outputIndex));
  }

  public snapshot(): UtxoRecord[] {
    return [...this.utxos.values()].map((utxo) => ({ ...utxo }));
  }
}

function key(sourceId: Uint8Array, outputIndex: number): string {
  return `${Buffer.from(sourceId).toString('hex')}:${outputIndex}`;
}
