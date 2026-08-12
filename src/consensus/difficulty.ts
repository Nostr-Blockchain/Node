import { NetworkParams } from '../networks/params';

export interface DifficultyHistoryEntry {
  readonly blockId: string;
  readonly parentId: string | null;
  readonly height: bigint;
  readonly createdAt: number;
  readonly requiredDifficulty: number;
}

export function calculateMedianTimePast(
  blockId: string | null,
  getBlock: (blockId: string) => DifficultyHistoryEntry | null
): number {
  const timestamps: number[] = [];
  let cursor = blockId;
  while (cursor !== null && timestamps.length < 11) {
    const block = getBlock(cursor);
    if (block === null) {
      break;
    }
    timestamps.push(block.createdAt);
    cursor = block.parentId;
  }
  timestamps.sort((left, right) => left - right);
  if (timestamps.length === 0) {
    return 0;
  }
  return timestamps[(timestamps.length - 1) >> 1]!;
}

export function calculateCandidateTimestamp(
  parentBlockId: string,
  localUnixTime: number,
  getBlock: (blockId: string) => DifficultyHistoryEntry | null
): number {
  const medianTimePast = calculateMedianTimePast(parentBlockId, getBlock);
  return Math.max(localUnixTime, medianTimePast + 1);
}

export function calculateNextDifficulty(
  params: NetworkParams,
  candidateHeight: bigint,
  parentBlock: DifficultyHistoryEntry,
  getBlock: (blockId: string) => DifficultyHistoryEntry | null
): number {
  if (candidateHeight <= BigInt(params.difficultyWindow)) {
    return params.initialDifficultyBits;
  }

  if ((candidateHeight - 1n) % BigInt(params.difficultyWindow) !== 0n) {
    return parentBlock.requiredDifficulty;
  }

  const startBlock = getAncestor(parentBlock, params.difficultyWindow, getBlock);
  const endMedianTimePast = calculateMedianTimePast(parentBlock.blockId, getBlock);
  const startMedianTimePast = calculateMedianTimePast(startBlock.blockId, getBlock);
  const actualSpan = BigInt(endMedianTimePast - startMedianTimePast);
  if (actualSpan <= 0n) {
    throw new Error('invalid non-positive difficulty timespan');
  }

  const targetSpan = BigInt(params.difficultyWindow * params.targetBlockSeconds);
  let nextDifficulty = parentBlock.requiredDifficulty;
  if (actualSpan * 4n < targetSpan * 3n) {
    nextDifficulty += 1;
  } else if (actualSpan * 2n > targetSpan * 3n) {
    nextDifficulty -= 1;
  }

  return clampDifficultyBits(nextDifficulty, params.minDifficultyBits, params.maxDifficultyBits);
}

export function clampDifficultyBits(difficultyBits: number, minimumDifficultyBits: number, maximumDifficultyBits: number): number {
  if (difficultyBits < minimumDifficultyBits) {
    return minimumDifficultyBits;
  }
  if (difficultyBits > maximumDifficultyBits) {
    return maximumDifficultyBits;
  }
  return difficultyBits;
}

export function computeBlockWork(requiredDifficulty: number): bigint {
  return 1n << BigInt(requiredDifficulty);
}

function getAncestor(
  block: DifficultyHistoryEntry,
  depth: number,
  getBlock: (blockId: string) => DifficultyHistoryEntry | null
): DifficultyHistoryEntry {
  let cursor: DifficultyHistoryEntry | null = block;
  for (let step = 0; step < depth; step += 1) {
    if (cursor === null || cursor.parentId === null) {
      throw new Error('insufficient ancestor history for difficulty retarget');
    }
    cursor = getBlock(cursor.parentId);
  }
  if (cursor === null) {
    throw new Error('missing ancestor history for difficulty retarget');
  }
  return cursor;
}
