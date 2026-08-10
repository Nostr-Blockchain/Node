import { BLOCK_KIND, GENESIS_SCOPE, NIP13_GATE_BITS, PROTOCOL_VERSION, makeChainScope } from './constants';
import { ConsensusError, assertConsensus } from './errors';
import { NostrEvent } from './nip01';
import { bytesToHex, compareBytes, hexToBytes, parseCanonicalDecimalU64 } from './primitives';

export interface ParsedBlock {
  event: NostrEvent;
  parentId: Buffer | null;
  txIds: Buffer[];
  nonce: bigint;
  isGenesis: boolean;
}

export function buildBlockTags(chainIdHex: string, parentIdHex: string, txIdsHex: readonly string[], nonce: bigint): string[][] {
  const sortedTxIds = [...txIdsHex].sort();
  return [
    ['t', makeChainScope(chainIdHex)],
    ['e', parentIdHex],
    ...sortedTxIds.map((txId) => ['e', txId]),
    ['nonce', nonce.toString(10), NIP13_GATE_BITS.toString(10)]
  ];
}

export function parseBlockEvent(event: NostrEvent, chainIdHex?: string): ParsedBlock {
  assertConsensus(event.kind === BLOCK_KIND, 'BLK_BAD_KIND');
  if (event.tags.length === 2 && event.tags[0]?.[0] === 't' && event.tags[0]?.[1] === GENESIS_SCOPE) {
    assertConsensus(event.content.length === 147 * 2, 'BLK_BAD_CONTENT');
    const nonceTag = event.tags[1] ?? [];
    assertConsensus(nonceTag.length === 3 && nonceTag[0] === 'nonce' && nonceTag[2] === NIP13_GATE_BITS.toString(10), 'BLK_BAD_NONCE');
    return {
      event,
      parentId: null,
      txIds: [],
      nonce: parseCanonicalDecimalU64(nonceTag[1] ?? ''),
      isGenesis: true
    };
  }

  assertConsensus(event.content === '00', 'BLK_BAD_CONTENT');
  assertConsensus(chainIdHex !== undefined, 'BLK_BAD_SCOPE');
  assertConsensus(event.tags.length >= 3, 'BLK_BAD_TAGS');
  const scopeTag = event.tags[0] ?? [];
  assertConsensus(scopeTag.length === 2 && scopeTag[0] === 't' && scopeTag[1] === makeChainScope(chainIdHex), 'BLK_BAD_SCOPE');
  const nonceTag = event.tags[event.tags.length - 1] ?? [];
  assertConsensus(nonceTag.length === 3 && nonceTag[0] === 'nonce' && nonceTag[2] === NIP13_GATE_BITS.toString(10), 'BLK_BAD_DIFFICULTY');
  const eTags = event.tags.slice(1, -1);
  assertConsensus(eTags.length >= 1, 'BLK_BAD_PARENT');
  assertConsensus(eTags.every((tag) => tag.length === 2 && tag[0] === 'e'), 'BLK_BAD_TAGS');
  const parentId = hexToBytes(eTags[0]![1]!, 32);
  const txIds = eTags.slice(1).map((tag) => hexToBytes(tag[1]!, 32));
  for (let index = 1; index < txIds.length; index += 1) {
    assertConsensus(compareBytes(txIds[index - 1]!, txIds[index]!) < 0, 'BLK_BAD_TAGS');
  }
  return {
    event,
    parentId,
    txIds,
    nonce: parseCanonicalDecimalU64(nonceTag[1] ?? ''),
    isGenesis: false
  };
}
