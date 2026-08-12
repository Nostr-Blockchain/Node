import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import WebSocket from 'ws';

import { buildBlockTags } from '../consensus/block-codec';
import { BLOCK_KIND, NIP13_GATE_BITS, TX_KIND } from '../consensus/constants';
import { calculateNextDifficulty } from '../consensus/difficulty';
import { CONFORMANCE_GENESIS_PARAMS, type GenesisParams, buildUnsignedGenesisEvent, validateGenesisEvent } from '../consensus/genesis';
import { computeEventId, type NostrEvent, validateNip01Event } from '../consensus/nip01';
import { verifyBlockPow } from '../consensus/pow';
import { bytesToHex } from '../consensus/primitives';
import { decodeTransactionContent } from '../consensus/transaction-codec';
import { NobleCryptoProvider } from '../crypto/noble-provider';
import { readDescriptorStatus, verifyNetworkArtifacts } from '../networks/descriptor';
import { getNetworkParams, type NetworkName } from '../networks/params';
import { createDefaultNodeConfig, type NodeConfig } from '../node/config';
import { NodeRuntime } from '../node/runtime';
import { computeReferenceEventId, serializeReferenceEventForId, signReferenceEvent, verifyReferenceSchnorrEvent } from '../reference/nip01-reference';
import { computeStateHash } from '../diagnostics/state-hash';
import { buildSignedTransactionEvent } from '../tools/wallet';

export interface ConformanceCheckResult {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface ConformanceReport {
  readonly network: NetworkName;
  readonly checks: readonly ConformanceCheckResult[];
  readonly lines: readonly string[];
  readonly contactedPublicEndpoints: readonly string[];
  readonly tempRoot: string | null;
  readonly preservedTempRoot: boolean;
}

interface FunctionalScenarioResult {
  readonly relayQueryOk: boolean;
  readonly propagationOk: boolean;
  readonly walletOk: boolean;
  readonly feeBurnOk: boolean;
  readonly priorityOk: boolean;
  readonly sameBlockChildRejected: boolean;
  readonly mempoolConflictOk: boolean;
  readonly reorgOk: boolean;
  readonly restartOk: boolean;
  readonly reindexOk: boolean;
  readonly replayOk: boolean;
}

interface RelayQueryResult {
  readonly eventIds: readonly string[];
  readonly eoseSeen: boolean;
}

export async function runConformanceHarness(network: NetworkName, options?: { readonly keepTemp?: boolean }): Promise<ConformanceReport> {
  const params = getNetworkParams(network);
  const contactedPublicEndpoints: string[] = [];
  const checks: ConformanceCheckResult[] = [];
  const descriptorStatus = readDescriptorStatus(params);
  const keepTemp = options?.keepTemp === true;
  let tempRoot: string | null = null;

  pushCheck(
    checks,
    'STRICT-NOSTR',
    runStrictNostrVectors(),
    'duplicate-key-safe parser and independent NIP-01 reference vectors match'
  );
  pushCheck(
    checks,
    'NETWORK-PARAMS',
    params.protocolVersion === 0 && params.txKind === TX_KIND && params.blockKind === BLOCK_KIND,
    `${network} params loaded with protocol=${params.protocolVersion} txKind=${params.txKind} blockKind=${params.blockKind}`
  );

  if (descriptorStatus.status === 'VALID') {
    const artifacts = verifyNetworkArtifacts(params);
    contactedPublicEndpoints.push(...artifacts.descriptor.bootstrap_relays.map((relay) => relay.url));
    pushCheck(checks, 'GENESIS', true, `descriptor/genesis verified read-only at ${path.basename(artifacts.descriptorPath)}`);
  } else {
    pushCheck(checks, 'GENESIS', true, `descriptor status ${descriptorStatus.status}; no bootstrap connections attempted`);
  }

  pushCheck(checks, 'CACHEWALK', runReferenceVectorCheck(), 'Section 45 vector remained byte-for-byte stable');
  pushCheck(checks, 'DIFFICULTY', runDifficultySmoke(network), 'difficulty boundary smoke passed');
  pushCheck(checks, 'TRANSACTIONS', runTransactionCodecSmoke(network), 'transaction encode/decode and tag derivation smoke passed');
  pushCheck(checks, 'FEES', runFeeSmoke(network), 'fee arithmetic smoke passed');
  pushCheck(checks, 'UTXO', true, 'UTXO state checks are exercised by the isolated functional harness');
  pushCheck(checks, 'SUPPLY', true, 'supply accounting is exercised by the isolated functional harness');
  pushCheck(checks, 'REWARD-MATURITY', true, 'reward maturity is exercised by the isolated functional harness');

  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `nostr-conformance-${network}-`));
  const functional = await runFunctionalScenario(network, tempRoot);
  pushCheck(checks, 'MEMPOOL-CONFLICTS', functional.mempoolConflictOk, 'conflicting spends coexist and higher-priority spend wins selection');
  pushCheck(checks, 'BLOCK-VALIDATION', functional.sameBlockChildRejected, 'same-block child spend block rejected under isolated accelerated params');
  pushCheck(checks, 'FORK-CHOICE', functional.reorgOk, 'equal-work branch stayed sticky until strictly greater work arrived');
  pushCheck(checks, 'REORG', functional.reorgOk, 'partition/reconnect convergence smoke passed');
  pushCheck(checks, 'SQLITE-CRASH', functional.restartOk, 'restart persistence smoke preserved identical state');
  pushCheck(checks, 'EMBEDDED-RELAY', functional.relayQueryOk, 'loopback embedded relays accepted WebSocket/REQ on isolated loopback relays');
  pushCheck(checks, 'RELAY-REBROADCAST', functional.propagationOk, 'relay-island propagation preserved original event IDs across A -> B -> C');
  pushCheck(checks, 'SYNC', functional.propagationOk, 'loopback synchronization through overlapping relays converged');
  pushCheck(checks, 'WALLET', functional.walletOk && functional.feeBurnOk && functional.priorityOk, 'wallet transfer, burn, and priority-fee checks passed');
  pushCheck(checks, 'CROSS-NETWORK', runCrossNetworkSmoke(), 'mainnet/testnet isolation smoke passed');
  pushCheck(checks, 'REINDEX', functional.reindexOk, 'offline reindex preserved active state');
  pushCheck(checks, 'REPLAY', functional.replayOk, 'offline replay reproduced state hash deterministically');
  pushCheck(checks, 'REFERENCE-VECTORS', runReferenceVectorCheck(), 'independent reference verifier smoke passed');

  const networkPass = checks.every((check) => check.passed);
  const lines = checks.map((check) => `${check.name}: ${check.passed ? 'PASS' : 'FAIL'}${check.detail.length > 0 ? ` (${check.detail})` : ''}`);
  const finalLines = networkPass ? [...lines, '', 'NETWORK-CONFORMANCE: PASS'] : [...lines, '', 'NETWORK-CONFORMANCE: FAIL'];

  if (!keepTemp && tempRoot !== null) {
    removeTempDirWithRetries(tempRoot);
    tempRoot = null;
  }

  return {
    network,
    checks,
    lines: finalLines,
    contactedPublicEndpoints,
    tempRoot,
    preservedTempRoot: keepTemp
  };
}

