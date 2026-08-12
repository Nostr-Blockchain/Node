import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { NobleCryptoProvider } from '../crypto/noble-provider';
import { BLOCK_KIND, TX_KIND, makeChainScope } from '../consensus/constants';
import { ClassifiedConsensusError, ConsensusError } from '../consensus/errors';
import { validateGenesisEvent, GenesisParams } from '../consensus/genesis';
import { computeEventId, NostrEvent, validateNip01Event } from '../consensus/nip01';
import { ChainExecutor, ConnectedBlock } from '../chain/chain-executor';
import { createDefaultNodeConfig, NodeConfig } from './config';
import { NodeLifecycle } from './lifecycle';
import { RelayManager } from '../nostr/relay-manager';
import { EmbeddedRelay } from '../nostr/embedded-relay';
import { InMemorySigner } from '../mining/signer';
import { MiningCoordinator } from '../mining/coordinator';
import { validateBlock } from '../consensus/block-validation';
import { parseTransactionEvent, ParsedTransaction } from '../consensus/transaction-codec';
import { validateParsedTransaction, TxEvaluation } from '../consensus/transaction-validation';
import { buildBlockTags, parseBlockEvent } from '../consensus/block-codec';
import { NodeStore } from '../storage/node-store';
import { selectTransactionsForBlock } from '../mempool/selection';
import { calculateCandidateTimestamp, calculateMedianTimePast, calculateNextDifficulty } from '../consensus/difficulty';
import { getNetworkParams, MAINNET_PARAMS, NetworkName, NetworkParams } from '../networks/params';
import { choosePreferredTip } from '../chain/fork-choice';
import { MissingObjectQueue } from '../nostr/fetch-queue';
import { buildExactEventFetch, buildLiveBlockSubscription, buildRecentTipProbe, NostrFilter } from '../nostr/subscriptions';
import { evaluateCandidatePow } from '../mining/worker';
import { LocalSignerProvider, SignerState } from '../signer/provider';
import { buildWalletTransaction } from '../wallet/builder';
import { formatDecimalAmount } from '../wallet/amounts';
import { toNpub } from '../wallet/addresses';

const RELAY_LIST_KIND = 10002;
const MAX_RELAY_LIST_EVENTS = 256;
const MAX_REBROADCAST_CACHE = 4096;
const MAX_REBROADCAST_QUEUE = 512;

export class NodeRuntime {
  public readonly config: NodeConfig;
  public readonly lifecycle = new NodeLifecycle();
  public readonly cryptoProvider = new NobleCryptoProvider();
  public chainExecutor = new ChainExecutor();
  public readonly relayManager: RelayManager;
  public readonly miningCoordinator: MiningCoordinator;
  private readonly embeddedRelay: EmbeddedRelay | null;
  private readonly signer: InMemorySigner | null;
  private readonly signerProvider: LocalSignerProvider | null;
  private readonly store: NodeStore;
  private chainIdHex: string | null = null;
  private genesisParams: GenesisParams | null = null;
  private readonly storedEvents = new Map<string, NostrEvent>();
  private readonly eventSequences = new Map<string, bigint>();
  private readonly parsedTransactions = new Map<string, ParsedTransaction>();
  private readonly pendingBlockIds = new Set<string>();
  private readonly invalidEventCodes = new Map<string, string>();
  private readonly relayListEventsByPubkey = new Map<string, NostrEvent>();
  private readonly validMinerPubkeys = new Set<string>();
  private readonly missingObjects = new MissingObjectQueue();
  private readonly rebroadcastedEventIds = new Set<string>();
  private readonly rebroadcastOrder: string[] = [];
  private readonly pendingRebroadcastQueue: Array<{ event: NostrEvent; priority: number; excludeRelayUrl: string | null }> = [];
  private persistenceEnabled = true;
  private miningLoopRunning = false;

