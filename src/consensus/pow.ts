import { chacha20 } from '@noble/ciphers/chacha';

import { CACHEWALK_R1_BYTES, CACHEWALK_R1_LINE_BYTES, CACHEWALK_R1_LINES, CACHEWALK_R1_PASSES, NIP13_GATE_BITS } from './constants';
import { decodeU32LE, hasLeadingZeroBits, sha256, utf8Bytes } from './primitives';
import { CacheWalkR1Params } from '../networks/params';

export interface PowInput {
  chainId: Uint8Array;
  parentId: Uint8Array;
  eventId: Uint8Array;
  requiredDifficulty: number;
  nonceGateBits: number;
  cacheWalkR1?: CacheWalkR1Params;
}

export interface CacheWalkVectorDetails {
  seed: Buffer;
  firstScratchLine: Buffer;
  lastScratchLine: Buffer;
  initialState: Buffer;
  stateAfterPass0: Buffer;
  stateAfterPass1: Buffer;
  finalIndex: number;
  workHash: Buffer;
}

export function verifyBlockPow(input: PowInput): boolean {
  if (input.nonceGateBits !== NIP13_GATE_BITS) {
    return false;
  }
  if (!hasLeadingZeroBits(input.eventId, NIP13_GATE_BITS)) {
    return false;
  }
  const workHash = cacheWalkR1(input.chainId, input.parentId, input.eventId, input.cacheWalkR1);
  return hasLeadingZeroBits(workHash, input.requiredDifficulty);
}

export function cacheWalkR1(chainId: Uint8Array, parentId: Uint8Array, eventId: Uint8Array, params?: CacheWalkR1Params): Buffer {
  return cacheWalkR1Details(chainId, parentId, eventId, params).workHash;
}

export function cacheWalkR1Details(chainId: Uint8Array, parentId: Uint8Array, eventId: Uint8Array, params?: CacheWalkR1Params): CacheWalkVectorDetails {
  const cacheWalkParams = params ?? {
    scratchpadBytes: CACHEWALK_R1_BYTES,
    lineBytes: CACHEWALK_R1_LINE_BYTES,
    lineCount: CACHEWALK_R1_LINES,
    passes: CACHEWALK_R1_PASSES
  };
  const seed = sha256(Buffer.concat([utf8Bytes('NostrCacheWalk-R1/seed'), Buffer.from(chainId), Buffer.from(parentId), Buffer.from(eventId)]));
  const scratch = chacha20(seed, Buffer.alloc(12, 0), Buffer.alloc(cacheWalkParams.scratchpadBytes, 0), undefined, 0);
  const initialFirstScratchLine = Buffer.from(scratch.subarray(0, cacheWalkParams.lineBytes));
  const initialLastScratchLine = Buffer.from(scratch.subarray(scratch.length - cacheWalkParams.lineBytes));
  const lines: Buffer[] = [];
  for (let offset = 0; offset < scratch.length; offset += cacheWalkParams.lineBytes) {
    lines.push(Buffer.from(scratch.subarray(offset, offset + cacheWalkParams.lineBytes)));
  }

  const initialState = sha256(Buffer.concat([utf8Bytes('NostrCacheWalk-R1/state'), seed, Buffer.from(parentId), Buffer.from(eventId)]));
  let state = Buffer.from(initialState);
  let stateAfterPass0 = Buffer.from(initialState);
  for (let pass = 0; pass < cacheWalkParams.passes; pass += 1) {
    for (let index = 0; index < cacheWalkParams.lineCount; index += 1) {
      const lineIndex = decodeU32LE(state, 0) & (cacheWalkParams.lineCount - 1);
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
      state = Buffer.from(m0);
    }
    if (pass === 0) {
      stateAfterPass0 = Buffer.from(state);
    }
  }

  const finalIndex = decodeU32LE(state, 4) & (cacheWalkParams.lineCount - 1);
  const workHash = sha256(Buffer.concat([
    utf8Bytes('NostrCacheWalk-R1/final'),
    state,
    lines[finalIndex]!,
    seed,
    Buffer.from(parentId),
    Buffer.from(eventId)
  ]));

  return {
    seed,
    firstScratchLine: initialFirstScratchLine,
    lastScratchLine: initialLastScratchLine,
    initialState,
    stateAfterPass0,
    stateAfterPass1: Buffer.from(state),
    finalIndex,
    workHash
  };
}

function xorInto(target: Buffer, offset: number, mask: Uint8Array): void {
  for (let index = 0; index < 32; index += 1) {
    target[offset + index] = target[offset + index]! ^ mask[index]!;
  }
}
