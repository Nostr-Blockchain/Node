import { GenesisParams } from './genesis';
import { decodeU256, encodeU256, truncDivTowardZero } from './primitives';

const RADIX = 65536n;
const MAX_U256 = (1n << 256n) - 1n;

export function computeRequiredTarget(params: GenesisParams, genesisCreatedAt: number, parentCreatedAt: number, candidateHeight: bigint): bigint {
  if (candidateHeight === 0n) {
    return params.initialPowTarget;
  }

  const heightDelta = candidateHeight - 1n;
  const anchorParentTime = BigInt(genesisCreatedAt - params.targetBlockInterval);
  const timeDelta = BigInt(parentCreatedAt) - anchorParentTime;
  const exponent = truncDivTowardZero((timeDelta - BigInt(params.targetBlockInterval) * (heightDelta + 1n)) * RADIX, BigInt(params.asertHalfLife));
  const numShifts = exponent >> 16n;
  const frac = exponent - (numShifts * RADIX);
  const factor = (((195766423245049n * frac) + (971821376n * frac * frac) + (5127n * frac * frac * frac) + (1n << 47n)) >> 48n) + RADIX;

  let nextTarget = params.initialPowTarget * factor;
  if (numShifts < 0n) {
    nextTarget >>= -numShifts;
  } else {
    nextTarget <<= numShifts;
  }
  nextTarget >>= 16n;

  if (nextTarget < 1n) {
    return 1n;
  }
  if (nextTarget > params.powLimitTarget) {
    return params.powLimitTarget;
  }
  return nextTarget;
}

export function computeBlockWork(requiredTarget: bigint): bigint {
  return (MAX_U256 / (requiredTarget + 1n)) + 1n;
}

export function targetToHex(requiredTarget: bigint): string {
  return encodeU256(requiredTarget).toString('hex');
}

export function targetFromHex(requiredTargetHex: string): bigint {
  return decodeU256(Buffer.from(requiredTargetHex, 'hex'));
}