  public constructor(config: NodeConfig, signerSecretHex: string | null = null) {
    this.config = config;
    this.store = new NodeStore(config.databasePath, config.network);
    this.relayManager = new RelayManager(config.relays, {
      onEvent: (event, relayUrl) => this.receiveEvent(event, relayUrl),
      onNotice: () => undefined
    });
    this.embeddedRelay = config.embeddedRelayPort === null ? null : new EmbeddedRelay({
      saveIncomingEvent: (event) => {
        this.receiveEvent(event, null);
        return { accepted: true, message: 'stored' };
      },
      query: (filters) => this.queryEvents(filters),
      getRelayInfo: () => this.getEmbeddedRelayInfo()
    });
    this.signer = signerSecretHex === null ? null : new InMemorySigner(Buffer.from(signerSecretHex, 'hex'), this.cryptoProvider);
    this.signerProvider = signerSecretHex === null && config.signerType === 'local-ncryptsec' && config.signerPath !== null
      ? new LocalSignerProvider(config.signerPath)
      : null;
    this.miningCoordinator = new MiningCoordinator(config.miningEnabled, config.miningMode, config.miningWorkerCount);
  }

  public static create(dataDir: string, network: NetworkName = 'mainnet', signerSecretHex: string | null = null): NodeRuntime {
    return new NodeRuntime(createDefaultNodeConfig(network, dataDir), signerSecretHex);
  }

