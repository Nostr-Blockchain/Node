"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyBlockPow = verifyBlockPow;
exports.cacheWalkR1 = cacheWalkR1;
exports.cacheWalkR1Details = cacheWalkR1Details;
const chacha_1 = require("@noble/ciphers/chacha");
const constants_1 = require("./constants");
const primitives_1 = require("./primitives");
function verifyBlockPow(input) {
    if (input.nonceGateBits !== constants_1.NIP13_GATE_BITS) {
        return false;
    }
    if (!(0, primitives_1.hasLeadingZeroBits)(input.eventId, constants_1.NIP13_GATE_BITS)) {
        return false;
    }
    const workHash = cacheWalkR1(input.chainId, input.parentId, input.eventId, input.cacheWalkR1);
    return (0, primitives_1.hasLeadingZeroBits)(workHash, input.requiredDifficulty);
}
function cacheWalkR1(chainId, parentId, eventId, params) {
    return cacheWalkR1Details(chainId, parentId, eventId, params).workHash;
}
function cacheWalkR1Details(chainId, parentId, eventId, params) {
    const cacheWalkParams = params ?? {
        scratchpadBytes: constants_1.CACHEWALK_R1_BYTES,
        lineBytes: constants_1.CACHEWALK_R1_LINE_BYTES,
        lineCount: constants_1.CACHEWALK_R1_LINES,
        passes: constants_1.CACHEWALK_R1_PASSES
    };
    const seed = (0, primitives_1.sha256)(Buffer.concat([(0, primitives_1.utf8Bytes)('NostrCacheWalk-R1/seed'), Buffer.from(chainId), Buffer.from(parentId), Buffer.from(eventId)]));
    const scratch = (0, chacha_1.chacha20)(seed, Buffer.alloc(12, 0), Buffer.alloc(cacheWalkParams.scratchpadBytes, 0), undefined, 0);
    const initialFirstScratchLine = Buffer.from(scratch.subarray(0, cacheWalkParams.lineBytes));
    const initialLastScratchLine = Buffer.from(scratch.subarray(scratch.length - cacheWalkParams.lineBytes));
    const lines = [];
    for (let offset = 0; offset < scratch.length; offset += cacheWalkParams.lineBytes) {
        lines.push(Buffer.from(scratch.subarray(offset, offset + cacheWalkParams.lineBytes)));
    }
    const initialState = (0, primitives_1.sha256)(Buffer.concat([(0, primitives_1.utf8Bytes)('NostrCacheWalk-R1/state'), seed, Buffer.from(parentId), Buffer.from(eventId)]));
    let state = Buffer.from(initialState);
    let stateAfterPass0 = Buffer.from(initialState);
    for (let pass = 0; pass < cacheWalkParams.passes; pass += 1) {
        for (let index = 0; index < cacheWalkParams.lineCount; index += 1) {
            const lineIndex = (0, primitives_1.decodeU32LE)(state, 0) & (cacheWalkParams.lineCount - 1);
            const lineA = Buffer.from(lines[index]);
            const lineB = Buffer.from(lines[lineIndex]);
            const passBytes = Buffer.alloc(4);
            passBytes.writeUInt32LE(pass, 0);
            const indexBytes = Buffer.alloc(4);
            indexBytes.writeUInt32LE(index, 0);
            const m0 = (0, primitives_1.sha256)(Buffer.concat([(0, primitives_1.utf8Bytes)('NostrCacheWalk-R1/round/0'), state, lineA, lineB, passBytes, indexBytes]));
            const m1 = (0, primitives_1.sha256)(Buffer.concat([(0, primitives_1.utf8Bytes)('NostrCacheWalk-R1/round/1'), m0, state, lineB, lineA, passBytes, indexBytes]));
            xorInto(lines[index], 0, m0);
            xorInto(lines[index], 32, m1);
            state = Buffer.from(m0);
        }
        if (pass === 0) {
            stateAfterPass0 = Buffer.from(state);
        }
    }
    const finalIndex = (0, primitives_1.decodeU32LE)(state, 4) & (cacheWalkParams.lineCount - 1);
    const workHash = (0, primitives_1.sha256)(Buffer.concat([
        (0, primitives_1.utf8Bytes)('NostrCacheWalk-R1/final'),
        state,
        lines[finalIndex],
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
function xorInto(target, offset, mask) {
    for (let index = 0; index < 32; index += 1) {
        target[offset + index] = target[offset + index] ^ mask[index];
    }
}
