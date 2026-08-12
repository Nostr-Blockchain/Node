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
  const comparableTips: ComparableTip[] = tips.filter((tip): tip is ComparableTip => isComparableTip(tip) && tip.height > 0n);
  if (comparableTips.length === 0) {
    return null;
  }
  const bestWork = comparableTips.reduce((bestWorkValue, tip) => tip.cumulativeWork > bestWorkValue ? tip.cumulativeWork : bestWorkValue, comparableTips[0]!.cumulativeWork);
  const bestTips = comparableTips.filter((tip) => tip.cumulativeWork === bestWork);
  return bestTips.sort((left, right) => compareBytes(Buffer.from(left.blockId, 'hex'), Buffer.from(right.blockId, 'hex')))[0] ?? null;
}

export function choosePreferredTip(tips: readonly BlockIndexEntry[], preferredTipId: string | null): BlockIndexEntry | null {
  const initialTip = chooseInitialTip(tips);
  if (initialTip === null || preferredTipId === null) {
    return initialTip;
  }
  const preferredTip = tips.find((tip) => tip.blockId === preferredTipId) ?? null;
  if (!isComparableTip(preferredTip) || preferredTip.height === 0n) {
    return initialTip;
  }
  return preferredTip.cumulativeWork === initialTip.cumulativeWork ? preferredTip : initialTip;
}

function isComparableTip(tip: BlockIndexEntry | null): tip is ComparableTip {
  return tip !== null && tip.validationState === 'STATE_VALID' && tip.height !== null && tip.cumulativeWork !== null;
}
