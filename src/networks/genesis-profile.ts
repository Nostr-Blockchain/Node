import { decodeU16, decodeU32, decodeU128, encodeU128, encodeU32, hexToBytes } from '../consensus/primitives';
import { NetworkParams } from './params';

export const GENESIS_PROFILE_BYTES = 76;

export interface ProductionGenesisProfile {
  readonly protocolVersion: number;
  readonly blockReward: bigint;
  readonly rewardMaturity: number;
  readonly powDifficulty: number;
  readonly baseFee: bigint;
  readonly inputFee: bigint;
  readonly outputFee: bigint;
  readonly maxTxInputs: number;
  readonly maxTxOutputs: number;
  readonly maxBlockTransactions: number;
}

export function createGenesisProfile(params: NetworkParams): ProductionGenesisProfile {
  return Object.freeze({
    protocolVersion: params.protocolVersion,
    blockReward: params.blockReward,
    rewardMaturity: params.rewardMaturity,
    powDifficulty: params.initialDifficultyBits,
    baseFee: params.baseFee,
    inputFee: params.inputFee,
    outputFee: params.outputFee,
    maxTxInputs: params.maxTxInputs,
    maxTxOutputs: params.maxTxOutputs,
    maxBlockTransactions: params.maxBlockTransactions
  });
}

export function encodeGenesisProfile(profile: ProductionGenesisProfile): string {
  validateGenesisProfile(profile);
  const bytes = Buffer.concat([
    Buffer.from([profile.protocolVersion]),
    encodeU128(profile.blockReward),
    encodeU32(profile.rewardMaturity),
    Buffer.from([profile.powDifficulty]),
    encodeU128(profile.baseFee),
    encodeU128(profile.inputFee),
    encodeU128(profile.outputFee),
    encodeU16(profile.maxTxInputs),
    encodeU16(profile.maxTxOutputs),
    encodeU16(profile.maxBlockTransactions)
  ]);
  return bytes.toString('hex');
}

export function decodeGenesisProfile(contentHex: string): ProductionGenesisProfile {
  const bytes = hexToBytes(contentHex, GENESIS_PROFILE_BYTES);
  const profile: ProductionGenesisProfile = Object.freeze({
    protocolVersion: bytes[0] ?? 0,
    blockReward: decodeU128(bytes, 1),
    rewardMaturity: decodeU32(bytes, 17),
    powDifficulty: bytes[21] ?? 0,
    baseFee: decodeU128(bytes, 22),
    inputFee: decodeU128(bytes, 38),
    outputFee: decodeU128(bytes, 54),
    maxTxInputs: decodeU16(bytes, 70),
    maxTxOutputs: decodeU16(bytes, 72),
    maxBlockTransactions: decodeU16(bytes, 74)
  });
  validateGenesisProfile(profile);
  return profile;
}

export function validateGenesisProfile(profile: ProductionGenesisProfile): void {
  if (profile.protocolVersion !== 0) {
    throw new Error('invalid genesis profile protocol version');
  }
  if (profile.blockReward <= 0n) {
    throw new Error('invalid genesis profile block reward');
  }
  if (profile.rewardMaturity < 1) {
    throw new Error('invalid genesis profile reward maturity');
  }
  if (profile.powDifficulty < 1 || profile.powDifficulty > 63) {
    throw new Error('invalid genesis profile pow difficulty');
  }
  if (profile.baseFee <= 0n || profile.inputFee < 0n || profile.outputFee < 0n) {
    throw new Error('invalid genesis profile fee values');
  }
  if (profile.maxTxInputs < 1 || profile.maxTxOutputs < 1 || profile.maxBlockTransactions < 1) {
    throw new Error('invalid genesis profile limits');
  }
}

export function assertGenesisProfileMatchesParams(profile: ProductionGenesisProfile, params: NetworkParams): void {
  const expectedProfile = createGenesisProfile(params);
  const actualProfileHex = encodeGenesisProfile(profile);
  const expectedProfileHex = encodeGenesisProfile(expectedProfile);
  if (actualProfileHex !== expectedProfileHex) {
    throw new Error(`genesis profile does not match selected ${params.network} network params`);
  }
}

function encodeU16(value: number): Buffer {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new Error('u16 out of range');
  }
  return Buffer.from([(value >>> 8) & 0xff, value & 0xff]);
}