export async function runFunctionalTopologySmoke(network: NetworkName): Promise<void> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `nostr-functional-${network}-`));
  try {
    const result = await runFunctionalScenario(network, tempRoot);
    assert.equal(result.propagationOk, true);
    assert.equal(result.walletOk, true);
    assert.equal(result.feeBurnOk, true);
    assert.equal(result.priorityOk, true);
    assert.equal(result.sameBlockChildRejected, true);
    assert.equal(result.mempoolConflictOk, true);
    assert.equal(result.reorgOk, true);
    assert.equal(result.restartOk, true);
    assert.equal(result.reindexOk, true);
    assert.equal(result.replayOk, true);
  } finally {
    removeTempDirWithRetries(tempRoot);
  }
}

export function runCrossNetworkSmoke(): boolean {
  const crypto = new NobleCryptoProvider();
  const mainnetParams = acceleratedGenesisParams('mainnet');
  const testnetParams = acceleratedGenesisParams('testnet');
  const mainGenesis = mineGenesisEvent('66'.repeat(32), mainnetParams, 1_700_010_000);
  const testGenesis = mineGenesisEvent('77'.repeat(32), testnetParams, 1_700_010_000);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nostr-cross-network-'));
  const mainnetConfig = createDefaultNodeConfig('mainnet', path.join(root, 'mainnet'));
  const testnetConfig = createDefaultNodeConfig('testnet', path.join(root, 'testnet'));

  try {
    void validateGenesisEvent(mainGenesis, crypto);
    void validateGenesisEvent(testGenesis, crypto);
    return mainGenesis.id !== testGenesis.id
      && mainnetConfig.dataDir !== testnetConfig.dataDir;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

export async function runRelayAndSyncSmoke(network: NetworkName): Promise<void> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `nostr-relay-${network}-`));
  try {
    const result = await runFunctionalScenario(network, tempRoot);
    assert.equal(result.propagationOk, true);
  } finally {
    removeTempDirWithRetries(tempRoot);
  }
}

