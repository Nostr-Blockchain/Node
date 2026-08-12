import { createHash } from 'node:crypto';

import { ChainStateSnapshot } from '../chain/chain-executor';
import { encodeU128, encodeU64, hexToBytes } from '../consensus/primitives';

export function computeStateHash(
  chainIdHex: string,
  snapshot: ChainStateSnapshot,
  activeDifficulty: number
): string {
  const tipId = snapshot.activeTip === null ? Buffer.alloc(32, 0) : hexToBytes(snapshot.activeTip, 32);
  const payload = Buffer.concat([
    Buffer.from('NostrBlockchain-v0/state', 'ascii'),
    hexToBytes(chainIdHex, 32),
    encodeU64(snapshot.activeHeight),
    tipId,
    Buffer.from([activeDifficulty]),
    encodeU128(snapshot.activeCumulativeWork),
    encodeU128(snapshot.totalSupply),
    Buffer.from(snapshot.utxoDigest, 'hex')
  ]);
  return createHash('sha256').update(payload).digest('hex');
}
