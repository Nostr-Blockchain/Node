export const TX_KIND = 7342;
export const BLOCK_KIND = 7343;
export const PROTOCOL_VERSION = 0;
export const NIP13_GATE_BITS = 6;
export const REWARD_OUTPUT_INDEX = 0xffff;
export const MAX_TX_INPUTS_ABSOLUTE = 64;
export const MAX_TX_OUTPUTS_ABSOLUTE = 64;
export const MAX_BLOCK_TRANSACTIONS_ABSOLUTE = 256;
export const MAX_U64 = (1n << 64n) - 1n;
export const MAX_U128 = (1n << 128n) - 1n;
export const MAX_SAFE_CREATED_AT = BigInt(Number.MAX_SAFE_INTEGER);
export const CACHEWALK_R1_BYTES = 262144;
export const CACHEWALK_R1_LINE_BYTES = 64;
export const CACHEWALK_R1_LINES = 4096;
export const CACHEWALK_R1_PASSES = 2;
export const ZERO32 = Buffer.alloc(32, 0);

export function makeChainScope(chainIdHex: string): string {
  return `nostr-blockchain:${chainIdHex}`;
}

export const GENESIS_SCOPE = 'nostr-blockchain:genesis';