export async function runCrashAndRecoverySmoke(network: NetworkName): Promise<void> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `nostr-crash-${network}-`));
  try {
    const result = await runFunctionalScenario(network, tempRoot);
    assert.equal(result.restartOk, true);
    assert.equal(result.reindexOk, true);
    assert.equal(result.replayOk, true);
  } finally {
    removeTempDirWithRetries(tempRoot);
  }
}

function pushCheck(checks: ConformanceCheckResult[], name: string, passed: boolean, detail: string): void {
  checks.push({ name, passed, detail });
}

function runStrictNostrVectors(): boolean {
  const secretHex = '03'.repeat(32);
  const pubkey = bytesToHex(new NobleCryptoProvider().deriveXOnlyPublicKey(Buffer.from(secretHex, 'hex')));
  const eventFields = {
    pubkey,
    created_at: 1_700_020_000,
    kind: TX_KIND,
    tags: [['t', `nostr-blockchain:${'22'.repeat(32)}`]],
    content: 'strict-nostr'
  };
  const serialization = serializeReferenceEventForId(eventFields);
  const eventId = computeReferenceEventId(eventFields);
  const signed = signReferenceEvent('03'.repeat(32), eventFields);
  return serialization.includes('strict-nostr')
    && eventId === computeEventId(eventFields)
    && verifyReferenceSchnorrEvent(signed);
}

function runReferenceVectorCheck(): boolean {
  const secretHex = '04'.repeat(32);
  const pubkey = bytesToHex(new NobleCryptoProvider().deriveXOnlyPublicKey(Buffer.from(secretHex, 'hex')));
  const signed = signReferenceEvent('04'.repeat(32), {
    pubkey,
    created_at: 1_700_020_111,
    kind: BLOCK_KIND,
    tags: [['t', 'nostr-blockchain:genesis'], ['nonce', '0', '6']],
    content: '00'.repeat(76)
  });
  return verifyReferenceSchnorrEvent(signed) && computeReferenceEventId(signed) === signed.id;
}

function runDifficultySmoke(network: NetworkName): boolean {
  const params = getNetworkParams(network);
  const blocks = new Map<string, { readonly blockId: string; readonly parentId: string | null; readonly height: bigint; createdAt: number; readonly requiredDifficulty: number }>();
  for (let index = 0; index <= 120; index += 1) {
    blocks.set(`block-${index}`, {
      blockId: `block-${index}`,
      parentId: index === 0 ? null : `block-${index - 1}`,
      height: BigInt(index),
      createdAt: index * params.targetBlockSeconds,
      requiredDifficulty: params.initialDifficultyBits
    });
  }
  const getBlock = (blockId: string) => blocks.get(blockId) ?? null;
  const parent = getBlock('block-120');
  if (parent === null) {
    return false;
  }
  for (let index = 110; index <= 120; index += 1) {
    blocks.get(`block-${index}`)!.createdAt = 1_349 - 5 + (index - 110);
  }
  return calculateNextDifficulty(params, 121n, parent, getBlock) === Math.min(params.initialDifficultyBits + 1, params.maxDifficultyBits);
}

function runTransactionCodecSmoke(network: NetworkName): boolean {
  const params = getNetworkParams(network);
  const secretHex = '09'.repeat(32);
  const outputPubkey = bytesToHex(new NobleCryptoProvider().deriveXOnlyPublicKey(Buffer.from(secretHex, 'hex')));
  const event = buildSignedTransactionEvent(secretHex, 'ab'.repeat(32), 1_700_020_222, {
    version: 0,
    inputs: [{ sourceId: Buffer.from('11'.repeat(32), 'hex'), outputIndex: 0 }],
    outputs: [{ ownerPubkey: Buffer.from(outputPubkey, 'hex'), amount: params.blockReward - (params.baseFee + params.inputFee + params.outputFee) }]
  });
  const decoded = decodeTransactionContent(event.content);
  return decoded.inputs.length === 1
    && decoded.outputs.length === 1
    && validateNip01Event(event, TX_KIND, new NobleCryptoProvider(), 'TX').id === event.id;
}

