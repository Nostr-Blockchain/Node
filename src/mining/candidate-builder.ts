import { BLOCK_KIND, NIP13_GATE_BITS } from '../consensus/constants';
import { buildBlockTags } from '../consensus/block-codec';
import { GenesisParams } from '../consensus/genesis';
import { computeEventId, NostrEvent } from '../consensus/nip01';
import { Mempool } from '../mempool/mempool';
import { selectTransactionsForBlock } from '../mempool/selection';

export interface MiningCandidate {
  parentId: string;
  txIds: string[];
  pubkey: string;
  createdAt: number;
  nonce: bigint;
  event: Omit<NostrEvent, 'id' | 'sig'>;
}

export function buildMiningCandidate(chainIdHex: string, parentIdHex: string, params: GenesisParams, mempool: Mempool, minerPubkeyHex: string, createdAt: number, nonce = 0n): MiningCandidate {
  const selectedEntries = selectTransactionsForBlock(parentIdHex, mempool.values(), params);
  const txIds = selectedEntries.map((entry) => entry.txId).sort();
  const event: Omit<NostrEvent, 'id' | 'sig'> = {
    pubkey: minerPubkeyHex,
    created_at: createdAt,
    kind: BLOCK_KIND,
    tags: buildBlockTags(chainIdHex, parentIdHex, txIds, nonce),
    content: '00'
  };
  return { parentId: parentIdHex, txIds, pubkey: minerPubkeyHex, createdAt, nonce, event };
}

export function updateCandidateNonce(candidate: MiningCandidate, nonce: bigint): MiningCandidate {
  const txIds = [...candidate.txIds];
  return {
    ...candidate,
    nonce,
    event: {
      ...candidate.event,
      tags: buildBlockTags(candidate.event.tags[0]![1]!.slice('nostr-blockchain:'.length), candidate.parentId, txIds, nonce)
    }
  };
}
