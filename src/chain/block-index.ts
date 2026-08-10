export type BlockValidationState =
  | 'PARENT_MISSING'
  | 'STRUCTURAL_VALID'
  | 'TX_DATA_MISSING'
  | 'STATE_VALID'
  | 'INVALID'
  | 'INVALID_ANCESTOR';

export interface BlockIndexEntry {
  blockId: string;
  parentId: string | null;
  height: bigint | null;
  cumulativeWork: bigint | null;
  validationState: BlockValidationState;
  active: boolean;
  invalidCode: string | null;
}

export class BlockIndex {
  private readonly entries = new Map<string, BlockIndexEntry>();
  private readonly children = new Map<string, Set<string>>();

  public upsert(entry: BlockIndexEntry): void {
    const previous = this.entries.get(entry.blockId);
    if (previous !== undefined && previous.parentId !== null) {
      this.children.get(previous.parentId)?.delete(entry.blockId);
    }
    this.entries.set(entry.blockId, { ...entry });
    if (entry.parentId !== null) {
      const siblings = this.children.get(entry.parentId) ?? new Set<string>();
      siblings.add(entry.blockId);
      this.children.set(entry.parentId, siblings);
    }
  }

  public get(blockId: string): BlockIndexEntry | null {
    return this.entries.get(blockId) ?? null;
  }

  public getChildren(blockId: string): string[] {
    return [...(this.children.get(blockId) ?? new Set<string>())];
  }

  public listStateValidTips(): BlockIndexEntry[] {
    return [...this.entries.values()].filter((entry) => {
      if (entry.validationState !== 'STATE_VALID') {
        return false;
      }
      return !this.getChildren(entry.blockId)
        .some((blockId) => this.get(blockId)?.validationState === 'STATE_VALID');
    });
  }

  public markInvalidAncestor(rootBlockId: string): void {
    const queue = [...this.getChildren(rootBlockId)];
    while (queue.length > 0) {
      const blockId = queue.shift()!;
      const entry = this.entries.get(blockId);
      if (entry !== undefined && entry.validationState !== 'INVALID') {
        entry.validationState = 'INVALID_ANCESTOR';
        queue.push(...this.getChildren(blockId));
      }
    }
  }

  public all(): BlockIndexEntry[] {
    return [...this.entries.values()].map((entry) => ({ ...entry }));
  }
}