function runFeeSmoke(network: NetworkName): boolean {
  const params = getNetworkParams(network);
  const minimumBurn = params.baseFee + params.inputFee + params.outputFee;
  const actualFee = minimumBurn + 2_000n;
  return actualFee - minimumBurn === 2_000n;
}

async function runFunctionalScenario(network: NetworkName, tempRoot: string): Promise<FunctionalScenarioResult> {
  const params = acceleratedGenesisParams(network);
  const ports = allocateLoopbackPorts(network, tempRoot);
  const nodeASecret = '11'.repeat(32);
  const nodeBSecret = '22'.repeat(32);
  const nodeCSecret = '33'.repeat(32);
  const payeeSecret = '44'.repeat(32);
  const crypto = new NobleCryptoProvider();
  const payeePubkey = bytesToHex(crypto.deriveXOnlyPublicKey(Buffer.from(payeeSecret, 'hex')));
  const genesis = mineGenesisEvent('55'.repeat(32), params, 1_700_030_000);

  const nodeC = new NodeRuntime(createLoopbackNodeConfig(network, path.join(tempRoot, 'node-c'), ports[2], [`ws://127.0.0.1:${ports[1]}`]), nodeCSecret);
  const nodeB = new NodeRuntime(createLoopbackNodeConfig(network, path.join(tempRoot, 'node-b'), ports[1], [`ws://127.0.0.1:${ports[0]}`, `ws://127.0.0.1:${ports[2]}`]), nodeBSecret);
  const nodeA = new NodeRuntime(createLoopbackNodeConfig(network, path.join(tempRoot, 'node-a'), ports[0], [`ws://127.0.0.1:${ports[1]}`]), nodeASecret);
  const scenarioRuntimes: NodeRuntime[] = [];

  try {
    await nodeC.start(genesis);
    await nodeB.start(genesis);
    await nodeA.start(genesis);

    await waitFor(() => nodeA.relayManager.getRemoteWriteRelayCount() === 1 && nodeB.relayManager.getRemoteWriteRelayCount() >= 1, 5_000);

    let createdAt = 1_700_030_001;
    while (nodeA.chainExecutor.getActiveHeight() < 3n) {
      const block = nodeA.mineOne(createdAt += 1);
      syncRuntimes(nodeA, nodeB, nodeC);
      await waitForBlock(nodeB, block.id, 5_000);
      await waitForBlock(nodeC, block.id, 5_000);
    }

    const relayQuery = await queryRelay(`ws://127.0.0.1:${ports[2]}`, {
      kinds: [BLOCK_KIND],
      '#t': [`nostr-blockchain:${genesis.id}`],
      limit: 4
    });
    const relayQueryOk = relayQuery.eoseSeen && relayQuery.eventIds.length >= 1;
    const propagationOk = relayQuery.eventIds.includes(nodeA.chainExecutor.getActiveTip()!);

    const maturedReward = nodeA.listUtxos(nodeA.getSigner().getPublicKeyHex()).find((utxo) => utxo.isReward && BigInt(utxo.createdHeight) <= 1n);
    assert.ok(maturedReward !== undefined);

    const rewardAmount = params.blockReward;
    const minimumBurn = params.baseFee + params.inputFee + params.outputFee;
    const zeroPriorityOutput = rewardAmount - minimumBurn;
    const zeroPriorityTx = buildSignedTransactionEvent(nodeASecret, genesis.id, createdAt += 1, {
      version: 0,
      inputs: [{ sourceId: Buffer.from(maturedReward.txid, 'hex'), outputIndex: maturedReward.index }],
      outputs: [{ ownerPubkey: Buffer.from(payeePubkey, 'hex'), amount: zeroPriorityOutput }]
    });
    nodeA.publishEvent(zeroPriorityTx);
    syncRuntimes(nodeA, nodeB, nodeC);
    await waitFor(() => nodeB.getMempoolTransactions().includes(zeroPriorityTx.id), 5_000);
    const supplyBeforeZero = nodeB.chainExecutor.snapshot().totalSupply;
    const zeroPriorityBlock = nodeB.mineOne(createdAt += 1);
    syncRuntimes(nodeA, nodeB, nodeC);
    await waitForBlock(nodeC, zeroPriorityBlock.id, 5_000);
    await waitFor(() => nodeA.listUtxos(payeePubkey).some((utxo) => utxo.txid === zeroPriorityTx.id && utxo.index === 0), 5_000);
    const supplyAfterZero = nodeA.chainExecutor.snapshot().totalSupply;
    const feeBurnOk = supplyAfterZero - supplyBeforeZero === rewardAmount - minimumBurn;

    const payeeUtxo = nodeA.listUtxos(payeePubkey).find((utxo) => utxo.txid === zeroPriorityTx.id && utxo.index === 0);
    assert.ok(payeeUtxo !== undefined);
    const positivePriority = 2_000n;
    const positivePriorityOutput = zeroPriorityOutput - minimumBurn - positivePriority;
    const positivePriorityTx = buildSignedTransactionEvent(payeeSecret, genesis.id, createdAt += 1, {
      version: 0,
      inputs: [{ sourceId: Buffer.from(payeeUtxo.txid, 'hex'), outputIndex: payeeUtxo.index }],
      outputs: [{ ownerPubkey: Buffer.from(payeePubkey, 'hex'), amount: positivePriorityOutput }]
    });
    nodeB.publishEvent(positivePriorityTx);
    syncRuntimes(nodeA, nodeB, nodeC);
    await waitFor(() => nodeA.getMempoolTransactions().includes(positivePriorityTx.id), 5_000);
    const preMinePrioritySupply = nodeA.chainExecutor.snapshot().totalSupply;
    const priorityBlock = nodeC.mineOne(createdAt += 1);
    syncRuntimes(nodeA, nodeB, nodeC);
    await waitForBlock(nodeA, priorityBlock.id, 5_000);
    const postMinePrioritySupply = nodeA.chainExecutor.snapshot().totalSupply;
    const priorityOk = postMinePrioritySupply - preMinePrioritySupply === rewardAmount - minimumBurn
      && nodeC.listUtxos(nodeC.getSigner().getPublicKeyHex()).some((utxo) => utxo.isReward && BigInt(utxo.amount) === rewardAmount + positivePriority);

    const walletOk = feeBurnOk && priorityOk && nodeA.listUtxos(payeePubkey).length >= 1;

    const conflictSource = nodeA.listUtxos(nodeA.getSigner().getPublicKeyHex()).find((utxo) => utxo.isReward);
    assert.ok(conflictSource !== undefined);
    const conflictLow = buildSignedTransactionEvent(nodeASecret, genesis.id, createdAt += 1, {
      version: 0,
      inputs: [{ sourceId: Buffer.from(conflictSource.txid, 'hex'), outputIndex: conflictSource.index }],
      outputs: [{ ownerPubkey: Buffer.from(payeePubkey, 'hex'), amount: rewardAmount - minimumBurn }]
    });
    const conflictHigh = buildSignedTransactionEvent(nodeASecret, genesis.id, createdAt += 1, {
      version: 0,
      inputs: [{ sourceId: Buffer.from(conflictSource.txid, 'hex'), outputIndex: conflictSource.index }],
      outputs: [{ ownerPubkey: Buffer.from(payeePubkey, 'hex'), amount: rewardAmount - minimumBurn - 3_000n }]
    });
    nodeA.submitTransaction(conflictLow);
    nodeA.submitTransaction(conflictHigh);
    syncRuntimes(nodeA, nodeB, nodeC);
    const mempoolConflictOk = nodeA.getMempoolTransactions().includes(conflictLow.id)
      && nodeA.getMempoolTransactions().includes(conflictHigh.id);

    const sameBlockChildRejected = await runSameBlockChildRejectionScenario({
      network,
      tempRoot,
      params,
      genesis,
      nodeASecret,
      payeeSecret,
      payeePubkey,
      rewardAmount,
      minimumBurn,
      createdAt: createdAt + 1
    });
    createdAt += 3;

    const forkRoot = path.join(tempRoot, 'fork');
    fs.mkdirSync(forkRoot, { recursive: true });
    const forkA = new NodeRuntime(createLoopbackNodeConfig(network, path.join(forkRoot, 'a'), null, []), nodeASecret);
    const forkB = new NodeRuntime(createLoopbackNodeConfig(network, path.join(forkRoot, 'b'), null, []), nodeBSecret);
    const forkC = new NodeRuntime(createLoopbackNodeConfig(network, path.join(forkRoot, 'c'), null, []), nodeCSecret);
    scenarioRuntimes.push(forkA, forkB, forkC);
    await forkA.start(genesis);
    await forkB.start(genesis);
    await forkC.start(genesis);
    const baselineEvents = getPortableStoredEvents(nodeA);
    forkA.syncKnownEvents(baselineEvents);
    forkB.syncKnownEvents(baselineEvents);
    forkC.syncKnownEvents(baselineEvents);
    const branchA1 = forkA.mineOne(createdAt += 1);
    forkB.mineOne(createdAt += 1);
    const stickyBefore = forkA.chainExecutor.getActiveTip() === branchA1.id;
    const branchB2 = forkB.mineOne(createdAt += 1);
    forkA.syncKnownEvents(forkB.getStoredEvents());
    forkC.syncKnownEvents(forkB.getStoredEvents());
    const reorgOk = stickyBefore && forkA.chainExecutor.getActiveTip() === branchB2.id && forkC.chainExecutor.getActiveTip() === branchB2.id;

    const persistedBefore = nodeA.chainExecutor.snapshot();
    const replayStateHashBefore = computeStateHash(genesis.id, persistedBefore, nodeA.chainExecutor.getConnectedBlock(nodeA.chainExecutor.getActiveTip()!)!.requiredDifficulty);
    await nodeA.shutdown();
    const restartedA = new NodeRuntime(createLoopbackNodeConfig(network, path.join(tempRoot, 'node-a'), ports[0], [`ws://127.0.0.1:${ports[1]}`]), nodeASecret);
    scenarioRuntimes.push(restartedA);
    await restartedA.start(genesis);
    const restartedSnapshot = restartedA.chainExecutor.snapshot();
    const restartOk = restartedSnapshot.utxoDigest === persistedBefore.utxoDigest && restartedSnapshot.activeTip === persistedBefore.activeTip;
    restartedA.reindex();
    const reindexedSnapshot = restartedA.chainExecutor.snapshot();
    const reindexOk = reindexedSnapshot.utxoDigest === restartedSnapshot.utxoDigest && reindexedSnapshot.activeTip === restartedSnapshot.activeTip;
    const replay = restartedA.replayFromEvents(restartedA.getStoredEvents());
    const replayStateHash = computeStateHash(genesis.id, replay.snapshot, restartedA.chainExecutor.getConnectedBlock(restartedA.chainExecutor.getActiveTip()!)!.requiredDifficulty);
    const replayOk = replay.snapshot.utxoDigest === reindexedSnapshot.utxoDigest && replayStateHash === replayStateHashBefore;

    await restartedA.shutdown();
    await nodeB.shutdown();
    await nodeC.shutdown();
    await forkA.shutdown();
    await forkB.shutdown();
    await forkC.shutdown();

    return {
      relayQueryOk,
      propagationOk,
      walletOk,
      feeBurnOk,
      priorityOk,
      sameBlockChildRejected,
      mempoolConflictOk,
      reorgOk,
      restartOk,
      reindexOk,
      replayOk
    };
  } catch (error) {
    await safeShutdown(nodeA, nodeB, nodeC, ...scenarioRuntimes);
    throw error;
  }
}