  public async start(genesisEvent: NostrEvent): Promise<void> {
    this.lifecycle.transition('STARTING');
    fs.mkdirSync(this.config.dataDir, { recursive: true });
    const validatedGenesis = validateNip01Event(genesisEvent, BLOCK_KIND, this.cryptoProvider, 'BLK');
    this.chainIdHex = validatedGenesis.id;
    this.genesisParams = validateGenesisEvent(validatedGenesis, this.cryptoProvider);
    const existingChainId = this.store.getMetaText('chain_id');
    if (existingChainId === null || existingChainId.length === 0) {
      this.chainExecutor = new ChainExecutor();
      this.chainExecutor.connectGenesis(validatedGenesis.id, validatedGenesis.created_at, this.genesisParams.powDifficulty, 0n);
      this.store.initializeChain(validatedGenesis.id, this.genesisParams.protocolVersion);
      const receivedSeq = this.store.nextReceivedSeq();
      this.store.persistEvent(validatedGenesis, 'nostr-blockchain:genesis', 'STRUCTURAL_VALID', null, receivedSeq);
      this.storedEvents.set(validatedGenesis.id, validatedGenesis);
      this.eventSequences.set(validatedGenesis.id, receivedSeq);
      this.store.persistBlockStructure(parseBlockEvent(validatedGenesis), {
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
    } else {
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

  public async shutdown(): Promise<void> {
    this.lifecycle.transition('SHUTTING_DOWN');
    if (this.embeddedRelay !== null) {
      await this.embeddedRelay.close();
    }
    await this.relayManager.closeAll();
    this.store.close();
    this.lifecycle.transition('STOPPED');
  }

  public getStatus(): Record<string, unknown> {
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

  public getChainIdHex(): string {
    if (this.chainIdHex === null) {
      throw new Error('runtime not started');
    }
    return this.chainIdHex;
  }

  public verifyIntegrity(): string {
    return this.store.verifyIntegrity();
  }

  public getMissingObjectCount(): number {
    return this.missingObjects.size();
  }

  public receiveEvent(event: NostrEvent, sourceRelayUrl: string | null = null): void {
    try {
      this.acceptEvent(event, true, sourceRelayUrl);
    } catch (error) {
      if (error instanceof ConsensusError) {
        this.recordInvalidIncomingEvent(event, error);
        return;
      }
      throw error;
    }
  }

  public queryEvents(filters: readonly NostrFilter[]): NostrEvent[] {
    const relayListEvents = new Set([...this.relayListEventsByPubkey.values()].map((event) => event.id));
    const events = [...this.storedEvents.values()].filter((event) => event.kind !== RELAY_LIST_KIND || relayListEvents.has(event.id));
    const matched = events.filter((event) => filters.some((filter) => matchesFilter(event, filter)));
    const limit = filters.reduce<number | null>((smallest, filter) => {
      if (filter.limit === undefined) {
        return smallest;
      }
      return smallest === null ? filter.limit : Math.min(smallest, filter.limit);
    }, null);
    return limit === null ? matched : matched.slice(0, limit);
  }

  public publishEvent(event: NostrEvent): void {
    this.acceptEvent(event, true, null);
    this.queueRebroadcast(event, event.kind === BLOCK_KIND ? 0 : 1, null);
    this.flushRebroadcastQueue();
  }

  public getGenesisParams(): GenesisParams {
    if (this.genesisParams === null) {
      throw new Error('runtime not started');
    }
    return this.genesisParams;
  }

  public getSigner(): InMemorySigner {
    if (this.signer === null) {
      throw new Error('no signer configured');
    }
    return this.signer;
  }

  public getSignerState(): SignerState {
    if (this.signer !== null) {
      return 'UNLOCKED';
    }
    if (this.signerProvider === null) {
      return 'UNAVAILABLE';
    }
    return this.signerProvider.getState();
  }

  public unlockSigner(password: string): { state: SignerState; pubkey: string } {
    if (this.signerProvider === null) {
      throw new Error('BOOT_SIGNER_UNAVAILABLE');
    }
    const pubkey = this.signerProvider.unlock(password);
    this.refreshMiningState();
    return { state: this.getSignerState(), pubkey };
  }

  public lockSigner(): void {
    this.signerProvider?.lock();
    this.miningCoordinator.invalidateGeneration();
    this.refreshMiningState();
  }

  public refreshMiningState(): void {
    const pauseReason = this.deriveMiningPauseReason();
    this.miningCoordinator.setPauseReason(pauseReason);
    if (pauseReason === null) {
      void this.ensureMiningLoop();
      return;
    }
    this.miningCoordinator.invalidateGeneration();
  }

  public getStoredEvents(): NostrEvent[] {
    return [...this.storedEvents.values()];
  }

  public syncKnownEvents(events: readonly NostrEvent[]): void {
    for (const event of events) {
      this.acceptEvent(event, true, null);
    }
  }

  public mineOne(createdAt?: number): NostrEvent {
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
    const selectedTxIds = selectTransactionsForBlock(parentIdHex, this.chainExecutor.getMempool().values(), this.genesisParams).map((entry) => entry.txId);
    const networkParams = this.getActiveNetworkParams();
    const requiredDifficulty = calculateNextDifficulty(networkParams, parentBlock.height + 1n, parentBlock, (blockId) => this.chainExecutor.getConnectedBlock(blockId));
    const candidateCreatedAt = createdAt ?? calculateCandidateTimestamp(parentIdHex, Math.floor(Date.now() / 1000), (blockId) => this.chainExecutor.getConnectedBlock(blockId));
    let nonce = 0n;
    let unsignedWinner = this.buildUnsignedBlock(parentIdHex, this.chainIdHex, activeSigner.getPublicKeyHex(), selectedTxIds, candidateCreatedAt, nonce);
    while (!evaluateCandidatePow({
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
    const event: NostrEvent = {
      ...unsignedWinner,
      sig: activeSigner.signEventId(unsignedWinner.id)
    };
    this.acceptEvent(event, true, null);
    return event;
  }

  public submitTransaction(event: NostrEvent): void {
    this.acceptEvent(event, true, null);
  }

  public getWalletAddress(): { network: string; pubkey: string; npub: string } {
    const walletPubkeyHex = this.getWalletPubkeyHex();
    return {
      network: this.config.network,
      pubkey: walletPubkeyHex,
      npub: toNpub(walletPubkeyHex)
    };
  }

  public getWalletBalanceSummary(): { network: string; symbol: string; confirmed: string; spendable: string; immatureReward: string; pending: string } {
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
      } else {
        immatureReward += utxo.amount;
      }
    }
    return {
      network: this.config.network,
      symbol: this.getActiveNetworkParams().displaySymbol,
      confirmed: formatDecimalAmount(confirmed),
      spendable: formatDecimalAmount(spendable),
      immatureReward: formatDecimalAmount(immatureReward),
      pending: '0.00000000'
    };
  }

  public getWalletUtxos(): Array<{ txid: string; index: number; amount: string; displayAmount: string; createdHeight: string; isReward: boolean; spendable: boolean }> {
    const walletPubkeyHex = this.getWalletPubkeyHex();
    const candidateHeight = this.chainExecutor.getActiveHeight() + 1n;
    return this.chainExecutor.getUtxoView().listUtxosByOwner(Buffer.from(walletPubkeyHex, 'hex')).map((utxo) => ({
      txid: Buffer.from(utxo.sourceId).toString('hex'),
      index: utxo.outputIndex,
      amount: utxo.amount.toString(10),
      displayAmount: formatDecimalAmount(utxo.amount),
      createdHeight: utxo.createdHeight.toString(10),
      isReward: utxo.isReward,
      spendable: !utxo.isReward || candidateHeight - utxo.createdHeight >= BigInt(this.getGenesisParams().rewardMaturity)
    }));
  }

  public sendWalletPayment(to: string, amount: string, priorityFee: string): { eventId: string; to: string; amount: string; minimumBurn: string; actualFee: string; actualPriorityFee: string; change: string } {
    const activeSigner = this.getActiveSigner();
    if (activeSigner === null) {
      throw new Error(this.getSignerState() === 'UNAVAILABLE' ? 'BOOT_SIGNER_UNAVAILABLE' : 'BOOT_SIGNER_LOCKED');
    }
    if (this.chainIdHex === null || this.genesisParams === null) {
      throw new Error('BOOT_SYNC_INCOMPLETE');
    }
    const buildResult = buildWalletTransaction({
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
      minimumBurn: formatDecimalAmount(buildResult.selection.minimumBurn),
      actualFee: formatDecimalAmount(buildResult.actualFee),
      actualPriorityFee: formatDecimalAmount(buildResult.selection.actualPriorityFee),
      change: formatDecimalAmount(buildResult.selection.changeAmount)
    };
  }

  public listUtxos(pubkeyHex: string): Array<{ txid: string; index: number; amount: string; createdHeight: string; isReward: boolean }> {
    return this.chainExecutor.getUtxoView().listUtxosByOwner(Buffer.from(pubkeyHex, 'hex')).map((utxo) => ({
      txid: Buffer.from(utxo.sourceId).toString('hex'),
      index: utxo.outputIndex,
      amount: utxo.amount.toString(10),
      createdHeight: utxo.createdHeight.toString(10),
      isReward: utxo.isReward
    }));
  }

  public getBalance(pubkeyHex: string): bigint {
    return this.chainExecutor.getUtxoView().listUtxosByOwner(Buffer.from(pubkeyHex, 'hex')).reduce((sum, utxo) => sum + utxo.amount, 0n);
  }

  public getInvalidEventCodes(): ReadonlyMap<string, string> {
    return this.invalidEventCodes;
  }

  public getMempoolTransactions(): string[] {
    return this.chainExecutor.getMempool().values().map((entry) => entry.txId);
  }

  public verify(): Record<string, unknown> {
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

  public reindex(): void {
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

  public replayFromEvents(events: readonly NostrEvent[]): { snapshot: ReturnType<ChainExecutor['snapshot']>; bestTips: string[]; pending: string[] } {
    if (this.chainIdHex === null) {
      throw new Error('runtime not started');
    }
    const genesis = events.find((event) => event.id === this.chainIdHex);
    if (genesis === undefined) {
      throw new Error('replay set missing genesis');
    }
    const replayDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nostr-blockchain-replay-'));
    const runtime = new NodeRuntime({ ...this.config, dataDir: replayDataDir, relays: [], embeddedRelayPort: null, embeddedRelayListen: null, databasePath: path.join(replayDataDir, 'chain.sqlite') }, this.signer === null ? null : '01'.repeat(32));
    try {
      runtime.persistenceEnabled = false;
      runtime.chainIdHex = this.chainIdHex;
      runtime.genesisParams = this.genesisParams;
      runtime.chainExecutor.connectGenesis(genesis.id, genesis.created_at, this.genesisParams!.powDifficulty, 0n);
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
    } finally {
      runtime.store.close();
      fs.rmSync(replayDataDir, { recursive: true, force: true });
    }
  }

  public syncFromRelays(): void {
    if (this.chainIdHex === null) {
      return;
    }
    const scope = makeChainScope(this.chainIdHex);
    this.relayManager.subscribe(`live-${Date.now()}`, buildLiveBlockSubscription(this.chainIdHex));
    this.relayManager.subscribe(`tips-${Date.now()}`, buildRecentTipProbe(this.chainIdHex));
    this.relayManager.subscribe(`tx-live-${Date.now()}`, [{ kinds: [TX_KIND], '#t': [scope] }]);
  }

  private reindexFromStore(genesisEvent: NostrEvent): void {
    const rememberedActiveTip = this.store.getMetaText('active_tip');
    this.chainExecutor = new ChainExecutor();
    this.chainExecutor.connectGenesis(genesisEvent.id, genesisEvent.created_at, this.genesisParams!.powDifficulty, 0n);
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
    const chosenTip = choosePreferredTip(this.chainExecutor.listStateValidTips(), rememberedActiveTip);
    if (chosenTip !== null && chosenTip.blockId !== this.chainExecutor.getActiveTip()) {
      this.chainExecutor.activateBranch(chosenTip.blockId);
    }
    this.persistRuntimeState();
  }

  private acceptEvent(event: NostrEvent, persist: boolean, sourceRelayUrl: string | null): void {
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
    if (event.kind === TX_KIND) {
      const validated = validateNip01Event(event, TX_KIND, this.cryptoProvider, 'TX');
      const parsed = parseTransactionEvent(validated, this.chainIdHex);
      const receivedSeq = persist ? this.store.nextReceivedSeq() : (this.eventSequences.get(event.id) ?? 0n);
      this.storedEvents.set(validated.id, validated);
      this.eventSequences.set(validated.id, receivedSeq);
      this.parsedTransactions.set(validated.id, parsed);
      if (persist) {
        this.store.persistEvent(validated, makeChainScope(this.chainIdHex), 'STRUCTURAL_VALID', null, receivedSeq);
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

    if (event.kind === BLOCK_KIND) {
      const validated = validateNip01Event(event, BLOCK_KIND, this.cryptoProvider, 'BLK');
      const parsed = parseBlockEvent(validated, validated.tags[0]?.[1] === 'nostr-blockchain:genesis' ? undefined : this.chainIdHex);
      const receivedSeq = persist ? this.store.nextReceivedSeq() : (this.eventSequences.get(event.id) ?? 0n);
      this.storedEvents.set(validated.id, validated);
      this.eventSequences.set(validated.id, receivedSeq);
      if (persist) {
        this.store.persistEvent(validated, parsed.isGenesis ? 'nostr-blockchain:genesis' : makeChainScope(this.chainIdHex), 'STRUCTURAL_VALID', null, receivedSeq);
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

  private acceptRelayListEvent(event: NostrEvent, persist: boolean): void {
    const validated = validateNip01Event(event, RELAY_LIST_KIND, this.cryptoProvider, 'TX');
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

  private recordInvalidIncomingEvent(event: NostrEvent, error: ConsensusError): void {
    if (error instanceof ClassifiedConsensusError && !error.cacheByEventId) {
      return;
    }
    const cacheKey = error instanceof ClassifiedConsensusError ? (error.canonicalEventId ?? event.id) : event.id;
    this.invalidEventCodes.set(cacheKey, error.code);
  }

  private tryAddToMempool(parsed: ParsedTransaction, receivedSeq: bigint): boolean {
    try {
      const evaluation = this.validateAgainstActiveView(parsed);
      this.chainExecutor.getMempool().add({ txId: parsed.event.id, transaction: parsed, evaluation, receivedSeq });
      return true;
    } catch (error) {
      if (error instanceof Error) {
        this.invalidEventCodes.set(parsed.event.id, error.message);
      }
      return false;
    }
  }

  private tryValidateAndRecordBlock(event: NostrEvent, persist: boolean, sourceRelayUrl: string | null): boolean {
    const parsedBlock = parseBlockEvent(event, this.chainIdHex!);
    const parentIdHex = Buffer.from(parsedBlock.parentId!).toString('hex');
    const parentEntry = this.chainExecutor.getBlockIndexEntry(parentIdHex);
    if (parentEntry === null || parentEntry.height === null) {
      return false;
    }
    const parentBlock = this.chainExecutor.getConnectedBlock(parentIdHex);
    if (parentBlock === null) {
      return false;
    }
    const medianTimePast = calculateMedianTimePast(parentIdHex, (blockId) => this.chainExecutor.getConnectedBlock(blockId));
    const localTime = Math.floor(Date.now() / 1000);
    if (event.created_at > localTime + 120) {
      return false;
    }
    const transactions: ParsedTransaction[] = [];
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
    const requiredDifficulty = calculateNextDifficulty(this.getActiveNetworkParams(), candidateHeight, parentBlock, (blockId) => this.chainExecutor.getConnectedBlock(blockId));
    const evaluation = validateBlock(event, this.chainIdHex!, Buffer.from(parentIdHex, 'hex'), candidateHeight, this.genesisParams!, transactions, parentView, this.cryptoProvider, {
      medianTimePast,
      localTime,
      requiredDifficulty,
      cacheWalkR1: this.getActiveNetworkParams().cacheWalkR1
    });
    const parentCumulativeWork = parentEntry.cumulativeWork ?? 0n;
    const connectedBlock: ConnectedBlock = {
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

  private async ensureMiningLoop(): Promise<void> {
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
        const selectedTxIds = selectTransactionsForBlock(parentIdHex, this.chainExecutor.getMempool().values(), this.genesisParams).map((entry) => entry.txId);
        const networkParams = this.getActiveNetworkParams();
        const candidateHeight = parentBlock.height + 1n;
        const requiredDifficulty = calculateNextDifficulty(networkParams, candidateHeight, parentBlock, (blockId) => this.chainExecutor.getConnectedBlock(blockId));
        const candidateCreatedAt = calculateCandidateTimestamp(parentIdHex, Math.floor(Date.now() / 1000), (blockId) => this.chainExecutor.getConnectedBlock(blockId));
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
        const recomputedPow = evaluateCandidatePow({
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
        const signedBlock: NostrEvent = {
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
    } finally {
      this.miningLoopRunning = false;
    }
  }

  private processPendingBlocks(): void {
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

  private rebuildMempool(): void {
    const entries = [] as Array<{ txId: string; transaction: ParsedTransaction; evaluation: TxEvaluation; receivedSeq: bigint }>;
    for (const [txId, parsed] of this.parsedTransactions.entries()) {
      const receivedSeq = this.eventSequences.get(txId) ?? 0n;
      try {
        const evaluation = this.validateAgainstActiveView(parsed);
        if (!this.isActiveTipTransaction(txId)) {
          entries.push({ txId, transaction: parsed, evaluation, receivedSeq });
        }
      } catch {
        continue;
      }
    }
    this.chainExecutor.getMempool().replace(entries);
  }

  private validateAgainstActiveView(parsed: ParsedTransaction): TxEvaluation {
    return validateParsedTransaction(parsed, this.chainExecutor.getActiveHeight() + 1n, this.genesisParams!, this.cryptoProvider, this.chainExecutor.getUtxoView());
  }

  public getActiveNetworkParams(): NetworkParams {
    const selectedNetworkParams = getNetworkParams(this.config.network);
    return Object.freeze({
      ...selectedNetworkParams,
      network: this.config.network,
      protocolVersion: this.genesisParams!.protocolVersion,
      blockReward: this.genesisParams!.blockReward,
      rewardMaturity: this.genesisParams!.rewardMaturity,
      baseFee: this.genesisParams!.baseFee,
      inputFee: this.genesisParams!.inputFee,
      outputFee: this.genesisParams!.outputFee,
      maxTxInputs: this.genesisParams!.maxTxInputs,
      maxTxOutputs: this.genesisParams!.maxTxOutputs,
      maxBlockTransactions: this.genesisParams!.maxBlockTransactions,
      initialDifficultyBits: this.genesisParams!.powDifficulty
    });
  }

  private deriveMiningPauseReason(): string | null {
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
      const candidateCreatedAt = calculateCandidateTimestamp(activeTip, Math.floor(Date.now() / 1000), (blockId) => this.chainExecutor.getConnectedBlock(blockId));
      if (candidateCreatedAt > Math.floor(Date.now() / 1000) + 120) {
        return 'CLOCK_BEHIND_CHAIN';
      }
    }
    return null;
  }

  private getActiveSigner(): InMemorySigner | null {
    if (this.signer !== null) {
      return this.signer;
    }
    const unlockedSigner = this.signerProvider?.getUnlockedSigner();
    return unlockedSigner instanceof InMemorySigner ? unlockedSigner : null;
  }

  private getWalletPubkeyHex(): string {
    const activeSigner = this.getActiveSigner();
    if (activeSigner !== null) {
      return activeSigner.getPublicKeyHex();
    }
    if (typeof this.config.signerPubkey === 'string' && this.config.signerPubkey.length === 64) {
      return this.config.signerPubkey;
    }
    throw new Error('BOOT_SIGNER_UNAVAILABLE');
  }

  private buildUnsignedBlock(parentIdHex: string, chainIdHex: string, pubkeyHex: string, txIds: readonly string[], createdAt: number, nonce: bigint): Omit<NostrEvent, 'sig'> {
    const unsignedEvent = {
      pubkey: pubkeyHex,
      created_at: createdAt,
      kind: 7343,
      tags: buildBlockTags(chainIdHex, parentIdHex, [...txIds], nonce),
      content: '00'
    };
    return {
      ...unsignedEvent,
      id: computeEventId(unsignedEvent)
    };
  }

  private isActiveTipTransaction(txId: string): boolean {
    const activeTip = this.chainExecutor.getActiveTip();
    if (activeTip === null) {
      return false;
    }
    return this.chainExecutor.getConnectedBlock(activeTip)?.evaluation.txEvaluations.some((candidate) => candidate.parsed.event.id === txId) === true;
  }

  private persistRuntimeState(): void {
    if (!this.persistenceEnabled) {
      return;
    }
    this.store.persistRuntimeState(this.chainExecutor.snapshot(), this.chainExecutor.getActiveChainIds(), this.chainExecutor.getMempool().values());
  }

  private getEmbeddedRelayInfo(): Record<string, unknown> {
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

  private queueMissingDependencies(parsedBlock: ReturnType<typeof parseBlockEvent>, receivedSeq: bigint, sourceRelayUrl: string | null): void {
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

  private processMissingObjectQueue(): void {
    const nowMs = Date.now();
    const remoteRelayUrls = this.relayManager.getRemoteRelayUrls();
    for (const request of this.missingObjects.listDue(nowMs)) {
      const orderedRelayUrls = request.sourceRelayUrl === null
        ? remoteRelayUrls.slice(0, 3)
        : [request.sourceRelayUrl, ...remoteRelayUrls.filter((relayUrl) => relayUrl !== request.sourceRelayUrl).slice(0, 3)];
      if (orderedRelayUrls.length === 0) {
        continue;
      }
      this.relayManager.requestExactEventIds(
        buildExactEventFetch(`${request.objectType}-${request.objectId}-${request.attempts}`, [request.objectId]),
        orderedRelayUrls
      );
      this.missingObjects.markAttempt(request.objectId, nowMs);
    }
  }

  private queueRebroadcast(event: NostrEvent, priority: number, excludeRelayUrl: string | null): void {
    if (this.rebroadcastedEventIds.has(event.id) || this.pendingRebroadcastQueue.some((entry) => entry.event.id === event.id)) {
      return;
    }
    this.pendingRebroadcastQueue.push({ event, priority, excludeRelayUrl });
    this.pendingRebroadcastQueue.sort((left, right) => left.priority - right.priority);
    while (this.pendingRebroadcastQueue.length > MAX_REBROADCAST_QUEUE) {
      this.pendingRebroadcastQueue.pop();
    }
  }

  private flushRebroadcastQueue(): void {
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

  private rememberRebroadcast(eventId: string): void {
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

  private enforceRelayListBounds(): void {
    while (this.relayListEventsByPubkey.size > MAX_RELAY_LIST_EVENTS) {
      const oldestPubkey = this.relayListEventsByPubkey.keys().next().value;
      if (typeof oldestPubkey !== 'string') {
        break;
      }
      this.relayListEventsByPubkey.delete(oldestPubkey);
    }
  }
}

function matchesFilter(event: NostrEvent, filter: NostrFilter): boolean {
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

function extractRelayListUrls(event: NostrEvent): string[] {
  return event.tags
    .filter((tag) => tag[0] === 'r' && typeof tag[1] === 'string' && tag[1].startsWith('wss://'))
    .map((tag) => tag[1]!);
}
