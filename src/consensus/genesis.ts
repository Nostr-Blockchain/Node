import { BLOCK_KIND, GENESIS_SCOPE, MAX_BLOCK_TRANSACTIONS_ABSOLUTE, MAX_TX_INPUTS_ABSOLUTE, MAX_TX_OUTPUTS_ABSOLUTE, NIP13_GATE_BITS, PROTOCOL_VERSION } from './constants';
import { ConsensusError, assertConsensus } from './errors';
import { NostrEvent, computeEventId } from './nip01';
import { decodeU16, decodeU32, decodeU128, encodeU128, encodeU32, hexToBytes, parseCanonicalDecimalU64 } from './primitives';
import { verifyBlockPow } from './pow';
import { CryptoProvider } from '../crypto/provider';

export interface GenesisParams {
  protocolVersion: number;
  blockReward: bigint;
  rewardMaturity: number;
  powDifficulty: number;
  baseFee: bigint;
  inputFee: bigint;
  outputFee: bigint;
  maxTxInputs: number;
  maxTxOutputs: number;
  maxBlockTransactions: number;
}

export const CONFORMANCE_GENESIS_PARAMS: GenesisParams = {
  protocolVersion: 0,
  blockReward: 5_000_000_000n,
  rewardMaturity: 240,
  powDifficulty: 1,
  baseFee: 1_000n,
  inputFee: 250n,
  outputFee: 500n,
  maxTxInputs: 32,
  maxTxOutputs: 32,
  maxBlockTransactions: 64
};

export function encodeGenesisContent(params: GenesisParams): string {
  validateGenesisParams(params);
  const bytes = Buffer.concat([
    Buffer.from([params.protocolVersion]),
    encodeU128(params.blockReward),
    encodeU32(params.rewardMaturity),
    Buffer.from([params.powDifficulty]),
    encodeU128(params.baseFee),
    encodeU128(params.inputFee),
    encodeU128(params.outputFee),
    Buffer.from([(params.maxTxInputs >>> 8) & 0xff, params.maxTxInputs & 0xff]),
    Buffer.from([(params.maxTxOutputs >>> 8) & 0xff, params.maxTxOutputs & 0xff]),
    Buffer.from([(params.maxBlockTransactions >>> 8) & 0xff, params.maxBlockTransactions & 0xff])
  ]);
  return bytes.toString('hex');
}

export function decodeGenesisContent(contentHex: string): GenesisParams {
  const bytes = hexToBytes(contentHex, 76);
  const params: GenesisParams = {
    protocolVersion: bytes[0] ?? 0,
    blockReward: decodeU128(bytes, 1),
    rewardMaturity: decodeU32(bytes, 17),
    powDifficulty: bytes[21] ?? 0,
    baseFee: decodeU128(bytes, 22),
    inputFee: decodeU128(bytes, 38),
    outputFee: decodeU128(bytes, 54),
    maxTxInputs: decodeU16(bytes, 70),
    maxTxOutputs: decodeU16(bytes, 72),
    maxBlockTransactions: decodeU16(bytes, 74)
  };
  validateGenesisParams(params);
  return params;
}

export function validateGenesisParams(params: GenesisParams): void {
  assertConsensus(params.protocolVersion === PROTOCOL_VERSION, 'BLK_BAD_CONTENT');
  assertConsensus(params.blockReward > 0n, 'BLK_BAD_CONTENT');
  assertConsensus(params.rewardMaturity >= 1, 'BLK_BAD_CONTENT');
  assertConsensus(params.powDifficulty >= 1 && params.powDifficulty <= 63, 'BLK_BAD_CONTENT');
  assertConsensus(params.baseFee > 0n, 'BLK_BAD_CONTENT');
  assertConsensus(params.maxTxInputs >= 1 && params.maxTxInputs <= MAX_TX_INPUTS_ABSOLUTE, 'BLK_BAD_CONTENT');
  assertConsensus(params.maxTxOutputs >= 1 && params.maxTxOutputs <= MAX_TX_OUTPUTS_ABSOLUTE, 'BLK_BAD_CONTENT');
  assertConsensus(params.maxBlockTransactions >= 1 && params.maxBlockTransactions <= MAX_BLOCK_TRANSACTIONS_ABSOLUTE, 'BLK_BAD_CONTENT');
}

export function validateGenesisEvent(event: NostrEvent, cryptoProvider: CryptoProvider): GenesisParams {
  assertConsensus(event.kind === BLOCK_KIND, 'BLK_BAD_KIND');
  assertConsensus(event.tags.length === 2, 'BLK_BAD_TAGS');
  assertConsensus(event.tags[0]?.[0] === 't' && event.tags[0]?.[1] === GENESIS_SCOPE && event.tags[0]?.length === 2, 'BLK_BAD_SCOPE');
  assertNonceTag(event.tags[1] ?? [], 'BLK_BAD_NONCE');
  const params = decodeGenesisContent(event.content);
  const nonce = parseCanonicalDecimalU64(event.tags[1]![1]!);
  void nonce;
  const powValid = verifyBlockPow({
    chainId: hexToBytes(event.id, 32),
    parentId: Buffer.alloc(32, 0),
    eventId: hexToBytes(event.id, 32),
    requiredDifficulty: params.powDifficulty,
    nonceGateBits: Number(event.tags[1]![2])
  });
  assertConsensus(powValid, 'BLK_INSUFFICIENT_POW');
  assertConsensus(computeEventId({
    pubkey: event.pubkey,
    created_at: event.created_at,
    kind: event.kind,
    tags: event.tags,
    content: event.content
  }) === event.id, 'BLK_BAD_NIP01_ID');
  return params;
}

export interface GenesisCandidateInput {
  params: GenesisParams;
  minerPubkey: string;
  createdAt: number;
  nonce: bigint;
}

export function buildUnsignedGenesisEvent(input: GenesisCandidateInput): Omit<NostrEvent, 'id' | 'sig'> {
  return {
    pubkey: input.minerPubkey,
    created_at: input.createdAt,
    kind: BLOCK_KIND,
    tags: [
      ['t', GENESIS_SCOPE],
      ['nonce', input.nonce.toString(10), NIP13_GATE_BITS.toString(10)]
    ],
    content: encodeGenesisContent(input.params)
  };
}

function assertNonceTag(tag: string[], code: string): void {
  assertConsensus(tag.length === 3 && tag[0] === 'nonce', code);
  parseCanonicalDecimalU64(tag[1] ?? '');
  assertConsensus(tag[2] === NIP13_GATE_BITS.toString(10), 'BLK_BAD_DIFFICULTY');
}