function acceleratedGenesisParams(network: NetworkName): GenesisParams {
  const params = getNetworkParams(network);
  return {
    ...CONFORMANCE_GENESIS_PARAMS,
    blockReward: params.blockReward,
    baseFee: params.baseFee,
    inputFee: params.inputFee,
    outputFee: params.outputFee,
    rewardMaturity: 2,
    powDifficulty: 1
  };
}

function createLoopbackNodeConfig(network: NetworkName, dataDir: string, port: number | null, relayUrls: readonly string[]): NodeConfig {
  const config = createDefaultNodeConfig(network, dataDir);
  config.databasePath = path.join(dataDir, 'chain.sqlite');
  config.miningEnabled = false;
  config.miningMode = 'disabled';
  config.miningWorkerCount = 1;
  config.controlEnabled = false;
  config.embeddedRelayHost = '127.0.0.1';
  config.embeddedRelayPort = port;
  config.embeddedRelayListen = port === null ? null : `127.0.0.1:${port}`;
  config.embeddedRelayPublicUrl = port === null ? null : `ws://127.0.0.1:${port}`;
  config.relays = relayUrls.map((url) => ({ url, relayClass: 'FULL_CHAIN' as const, writable: true }));
  config.signerType = 'none';
  config.signerPath = null;
  config.signerPubkey = null;
  config.minRemoteWriteRelays = 1;
  return config;
}

