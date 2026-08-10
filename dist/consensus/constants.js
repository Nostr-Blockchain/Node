"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GENESIS_SCOPE = exports.ZERO32 = exports.CACHEWALK_R1_PASSES = exports.CACHEWALK_R1_LINES = exports.CACHEWALK_R1_LINE_BYTES = exports.CACHEWALK_R1_BYTES = exports.MAX_SAFE_CREATED_AT = exports.MAX_U128 = exports.MAX_U64 = exports.MAX_BLOCK_TRANSACTIONS_ABSOLUTE = exports.MAX_TX_OUTPUTS_ABSOLUTE = exports.MAX_TX_INPUTS_ABSOLUTE = exports.REWARD_OUTPUT_INDEX = exports.NIP13_GATE_BITS = exports.PROTOCOL_VERSION = exports.BLOCK_KIND = exports.TX_KIND = void 0;
exports.makeChainScope = makeChainScope;
exports.TX_KIND = 7342;
exports.BLOCK_KIND = 7343;
exports.PROTOCOL_VERSION = 0;
exports.NIP13_GATE_BITS = 6;
exports.REWARD_OUTPUT_INDEX = 0xffff;
exports.MAX_TX_INPUTS_ABSOLUTE = 64;
exports.MAX_TX_OUTPUTS_ABSOLUTE = 64;
exports.MAX_BLOCK_TRANSACTIONS_ABSOLUTE = 256;
exports.MAX_U64 = (1n << 64n) - 1n;
exports.MAX_U128 = (1n << 128n) - 1n;
exports.MAX_SAFE_CREATED_AT = BigInt(Number.MAX_SAFE_INTEGER);
exports.CACHEWALK_R1_BYTES = 262144;
exports.CACHEWALK_R1_LINE_BYTES = 64;
exports.CACHEWALK_R1_LINES = 4096;
exports.CACHEWALK_R1_PASSES = 2;
exports.ZERO32 = Buffer.alloc(32, 0);
function makeChainScope(chainIdHex) {
    return `nostr-blockchain:${chainIdHex}`;
}
exports.GENESIS_SCOPE = 'nostr-blockchain:genesis';
