import fs from 'node:fs';

import { NobleCryptoProvider } from '../crypto/noble-provider';
import { BLOCK_KIND, TX_KIND, makeChainScope } from '../consensus/constants';
import { ConsensusError } from '../consensus/errors';
import { validateGenesisEvent, GenesisParams } from '../consensus/genesis';
import { NostrEvent, validateNip01Event } from '../consensus/nip01';
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
import { parseBlockEvent } from '../consensus/block-codec';
import { NodeStore } from '../storage/node-store';
import { selectTransactionsForBlock } from '../mempool/selection';
import { computeBlockWork, computeRequiredTarget } from '../consensus/difficulty';

export class NodeRuntime {
  public readonly config: NodeConfig;
  public readonly lifecycle = new NodeLifecycle();
  public readonly cryptoProvider = new NobleCryptoProvider();
  public chainExecutor = new ChainExecutor();
  public readonly relayManager: RelayManager;
  public readonly miningCoordinator: MiningCoordinator;
  private readonly embeddedRelay: EmbeddedRelay | null;
  private readonly signer: InMemorySigner | null;
  private readonly store: NodeStore;
  private chainIdHex: string | null = null;
  private genesisParams: GenesisParams | null = null;
  private readonly storedEvents = new Map<string, NostrEvent>();
  private readonly eventSequences = new Map<string, bigint>();
  private readonly parsedTransactions = new Map<string, ParsedTransaction>();
  private readonly pendingBlockIds = new Set<string>();
  private readonly invalidEventCodes = new Map<string, string>();

  public constructor(config: NodeConfig, signerSecretHex: string | null = null) {
    this.config = config;
    this.store = new NodeStore(config.databasePath);
    this.relayManager = new RelayManager(config.relays, {
      onEvent: (event) => this.receiveEvent(event),
      onNotice: () => undefined
    });
    this.embeddedRelay = config.embeddedRelayPort === null ? null : new EmbeddedRelay({
      saveIncomingEvent: (event) => {
        this.receiveEvent(event);
        return { accepted: true, message: 'stored' };
      },
      query: (filters) => this.queryEvents(filters)
    });
    this.signer = signerSecretHex === null ? null : new InMemorySigner(Buffer.from(signerSecretHex, 'hex'), this.cryptoProvider);
    this.miningCoordinator = new MiningCoordinator(config.miningEnabled, config.miningMode, config.miningWorkerCount);
  }

  public static create(dataDir: string, signerSecretHex: string | null = null): NodeRuntime {
    return new NodeRuntime(createDefaultNodeConfig(dataDir), signerSecretHex);
  }