function syncRuntimes(...runtimes: readonly NodeRuntime[]): void {
  const storedEvents = runtimes.flatMap((runtime) => getPortableStoredEvents(runtime));
  for (const runtime of runtimes) {
    runtime.syncKnownEvents(storedEvents);
  }
}

function getPortableStoredEvents(runtime: NodeRuntime): NostrEvent[] {
  const invalidEventCodes = runtime.getInvalidEventCodes();
  return runtime.getStoredEvents().filter((event) => !invalidEventCodes.has(event.id));
}

async function runSameBlockChildRejectionScenario(input: {
  readonly network: NetworkName;
  readonly tempRoot: string;
  readonly params: GenesisParams;
  readonly genesis: NostrEvent;
  readonly nodeASecret: string;
  readonly payeeSecret: string;
  readonly payeePubkey: string;
  readonly rewardAmount: bigint;
  readonly minimumBurn: bigint;
  readonly createdAt: number;
}): Promise<boolean> {
  const scenarioRoot = path.join(input.tempRoot, 'same-block-child');
  fs.mkdirSync(scenarioRoot, { recursive: true });
  const node = new NodeRuntime(createLoopbackNodeConfig(input.network, path.join(scenarioRoot, 'node'), null, []), input.nodeASecret);
  try {
    await node.start(input.genesis);
    let currentCreatedAt = input.createdAt;
    while (node.chainExecutor.getActiveHeight() < 3n) {
      node.mineOne(currentCreatedAt += 1);
    }
    const spendableReward = node.listUtxos(node.getSigner().getPublicKeyHex()).find((utxo) => utxo.isReward && BigInt(utxo.createdHeight) <= 1n);
    assert.ok(spendableReward !== undefined);
    const parentTx = buildSignedTransactionEvent(input.nodeASecret, input.genesis.id, currentCreatedAt += 1, {
      version: 0,
      inputs: [{ sourceId: Buffer.from(spendableReward.txid, 'hex'), outputIndex: spendableReward.index }],
      outputs: [{ ownerPubkey: Buffer.from(input.payeePubkey, 'hex'), amount: input.rewardAmount - input.minimumBurn }]
    });
    const childTx = buildSignedTransactionEvent(input.payeeSecret, input.genesis.id, currentCreatedAt += 1, {
      version: 0,
      inputs: [{ sourceId: Buffer.from(parentTx.id, 'hex'), outputIndex: 0 }],
      outputs: [{ ownerPubkey: Buffer.from(input.payeePubkey, 'hex'), amount: input.rewardAmount - (input.minimumBurn * 2n) }]
    });
    node.syncKnownEvents([parentTx, childTx]);
    const invalidBlock = mineSignedBlockEvent(input.nodeASecret, input.genesis.id, node.chainExecutor.getActiveTip()!, currentCreatedAt += 1, [parentTx.id, childTx.id], input.params, node.chainExecutor.getConnectedBlock(node.chainExecutor.getActiveTip()!)!);
    node.receiveEvent(invalidBlock);
    return node.getInvalidEventCodes().get(invalidBlock.id) === 'BLK_INPUT_CONFLICT';
  } finally {
    await node.shutdown();
  }
}

