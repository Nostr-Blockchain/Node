import { createHash } from 'node:crypto';

import { MAX_U128, MAX_U64 } from './constants';
import { ConsensusError } from './errors';

export interface Outpoint {
  sourceId: Buffer;
  outputIndex: number;
}

export interface UtxoRecord {
  sourceId: Buffer;
  outputIndex: number;
  owner: Buffer;
  amount: bigint;
  createdHeight: bigint;
  isReward: boolean;
}

export function sha256(data: Uint8Array): Buffer {
  return createHash('sha256').update(data).digest();
}

export function utf8Bytes(text: string): Buffer {
  return Buffer.from(text, 'utf8');
}

export function hexToBytes(hex: string, expectedLength?: number): Buffer {
  if (!/^[0-9a-f]*$/.test(hex) || hex.length % 2 !== 0) {
    throw new ConsensusError('BAD_HEX', 'hex must be lowercase and even-length');
  }

  const bytes = Buffer.from(hex, 'hex');
  if (expectedLength !== undefined && bytes.length !== expectedLength) {
    throw new ConsensusError('BAD_HEX', `expected ${expectedLength} bytes`);
  }

  return bytes;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

export function encodeU16(value: number): Buffer {
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16BE(value, 0);
  return bytes;
}

export function encodeU32(value: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value, 0);
  return bytes;
}

export function encodeU64(value: bigint): Buffer {
  if (value < 0n || value > MAX_U64) {
    throw new ConsensusError('BAD_U64');
  }

  const bytes = Buffer.alloc(8);
  let remaining = value;
  for (let index = 7; index >= 0; index -= 1) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}

export function encodeU128(value: bigint): Buffer {
  if (value < 0n || value > MAX_U128) {
    throw new ConsensusError('BAD_U128');
  }

  const bytes = Buffer.alloc(16);
  let remaining = value;
  for (let index = 15; index >= 0; index -= 1) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}

export function encodeU136(value: bigint): Buffer {
  if (value < 0n || value >= (1n << 136n)) {
    throw new ConsensusError('BAD_U136');
  }

  const bytes = Buffer.alloc(17);
  let remaining = value;
  for (let index = 16; index >= 0; index -= 1) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}

export function decodeU16(bytes: Uint8Array, offset: number): number {
  return Buffer.from(bytes).readUInt16BE(offset);
}

export function decodeU32(bytes: Uint8Array, offset: number): number {
  return Buffer.from(bytes).readUInt32BE(offset);
}

export function decodeU32LE(bytes: Uint8Array, offset: number): number {
  return Buffer.from(bytes).readUInt32LE(offset);
}

export function decodeU64(bytes: Uint8Array, offset: number): bigint {
  let value = 0n;
  for (let index = offset; index < offset + 8; index += 1) {
    value = (value << 8n) | BigInt(bytes[index] ?? 0);
  }
  return value;
}

export function decodeU128(bytes: Uint8Array, offset: number): bigint {
  let value = 0n;
  for (let index = offset; index < offset + 16; index += 1) {
    value = (value << 8n) | BigInt(bytes[index] ?? 0);
  }
  return value;
}

export function decodeU136(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  return value;
}

export function compareBytes(left: Uint8Array, right: Uint8Array): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

export function leadingZeroBits(bytes: Uint8Array): number {
  let count = 0;
  for (const byte of bytes) {
    if (byte === 0) {
      count += 8;
      continue;
    }

    for (let bit = 7; bit >= 0; bit -= 1) {
      if ((byte & (1 << bit)) === 0) {
        count += 1;
      } else {
        return count;
      }
    }
  }
  return count;
}

export function parseCanonicalDecimalU64(text: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(text)) {
    throw new ConsensusError('BAD_DECIMAL');
  }

  const value = BigInt(text);
  if (value > MAX_U64) {
    throw new ConsensusError('BAD_DECIMAL');
  }
  return value;
}

export function outpointKey(sourceId: Uint8Array, outputIndex: number): string {
  return `${bytesToHex(sourceId)}:${outputIndex}`;
}

export function sortOutpointsCanonical<T extends Outpoint>(outpoints: readonly T[]): T[] {
  return [...outpoints].sort((left, right) => {
    const idCompare = compareBytes(left.sourceId, right.sourceId);
    if (idCompare !== 0) {
      return idCompare;
    }
    return left.outputIndex - right.outputIndex;
  });
}
