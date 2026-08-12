import { BLOCK_KIND, GENESIS_SCOPE, NIP13_GATE_BITS, makeChainScope } from './constants';
import { ConsensusError, assertConsensus } from './errors';
import { NostrEvent } from './nip01';
import { compareBytes, hexToBytes, parseCanonicalDecimalU64 } from './primitives';

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
    ['e', parentIdHex, '', 'parent'],
    ['nonce', nonce.toString(10), NIP13_GATE_BITS.toString(10)],
    ...sortedTxIds.map((txId) => ['e', txId, '', 'tx'])
  ];
}

export function parseBlockEvent(event: NostrEvent, chainIdHex?: string): ParsedBlock {
  assertConsensus(event.kind === BLOCK_KIND, 'BLK_BAD_KIND');
  if (event.tags.length === 2 && event.tags[0]?.[0] === 't' && event.tags[0]?.[1] === GENESIS_SCOPE) {
    assertConsensus(event.content.length === 76 * 2, 'BLK_BAD_CONTENT');
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
  const parentTag = event.tags[1] ?? [];
  assertConsensus(parentTag.length === 4 && parentTag[0] === 'e' && parentTag[2] === '' && parentTag[3] === 'parent', 'BLK_BAD_PARENT');
  const nonceTag = event.tags[2] ?? [];
  assertConsensus(nonceTag.length === 3 && nonceTag[0] === 'nonce' && nonceTag[2] === NIP13_GATE_BITS.toString(10), 'BLK_BAD_NONCE');
  const parentId = hexToBytes(parentTag[1] ?? '', 32);
  assertConsensus(compareBytes(parentId, hexToBytes(event.id, 32)) !== 0, 'BLK_SELF_PARENT');
  const txTags = event.tags.slice(3);
  assertConsensus(txTags.length <= 64, 'BLK_BAD_TAGS');
  assertConsensus(txTags.every((tag) => tag.length === 4 && tag[0] === 'e' && tag[2] === '' && tag[3] === 'tx'), 'BLK_BAD_TAGS');
  const txIds = txTags.map((tag) => hexToBytes(tag[1] ?? '', 32));
  for (let index = 1; index < txIds.length; index += 1) {
    const comparison = compareBytes(txIds[index - 1]!, txIds[index]!);
    assertConsensus(comparison !== 0, 'BLK_TX_DUPLICATE');
    assertConsensus(comparison < 0, 'BLK_BAD_TAGS');
  }
  return {
    event,
    parentId,
    txIds,
    nonce: parseCanonicalDecimalU64(nonceTag[1] ?? ''),
    isGenesis: false
  };
}
