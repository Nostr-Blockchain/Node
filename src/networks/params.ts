export type NetworkName = 'mainnet' | 'testnet';

export interface CacheWalkR1Params {
  readonly scratchpadBytes: number;
  readonly lineBytes: number;
  readonly lineCount: number;
  readonly passes: number;
}

export interface NetworkParams {
  readonly network: NetworkName;
  readonly protocolVersion: number;
  readonly txKind: number;
  readonly blockKind: number;
  readonly decimals: number;
  readonly baseUnitsPerNsr: bigint;
  readonly blockReward: bigint;
  readonly rewardMaturity: number;
  readonly baseFee: bigint;
  readonly inputFee: bigint;
  readonly outputFee: bigint;
  readonly maxTxInputs: number;
  readonly maxTxOutputs: number;
  readonly maxBlockTransactions: number;
  readonly targetBlockSeconds: number;
  readonly difficultyWindow: number;
  readonly minDifficultyBits: number;
  readonly maxDifficultyBits: number;
  readonly nip13GateBits: number;
  readonly cacheWalkR1: CacheWalkR1Params;
  readonly initialDifficultyBits: number;
  readonly displaySymbol: 'NSR' | 'tNSR';
  readonly expectedGenesisId: string | null;
}

export const SUPPORTED_NETWORK_NAMES: readonly NetworkName[] = Object.freeze(['mainnet', 'testnet']);
export const PUBLIC_BINARY_NAME = 'nostr-blockchain';

const SHARED_CACHEWALK_R1: CacheWalkR1Params = Object.freeze({
  scratchpadBytes: 262_144,
  lineBytes: 64,
  lineCount: 4_096,
  passes: 2
});

const SHARED_NETWORK_CONSTANTS = {
  protocolVersion: 0,
  txKind: 7_342,
  blockKind: 7_343,
  decimals: 8,
  baseUnitsPerNsr: 100_000_000n,
  blockReward: 5_000_000_000n,
  rewardMaturity: 240,
  baseFee: 1_000n,
  inputFee: 250n,
  outputFee: 500n,
  maxTxInputs: 32,
  maxTxOutputs: 32,
  maxBlockTransactions: 64,
  targetBlockSeconds: 15,
  difficultyWindow: 120,
  minDifficultyBits: 1,
  maxDifficultyBits: 63,
  nip13GateBits: 6,
  cacheWalkR1: SHARED_CACHEWALK_R1
} as const;

export const MAINNET_PARAMS: NetworkParams = Object.freeze({
  network: 'mainnet',
  ...SHARED_NETWORK_CONSTANTS,
  initialDifficultyBits: 10,
  displaySymbol: 'NSR',
  expectedGenesisId: null
});

export const TESTNET_PARAMS: NetworkParams = Object.freeze({
  network: 'testnet',
  ...SHARED_NETWORK_CONSTANTS,
  initialDifficultyBits: 4,
  displaySymbol: 'tNSR',
  expectedGenesisId: null
});

export const NETWORK_PARAMS_BY_NAME: Readonly<Record<NetworkName, NetworkParams>> = Object.freeze({
  mainnet: MAINNET_PARAMS,
  testnet: TESTNET_PARAMS
});

export function isNetworkName(value: string): value is NetworkName {
  return value === 'mainnet' || value === 'testnet';
}

export function assertNetworkName(value: string): NetworkName {
  if (!isNetworkName(value)) {
    throw new Error(`invalid network name: ${value}`);
  }
  return value;
}

export function getNetworkParams(network: NetworkName): NetworkParams {
  return NETWORK_PARAMS_BY_NAME[network];
}
