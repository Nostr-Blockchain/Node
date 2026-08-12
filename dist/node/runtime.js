"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NodeRuntime = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
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
const params_1 = require("../networks/params");
const fork_choice_1 = require("../chain/fork-choice");
const fetch_queue_1 = require("../nostr/fetch-queue");
const subscriptions_1 = require("../nostr/subscriptions");
const worker_1 = require("../mining/worker");
const provider_1 = require("../signer/provider");
const builder_1 = require("../wallet/builder");
const amounts_1 = require("../wallet/amounts");
const addresses_1 = require("../wallet/addresses");
const RELAY_LIST_KIND = 10002;
const MAX_RELAY_LIST_EVENTS = 256;
const MAX_REBROADCAST_CACHE = 4096;
const MAX_REBROADCAST_QUEUE = 512;
class NodeRuntime {
    config;
    lifecycle = new lifecycle_1.NodeLifecycle();
    cryptoProvider = new noble_provider_1.NobleCryptoProvider();
    chainExecutor = new chain_executor_1.ChainExecutor();
    relayManager;
    miningCoordinator;
    embeddedRelay;
    signer;
    signerProvider;
    store;
    chainIdHex = null;
    genesisParams = null;
    storedEvents = new Map();
    eventSequences = new Map();
    parsedTransactions = new Map();
    pendingBlockIds = new Set();
    invalidEventCodes = new Map();
    relayListEventsByPubkey = new Map();
    validMinerPubkeys = new Set();
    missingObjects = new fetch_queue_1.MissingObjectQueue();
    rebroadcastedEventIds = new Set();
    rebroadcastOrder = [];
    pendingRebroadcastQueue = [];
    persistenceEnabled = true;
    miningLoopRunning = false;
    constructor(config, signerSecretHex = null) {
        this.config = config;
        this.store = new node_store_1.NodeStore(config.databasePath, config.network);
        this.relayManager = new relay_manager_1.RelayManager(config.relays, {
            onEvent: (event, relayUrl) => this.receiveEvent(event, relayUrl),
            onNotice: () => undefined
        });
        this.embeddedRelay = config.embeddedRelayPort === null ? null : new embedded_relay_1.EmbeddedRelay({
            saveIncomingEvent: (event) => {
                this.receiveEvent(event, null);
                return { accepted: true, message: 'stored' };
            },
            query: (filters) => this.queryEvents(filters),
            getRelayInfo: () => this.getEmbeddedRelayInfo()
        });
        this.signer = signerSecretHex === null ? null : new signer_1.InMemorySigner(Buffer.from(signerSecretHex, 'hex'), this.cryptoProvider);
        this.signerProvider = signerSecretHex === null && config.signerType === 'local-ncryptsec' && config.signerPath !== null
            ? new provider_1.LocalSignerProvider(config.signerPath)
            : null;
        this.miningCoordinator = new coordinator_1.MiningCoordinator(config.miningEnabled, config.miningMode, config.miningWorkerCount);
    }
    static create(dataDir, network = 'mainnet', signerSecretHex = null) {
        return new NodeRuntime((0, config_1.createDefaultNodeConfig)(network, dataDir), signerSecretHex);
    }
    async start(genesisEvent) {
        this.lifecycle.transition('STARTING');
        node_fs_1.default.mkdirSync(this.config.dataDir, { recursive: true });
        const validatedGenesis = (0, nip01_1.validateNip01Event)(genesisEvent, constants_1.BLOCK_KIND, this.cryptoProvider, 'BLK');
        this.chainIdHex = validatedGenesis.id;
        this.genesisParams = (0, genesis_1.validateGenesisEvent)(validatedGenesis, this.cryptoProvider);
        const existingChainId = this.store.getMetaText('chain_id');
        if (existingChainId === null || existingChainId.length === 0) {
            this.chainExecutor = new chain_executor_1.ChainExecutor();
            this.chainExecutor.connectGenesis(validatedGenesis.id, validatedGenesis.created_at, this.genesisParams.powDifficulty, 0n);
            this.store.initializeChain(validatedGenesis.id, this.genesisParams.protocolVersion);
            const receivedSeq = this.store.nextReceivedSeq();
            this.store.persistEvent(validatedGenesis, 'nostr-blockchain:genesis', 'STRUCTURAL_VALID', null, receivedSeq);
            this.storedEvents.set(validatedGenesis.id, validatedGenesis);
            this.eventSequences.set(validatedGenesis.id, receivedSeq);
            this.store.persistBlockStructure((0, block_codec_1.parseBlockEvent)(validatedGenesis), {
                height: 0n,
                validationState: 'STATE_VALID',
                invalidCode: null,
                active: true,
                workDifficulty: this.genesisParams.powDifficulty,
                medianTimePast: validatedGenesis.created_at,
                creditedWork: 0n,
                cumulativeWork: 0n,
                totalBurn: 0n,
                totalPriority: 0n,
                rewardAmount: 0n,
                supplyAfter: 0n
            });
            this.store.persistRuntimeState(this.chainExecutor.snapshot(), this.chainExecutor.getActiveChainIds(), this.chainExecutor.getMempool().values());
        }
        else {
            this.store.validateChainBinding(validatedGenesis.id, this.genesisParams.protocolVersion);
            this.reindexFromStore(validatedGenesis);
            this.chainExecutor.revalidateMempool((txId) => !this.storedEvents.has(txId) || this.parsedTransactions.has(txId));
        }
        this.lifecycle.transition(existingChainId === null || existingChainId.length === 0 ? 'SYNCING' : 'RECOVERING');
        if (this.embeddedRelay !== null && this.config.embeddedRelayPort !== null) {
            await this.embeddedRelay.listen(this.config.embeddedRelayPort, this.config.embeddedRelayHost);
        }
        if (this.config.relays.length > 0) {
            await this.relayManager.connectAll();
            this.syncFromRelays();
        }
        this.lifecycle.transition(this.relayManager.getRemoteRelayUrls().length > 0 || this.config.relays.length === 0 ? 'READY' : 'DEGRADED');
        this.refreshMiningState();
    }
    async shutdown() {
        this.lifecycle.transition('SHUTTING_DOWN');
        if (this.embeddedRelay !== null) {
            await this.embeddedRelay.close();
        }
        await this.relayManager.closeAll();
        this.store.close();
        this.lifecycle.transition('STOPPED');
    }
    getStatus() {
        return {
            state: this.lifecycle.getState(),
            activeTip: this.chainExecutor.getActiveTip(),
            snapshot: this.chainExecutor.snapshot(),
            mining: this.miningCoordinator.getStatus(),
            chainId: this.chainIdHex,
            mempoolSize: this.chainExecutor.getMempool().size(),
            signerState: this.getSignerState()
        };
    }
    getChainIdHex() {
        if (this.chainIdHex === null) {
            throw new Error('runtime not started');
        }
        return this.chainIdHex;
    }
    verifyIntegrity() {
        return this.store.verifyIntegrity();
    }
    getMissingObjectCount() {
        return this.missingObjects.size();
    }
    receiveEvent(event, sourceRelayUrl = null) {
        try {
            this.acceptEvent(event, true, sourceRelayUrl);
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
        const relayListEvents = new Set([...this.relayListEventsByPubkey.values()].map((event) => event.id));
        const events = [...this.storedEvents.values()].filter((event) => event.kind !== RELAY_LIST_KIND || relayListEvents.has(event.id));
        const matched = events.filter((event) => filters.some((filter) => matchesFilter(event, filter)));
        const limit = filters.reduce((smallest, filter) => {
            if (filter.limit === undefined) {
                return smallest;
            }
            return smallest === null ? filter.limit : Math.min(smallest, filter.limit);
        }, null);
        return limit === null ? matched : matched.slice(0, limit);
    }
    publishEvent(event) {
        this.acceptEvent(event, true, null);
        this.queueRebroadcast(event, event.kind === constants_1.BLOCK_KIND ? 0 : 1, null);
        this.flushRebroadcastQueue();
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
    getSignerState() {
        if (this.signer !== null) {
            return 'UNLOCKED';
        }
        if (this.signerProvider === null) {
            return 'UNAVAILABLE';
        }
        return this.signerProvider.getState();
    }
    unlockSigner(password) {
        if (this.signerProvider === null) {
            throw new Error('BOOT_SIGNER_UNAVAILABLE');
        }
        const pubkey = this.signerProvider.unlock(password);
        this.refreshMiningState();
        return { state: this.getSignerState(), pubkey };
    }
    lockSigner() {
        this.signerProvider?.lock();
        this.miningCoordinator.invalidateGeneration();
        this.refreshMiningState();
    }
    refreshMiningState() {
        const pauseReason = this.deriveMiningPauseReason();
        this.miningCoordinator.setPauseReason(pauseReason);
        if (pauseReason === null) {
            void this.ensureMiningLoop();
            return;
        }
        this.miningCoordinator.invalidateGeneration();
    }
    getStoredEvents() {
        return [...this.storedEvents.values()];
    }
    syncKnownEvents(events) {
        for (const event of events) {
            this.acceptEvent(event, true, null);
        }
    }
    mineOne(createdAt) {
        const activeSigner = this.getActiveSigner();
        if (this.chainIdHex === null || this.genesisParams === null || activeSigner === null) {
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
        const networkParams = this.getActiveNetworkParams();
        const requiredDifficulty = (0, difficulty_1.calculateNextDifficulty)(networkParams, parentBlock.height + 1n, parentBlock, (blockId) => this.chainExecutor.getConnectedBlock(blockId));
        const candidateCreatedAt = createdAt ?? (0, difficulty_1.calculateCandidateTimestamp)(parentIdHex, Math.floor(Date.now() / 1000), (blockId) => this.chainExecutor.getConnectedBlock(blockId));
        let nonce = 0n;
        let unsignedWinner = this.buildUnsignedBlock(parentIdHex, this.chainIdHex, activeSigner.getPublicKeyHex(), selectedTxIds, candidateCreatedAt, nonce);
        while (!(0, worker_1.evaluateCandidatePow)({
            chainIdHex: this.chainIdHex,
            parentIdHex,
            eventIdHex: unsignedWinner.id,
            requiredDifficulty,
            fixedGateBits: networkParams.nip13GateBits,
            cacheWalkR1: networkParams.cacheWalkR1
        }).success) {
            nonce += 1n;
            unsignedWinner = this.buildUnsignedBlock(parentIdHex, this.chainIdHex, activeSigner.getPublicKeyHex(), selectedTxIds, candidateCreatedAt, nonce);
        }
        const event = {
            ...unsignedWinner,
            sig: activeSigner.signEventId(unsignedWinner.id)
        };
        this.acceptEvent(event, true, null);
        return event;
    }
    submitTransaction(event) {
        this.acceptEvent(event, true, null);
    }
    getWalletAddress() {
        const walletPubkeyHex = this.getWalletPubkeyHex();
        return {
            network: this.config.network,
            pubkey: walletPubkeyHex,
            npub: (0, addresses_1.toNpub)(walletPubkeyHex)
        };
    }
    getWalletBalanceSummary() {
        const walletPubkeyHex = this.getWalletPubkeyHex();
        const walletUtxos = this.chainExecutor.getUtxoView().listUtxosByOwner(Buffer.from(walletPubkeyHex, 'hex'));
        const candidateHeight = this.chainExecutor.getActiveHeight() + 1n;
        let confirmed = 0n;
        let spendable = 0n;
        let immatureReward = 0n;
        for (const utxo of walletUtxos) {
            confirmed += utxo.amount;
            if (!utxo.isReward || candidateHeight - utxo.createdHeight >= BigInt(this.getGenesisParams().rewardMaturity)) {
                spendable += utxo.amount;
            }
            else {
                immatureReward += utxo.amount;
            }
        }
        return {
            network: this.config.network,
            symbol: this.getActiveNetworkParams().displaySymbol,
            confirmed: (0, amounts_1.formatDecimalAmount)(confirmed),
            spendable: (0, amounts_1.formatDecimalAmount)(spendable),
            immatureReward: (0, amounts_1.formatDecimalAmount)(immatureReward),
            pending: '0.00000000'
        };
    }
    getWalletUtxos() {
        const walletPubkeyHex = this.getWalletPubkeyHex();
        const candidateHeight = this.chainExecutor.getActiveHeight() + 1n;
        return this.chainExecutor.getUtxoView().listUtxosByOwner(Buffer.from(walletPubkeyHex, 'hex')).map((utxo) => ({
            txid: Buffer.from(utxo.sourceId).toString('hex'),
            index: utxo.outputIndex,
            amount: utxo.amount.toString(10),
            displayAmount: (0, amounts_1.formatDecimalAmount)(utxo.amount),
            createdHeight: utxo.createdHeight.toString(10),
            isReward: utxo.isReward,
            spendable: !utxo.isReward || candidateHeight - utxo.createdHeight >= BigInt(this.getGenesisParams().rewardMaturity)
        }));
    }
    sendWalletPayment(to, amount, priorityFee) {
        const activeSigner = this.getActiveSigner();
        if (activeSigner === null) {
            throw new Error(this.getSignerState() === 'UNAVAILABLE' ? 'BOOT_SIGNER_UNAVAILABLE' : 'BOOT_SIGNER_LOCKED');
        }
        if (this.chainIdHex === null || this.genesisParams === null) {
            throw new Error('BOOT_SYNC_INCOMPLETE');
        }
        const buildResult = (0, builder_1.buildWalletTransaction)({
            signer: activeSigner,
            chainIdHex: this.chainIdHex,
            networkParams: this.getActiveNetworkParams(),
            walletUtxos: this.chainExecutor.getUtxoView().listUtxosByOwner(Buffer.from(activeSigner.getPublicKeyHex(), 'hex')),
            candidateHeight: this.chainExecutor.getActiveHeight() + 1n,
            createdAt: Math.floor(Date.now() / 1000),
            recipientText: to,
            amountText: amount,
            priorityFeeText: priorityFee,
            view: this.chainExecutor.getUtxoView()
        });
        this.submitTransaction(buildResult.event);
        return {
            eventId: buildResult.event.id,
            to: buildResult.recipientPubkeyHex,
            amount,
            minimumBurn: (0, amounts_1.formatDecimalAmount)(buildResult.selection.minimumBurn),
            actualFee: (0, amounts_1.formatDecimalAmount)(buildResult.actualFee),
            actualPriorityFee: (0, amounts_1.formatDecimalAmount)(buildResult.selection.actualPriorityFee),
            change: (0, amounts_1.formatDecimalAmount)(buildResult.selection.changeAmount)
        };
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
            stateHash: current.utxoDigest,
            replayBestTips: replay.bestTips,
            replayPending: replay.pending,
            replaySnapshot: replay.snapshot
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
        const replayDataDir = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'nostr-blockchain-replay-'));
        const runtime = new NodeRuntime({ ...this.config, dataDir: replayDataDir, relays: [], embeddedRelayPort: null, embeddedRelayListen: null, databasePath: node_path_1.default.join(replayDataDir, 'chain.sqlite') }, this.signer === null ? null : '01'.repeat(32));
        try {
            runtime.persistenceEnabled = false;
            runtime.chainIdHex = this.chainIdHex;
            runtime.genesisParams = this.genesisParams;
            runtime.chainExecutor.connectGenesis(genesis.id, genesis.created_at, this.genesisParams.powDifficulty, 0n);
            runtime.storedEvents.set(genesis.id, genesis);
            for (const event of events) {
                if (event.id === genesis.id) {
                    continue;
                }
                runtime.acceptEvent(event, false, null);
            }
            return {
                snapshot: runtime.chainExecutor.snapshot(),
                bestTips: runtime.chainExecutor.listStateValidTips().filter((entry) => entry.height === runtime.chainExecutor.getActiveHeight()).map((entry) => entry.blockId).sort(),
                pending: [...runtime.pendingBlockIds].sort()
            };
        }
        finally {
            runtime.store.close();
            node_fs_1.default.rmSync(replayDataDir, { recursive: true, force: true });
        }
    }
    syncFromRelays() {
        if (this.chainIdHex === null) {
            return;
        }
        const scope = (0, constants_1.makeChainScope)(this.chainIdHex);
        this.relayManager.subscribe(`live-${Date.now()}`, (0, subscriptions_1.buildLiveBlockSubscription)(this.chainIdHex));
        this.relayManager.subscribe(`tips-${Date.now()}`, (0, subscriptions_1.buildRecentTipProbe)(this.chainIdHex));
        this.relayManager.subscribe(`tx-live-${Date.now()}`, [{ kinds: [constants_1.TX_KIND], '#t': [scope] }]);
    }
    reindexFromStore(genesisEvent) {
        const rememberedActiveTip = this.store.getMetaText('active_tip');
        this.chainExecutor = new chain_executor_1.ChainExecutor();
        this.chainExecutor.connectGenesis(genesisEvent.id, genesisEvent.created_at, this.genesisParams.powDifficulty, 0n);
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
            this.acceptEvent(record.event, false, null);
        }
        const chosenTip = (0, fork_choice_1.choosePreferredTip)(this.chainExecutor.listStateValidTips(), rememberedActiveTip);
        if (chosenTip !== null && chosenTip.blockId !== this.chainExecutor.getActiveTip()) {
            this.chainExecutor.activateBranch(chosenTip.blockId);
        }
        this.persistRuntimeState();
    }
    acceptEvent(event, persist, sourceRelayUrl) {
        if (this.chainIdHex === null || this.genesisParams === null) {
            throw new Error('runtime not started');
        }
        if (this.storedEvents.has(event.id)) {
            return;
        }
        if (event.kind === RELAY_LIST_KIND) {
            this.acceptRelayListEvent(event, persist);
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
            const admitted = this.tryAddToMempool(parsed, receivedSeq);
            if (admitted) {
                this.queueRebroadcast(validated, 1, sourceRelayUrl);
            }
            this.processPendingBlocks();
            this.flushRebroadcastQueue();
            this.persistRuntimeState();
            this.refreshMiningState();
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
                this.store.persistBlockStructure(parsed, {
                    height: null,
                    validationState: 'STRUCTURAL_VALID',
                    invalidCode: null,
                    active: false,
                    workDifficulty: null,
                    medianTimePast: null,
                    creditedWork: null,
                    cumulativeWork: null,
                    totalBurn: null,
                    totalPriority: null,
                    rewardAmount: null,
                    supplyAfter: null
                });
            }
            if (!this.tryValidateAndRecordBlock(validated, persist, sourceRelayUrl)) {
                this.pendingBlockIds.add(validated.id);
                this.queueMissingDependencies(parsed, receivedSeq, sourceRelayUrl);
            }
            this.processPendingBlocks();
            this.flushRebroadcastQueue();
            this.persistRuntimeState();
            this.refreshMiningState();
        }
    }
    acceptRelayListEvent(event, persist) {
        const validated = (0, nip01_1.validateNip01Event)(event, RELAY_LIST_KIND, this.cryptoProvider, 'TX');
        if (!this.validMinerPubkeys.has(validated.pubkey)) {
            return;
        }
        const existing = this.relayListEventsByPubkey.get(validated.pubkey);
        if (existing !== undefined && existing.created_at > validated.created_at) {
            return;
        }
        const receivedSeq = persist ? this.store.nextReceivedSeq() : (this.eventSequences.get(event.id) ?? 0n);
        this.storedEvents.set(validated.id, validated);
        this.eventSequences.set(validated.id, receivedSeq);
        this.relayListEventsByPubkey.set(validated.pubkey, validated);
        if (persist) {
            this.store.persistEvent(validated, 'nostr:relay-list', 'STRUCTURAL_VALID', null, receivedSeq);
        }
        this.relayManager.ingestRelayListUrls(extractRelayListUrls(validated));
        this.enforceRelayListBounds();
    }
    recordInvalidIncomingEvent(event, error) {
        if (error instanceof errors_1.ClassifiedConsensusError && !error.cacheByEventId) {
            return;
        }
        const cacheKey = error instanceof errors_1.ClassifiedConsensusError ? (error.canonicalEventId ?? event.id) : event.id;
        this.invalidEventCodes.set(cacheKey, error.code);
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
    tryValidateAndRecordBlock(event, persist, sourceRelayUrl) {
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
        const medianTimePast = (0, difficulty_1.calculateMedianTimePast)(parentIdHex, (blockId) => this.chainExecutor.getConnectedBlock(blockId));
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
        const requiredDifficulty = (0, difficulty_1.calculateNextDifficulty)(this.getActiveNetworkParams(), candidateHeight, parentBlock, (blockId) => this.chainExecutor.getConnectedBlock(blockId));
        const evaluation = (0, block_validation_1.validateBlock)(event, this.chainIdHex, Buffer.from(parentIdHex, 'hex'), candidateHeight, this.genesisParams, transactions, parentView, this.cryptoProvider, {
            medianTimePast,
            localTime,
            requiredDifficulty,
            cacheWalkR1: this.getActiveNetworkParams().cacheWalkR1
        });
        const parentCumulativeWork = parentEntry.cumulativeWork ?? 0n;
        const connectedBlock = {
            blockId: event.id,
            parentId: parentIdHex,
            height: candidateHeight,
            createdAt: event.created_at,
            requiredDifficulty,
            blockWork: evaluation.blockWork,
            cumulativeWork: parentCumulativeWork + evaluation.blockWork,
            evaluation
        };
        const supplyBefore = this.chainExecutor.snapshot().totalSupply;
        this.chainExecutor.recordStateValidBlock(connectedBlock);
        this.chainExecutor.considerCandidateTip(event.id);
        this.validMinerPubkeys.add(event.pubkey);
        if (persist) {
            this.store.persistBlockStructure(parsedBlock, {
                height: candidateHeight,
                validationState: 'STATE_VALID',
                invalidCode: null,
                active: this.chainExecutor.getActiveTip() === event.id,
                workDifficulty: requiredDifficulty,
                medianTimePast,
                creditedWork: evaluation.blockWork,
                cumulativeWork: connectedBlock.cumulativeWork,
                totalBurn: evaluation.totalMinimumBurn,
                totalPriority: evaluation.totalPriorityFee,
                rewardAmount: evaluation.blockRewardAmount,
                supplyAfter: this.chainExecutor.snapshot().totalSupply
            });
            this.store.persistUndo(connectedBlock, supplyBefore);
        }
        this.rebuildMempool();
        for (const transaction of transactions) {
            this.missingObjects.remove(transaction.event.id);
        }
        this.missingObjects.remove(parentIdHex);
        this.relayManager.requestLatestRelayList(event.pubkey, sourceRelayUrl === null ? undefined : [sourceRelayUrl]);
        for (const transaction of transactions) {
            this.queueRebroadcast(transaction.event, 0, sourceRelayUrl);
        }
        this.queueRebroadcast(event, 0, sourceRelayUrl);
        return true;
    }
    async ensureMiningLoop() {
        if (this.miningLoopRunning) {
            return;
        }
        this.miningLoopRunning = true;
        try {
            while (true) {
                const pauseReason = this.deriveMiningPauseReason();
                this.miningCoordinator.setPauseReason(pauseReason);
                if (pauseReason !== null) {
                    return;
                }
                const activeSigner = this.getActiveSigner();
                if (activeSigner === null || this.chainIdHex === null || this.genesisParams === null) {
                    return;
                }
                const parentIdHex = this.chainExecutor.getActiveTip();
                if (parentIdHex === null) {
                    return;
                }
                const parentBlock = this.chainExecutor.getConnectedBlock(parentIdHex);
                if (parentBlock === null) {
                    return;
                }
                const selectedTxIds = (0, selection_1.selectTransactionsForBlock)(parentIdHex, this.chainExecutor.getMempool().values(), this.genesisParams).map((entry) => entry.txId);
                const networkParams = this.getActiveNetworkParams();
                const candidateHeight = parentBlock.height + 1n;
                const requiredDifficulty = (0, difficulty_1.calculateNextDifficulty)(networkParams, candidateHeight, parentBlock, (blockId) => this.chainExecutor.getConnectedBlock(blockId));
                const candidateCreatedAt = (0, difficulty_1.calculateCandidateTimestamp)(parentIdHex, Math.floor(Date.now() / 1000), (blockId) => this.chainExecutor.getConnectedBlock(blockId));
                const currentGeneration = this.chainExecutor.getMiningGeneration();
                const winner = await this.miningCoordinator.searchForWinner({
                    generation: currentGeneration,
                    chainIdHex: this.chainIdHex,
                    parentIdHex,
                    createdAt: candidateCreatedAt,
                    signer: activeSigner,
                    txIds: selectedTxIds,
                    requiredDifficulty,
                    networkParams
                });
                if (winner === null || winner.success !== true || winner.nonce === undefined) {
                    return;
                }
                if (currentGeneration !== this.chainExecutor.getMiningGeneration() || parentIdHex !== this.chainExecutor.getActiveTip()) {
                    continue;
                }
                const recomputedUnsignedBlock = this.buildUnsignedBlock(parentIdHex, this.chainIdHex, activeSigner.getPublicKeyHex(), selectedTxIds, candidateCreatedAt, BigInt(winner.nonce));
                const recomputedPow = (0, worker_1.evaluateCandidatePow)({
                    chainIdHex: this.chainIdHex,
                    parentIdHex,
                    eventIdHex: recomputedUnsignedBlock.id,
                    requiredDifficulty,
                    fixedGateBits: networkParams.nip13GateBits,
                    cacheWalkR1: networkParams.cacheWalkR1
                });
                if (!recomputedPow.success || recomputedUnsignedBlock.id !== winner.eventIdHex) {
                    continue;
                }
                const signedBlock = {
                    ...recomputedUnsignedBlock,
                    sig: activeSigner.signEventId(recomputedUnsignedBlock.id)
                };
                this.acceptEvent(signedBlock, true, null);
                if (this.miningCoordinator.getStatus().mode === 'mine-one') {
                    this.miningCoordinator.setMode('disabled');
                    this.miningCoordinator.setPauseReason('DISABLED');
                    return;
                }
            }
        }
        finally {
            this.miningLoopRunning = false;
        }
    }
    processPendingBlocks() {
        this.processMissingObjectQueue();
        let progressed = true;
        while (progressed) {
            progressed = false;
            for (const blockId of [...this.pendingBlockIds]) {
                const event = this.storedEvents.get(blockId);
                if (event !== undefined && this.tryValidateAndRecordBlock(event, false, null)) {
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
    getActiveNetworkParams() {
        const selectedNetworkParams = (0, params_1.getNetworkParams)(this.config.network);
        return Object.freeze({
            ...selectedNetworkParams,
            network: this.config.network,
            protocolVersion: this.genesisParams.protocolVersion,
            blockReward: this.genesisParams.blockReward,
            rewardMaturity: this.genesisParams.rewardMaturity,
            baseFee: this.genesisParams.baseFee,
            inputFee: this.genesisParams.inputFee,
            outputFee: this.genesisParams.outputFee,
            maxTxInputs: this.genesisParams.maxTxInputs,
            maxTxOutputs: this.genesisParams.maxTxOutputs,
            maxBlockTransactions: this.genesisParams.maxBlockTransactions,
            initialDifficultyBits: this.genesisParams.powDifficulty
        });
    }
    deriveMiningPauseReason() {
        if (!this.config.miningEnabled || this.miningCoordinator.getStatus().mode === 'disabled') {
            return 'DISABLED';
        }
        if (this.lifecycle.getState() !== 'READY') {
            return 'BOOT_SYNC_INCOMPLETE';
        }
        if (this.getSignerState() === 'UNAVAILABLE') {
            return 'BOOT_SIGNER_UNAVAILABLE';
        }
        if (this.getSignerState() !== 'UNLOCKED') {
            return 'BOOT_SIGNER_LOCKED';
        }
        const minimumRemoteWriteRelays = this.config.minRemoteWriteRelays ?? 1;
        if (this.relayManager.getRemoteWriteRelayCount() < minimumRemoteWriteRelays) {
            return 'NO_REMOTE_WRITE_RELAY';
        }
        if (this.verifyIntegrity() !== 'ok') {
            return 'STORAGE_CORRUPT';
        }
        const activeTip = this.chainExecutor.getActiveTip();
        if (activeTip !== null) {
            const candidateCreatedAt = (0, difficulty_1.calculateCandidateTimestamp)(activeTip, Math.floor(Date.now() / 1000), (blockId) => this.chainExecutor.getConnectedBlock(blockId));
            if (candidateCreatedAt > Math.floor(Date.now() / 1000) + 120) {
                return 'CLOCK_BEHIND_CHAIN';
            }
        }
        return null;
    }
    getActiveSigner() {
        if (this.signer !== null) {
            return this.signer;
        }
        const unlockedSigner = this.signerProvider?.getUnlockedSigner();
        return unlockedSigner instanceof signer_1.InMemorySigner ? unlockedSigner : null;
    }
    getWalletPubkeyHex() {
        const activeSigner = this.getActiveSigner();
        if (activeSigner !== null) {
            return activeSigner.getPublicKeyHex();
        }
        if (typeof this.config.signerPubkey === 'string' && this.config.signerPubkey.length === 64) {
            return this.config.signerPubkey;
        }
        throw new Error('BOOT_SIGNER_UNAVAILABLE');
    }
    buildUnsignedBlock(parentIdHex, chainIdHex, pubkeyHex, txIds, createdAt, nonce) {
        const unsignedEvent = {
            pubkey: pubkeyHex,
            created_at: createdAt,
            kind: 7343,
            tags: (0, block_codec_1.buildBlockTags)(chainIdHex, parentIdHex, [...txIds], nonce),
            content: '00'
        };
        return {
            ...unsignedEvent,
            id: (0, nip01_1.computeEventId)(unsignedEvent)
        };
    }
    isActiveTipTransaction(txId) {
        const activeTip = this.chainExecutor.getActiveTip();
        if (activeTip === null) {
            return false;
        }
        return this.chainExecutor.getConnectedBlock(activeTip)?.evaluation.txEvaluations.some((candidate) => candidate.parsed.event.id === txId) === true;
    }
    persistRuntimeState() {
        if (!this.persistenceEnabled) {
            return;
        }
        this.store.persistRuntimeState(this.chainExecutor.snapshot(), this.chainExecutor.getActiveChainIds(), this.chainExecutor.getMempool().values());
    }
    getEmbeddedRelayInfo() {
        return {
            name: 'nostr-blockchain-embedded-relay',
            description: 'Restricted archival relay for Nostr Blockchain v0',
            software: 'nostr-blockchain',
            supported_nips: [1, 11, 65],
            limitation: {
                max_message_length: 65_536,
                max_subscriptions: 64,
                max_filters: 4,
                max_limit: 2048
            },
            nostr_blockchain: {
                network: this.config.network,
                chain_id: this.chainIdHex,
                protocol_version: this.genesisParams?.protocolVersion ?? 0,
                full_history: true
            }
        };
    }
    queueMissingDependencies(parsedBlock, receivedSeq, sourceRelayUrl) {
        if (parsedBlock.parentId !== null) {
            const parentIdHex = Buffer.from(parsedBlock.parentId).toString('hex');
            if (!this.storedEvents.has(parentIdHex)) {
                this.missingObjects.add({ objectId: parentIdHex, objectType: 'block', firstSeenSeq: receivedSeq, attempts: 0, nextRetryMs: null, sourceRelayUrl });
            }
        }
        for (const txIdBytes of parsedBlock.txIds) {
            const txIdHex = Buffer.from(txIdBytes).toString('hex');
            if (!this.parsedTransactions.has(txIdHex)) {
                this.missingObjects.add({ objectId: txIdHex, objectType: 'tx', firstSeenSeq: receivedSeq, attempts: 0, nextRetryMs: null, sourceRelayUrl });
            }
        }
    }
    processMissingObjectQueue() {
        const nowMs = Date.now();
        const remoteRelayUrls = this.relayManager.getRemoteRelayUrls();
        for (const request of this.missingObjects.listDue(nowMs)) {
            const orderedRelayUrls = request.sourceRelayUrl === null
                ? remoteRelayUrls.slice(0, 3)
                : [request.sourceRelayUrl, ...remoteRelayUrls.filter((relayUrl) => relayUrl !== request.sourceRelayUrl).slice(0, 3)];
            if (orderedRelayUrls.length === 0) {
                continue;
            }
            this.relayManager.requestExactEventIds((0, subscriptions_1.buildExactEventFetch)(`${request.objectType}-${request.objectId}-${request.attempts}`, [request.objectId]), orderedRelayUrls);
            this.missingObjects.markAttempt(request.objectId, nowMs);
        }
    }
    queueRebroadcast(event, priority, excludeRelayUrl) {
        if (this.rebroadcastedEventIds.has(event.id) || this.pendingRebroadcastQueue.some((entry) => entry.event.id === event.id)) {
            return;
        }
        this.pendingRebroadcastQueue.push({ event, priority, excludeRelayUrl });
        this.pendingRebroadcastQueue.sort((left, right) => left.priority - right.priority);
        while (this.pendingRebroadcastQueue.length > MAX_REBROADCAST_QUEUE) {
            this.pendingRebroadcastQueue.pop();
        }
    }
    flushRebroadcastQueue() {
        const remoteWritableRelayUrls = this.relayManager.getRemoteWritableRelayUrls();
        if (remoteWritableRelayUrls.length === 0) {
            return;
        }
        while (this.pendingRebroadcastQueue.length > 0) {
            const next = this.pendingRebroadcastQueue.shift();
            if (next === undefined || this.rebroadcastedEventIds.has(next.event.id)) {
                continue;
            }
            this.relayManager.publishEvent(next.event, { excludeRelayUrl: next.excludeRelayUrl, relayUrls: remoteWritableRelayUrls });
            this.rememberRebroadcast(next.event.id);
        }
    }
    rememberRebroadcast(eventId) {
        if (this.rebroadcastedEventIds.has(eventId)) {
            return;
        }
        this.rebroadcastedEventIds.add(eventId);
        this.rebroadcastOrder.push(eventId);
        while (this.rebroadcastOrder.length > MAX_REBROADCAST_CACHE) {
            const removedEventId = this.rebroadcastOrder.shift();
            if (removedEventId !== undefined) {
                this.rebroadcastedEventIds.delete(removedEventId);
            }
        }
    }
    enforceRelayListBounds() {
        while (this.relayListEventsByPubkey.size > MAX_RELAY_LIST_EVENTS) {
            const oldestPubkey = this.relayListEventsByPubkey.keys().next().value;
            if (typeof oldestPubkey !== 'string') {
                break;
            }
            this.relayListEventsByPubkey.delete(oldestPubkey);
        }
    }
}
exports.NodeRuntime = NodeRuntime;
function matchesFilter(event, filter) {
    if (Array.isArray(filter.ids) && !filter.ids.includes(event.id)) {
        return false;
    }
    if (Array.isArray(filter.authors) && !filter.authors.includes(event.pubkey)) {
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
function extractRelayListUrls(event) {
    return event.tags
        .filter((tag) => tag[0] === 'r' && typeof tag[1] === 'string' && tag[1].startsWith('wss://'))
        .map((tag) => tag[1]);
}