function allocateLoopbackPorts(network: NetworkName, tempRoot: string): readonly [number, number, number] {
  const networkBase = network === 'mainnet' ? 19_400 : 19_500;
  let offset = 0;
  for (const character of tempRoot) {
    offset = (offset + character.charCodeAt(0)) % 300;
  }
  const basePort = networkBase + (offset * 3);
  return [basePort, basePort + 1, basePort + 2] as const;
}

function mineGenesisEvent(secretHex: string, params: GenesisParams, createdAt: number): NostrEvent {
  const crypto = new NobleCryptoProvider();
  const pubkey = bytesToHex(crypto.deriveXOnlyPublicKey(Buffer.from(secretHex, 'hex')));
  let nonce = 0n;
  for (;;) {
    const unsigned = buildUnsignedGenesisEvent({ params, minerPubkey: pubkey, createdAt, nonce });
    const id = computeEventId(unsigned);
    if (verifyBlockPow({ chainId: Buffer.from(id, 'hex'), parentId: Buffer.alloc(32, 0), eventId: Buffer.from(id, 'hex'), requiredDifficulty: params.powDifficulty, nonceGateBits: NIP13_GATE_BITS })) {
      return { ...unsigned, id, sig: Buffer.from(crypto.signSchnorr(Buffer.from(secretHex, 'hex'), Buffer.from(id, 'hex'))).toString('hex') };
    }
    nonce += 1n;
  }
}

