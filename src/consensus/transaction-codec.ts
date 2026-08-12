import { TX_KIND, makeChainScope, PROTOCOL_VERSION } from './constants';
import { ConsensusError, assertConsensus } from './errors';
import { NostrEvent } from './nip01';
import { compareBytes, decodeU16, decodeU128, encodeU16, encodeU128, hexToBytes, sortOutpointsCanonical } from './primitives';

export interface TxInput {
  sourceId: Buffer;
  outputIndex: number;
}

export interface TxOutput {
  ownerPubkey: Buffer;
  amount: bigint;
}

export interface TransactionData {
  version: number;
  inputs: TxInput[];
  outputs: TxOutput[];
}

export interface ParsedTransaction {
  event: NostrEvent;
  data: TransactionData;
}

export function encodeTransactionContent(data: TransactionData): string {
  const parts: Buffer[] = [Buffer.from([data.version]), encodeU16(data.inputs.length)];
  for (const input of data.inputs) {
    parts.push(Buffer.from(input.sourceId));
    parts.push(encodeU16(input.outputIndex));
  }
  parts.push(encodeU16(data.outputs.length));
  for (const output of data.outputs) {
    parts.push(Buffer.from(output.ownerPubkey));
    parts.push(encodeU128(output.amount));
  }
  return Buffer.concat(parts).toString('hex');
}

export function decodeTransactionContent(contentHex: string): TransactionData {
  const bytes = decodeTransactionContentHex(contentHex);
  assertConsensus(bytes.length >= 5, 'TX_BAD_LENGTH');
  const version = bytes[0] ?? 0;
  const inputCount = decodeU16(bytes, 1);
  let offset = 3;
  const inputs: TxInput[] = [];
  for (let index = 0; index < inputCount; index += 1) {
    assertConsensus(offset + 34 <= bytes.length, 'TX_BAD_LENGTH');
    inputs.push({
      sourceId: bytes.subarray(offset, offset + 32),
      outputIndex: decodeU16(bytes, offset + 32)
    });
    offset += 34;
  }
  assertConsensus(offset + 2 <= bytes.length, 'TX_BAD_LENGTH');
  const outputCount = decodeU16(bytes, offset);
  const expectedLength = 5 + (34 * inputCount) + (48 * outputCount);
  assertConsensus(bytes.length === expectedLength, 'TX_BAD_LENGTH');
  offset += 2;
  const outputs: TxOutput[] = [];
  for (let index = 0; index < outputCount; index += 1) {
    assertConsensus(offset + 48 <= bytes.length, 'TX_BAD_LENGTH');
    outputs.push({
      ownerPubkey: bytes.subarray(offset, offset + 32),
      amount: decodeU128(bytes, offset + 32)
    });
    offset += 48;
  }
  assertConsensus(offset === bytes.length, 'TX_BAD_LENGTH');
  return { version, inputs, outputs };
}

export function deriveTransactionTags(chainIdHex: string, data: TransactionData): string[][] {
  return [
    ['t', makeChainScope(chainIdHex)],
    ['v', PROTOCOL_VERSION.toString(10)],
    ...data.inputs.map((input) => ['i', Buffer.from(input.sourceId).toString('hex'), canonicalDecimal(input.outputIndex)]),
    ...data.outputs.map((output) => ['p', Buffer.from(output.ownerPubkey).toString('hex')])
  ];
}

export function canonicalizeTransactionData(data: TransactionData): TransactionData {
  return {
    version: data.version,
    inputs: sortOutpointsCanonical(data.inputs).map((input) => ({
      sourceId: Buffer.from(input.sourceId),
      outputIndex: input.outputIndex
    })),
    outputs: data.outputs.map((output) => ({
      ownerPubkey: Buffer.from(output.ownerPubkey),
      amount: output.amount
    }))
  };
}

export function parseTransactionEvent(event: NostrEvent, chainIdHex: string): ParsedTransaction {
  assertConsensus(event.kind === TX_KIND, 'TX_BAD_KIND');
  const data = decodeTransactionContent(event.content);
  assertConsensus(data.version === PROTOCOL_VERSION, 'TX_BAD_VERSION');
  assertTransactionTags(event.tags, chainIdHex, data);
  return {
    event,
    data
  };
}

function decodeTransactionContentHex(contentHex: string): Buffer {
  try {
    return hexToBytes(contentHex);
  } catch (error) {
    if (error instanceof ConsensusError && error.code === 'BAD_HEX') {
      throw new ConsensusError('TX_BAD_CONTENT_HEX');
    }
    throw error;
  }
}

function assertTransactionTags(tags: string[][], chainIdHex: string, data: TransactionData): void {
  const expectedLength = 2 + data.inputs.length + data.outputs.length;
  assertConsensus(tags.length === expectedLength, 'TX_BAD_TAGS');

  const scopeTag = tags[0] ?? [];
  assertConsensus(scopeTag.length === 2 && scopeTag[0] === 't' && scopeTag[1] === makeChainScope(chainIdHex), 'TX_BAD_SCOPE');

  const versionTag = tags[1] ?? [];
  assertConsensus(versionTag.length === 2 && versionTag[0] === 'v' && versionTag[1] === PROTOCOL_VERSION.toString(10), 'TX_BAD_TAGS');

  for (let index = 0; index < data.inputs.length; index += 1) {
    const tag = tags[index + 2] ?? [];
    const input = data.inputs[index]!;
    assertConsensus(
      tag.length === 3
        && tag[0] === 'i'
        && tag[1] === Buffer.from(input.sourceId).toString('hex')
        && tag[2] === canonicalDecimal(input.outputIndex),
      'TX_BAD_TAGS'
    );
  }

  for (let index = 0; index < data.outputs.length; index += 1) {
    const tag = tags[data.inputs.length + index + 2] ?? [];
    const output = data.outputs[index]!;
    assertConsensus(
      tag.length === 2
        && tag[0] === 'p'
        && tag[1] === Buffer.from(output.ownerPubkey).toString('hex'),
      'TX_BAD_TAGS'
    );
  }
}

function canonicalDecimal(value: number): string {
  return value.toString(10);
}
