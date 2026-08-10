import { makeChainScope, PROTOCOL_VERSION } from './constants';
import { ConsensusError, assertConsensus } from './errors';
import { NostrEvent } from './nip01';
import { bytesToHex, compareBytes, decodeU16, decodeU128, encodeU128, hexToBytes } from './primitives';

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
  uniqueInputSourceIds: Buffer[];
  uniqueOutputOwners: Buffer[];
}

export function encodeTransactionContent(data: TransactionData): string {
  const parts: Buffer[] = [Buffer.from([data.version]), Buffer.alloc(2)];
  parts[1].writeUInt16BE(data.inputs.length, 0);
  for (const input of data.inputs) {
    parts.push(Buffer.from(input.sourceId));
    const indexBytes = Buffer.alloc(2);
    indexBytes.writeUInt16BE(input.outputIndex, 0);
    parts.push(indexBytes);
  }
  const outputCount = Buffer.alloc(2);
  outputCount.writeUInt16BE(data.outputs.length, 0);
  parts.push(outputCount);
  for (const output of data.outputs) {
    parts.push(Buffer.from(output.ownerPubkey));
    parts.push(encodeU128(output.amount));
  }
  return Buffer.concat(parts).toString('hex');
}

export function decodeTransactionContent(contentHex: string): TransactionData {
  const bytes = hexToBytes(contentHex);
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
  const sourceIds = uniqueSortedHex(data.inputs.map((input) => input.sourceId));
  const owners = uniqueSortedHex(data.outputs.map((output) => output.ownerPubkey));
  return [
    ['t', makeChainScope(chainIdHex)],
    ...sourceIds.map((hex) => ['e', hex]),
    ...owners.map((hex) => ['p', hex])
  ];
}

export function parseTransactionEvent(event: NostrEvent, chainIdHex: string): ParsedTransaction {
  const data = decodeTransactionContent(event.content);
  assertConsensus(data.version === PROTOCOL_VERSION, 'TX_BAD_VERSION');
  const expectedTags = deriveTransactionTags(chainIdHex, data);
  assertConsensus(JSON.stringify(event.tags) === JSON.stringify(expectedTags), 'TX_BAD_TAGS');
  return {
    event,
    data,
    uniqueInputSourceIds: uniqueSortedBuffers(data.inputs.map((input) => input.sourceId)),
    uniqueOutputOwners: uniqueSortedBuffers(data.outputs.map((output) => output.ownerPubkey))
  };
}

function uniqueSortedHex(values: readonly Buffer[]): string[] {
  return uniqueSortedBuffers(values).map((value) => bytesToHex(value));
}

function uniqueSortedBuffers(values: readonly Buffer[]): Buffer[] {
  const sorted = [...values].sort(compareBytes);
  const unique: Buffer[] = [];
  for (const value of sorted) {
    if (unique.length === 0 || compareBytes(unique[unique.length - 1], value) !== 0) {
      unique.push(value);
    }
  }
  return unique;
}
