import { createHash } from 'node:crypto';

import { MAX_U128 } from '../consensus/constants';
import { GenesisParams } from '../consensus/genesis';
import { outpointKey } from '../consensus/primitives';
import { MempoolEntry } from './mempool';

export function selectTransactionsForBlock(parentBlockIdHex: string, entries: readonly MempoolEntry[], params: GenesisParams): MempoolEntry[] {
  const sorted = [...entries].sort((left, right) => {
    if (left.evaluation.priorityFee !== right.evaluation.priorityFee) {
      return left.evaluation.priorityFee > right.evaluation.priorityFee ? -1 : 1;
    }
    const leftKey = tieBreaker(parentBlockIdHex, left.txId);
    const rightKey = tieBreaker(parentBlockIdHex, right.txId);
    return Buffer.compare(leftKey, rightKey);
  });

  const selected: MempoolEntry[] = [];
  const spent = new Set<string>();
  let priorityFees = 0n;
  for (const entry of sorted) {
    if (selected.length >= params.maxBlockTransactions) {
      break;
    }
    const conflicts = entry.evaluation.consumedOutpoints.some((utxo) => spent.has(outpointKey(utxo.sourceId, utxo.outputIndex)));
    if (conflicts) {
      continue;
    }
    if (params.blockReward + priorityFees + entry.evaluation.priorityFee > MAX_U128) {
      continue;
    }
    selected.push(entry);
    priorityFees += entry.evaluation.priorityFee;
    for (const utxo of entry.evaluation.consumedOutpoints) {
      spent.add(outpointKey(utxo.sourceId, utxo.outputIndex));
    }
  }
  return selected;
}

function tieBreaker(parentBlockIdHex: string, txIdHex: string): Buffer {
  return createHash('sha256').update(Buffer.from(parentBlockIdHex + txIdHex, 'hex')).digest();
}
