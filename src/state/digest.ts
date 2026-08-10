import { createHash } from 'node:crypto';

import { UtxoRecord, compareBytes, encodeU16, encodeU64, encodeU128 } from '../consensus/primitives';

export function computeUtxoDigest(utxos: readonly UtxoRecord[]): string {
  const sorted = [...utxos].sort((left, right) => {
    const idCompare = compareBytes(left.sourceId, right.sourceId);
    if (idCompare !== 0) {
      return idCompare;
    }
    return left.outputIndex - right.outputIndex;
  });

  const hash = createHash('sha256');
  for (const utxo of sorted) {
    hash.update(Buffer.from(utxo.sourceId));
    hash.update(encodeU16(utxo.outputIndex));
    hash.update(Buffer.from(utxo.owner));
    hash.update(encodeU128(utxo.amount));
    hash.update(encodeU64(utxo.createdHeight));
    hash.update(Buffer.from([utxo.isReward ? 1 : 0]));
  }
  return hash.digest('hex');
}
