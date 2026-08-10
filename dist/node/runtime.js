"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NodeRuntime = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const noble_provider_1 = require("../crypto/noble-provider");
const constants_1 = require("../consensus/constants");
const errors_1 = require("../consensus/errors");
const genesis_1 = require("../consensus/genesis");
const nip01_1 = require("../consensus/nip01");
const chain_executor_1 = require("../chain/chain-executor");
const config_1 = require("./config");
const lifecycle_1 = require("./lifecycle");
const relay_manager_1 = require("../nostr/relay-manager");
const embedded_relay_1 = require("../nostr/embedded-relay");
const signer_1 = require("../mining/signer");
const coordinator_1 = require("../mining/coordinator");
const block_validation_1 = require("../consensus/block-validation");
const transaction_codec_1 = require("../consensus/transaction-codec");
const transaction_validation_1 = require("../consensus/transaction-validation");
const block_codec_1 = require("../consensus/block-codec");
const node_store_1 = require("../storage/node-store");
const selection_1 = require("../mempool/selection");
const difficulty_1 = require("../consensus/difficulty");
class NodeRuntime {
    config;
    lifecycle = new lifecycle_1.NodeLifecycle();
    cryptoProvider = new noble_provider_1.NobleCryptoProvider();
    chainExecutor = new chain_executor_1.ChainExecutor();
    relayManager;
    miningCoordinator;
    embeddedRelay;
    signer;
    store;
    chainIdHex = null;
    genesisParams = null;
    storedEvents = new Map();
    eventSequences = new Map();
    parsedTransactions = new Map();
    pendingBlockIds = new Set();
    invalidEventCodes = new Map();
    constructor(config, signerSecretHex = null) {
        this.config = config;
        this.store = new node_store_1.NodeStore(config.databasePath);
        this.relayManager = new relay_manager_1.RelayManager(config.relays, {
            onEvent: (event) => this.receiveEvent(event),
            onNotice: () => undefined
        });
        this.embeddedRelay = config.embeddedRelayPort === null ? null : new embedded_relay_1.EmbeddedRelay({
            saveIncomingEvent: (event) => {
                this.receiveEvent(event);
                return { accepted: true, message: 'stored' };
            },
            query: (filters) => this.queryEvents(filters)
        });
        this.signer = signerSecretHex === null ? null : new signer_1.InMemorySigner(Buffer.from(signerSecretHex, 'hex'), this.cryptoProvider);
        this.miningCoordinator = new coordinator_1.MiningCoordinator(config.miningEnabled, config.miningMode, config.miningWorkerCount);
    }
    static create(dataDir, signerSecretHex = null) {
        return new NodeRuntime((0, config_1.createDefaultNodeConfig)(dataDir), signerSecretHex);
    }
    async start(genesisEvent) {
        this.lifecycle.transition('STARTING');
        node_fs_1.default.mkdirSync(this.config.dataDir, { recursive: true });
        const validatedGenesis = (0, nip01_1.validateNip01Event)(genesisEvent, constants_1.BLOCK_KIND, this.cryptoProvider, 'BLK');
        this.chainIdHex = validatedGenesis.id;
        this.genesisParams = (0, genesis_1.validateGenesisEvent)(validatedGenesis, this.cryptoProvider);
        const genesisWork = (0, difficulty_1.computeBlockWork)(this.genesisParams.initialPowTarget);
        const existingChainId = this.store.getMetaText('chain_id');
        if (existingChainId === null || existingChainId.length === 0) {
            this.chainExecutor = new chain_executor_1.ChainExecutor();
            this.chainExecutor.connectGenesis(validatedGenesis.id, validatedGenesis.created_at, this.genesisParams.initialPowTarget, genesisWork);
            this.store.initializeChain(validatedGenesis.id, this.genesisParams.protocolVersion);
            const receivedSeq = this.store.nextReceivedSeq();
            this.store.persistEvent(validatedGenesis, 'nostr-blockchain:genesis', 'STRUCTURAL_VALID', null, receivedSeq);
            this.storedEvents.set(validatedGenesis.id, validatedGenesis);
            this.eventSequences.set(validatedGenesis.id, receivedSeq);
            this.store.persistBlockStructure((0, block_codec_1.parseBlockEvent)(validatedGenesis), 'STATE_VALID', 0n, null);
            this.store.persistDerivedState(this.chainExecutor.snapshot(), this.chainExecutor.getActiveChainIds());
        }
        else {
            if (existingChainId !== validatedGenesis.id) {
                throw new Error('stored genesis binding does not match selected genesis');
            }
            this.reindexFromStore(validatedGenesis);
            this.chainExecutor.revalidateMempool((txId) => !this.storedEvents.has(txId) || this.parsedTransactions.has(txId));
        }
        this.lifecycle.transition('SYNCING');
        if (this.config.relays.length > 0) {
            await this.relayManager.connectAll();
            this.syncFromRelays();
        }
        if (this.embeddedRelay !== null && this.config.embeddedRelayPort !== null) {
            await this.embeddedRelay.listen(this.config.embeddedRelayPort);
        }
        this.lifecycle.transition('READY');
        this.autoMineIfConfigured();
    }
    async shutdown() {
        this.lifecycle.transition('SHUTTING_DOWN');
        if (this.embeddedRelay !== null) {
            await this.embeddedRelay.close();
        }
        await this.relayManager.closeAll();
        this.store.close();
    }
    getStatus() {
        return {
            state: this.lifecycle.getState(),
            activeTip: this.chainExecutor.getActiveTip(),
            snapshot: this.chainExecutor.snapshot(),
            mining: this.miningCoordinator.getStatus(),
            chainId: this.chainIdHex,
            mempoolSize: this.chainExecutor.getMempool().size()
        };
    }
    receiveEvent(event) {
        try {
            this.acceptEvent(event, true);
        }
        catch (error) {
            if (error instanceof errors_1.ConsensusError) {
                this.recordInvalidIncomingEvent(event, error);
                return;
            }
            throw error;
        }
    }
    queryEvents(filters) {
        const events = [...this.storedEvents.values()];
        return events.filter((event) => filters.some((filter) => matchesFilter(event, filter)));
    }
    publishEvent(event) {
        this.acceptEvent(event, true);
        this.relayManager.publishEvent(event);
    }
    getGenesisParams() {
        if (this.genesisParams === null) {
            throw new Error('runtime not started');
        }
        return this.genesisParams;
    }
    getSigner() {
        if (this.signer === null) {
            throw new Error('no signer configured');
        }
        return this.signer;
    }
    getStoredEvents() {
        return [...this.storedEvents.values()];
    }
    syncKnownEvents(events) {
        for (const event of events) {
            this.acceptEvent(event, true);
        }
    }
    mineOne(createdAt = 1_700_000_000) {
        if (this.chainIdHex === null || this.genesisParams === null || this.signer === null) {
            throw new Error('runtime not ready for mining');
        }
        const parentIdHex = this.chainExecutor.getActiveTip();
        if (parentIdHex === null) {
            throw new Error('missing active tip');
        }
        const parentBlock = this.chainExecutor.getConnectedBlock(parentIdHex);
        if (parentBlock === null) {
            throw new Error('missing parent block');
        }
        const selectedTxIds = (0, selection_1.selectTransactionsForBlock)(parentIdHex, this.chainExecutor.getMempool().values(), this.genesisParams).map((entry) => entry.txId);
        const unsignedWinner = this.miningCoordinator.buildUnsignedWinningBlock(parentIdHex, this.chainIdHex, this.genesisParams, this.signer, selectedTxIds, this.getGenesisCreatedAt(), parentBlock.createdAt, parentBlock.height + 1n, createdAt);
        const event = {
            ...unsignedWinner,
            sig: this.signer.signEventId(unsignedWinner.id)
        };
        this.acceptEvent(event, true);
        return event;
    }
    submitTransaction(event) {
        this.acceptEvent(event, true);
    }
    listUtxos(pubkeyHex) {
        return this.chainExecutor.getUtxoView().listUtxosByOwner(Buffer.from(pubkeyHex, 'hex')).map((utxo) => ({
            txid: Buffer.from(utxo.sourceId).toString('hex'),
            index: utxo.outputIndex,
            amount: utxo.amount.toString(10),
            createdHeight: utxo.createdHeight.toString(10),
            isReward: utxo.isReward
        }));
    }
    getBalance(pubkeyHex) {
        return this.chainExecutor.getUtxoView().listUtxosByOwner(Buffer.from(pubkeyHex, 'hex')).reduce((sum, utxo) => sum + utxo.amount, 0n);
    }
    getInvalidEventCodes() {
        return this.invalidEventCodes;
    }
    getMempoolTransactions() {
        return this.chainExecutor.getMempool().values().map((entry) => entry.txId);
    }
    verify() {
        const integrity = this.store.verifyIntegrity();
        const replay = this.replayFromEvents(this.store.loadStoredEvents().map((entry) => entry.event));
        const current = this.chainExecutor.snapshot();
        return {
            integrity,
            matchesReplay: integrity === 'ok' && replay.snapshot.utxoDigest === current.utxoDigest && replay.snapshot.activeTip === current.activeTip && replay.snapshot.activeCumulativeWork === current.activeCumulativeWork,
            activeTip: current.activeTip,
            stateHash: current.utxoDigest
        };
    }
    reindex() {
        if (this.chainIdHex === null) {
            throw new Error('runtime not started');
        }
        const genesis = this.storedEvents.get(this.chainIdHex);
        if (genesis === undefined) {
            throw new Error('missing stored genesis');
        }
        this.store.clearDerivedState();
        this.reindexFromStore(genesis);
    }
    replayFromEvents(events) {
        if (this.chainIdHex === null) {
            throw new Error('runtime not started');
        }
        const genesis = events.find((event) => event.id === this.chainIdHex);
        if (genesis === undefined) {
            throw new Error('replay set missing genesis');
        }
        const runtime = new NodeRuntime({ ...this.config, relays: [], embeddedRelayPort: null, databasePath: `${this.config.databasePath}.replay` }, this.signer === null ? null : '01'.repeat(32));
        runtime.chainIdHex = this.chainIdHex;
        runtime.genesisParams = this.genesisParams;
        runtime.chainExecutor.connectGenesis(genesis.id, genesis.created_at, this.genesisParams.initialPowTarget, (0, difficulty_1.computeBlockWork)(this.genesisParams.initialPowTarget));
        runtime.storedEvents.set(genesis.id, genesis);
        for (const event of events) {
            if (event.id === genesis.id) {
                continue;
            }
            runtime.acceptEvent(event, false);
        }
        runtime.store.close();
        return {
            snapshot: runtime.chainExecutor.snapshot(),
            bestTips: runtime.chainExecutor.listStateValidTips().filter((entry) => entry.height === runtime.chainExecutor.getActiveHeight()).map((entry) => entry.blockId).sort(),
            pending: [...runtime.pendingBlockIds].sort()
        };
    }
    syncFromRelays() {
        if (this.chainIdHex === null) {
            return;
        }
        const scope = (0, constants_1.makeChainScope)(this.chainIdHex);
        this.relayManager.subscribe(`sync-${Date.now()}`, [{ kinds: [constants_1.BLOCK_KIND], '#t': [scope] }, { kinds: [constants_1.TX_KIND], '#t': [scope] }]);
    }
    reindexFromStore(genesisEvent) {
        this.chainExecutor = new chain_executor_1.ChainExecutor();
        this.chainExecutor.connectGenesis(genesisEvent.id, genesisEvent.created_at, this.genesisParams.initialPowTarget, (0, difficulty_1.computeBlockWork)(this.genesisParams.initialPowTarget));
        this.storedEvents.clear();
        this.eventSequences.clear();
        this.parsedTransactions.clear();
        this.pendingBlockIds.clear();
        const stored = this.store.loadStoredEvents();
        this.storedEvents.set(genesisEvent.id, genesisEvent);
        const genesisRecord = stored.find((record) => record.event.id === genesisEvent.id);
        if (genesisRecord !== undefined) {
            this.eventSequences.set(genesisEvent.id, genesisRecord.receivedSeq);
        }
        for (const record of stored) {
            if (record.event.id === genesisEvent.id) {
                continue;
            }
            this.eventSequences.set(record.event.id, record.receivedSeq);
            this.acceptEvent(record.event, false);
        }
        this.persistRuntimeState();
    }
    autoMineIfConfigured() {
        if (this.lifecycle.getState() !== 'READY') {
            return;
        }
        const miningStatus = this.miningCoordinator.getStatus();
        if (!miningStatus.enabled || miningStatus.mode !== 'continuous' || this.signer === null) {
            return;
        }
        this.mineOne();
    }
    acceptEvent(event, persist) {
        if (this.chainIdHex === null || this.genesisParams === null) {
            throw new Error('runtime not started');
        }
        if (this.storedEvents.has(event.id)) {
            return;
        }
        if (event.kind === constants_1.TX_KIND) {
            const validated = (0, nip01_1.validateNip01Event)(event, constants_1.TX_KIND, this.cryptoProvider, 'TX');
            const parsed = (0, transaction_codec_1.parseTransactionEvent)(validated, this.chainIdHex);
            const receivedSeq = persist ? this.store.nextReceivedSeq() : (this.eventSequences.get(event.id) ?? 0n);
            this.storedEvents.set(validated.id, validated);
            this.eventSequences.set(validated.id, receivedSeq);
            this.parsedTransactions.set(validated.id, parsed);
            if (persist) {
                this.store.persistEvent(validated, (0, constants_1.makeChainScope)(this.chainIdHex), 'STRUCTURAL_VALID', null, receivedSeq);
                this.store.persistTransaction(parsed);
            }
            this.tryAddToMempool(parsed, receivedSeq);
            this.processPendingBlocks();
            this.persistRuntimeState();
            return;
        }
        if (event.kind === constants_1.BLOCK_KIND) {
            const validated = (0, nip01_1.validateNip01Event)(event, constants_1.BLOCK_KIND, this.cryptoProvider, 'BLK');
            const parsed = (0, block_codec_1.parseBlockEvent)(validated, validated.tags[0]?.[1] === 'nostr-blockchain:genesis' ? undefined : this.chainIdHex);
            const receivedSeq = persist ? this.store.nextReceivedSeq() : (this.eventSequences.get(event.id) ?? 0n);
            this.storedEvents.set(validated.id, validated);
            this.eventSequences.set(validated.id, receivedSeq);
            if (persist) {
                this.store.persistEvent(validated, parsed.isGenesis ? 'nostr-blockchain:genesis' : (0, constants_1.makeChainScope)(this.chainIdHex), 'STRUCTURAL_VALID', null, receivedSeq);
            }
            if (parsed.isGenesis) {
                return;
            }
            if (persist) {
                this.store.persistBlockStructure(parsed, 'STRUCTURAL_VALID', null, null);
            }
            if (!this.tryValidateAndRecordBlock(validated, persist)) {
                this.pendingBlockIds.add(validated.id);
            }
            this.processPendingBlocks();
            this.persistRuntimeState();
        }
    }
    recordInvalidIncomingEvent(event, error) {
        this.invalidEventCodes.set(event.id, error.code);
    }
    tryAddToMempool(parsed, receivedSeq) {
        try {
            const evaluation = this.validateAgainstActiveView(parsed);
            this.chainExecutor.getMempool().add({ txId: parsed.event.id, transaction: parsed, evaluation, receivedSeq });
            return true;
        }
        catch (error) {
            if (error instanceof Error) {
                this.invalidEventCodes.set(parsed.event.id, error.message);
            }
            return false;
        }
    }
    tryValidateAndRecordBlock(event, persist) {
        const parsedBlock = (0, block_codec_1.parseBlockEvent)(event, this.chainIdHex);
        const parentIdHex = Buffer.from(parsedBlock.parentId).toString('hex');
        const parentEntry = this.chainExecutor.getBlockIndexEntry(parentIdHex);
        if (parentEntry === null || parentEntry.height === null) {
            return false;
        }
        const parentBlock = this.chainExecutor.getConnectedBlock(parentIdHex);
        if (parentBlock === null) {
            return false;
        }
        const medianTimePast = this.computeMedianTimePast(parentIdHex);
        const localTime = Math.floor(Date.now() / 1000);
        if (event.created_at > localTime + 120) {
            return false;
        }
        const transactions = [];
        for (const txIdBytes of parsedBlock.txIds) {
            const txIdHex = Buffer.from(txIdBytes).toString('hex');
            const parsed = this.parsedTransactions.get(txIdHex);
            if (parsed === undefined) {
                return false;
            }
            transactions.push(parsed);
        }
        const parentView = this.chainExecutor.buildViewForParent(parentIdHex);
        const candidateHeight = parentEntry.height + 1n;
        const requiredTarget = (0, difficulty_1.computeRequiredTarget)(this.genesisParams, this.getGenesisCreatedAt(), parentBlock.createdAt, candidateHeight);
        const evaluation = (0, block_validation_1.validateBlock)(event, this.chainIdHex, Buffer.from(parentIdHex, 'hex'), candidateHeight, this.genesisParams, transactions, parentView, this.cryptoProvider, {
            medianTimePast,
            localTime,
            requiredTarget
        });
        const parentCumulativeWork = parentEntry.cumulativeWork ?? 0n;
        const connectedBlock = {
            blockId: event.id,
            parentId: parentIdHex,
            height: candidateHeight,
            createdAt: event.created_at,
            requiredTarget,
            blockWork: evaluation.blockWork,
            cumulativeWork: parentCumulativeWork + evaluation.blockWork,
            evaluation
        };
        this.chainExecutor.recordStateValidBlock(connectedBlock);
        this.chainExecutor.considerCandidateTip(event.id);
        if (persist) {
            this.store.persistBlockStructure(parsedBlock, 'STATE_VALID', candidateHeight, null);
            this.store.persistUndo(connectedBlock);
        }
        this.rebuildMempool();
        return true;
    }
    processPendingBlocks() {
        let progressed = true;
        while (progressed) {
            progressed = false;
            for (const blockId of [...this.pendingBlockIds]) {
                const event = this.storedEvents.get(blockId);
                if (event !== undefined && this.tryValidateAndRecordBlock(event, false)) {
                    this.pendingBlockIds.delete(blockId);
                    progressed = true;
                }
            }
        }
    }
    rebuildMempool() {
        const entries = [];
        for (const [txId, parsed] of this.parsedTransactions.entries()) {
            const receivedSeq = this.eventSequences.get(txId) ?? 0n;
            try {
                const evaluation = this.validateAgainstActiveView(parsed);
                if (!this.isActiveTipTransaction(txId)) {
                    entries.push({ txId, transaction: parsed, evaluation, receivedSeq });
                }
            }
            catch {
                continue;
            }
        }
        this.chainExecutor.getMempool().replace(entries);
    }
    validateAgainstActiveView(parsed) {
        return (0, transaction_validation_1.validateParsedTransaction)(parsed, this.chainExecutor.getActiveHeight() + 1n, this.genesisParams, this.cryptoProvider, this.chainExecutor.getUtxoView());
    }
    getGenesisCreatedAt() {
        if (this.chainIdHex === null) {
            throw new Error('runtime not started');
        }
        const genesis = this.storedEvents.get(this.chainIdHex);
        if (genesis === undefined) {
            throw new Error('missing genesis');
        }
        return genesis.created_at;
    }
    computeMedianTimePast(parentIdHex) {
        const timestamps = [];
        let cursor = parentIdHex;
        while (cursor !== null && timestamps.length < 11) {
            const block = this.chainExecutor.getConnectedBlock(cursor);
            if (block === null) {
                break;
            }
            timestamps.push(block.createdAt);
            cursor = block.parentId;
        }
        timestamps.sort((left, right) => left - right);
        return timestamps[(timestamps.length - 1) >> 1] ?? 0;
    }
    isActiveTipTransaction(txId) {
        const activeTip = this.chainExecutor.getActiveTip();
        if (activeTip === null) {
            return false;
        }
        return this.chainExecutor.getConnectedBlock(activeTip)?.evaluation.txEvaluations.some((candidate) => candidate.parsed.event.id === txId) === true;
    }
    persistRuntimeState() {
        this.store.persistDerivedState(this.chainExecutor.snapshot(), this.chainExecutor.getActiveChainIds());
        this.store.persistMempool(this.chainExecutor.getMempool().values().map((entry) => ({
            txId: entry.txId,
            actualFee: entry.evaluation.actualFee,
            minimumBurn: entry.evaluation.minimumBurn,
            priorityFee: entry.evaluation.priorityFee,
            receivedSeq: entry.receivedSeq,
            inputs: entry.evaluation.consumedOutpoints.map((utxo) => ({ sourceId: utxo.sourceId, outputIndex: utxo.outputIndex }))
        })));
    }
}
exports.NodeRuntime = NodeRuntime;
function matchesFilter(event, filter) {
    if (Array.isArray(filter.ids) && !filter.ids.includes(event.id)) {
        return false;
    }
    if (Array.isArray(filter.kinds) && !filter.kinds.includes(event.kind)) {
        return false;
    }
    const scopeValues = filter['#t'];
    if (Array.isArray(scopeValues)) {
        const chainTag = event.tags.find((tag) => tag[0] === 't')?.[1];
        if (chainTag === undefined || !scopeValues.includes(chainTag)) {
            return false;
        }
    }
    return true;
}