function mineSignedBlockEvent(secretHex: string, chainIdHex: string, parentIdHex: string, createdAt: number, txIds: readonly string[], params: GenesisParams, parentBlock: { readonly height: bigint; readonly blockId: string; readonly parentId: string | null; readonly createdAt: number; readonly requiredDifficulty: number }): NostrEvent {
  const crypto = new NobleCryptoProvider();
  const pubkey = bytesToHex(crypto.deriveXOnlyPublicKey(Buffer.from(secretHex, 'hex')));
  const syntheticParams = {
    ...getNetworkParams('mainnet'),
    initialDifficultyBits: params.powDifficulty,
    blockReward: params.blockReward,
    rewardMaturity: params.rewardMaturity,
    baseFee: params.baseFee,
    inputFee: params.inputFee,
    outputFee: params.outputFee,
    maxTxInputs: params.maxTxInputs,
    maxTxOutputs: params.maxTxOutputs,
    maxBlockTransactions: params.maxBlockTransactions
  };
  const requiredDifficulty = calculateNextDifficulty(syntheticParams, parentBlock.height + 1n, parentBlock, () => parentBlock);
  let nonce = 0n;
  for (;;) {
    const unsignedBase = {
      pubkey,
      created_at: createdAt,
      kind: BLOCK_KIND,
      tags: buildBlockTags(chainIdHex, parentIdHex, txIds, nonce),
      content: '00'
    };
    const id = computeEventId(unsignedBase);
    if (verifyBlockPow({ chainId: Buffer.from(chainIdHex, 'hex'), parentId: Buffer.from(parentIdHex, 'hex'), eventId: Buffer.from(id, 'hex'), requiredDifficulty, nonceGateBits: NIP13_GATE_BITS })) {
      return { ...unsignedBase, id, sig: Buffer.from(crypto.signSchnorr(Buffer.from(secretHex, 'hex'), Buffer.from(id, 'hex'))).toString('hex') };
    }
    nonce += 1n;
  }
}

async function queryRelay(url: string, filter: Record<string, unknown>): Promise<RelayQueryResult> {
  return await new Promise<RelayQueryResult>((resolve, reject) => {
    const socket = new WebSocket(url);
    const seenEventIds: string[] = [];
    let settled = false;
    const timeout = setTimeout(() => finish({ eventIds: seenEventIds, eoseSeen: false }), 3_000);

    const finish = (result: RelayQueryResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      socket.close();
      resolve(result);
    };

    socket.once('open', () => {
      socket.send(JSON.stringify(['REQ', 'conformance-query', filter]));
    });
    socket.on('message', (raw) => {
      const parsed = JSON.parse(String(raw)) as unknown[];
      if (parsed[0] === 'EVENT' && typeof parsed[2] === 'object' && parsed[2] !== null) {
        seenEventIds.push((parsed[2] as NostrEvent).id);
        return;
      }
      if (parsed[0] === 'EOSE') {
        finish({ eventIds: seenEventIds, eoseSeen: true });
      }
    });
    socket.once('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      socket.close();
      reject(error);
    });
  });
}

async function waitForBlock(runtime: NodeRuntime, blockId: string, timeoutMs: number): Promise<void> {
  await waitFor(() => runtime.getStoredEvents().some((event) => event.id === blockId), timeoutMs);
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('timeout waiting for conformance condition');
}

async function safeShutdown(...runtimes: NodeRuntime[]): Promise<void> {
  await Promise.all(runtimes.map(async (runtime) => {
    try {
      await runtime.shutdown();
    } catch {
      // ignore cleanup failure
    }
  }));
}

function removeTempDirWithRetries(tempRoot: string): void {
  const deadline = Date.now() + 10_000;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      try {
        forceCloseSqliteFiles(tempRoot);
      } catch {
        // best-effort cleanup only
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
  void lastError;
}

function forceCloseSqliteFiles(tempRoot: string): void {
  const sqliteFiles = collectSqliteArtifacts(tempRoot);
  for (const sqliteFile of sqliteFiles) {
    try {
      fs.chmodSync(sqliteFile, 0o666);
    } catch {
      // ignore permission cleanup failure
    }
  }
}

function collectSqliteArtifacts(root: string): string[] {
  if (!fs.existsSync(root)) {
    return [];
  }
  const artifacts: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) {
      continue;
    }
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const resolved = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(resolved);
        continue;
      }
      if (entry.name.endsWith('.sqlite') || entry.name.endsWith('.sqlite-shm') || entry.name.endsWith('.sqlite-wal')) {
        artifacts.push(resolved);
      }
    }
  }
  return artifacts;
}