  public async start(genesisEvent: NostrEvent): Promise<void> {
    this.lifecycle.transition('STARTING');
    fs.mkdirSync(this.config.dataDir, { recursive: true });
    const validatedGenesis = validateNip01Event(genesisEvent, BLOCK_KIND, this.cryptoProvider, 'BLK');
    this.chainIdHex = validatedGenesis.id;
    this.genesisParams = validateGenesisEvent(validatedGenesis, this.cryptoProvider);
    const genesisWork = computeBlockWork(this.genesisParams.initialPowTarget);
    const existingChainId = this.store.getMetaText('chain_id');
    if (existingChainId === null || existingChainId.length === 0) {
      this.chainExecutor = new ChainExecutor();
      this.chainExecutor.connectGenesis(validatedGenesis.id, validatedGenesis.created_at, this.genesisParams.initialPowTarget, genesisWork);
      this.store.initializeChain(validatedGenesis.id, this.genesisParams.protocolVersion);
      const receivedSeq = this.store.nextReceivedSeq();
      this.store.persistEvent(validatedGenesis, 'nostr-blockchain:genesis', 'STRUCTURAL_VALID', null, receivedSeq);
      this.storedEvents.set(validatedGenesis.id, validatedGenesis);
      this.eventSequences.set(validatedGenesis.id, receivedSeq);
      this.store.persistBlockStructure(parseBlockEvent(validatedGenesis), 'STATE_VALID', 0n, null);
      this.store.persistDerivedState(this.chainExecutor.snapshot(), this.chainExecutor.getActiveChainIds());
    } else {
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

  public async shutdown(): Promise<void> {
    this.lifecycle.transition('SHUTTING_DOWN');
    if (this.embeddedRelay !== null) {
      await this.embeddedRelay.close();
    }
    await this.relayManager.closeAll();
    this.store.close();
  }

  public getStatus(): Record<string, unknown> {
    return {
      state: this.lifecycle.getState(),
      activeTip: this.chainExecutor.getActiveTip(),
      snapshot: this.chainExecutor.snapshot(),
      mining: this.miningCoordinator.getStatus(),
      chainId: this.chainIdHex,
      mempoolSize: this.chainExecutor.getMempool().size()
    };
  }

  public receiveEvent(event: NostrEvent): void {
    try {
      this.acceptEvent(event, true);
    } catch (error) {
      if (error instanceof ConsensusError) {
        this.recordInvalidIncomingEvent(event, error);
        return;
      }
      throw error;
    }
  }

  public queryEvents(filters: readonly Record<string, unknown>[]): NostrEvent[] {
    const events = [...this.storedEvents.values()];
    return events.filter((event) => filters.some((filter) => matchesFilter(event, filter)));
  }

  public publishEvent(event: NostrEvent): void {
    this.acceptEvent(event, true);
    this.relayManager.publishEvent(event);
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

  public getStoredEvents(): NostrEvent[] {
    return [...this.storedEvents.values()];
  }

  public syncKnownEvents(events: readonly NostrEvent[]): void {
    for (const event of events) {
      this.acceptEvent(event, true);
    }
  }

  public mineOne(createdAt = 1_700_000_000): NostrEvent {
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
    const selectedTxIds = selectTransactionsForBlock(parentIdHex, this.chainExecutor.getMempool().values(), this.genesisParams).map((entry) => entry.txId);
    const unsignedWinner = this.miningCoordinator.buildUnsignedWinningBlock(
      parentIdHex,
      this.chainIdHex,
      this.genesisParams,
      this.signer,
      selectedTxIds,
      this.getGenesisCreatedAt(),
      parentBlock.createdAt,
      parentBlock.height + 1n,
      createdAt
    );
    const event: NostrEvent = {
      ...unsignedWinner,
      sig: this.signer.signEventId(unsignedWinner.id)
    };
    this.acceptEvent(event, true);
    return event;
  }

  public submitTransaction(event: NostrEvent): void {
    this.acceptEvent(event, true);
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
      stateHash: current.utxoDigest
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
    const runtime = new NodeRuntime({ ...this.config, relays: [], embeddedRelayPort: null, databasePath: `${this.config.databasePath}.replay` }, this.signer === null ? null : '01'.repeat(32));
    runtime.chainIdHex = this.chainIdHex;
    runtime.genesisParams = this.genesisParams;
    runtime.chainExecutor.connectGenesis(genesis.id, genesis.created_at, this.genesisParams!.initialPowTarget, computeBlockWork(this.genesisParams!.initialPowTarget));
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

  public syncFromRelays(): void {
    if (this.chainIdHex === null) {
      return;
    }
    const scope = makeChainScope(this.chainIdHex);
    this.relayManager.subscribe(`sync-${Date.now()}`, [{ kinds: [BLOCK_KIND], '#t': [scope] }, { kinds: [TX_KIND], '#t': [scope] }]);
  }

  private reindexFromStore(genesisEvent: NostrEvent): void {
    this.chainExecutor = new ChainExecutor();
    this.chainExecutor.connectGenesis(genesisEvent.id, genesisEvent.created_at, this.genesisParams!.initialPowTarget, computeBlockWork(this.genesisParams!.initialPowTarget));
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

  private autoMineIfConfigured(): void {
    if (this.lifecycle.getState() !== 'READY') {
      return;
    }
    const miningStatus = this.miningCoordinator.getStatus();
    if (!miningStatus.enabled || miningStatus.mode !== 'continuous' || this.signer === null) {
      return;
    }
    this.mineOne();
  }

  private acceptEvent(event: NostrEvent, persist: boolean): void {
    if (this.chainIdHex === null || this.genesisParams === null) {
      throw new Error('runtime not started');
    }
    if (this.storedEvents.has(event.id)) {
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
      this.tryAddToMempool(parsed, receivedSeq);
      this.processPendingBlocks();
      this.persistRuntimeState();
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
        this.store.persistBlockStructure(parsed, 'STRUCTURAL_VALID', null, null);
      }
      if (!this.tryValidateAndRecordBlock(validated, persist)) {
        this.pendingBlockIds.add(validated.id);
      }
      this.processPendingBlocks();
      this.persistRuntimeState();
    }
  }

  private recordInvalidIncomingEvent(event: NostrEvent, error: ConsensusError): void {
    this.invalidEventCodes.set(event.id, error.code);
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

  private tryValidateAndRecordBlock(event: NostrEvent, persist: boolean): boolean {
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
    const medianTimePast = this.computeMedianTimePast(parentIdHex);
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
    const requiredTarget = computeRequiredTarget(this.genesisParams!, this.getGenesisCreatedAt(), parentBlock.createdAt, candidateHeight);
    const evaluation = validateBlock(event, this.chainIdHex!, Buffer.from(parentIdHex, 'hex'), candidateHeight, this.genesisParams!, transactions, parentView, this.cryptoProvider, {
      medianTimePast,
      localTime,
      requiredTarget
    });
    const parentCumulativeWork = parentEntry.cumulativeWork ?? 0n;
    const connectedBlock: ConnectedBlock = {
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

  private processPendingBlocks(): void {
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

  private getGenesisCreatedAt(): number {
    if (this.chainIdHex === null) {
      throw new Error('runtime not started');
    }
    const genesis = this.storedEvents.get(this.chainIdHex);
    if (genesis === undefined) {
      throw new Error('missing genesis');
    }
    return genesis.created_at;
  }

  private computeMedianTimePast(parentIdHex: string): number {
    const timestamps: number[] = [];
    let cursor: string | null = parentIdHex;
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

  private isActiveTipTransaction(txId: string): boolean {
    const activeTip = this.chainExecutor.getActiveTip();
    if (activeTip === null) {
      return false;
    }
    return this.chainExecutor.getConnectedBlock(activeTip)?.evaluation.txEvaluations.some((candidate) => candidate.parsed.event.id === txId) === true;
  }

  private persistRuntimeState(): void {
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

function matchesFilter(event: NostrEvent, filter: Record<string, unknown>): boolean {
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
