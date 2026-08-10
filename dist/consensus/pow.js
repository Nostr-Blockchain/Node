"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyBlockPow = verifyBlockPow;
exports.cacheWalkR1 = cacheWalkR1;
const chacha_1 = require("@noble/ciphers/chacha");
const constants_1 = require("./constants");
const primitives_1 = require("./primitives");
function verifyBlockPow(input) {
    if (input.nonceGateBits !== constants_1.NIP13_GATE_BITS) {
        return false;
    }
    if ((0, primitives_1.leadingZeroBits)(input.eventId) < constants_1.NIP13_GATE_BITS) {
        return false;
    }
    const workHash = cacheWalkR1(input.chainId, input.parentId, input.eventId);
    return (0, primitives_1.leadingZeroBits)(workHash) >= input.powDifficulty;
}
function cacheWalkR1(chainId, parentId, eventId) {
    const seed = (0, primitives_1.sha256)(Buffer.concat([(0, primitives_1.utf8Bytes)('NostrCacheWalk-R1/seed'), Buffer.from(chainId), Buffer.from(parentId), Buffer.from(eventId)]));
    const scratch = (0, chacha_1.chacha20)(seed, Buffer.alloc(12, 0), Buffer.alloc(constants_1.CACHEWALK_R1_BYTES, 0), undefined, 0);
    const lines = [];
    for (let offset = 0; offset < scratch.length; offset += constants_1.CACHEWALK_R1_LINE_BYTES) {
        lines.push(Buffer.from(scratch.subarray(offset, offset + constants_1.CACHEWALK_R1_LINE_BYTES)));
    }
    let state = (0, primitives_1.sha256)(Buffer.concat([(0, primitives_1.utf8Bytes)('NostrCacheWalk-R1/state'), seed, Buffer.from(parentId), Buffer.from(eventId)]));
    for (let pass = 0; pass < constants_1.CACHEWALK_R1_PASSES; pass += 1) {
        for (let index = 0; index < constants_1.CACHEWALK_R1_LINES; index += 1) {
            const lineIndex = (0, primitives_1.decodeU32LE)(state, 0) & 4095;
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
            state = m0;
        }
    }
    const finalIndex = (0, primitives_1.decodeU32LE)(state, 4) & 4095;
    return (0, primitives_1.sha256)(Buffer.concat([
        (0, primitives_1.utf8Bytes)('NostrCacheWalk-R1/final'),
        state,
        lines[finalIndex],
        seed,
        Buffer.from(parentId),
        Buffer.from(eventId)
    ]));
}
function xorInto(target, offset, mask) {
    for (let index = 0; index < 32; index += 1) {
        target[offset + index] = target[offset + index] ^ mask[index];
    }
}
