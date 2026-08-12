"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChainExecutor = void 0;
const constants_1 = require("../consensus/constants");
const constants_2 = require("../consensus/constants");
const digest_1 = require("../state/digest");
const utxo_view_1 = require("../state/utxo-view");
const block_index_1 = require("./block-index");
const reorg_1 = require("./reorg");
const fork_choice_1 = require("./fork-choice");
const mempool_1 = require("../mempool/mempool");
const primitives_1 = require("../consensus/primitives");
class ChainExecutor {
    blockIndex = new block_index_1.BlockIndex();
    connectedBlocks = new Map();
    mempool;
    utxoView;
    activeTip = null;
    activeHeight = 0n;
    cumulativeFixedRewards = 0n;
    cumulativeMinimumBurns = 0n;
    cumulativePriorityFees = 0n;
    activeCumulativeWork = 0n;
    stateVersion = 0n;
    miningGeneration = 0n;
    constructor(mempool = new mempool_1.Mempool(), initialView = new utxo_view_1.MemoryUtxoView()) {
        this.mempool = mempool;
        this.utxoView = initialView;
    }
    getActiveTip() {
        return this.activeTip;
    }
    getStateVersion() {
        return this.stateVersion;
    }
    getMiningGeneration() {
        return this.miningGeneration;
    }
    getUtxoView() {
        return new utxo_view_1.MemoryUtxoView(this.utxoView.snapshot());
    }
    getMempool() {
        return this.mempool;
    }
    getActiveHeight() {
        return this.activeHeight;
    }
    getBlockIndexEntry(blockId) {
        return this.blockIndex.get(blockId);
    }
    getConnectedBlock(blockId) {
        return this.connectedBlocks.get(blockId) ?? null;
    }
    getActiveChainIds() {
        if (this.activeTip === null) {
            return [];
        }
        const ids = [];
        let currentId = this.activeTip;
        while (currentId !== null) {
            ids.push(currentId);
            currentId = this.blockIndex.get(currentId)?.parentId ?? null;
        }
        return ids.reverse();
    }
    buildViewForParent(blockId) {
        if (this.blockIndex.get(blockId) === null) {
            throw new Error('unknown parent block');
        }
        const view = new utxo_view_1.MemoryUtxoView(this.utxoView.snapshot());
        const plan = (0, reorg_1.buildReorgPlan)(this.blockIndex, this.activeTip, blockId);
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
    connectGenesis(blockId, createdAt = 0, requiredDifficulty = 0, cumulativeWork = 0n) {
        this.blockIndex.upsert({
            blockId,
            parentId: null,
            height: 0n,
            cumulativeWork,
            validationState: 'STATE_VALID',
            active: true,
            invalidCode: null
        });
        this.connectedBlocks.set(blockId, {
            blockId,
            parentId: null,
            height: 0n,
            createdAt,
            requiredDifficulty,
            blockWork: cumulativeWork,
            cumulativeWork,
            evaluation: {
                parsedBlock: { event: { id: blockId, pubkey: '', created_at: 0, kind: 0, tags: [], content: '', sig: '' }, parentId: null, txIds: [], nonce: 0n, isGenesis: true },
                txEvaluations: [],
                consumedOutpoints: [],
                createdTxOutputs: [],
                rewardOutput: null,
                totalMinimumBurn: 0n,
                totalPriorityFee: 0n,
                blockRewardAmount: 0n,
                requiredDifficulty,
                blockWork: cumulativeWork
            }
        });
        this.activeTip = blockId;
        this.activeHeight = 0n;
        this.activeCumulativeWork = cumulativeWork;
    }
    recordStateValidBlock(block) {
        this.connectedBlocks.set(block.blockId, block);
        this.blockIndex.upsert({
            blockId: block.blockId,
            parentId: block.parentId,
            height: block.height,
            cumulativeWork: block.cumulativeWork,
            validationState: 'STATE_VALID',
            active: false,
            invalidCode: null
        });
    }
    considerCandidateTip(blockId) {
        const candidate = this.blockIndex.get(blockId);
        if (candidate === null) {
            return;
        }
        if (this.activeTip === null) {
            const chosen = (0, fork_choice_1.chooseInitialTip)(this.blockIndex.listStateValidTips());
            if (chosen !== null) {
                this.activateBranch(chosen.blockId);
            }
            return;
        }
        const current = this.blockIndex.get(this.activeTip);
        const next = (0, fork_choice_1.chooseBetterTip)(current, candidate);
        if (next !== null && next.blockId !== this.activeTip) {
            this.activateBranch(next.blockId);
        }
    }
    activateBranch(candidateTipId) {
        const plan = (0, reorg_1.buildReorgPlan)(this.blockIndex, this.activeTip, candidateTipId);
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
    disconnectTip(blockId) {
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
        this.activeCumulativeWork = this.blockIndex.get(this.activeTip ?? '')?.cumulativeWork ?? 0n;
    }
    applyConnectedBlock(block) {
        applyBlockOnView(this.utxoView, block);
        this.updateMonetaryTotals(block, 1n);
        const entry = this.blockIndex.get(block.blockId);
        if (entry !== null) {
            entry.active = true;
        }
        this.activeTip = block.blockId;
        this.activeHeight = block.height;
        this.activeCumulativeWork = block.cumulativeWork;
    }
    updateMonetaryTotals(block, direction) {
        if (block.evaluation.rewardOutput === null) {
            return;
        }
        this.cumulativeFixedRewards += direction * (block.evaluation.blockRewardAmount - block.evaluation.totalPriorityFee);
        this.cumulativePriorityFees += direction * block.evaluation.totalPriorityFee;
        this.cumulativeMinimumBurns += direction * block.evaluation.totalMinimumBurn;
        const totalSupply = this.cumulativeFixedRewards - this.cumulativeMinimumBurns;
        if (totalSupply < 0n || totalSupply > constants_2.MAX_U128) {
            throw new Error('consensus supply overflow');
        }
        const activeUtxoSum = this.utxoView.snapshot().reduce((sum, utxo) => sum + utxo.amount, 0n);
        if (activeUtxoSum !== totalSupply) {
            throw new Error('active UTXO sum does not match consensus supply');
        }
    }
    revalidateMempool(predicate) {
        const confirmed = new Set([...this.connectedBlocks.values()]
            .filter((block) => this.isActiveBlock(block.blockId))
            .flatMap((block) => block.evaluation.txEvaluations.map((evaluation) => evaluation.parsed.event.id)));
        for (const entry of this.mempool.values()) {
            if (confirmed.has(entry.txId) || (predicate !== undefined && !predicate(entry.txId))) {
                this.mempool.remove(entry.txId);
            }
        }
    }
    listStateValidTips() {
        return this.blockIndex.listStateValidTips();
    }
    isActiveBlock(blockId) {
        const entry = this.blockIndex.get(blockId);
        return entry?.active === true;
    }
    snapshot() {
        const utxos = this.utxoView.snapshot();
        return {
            activeTip: this.activeTip,
            activeHeight: this.activeHeight,
            cumulativeFixedRewards: this.cumulativeFixedRewards,
            cumulativeMinimumBurns: this.cumulativeMinimumBurns,
            cumulativePriorityFees: this.cumulativePriorityFees,
            totalSupply: this.cumulativeFixedRewards - this.cumulativeMinimumBurns,
            activeCumulativeWork: this.activeCumulativeWork,
            utxoDigest: (0, digest_1.computeUtxoDigest)(utxos),
            utxos
        };
    }
}
exports.ChainExecutor = ChainExecutor;
function applyBlockOnView(view, block) {
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
function revertBlockOnView(view, block) {
    if (block.evaluation.rewardOutput !== null) {
        view.deleteUtxo(block.evaluation.rewardOutput.sourceId, constants_1.REWARD_OUTPUT_INDEX);
    }
    for (const output of (0, primitives_1.sortOutpointsCanonical)(block.evaluation.createdTxOutputs)) {
        view.deleteUtxo(output.sourceId, output.outputIndex);
    }
    for (const spent of block.evaluation.consumedOutpoints) {
        view.setUtxo(spent);
    }
}
