import { REWARD_OUTPUT_INDEX } from '../consensus/constants';
import { BlockEvaluation } from '../consensus/block-validation';
import { ParsedBlock } from '../consensus/block-codec';
import { UtxoRecord } from '../consensus/primitives';
import { computeUtxoDigest } from '../state/digest';
import { MemoryUtxoView } from '../state/utxo-view';
import { BlockIndex, BlockIndexEntry } from './block-index';
import { buildReorgPlan } from './reorg';
import { chooseBetterTip, chooseInitialTip } from './fork-choice';
import { Mempool } from '../mempool/mempool';
import { sortOutpointsCanonical } from '../consensus/primitives';

export interface ConnectedBlock {
  blockId: string;
  parentId: string | null;
  height: bigint;
  evaluation: BlockEvaluation;
}

export interface ChainStateSnapshot {
  activeTip: string | null;
  activeHeight: bigint;
  cumulativeFixedRewards: bigint;
  cumulativeMinimumBurns: bigint;
  cumulativePriorityFees: bigint;
  totalSupply: bigint;
  utxoDigest: string;
  utxos: UtxoRecord[];
}

export class ChainExecutor {
  private readonly blockIndex = new BlockIndex();
  private readonly connectedBlocks = new Map<string, ConnectedBlock>();
  private readonly mempool: Mempool;
  private readonly utxoView: MemoryUtxoView;
  private activeTip: string | null = null;
  private activeHeight = 0n;
  private cumulativeFixedRewards = 0n;
  private cumulativeMinimumBurns = 0n;
  private cumulativePriorityFees = 0n;
  private stateVersion = 0n;
  private miningGeneration = 0n;

  public constructor(mempool = new Mempool(), initialView = new MemoryUtxoView()) {
    this.mempool = mempool;
    this.utxoView = initialView;
  }

  public getActiveTip(): string | null {
    return this.activeTip;
  }

  public getStateVersion(): bigint {
    return this.stateVersion;
  }

  public getMiningGeneration(): bigint {
    return this.miningGeneration;
  }

  public getUtxoView(): MemoryUtxoView {
    return this.utxoView;
  }

  public getMempool(): Mempool {
    return this.mempool;
  }

  public getActiveHeight(): bigint {
    return this.activeHeight;
  }

  public getBlockIndexEntry(blockId: string): BlockIndexEntry | null {
    return this.blockIndex.get(blockId);
  }

  public getConnectedBlock(blockId: string): ConnectedBlock | null {
    return this.connectedBlocks.get(blockId) ?? null;
  }

  public getActiveChainIds(): string[] {
    if (this.activeTip === null) {
      return [];
    }
    const ids: string[] = [];
    let currentId: string | null = this.activeTip;
    while (currentId !== null) {
      ids.push(currentId);
      currentId = this.blockIndex.get(currentId)?.parentId ?? null;
    }
    return ids.reverse();
  }

  public buildViewForParent(blockId: string): MemoryUtxoView {
    if (this.blockIndex.get(blockId) === null) {
      throw new Error('unknown parent block');
    }

    const view = new MemoryUtxoView(this.utxoView.snapshot());
    const plan = buildReorgPlan(this.blockIndex, this.activeTip, blockId);

    for (const disconnectId of plan.disconnectIds) {
      const block = this.connectedBlocks.get(disconnectId);
      if (block !== undefined) {
        revertBlockOnView(view, block);
      }
    }

    for (const connectId of plan.connectIds) {
      const block = this.connectedBlocks.get(connectId);
      if (block !== undefined) {
        applyBlockOnView(view, block);
      }
    }

    return view;
  }

  public connectGenesis(blockId: string): void {
    this.blockIndex.upsert({
      blockId,
      parentId: null,
      height: 0n,
      cumulativeWork: 0n,
      validationState: 'STATE_VALID',
      active: true,
      invalidCode: null
    });
    this.connectedBlocks.set(blockId, {
      blockId,
      parentId: null,
      height: 0n,
      evaluation: {
        parsedBlock: { event: { id: blockId, pubkey: '', created_at: 0, kind: 0, tags: [], content: '', sig: '' }, parentId: null, txIds: [], nonce: 0n, isGenesis: true },
        txEvaluations: [],
        consumedOutpoints: [],
        createdTxOutputs: [],
        rewardOutput: null,
        totalMinimumBurn: 0n,
        totalPriorityFee: 0n,
        blockRewardAmount: 0n
      }
    });
    this.activeTip = blockId;
    this.activeHeight = 0n;
  }

  public recordStateValidBlock(block: ConnectedBlock): void {
    this.connectedBlocks.set(block.blockId, block);
    this.blockIndex.upsert({
      blockId: block.blockId,
      parentId: block.parentId,
      height: block.height,
      cumulativeWork: block.height,
      validationState: 'STATE_VALID',
      active: false,
      invalidCode: null
    });
  }

