import { compareBytes } from '../consensus/primitives';
import { BlockIndexEntry } from './block-index';

interface ComparableTip extends BlockIndexEntry {
  height: bigint;
  cumulativeWork: bigint;
}

export function chooseBetterTip(currentTip: BlockIndexEntry | null, candidateTip: BlockIndexEntry): BlockIndexEntry | null {
  if (!isComparableTip(candidateTip)) {
    return currentTip;
  }
  if (!isComparableTip(currentTip)) {
    return candidateTip;
  }
  if (candidateTip.cumulativeWork > currentTip.cumulativeWork) {
    return candidateTip;
  }
  return currentTip;
}

export function chooseInitialTip(tips: readonly BlockIndexEntry[]): BlockIndexEntry | null {
  const comparableTips = tips.filter(isComparableTip);
  if (comparableTips.length === 0) {
    return null;
  }
  const bestWork = comparableTips.reduce((best, tip) => tip.cumulativeWork > best ? tip.cumulativeWork : best, comparableTips[0]!.cumulativeWork);
  const bestTips = comparableTips.filter((tip) => tip.cumulativeWork === bestWork);
  return bestTips.sort((left, right) => compareBytes(Buffer.from(left.blockId, 'hex'), Buffer.from(right.blockId, 'hex')))[0] ?? null;
}

function isComparableTip(tip: BlockIndexEntry | null): tip is ComparableTip {
  return tip !== null && tip.validationState === 'STATE_VALID' && tip.height !== null && tip.cumulativeWork !== null;
}
