import { BlockIndex } from './block-index';

export interface ReorgPlan {
  commonAncestorId: string | null;
  disconnectIds: string[];
  connectIds: string[];
}

export function buildReorgPlan(index: BlockIndex, currentTipId: string | null, candidateTipId: string): ReorgPlan {
  const currentPath = currentTipId === null ? [] : collectPathToGenesis(index, currentTipId);
  const candidatePath = collectPathToGenesis(index, candidateTipId);
  const currentSet = new Set(currentPath);
  let commonAncestorId: string | null = null;
  for (const blockId of candidatePath) {
    if (currentSet.has(blockId)) {
      commonAncestorId = blockId;
      break;
    }
  }

  const disconnectIds: string[] = [];
  for (const blockId of currentPath) {
    if (blockId === commonAncestorId) {
      break;
    }
    disconnectIds.push(blockId);
  }

  const connectIds = candidatePath
    .slice(0, commonAncestorId === null ? candidatePath.length : candidatePath.indexOf(commonAncestorId))
    .reverse();

  return { commonAncestorId, disconnectIds, connectIds };
}

function collectPathToGenesis(index: BlockIndex, tipId: string): string[] {
  const path: string[] = [];
  let currentId: string | null = tipId;
  while (currentId !== null) {
    path.push(currentId);
    currentId = index.get(currentId)?.parentId ?? null;
  }
  return path;
}
