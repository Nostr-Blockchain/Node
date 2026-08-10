import { chacha20 } from '@noble/ciphers/chacha';

import { CACHEWALK_R1_BYTES, CACHEWALK_R1_LINE_BYTES, CACHEWALK_R1_LINES, CACHEWALK_R1_PASSES, NIP13_GATE_BITS } from './constants';
import { decodeU32LE, leadingZeroBits, sha256, utf8Bytes } from './primitives';

export interface PowInput {
  chainId: Uint8Array;
  parentId: Uint8Array;
  eventId: Uint8Array;
  powDifficulty: number;
  nonceGateBits: number;
}

export function verifyBlockPow(input: PowInput): boolean {
  if (input.nonceGateBits !== NIP13_GATE_BITS) {
    return false;
  }
  if (leadingZeroBits(input.eventId) < NIP13_GATE_BITS) {
    return false;
  }
  const workHash = cacheWalkR1(input.chainId, input.parentId, input.eventId);
  return leadingZeroBits(workHash) >= input.powDifficulty;
}

export function cacheWalkR1(chainId: Uint8Array, parentId: Uint8Array, eventId: Uint8Array): Buffer {
  const seed = sha256(Buffer.concat([utf8Bytes('NostrCacheWalk-R1/seed'), Buffer.from(chainId), Buffer.from(parentId), Buffer.from(eventId)]));
  const scratch = chacha20(seed, Buffer.alloc(12, 0), Buffer.alloc(CACHEWALK_R1_BYTES, 0), undefined, 0);
  const lines: Buffer[] = [];
  for (let offset = 0; offset < scratch.length; offset += CACHEWALK_R1_LINE_BYTES) {
    lines.push(Buffer.from(scratch.subarray(offset, offset + CACHEWALK_R1_LINE_BYTES)));
  }

  let state = sha256(Buffer.concat([utf8Bytes('NostrCacheWalk-R1/state'), seed, Buffer.from(parentId), Buffer.from(eventId)]));
  for (let pass = 0; pass < CACHEWALK_R1_PASSES; pass += 1) {
    for (let index = 0; index < CACHEWALK_R1_LINES; index += 1) {
      const lineIndex = decodeU32LE(state, 0) & 4095;
      const lineA = Buffer.from(lines[index]!);
      const lineB = Buffer.from(lines[lineIndex]!);
      const passBytes = Buffer.alloc(4);
      passBytes.writeUInt32LE(pass, 0);
      const indexBytes = Buffer.alloc(4);
      indexBytes.writeUInt32LE(index, 0);
      const m0 = sha256(Buffer.concat([utf8Bytes('NostrCacheWalk-R1/round/0'), state, lineA, lineB, passBytes, indexBytes]));
      const m1 = sha256(Buffer.concat([utf8Bytes('NostrCacheWalk-R1/round/1'), m0, state, lineB, lineA, passBytes, indexBytes]));
      xorInto(lines[index]!, 0, m0);
      xorInto(lines[index]!, 32, m1);
      state = m0;
    }
  }

  const finalIndex = decodeU32LE(state, 4) & 4095;
  return sha256(Buffer.concat([
    utf8Bytes('NostrCacheWalk-R1/final'),
    state,
    lines[finalIndex]!,
    seed,
    Buffer.from(parentId),
    Buffer.from(eventId)
  ]));
}

function xorInto(target: Buffer, offset: number, mask: Uint8Array): void {
  for (let index = 0; index < 32; index += 1) {
    target[offset + index] = target[offset + index]! ^ mask[index]!;
  }
}