  public considerCandidateTip(blockId: string): void {
    const candidate = this.blockIndex.get(blockId);
    if (candidate === null) {
      return;
    }

    if (this.activeTip === null) {
      const chosen = chooseInitialTip(this.blockIndex.listStateValidTips());
      if (chosen !== null) {
        this.activateBranch(chosen.blockId);
      }
      return;
    }

    const current = this.blockIndex.get(this.activeTip);
    const next = chooseBetterTip(current, candidate);
    if (next !== null && next.blockId !== this.activeTip) {
      this.activateBranch(next.blockId);
    }
  }

  public activateBranch(candidateTipId: string): void {
    const plan = buildReorgPlan(this.blockIndex, this.activeTip, candidateTipId);
    for (const blockId of plan.disconnectIds) {
      this.disconnectTip(blockId);
    }
    for (const blockId of plan.connectIds) {
      const block = this.connectedBlocks.get(blockId);
      if (block !== undefined) {
        this.applyConnectedBlock(block);
      }
    }
    this.revalidateMempool();
    this.stateVersion += 1n;
    this.miningGeneration += 1n;
  }

  public disconnectTip(blockId: string): void {
    if (this.activeTip !== blockId) {
      throw new Error('disconnectTip requires active tip');
    }
    const block = this.connectedBlocks.get(blockId);
    if (block === undefined) {
      throw new Error('unknown block');
    }
    revertBlockOnView(this.utxoView, block);
    this.updateMonetaryTotals(block, -1n);
    const entry = this.blockIndex.get(blockId);
    if (entry !== null) {
      entry.active = false;
    }
    this.activeTip = block.parentId;
    this.activeHeight = this.activeHeight > 0n ? this.activeHeight - 1n : 0n;
  }

  private applyConnectedBlock(block: ConnectedBlock): void {
    applyBlockOnView(this.utxoView, block);
    this.updateMonetaryTotals(block, 1n);
    const entry = this.blockIndex.get(block.blockId);
    if (entry !== null) {
      entry.active = true;
    }
    this.activeTip = block.blockId;
    this.activeHeight = block.height;
  }

  private updateMonetaryTotals(block: ConnectedBlock, direction: 1n | -1n): void {
    if (block.evaluation.rewardOutput === null) {
      return;
    }
    this.cumulativeFixedRewards += direction * (block.evaluation.blockRewardAmount - block.evaluation.totalPriorityFee);
    this.cumulativePriorityFees += direction * block.evaluation.totalPriorityFee;
    this.cumulativeMinimumBurns += direction * block.evaluation.totalMinimumBurn;
  }

  public revalidateMempool(predicate?: (txId: string) => boolean): void {
    const confirmed = new Set(
      [...this.connectedBlocks.values()]
        .filter((block) => this.isActiveBlock(block.blockId))
        .flatMap((block) => block.evaluation.txEvaluations.map((evaluation) => evaluation.parsed.event.id))
    );
    for (const entry of this.mempool.values()) {
      if (confirmed.has(entry.txId) || (predicate !== undefined && !predicate(entry.txId))) {
        this.mempool.remove(entry.txId);
      }
    }
  }

  public listStateValidTips(): BlockIndexEntry[] {
    return this.blockIndex.listStateValidTips();
  }

  private isActiveBlock(blockId: string): boolean {
    const entry = this.blockIndex.get(blockId);
    return entry?.active === true;
  }

  public snapshot(): ChainStateSnapshot {
    const utxos = this.utxoView.snapshot();
    return {
      activeTip: this.activeTip,
      activeHeight: this.activeHeight,
      cumulativeFixedRewards: this.cumulativeFixedRewards,
      cumulativeMinimumBurns: this.cumulativeMinimumBurns,
      cumulativePriorityFees: this.cumulativePriorityFees,
      totalSupply: this.cumulativeFixedRewards - this.cumulativeMinimumBurns,
      utxoDigest: computeUtxoDigest(utxos),
      utxos
    };
  }
}

function applyBlockOnView(view: MemoryUtxoView, block: ConnectedBlock): void {
  for (const spent of block.evaluation.consumedOutpoints) {
    view.deleteUtxo(spent.sourceId, spent.outputIndex);
  }
  for (const output of block.evaluation.createdTxOutputs) {
    view.setUtxo(output);
  }
  if (block.evaluation.rewardOutput !== null) {
    view.setUtxo(block.evaluation.rewardOutput);
  }
}

function revertBlockOnView(view: MemoryUtxoView, block: ConnectedBlock): void {
  if (block.evaluation.rewardOutput !== null) {
    view.deleteUtxo(block.evaluation.rewardOutput.sourceId, REWARD_OUTPUT_INDEX);
  }
  for (const output of sortOutpointsCanonical(block.evaluation.createdTxOutputs)) {
    view.deleteUtxo(output.sourceId, output.outputIndex);
  }
  for (const spent of block.evaluation.consumedOutpoints) {
    view.setUtxo(spent);
  }
}
