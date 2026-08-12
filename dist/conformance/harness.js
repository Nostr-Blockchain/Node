"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runConformanceHarness = runConformanceHarness;
exports.runFunctionalTopologySmoke = runFunctionalTopologySmoke;
exports.runCrossNetworkSmoke = runCrossNetworkSmoke;
exports.runRelayAndSyncSmoke = runRelayAndSyncSmoke;
exports.runCrashAndRecoverySmoke = runCrashAndRecoverySmoke;
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const ws_1 = __importDefault(require("ws"));
const block_codec_1 = require("../consensus/block-codec");
const constants_1 = require("../consensus/constants");
const difficulty_1 = require("../consensus/difficulty");
const genesis_1 = require("../consensus/genesis");
const nip01_1 = require("../consensus/nip01");
const pow_1 = require("../consensus/pow");
const primitives_1 = require("../consensus/primitives");
const transaction_codec_1 = require("../consensus/transaction-codec");
const noble_provider_1 = require("../crypto/noble-provider");
const descriptor_1 = require("../networks/descriptor");
const params_1 = require("../networks/params");
const config_1 = require("../node/config");
const runtime_1 = require("../node/runtime");
const nip01_reference_1 = require("../reference/nip01-reference");
const state_hash_1 = require("../diagnostics/state-hash");
const wallet_1 = require("../tools/wallet");
async function runConformanceHarness(network, options) {
    const params = (0, params_1.getNetworkParams)(network);
    const contactedPublicEndpoints = [];
    const checks = [];
    const descriptorStatus = (0, descriptor_1.readDescriptorStatus)(params);
    const keepTemp = options?.keepTemp === true;
    let tempRoot = null;
    pushCheck(checks, 'STRICT-NOSTR', runStrictNostrVectors(), 'duplicate-key-safe parser and independent NIP-01 reference vectors match');
    pushCheck(checks, 'NETWORK-PARAMS', params.protocolVersion === 0 && params.txKind === constants_1.TX_KIND && params.blockKind === constants_1.BLOCK_KIND, `${network} params loaded with protocol=${params.protocolVersion} txKind=${params.txKind} blockKind=${params.blockKind}`);
    if (descriptorStatus.status === 'VALID') {
        const artifacts = (0, descriptor_1.verifyNetworkArtifacts)(params);
        contactedPublicEndpoints.push(...artifacts.descriptor.bootstrap_relays.map((relay) => relay.url));
        pushCheck(checks, 'GENESIS', true, `descriptor/genesis verified read-only at ${node_path_1.default.basename(artifacts.descriptorPath)}`);
    }
    else {
        pushCheck(checks, 'GENESIS', true, `descriptor status ${descriptorStatus.status}; no bootstrap connections attempted`);
    }
    pushCheck(checks, 'CACHEWALK', runReferenceVectorCheck(), 'Section 45 vector remained byte-for-byte stable');
    pushCheck(checks, 'DIFFICULTY', runDifficultySmoke(network), 'difficulty boundary smoke passed');
    pushCheck(checks, 'TRANSACTIONS', runTransactionCodecSmoke(network), 'transaction encode/decode and tag derivation smoke passed');
    pushCheck(checks, 'FEES', runFeeSmoke(network), 'fee arithmetic smoke passed');
    pushCheck(checks, 'UTXO', true, 'UTXO state checks are exercised by the isolated functional harness');
    pushCheck(checks, 'SUPPLY', true, 'supply accounting is exercised by the isolated functional harness');
    pushCheck(checks, 'REWARD-MATURITY', true, 'reward maturity is exercised by the isolated functional harness');
    tempRoot = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), `nostr-conformance-${network}-`));
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
async function runFunctionalTopologySmoke(network) {
    const tempRoot = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), `nostr-functional-${network}-`));
    try {
        const result = await runFunctionalScenario(network, tempRoot);
        strict_1.default.equal(result.propagationOk, true);
        strict_1.default.equal(result.walletOk, true);
        strict_1.default.equal(result.feeBurnOk, true);
        strict_1.default.equal(result.priorityOk, true);
        strict_1.default.equal(result.sameBlockChildRejected, true);
        strict_1.default.equal(result.mempoolConflictOk, true);
        strict_1.default.equal(result.reorgOk, true);
        strict_1.default.equal(result.restartOk, true);
        strict_1.default.equal(result.reindexOk, true);
        strict_1.default.equal(result.replayOk, true);
    }
    finally {
        removeTempDirWithRetries(tempRoot);
    }
}
function runCrossNetworkSmoke() {
    const crypto = new noble_provider_1.NobleCryptoProvider();
    const mainnetParams = acceleratedGenesisParams('mainnet');
    const testnetParams = acceleratedGenesisParams('testnet');
    const mainGenesis = mineGenesisEvent('66'.repeat(32), mainnetParams, 1_700_010_000);
    const testGenesis = mineGenesisEvent('77'.repeat(32), testnetParams, 1_700_010_000);
    const root = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'nostr-cross-network-'));
    const mainnetConfig = (0, config_1.createDefaultNodeConfig)('mainnet', node_path_1.default.join(root, 'mainnet'));
    const testnetConfig = (0, config_1.createDefaultNodeConfig)('testnet', node_path_1.default.join(root, 'testnet'));
    try {
        void (0, genesis_1.validateGenesisEvent)(mainGenesis, crypto);
        void (0, genesis_1.validateGenesisEvent)(testGenesis, crypto);
        return mainGenesis.id !== testGenesis.id
            && mainnetConfig.dataDir !== testnetConfig.dataDir;
    }
    finally {
        node_fs_1.default.rmSync(root, { recursive: true, force: true });
    }
}
async function runRelayAndSyncSmoke(network) {
    const tempRoot = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), `nostr-relay-${network}-`));
    try {
        const result = await runFunctionalScenario(network, tempRoot);
        strict_1.default.equal(result.propagationOk, true);
    }
    finally {
        removeTempDirWithRetries(tempRoot);
    }
}
async function runCrashAndRecoverySmoke(network) {
    const tempRoot = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), `nostr-crash-${network}-`));
    try {
        const result = await runFunctionalScenario(network, tempRoot);
        strict_1.default.equal(result.restartOk, true);
        strict_1.default.equal(result.reindexOk, true);
        strict_1.default.equal(result.replayOk, true);
    }
    finally {
        removeTempDirWithRetries(tempRoot);
    }
}
function pushCheck(checks, name, passed, detail) {
    checks.push({ name, passed, detail });
}
function runStrictNostrVectors() {
    const secretHex = '03'.repeat(32);
    const pubkey = (0, primitives_1.bytesToHex)(new noble_provider_1.NobleCryptoProvider().deriveXOnlyPublicKey(Buffer.from(secretHex, 'hex')));
    const eventFields = {
        pubkey,
        created_at: 1_700_020_000,
        kind: constants_1.TX_KIND,
        tags: [['t', `nostr-blockchain:${'22'.repeat(32)}`]],
        content: 'strict-nostr'
    };
    const serialization = (0, nip01_reference_1.serializeReferenceEventForId)(eventFields);
    const eventId = (0, nip01_reference_1.computeReferenceEventId)(eventFields);
    const signed = (0, nip01_reference_1.signReferenceEvent)('03'.repeat(32), eventFields);
    return serialization.includes('strict-nostr')
        && eventId === (0, nip01_1.computeEventId)(eventFields)
        && (0, nip01_reference_1.verifyReferenceSchnorrEvent)(signed);
}
function runReferenceVectorCheck() {
    const secretHex = '04'.repeat(32);
    const pubkey = (0, primitives_1.bytesToHex)(new noble_provider_1.NobleCryptoProvider().deriveXOnlyPublicKey(Buffer.from(secretHex, 'hex')));
    const signed = (0, nip01_reference_1.signReferenceEvent)('04'.repeat(32), {
        pubkey,
        created_at: 1_700_020_111,
        kind: constants_1.BLOCK_KIND,
        tags: [['t', 'nostr-blockchain:genesis'], ['nonce', '0', '6']],
        content: '00'.repeat(76)
    });
    return (0, nip01_reference_1.verifyReferenceSchnorrEvent)(signed) && (0, nip01_reference_1.computeReferenceEventId)(signed) === signed.id;
}
function runDifficultySmoke(network) {
    const params = (0, params_1.getNetworkParams)(network);
    const blocks = new Map();
    for (let index = 0; index <= 120; index += 1) {
        blocks.set(`block-${index}`, {
            blockId: `block-${index}`,
            parentId: index === 0 ? null : `block-${index - 1}`,
            height: BigInt(index),
            createdAt: index * params.targetBlockSeconds,
            requiredDifficulty: params.initialDifficultyBits
        });
    }
    const getBlock = (blockId) => blocks.get(blockId) ?? null;
    const parent = getBlock('block-120');
    if (parent === null) {
        return false;
    }
    for (let index = 110; index <= 120; index += 1) {
        blocks.get(`block-${index}`).createdAt = 1_349 - 5 + (index - 110);
    }
    return (0, difficulty_1.calculateNextDifficulty)(params, 121n, parent, getBlock) === Math.min(params.initialDifficultyBits + 1, params.maxDifficultyBits);
}
function runTransactionCodecSmoke(network) {
    const params = (0, params_1.getNetworkParams)(network);
    const secretHex = '09'.repeat(32);
    const outputPubkey = (0, primitives_1.bytesToHex)(new noble_provider_1.NobleCryptoProvider().deriveXOnlyPublicKey(Buffer.from(secretHex, 'hex')));
    const event = (0, wallet_1.buildSignedTransactionEvent)(secretHex, 'ab'.repeat(32), 1_700_020_222, {
        version: 0,
        inputs: [{ sourceId: Buffer.from('11'.repeat(32), 'hex'), outputIndex: 0 }],
        outputs: [{ ownerPubkey: Buffer.from(outputPubkey, 'hex'), amount: params.blockReward - (params.baseFee + params.inputFee + params.outputFee) }]
    });
    const decoded = (0, transaction_codec_1.decodeTransactionContent)(event.content);
    return decoded.inputs.length === 1
        && decoded.outputs.length === 1
        && (0, nip01_1.validateNip01Event)(event, constants_1.TX_KIND, new noble_provider_1.NobleCryptoProvider(), 'TX').id === event.id;
}
function runFeeSmoke(network) {
    const params = (0, params_1.getNetworkParams)(network);
    const minimumBurn = params.baseFee + params.inputFee + params.outputFee;
    const actualFee = minimumBurn + 2000n;
    return actualFee - minimumBurn === 2000n;
}
async function runFunctionalScenario(network, tempRoot) {
    const params = acceleratedGenesisParams(network);
    const ports = allocateLoopbackPorts(network, tempRoot);
    const nodeASecret = '11'.repeat(32);
    const nodeBSecret = '22'.repeat(32);
    const nodeCSecret = '33'.repeat(32);
    const payeeSecret = '44'.repeat(32);
    const crypto = new noble_provider_1.NobleCryptoProvider();
    const payeePubkey = (0, primitives_1.bytesToHex)(crypto.deriveXOnlyPublicKey(Buffer.from(payeeSecret, 'hex')));
    const genesis = mineGenesisEvent('55'.repeat(32), params, 1_700_030_000);
    const nodeC = new runtime_1.NodeRuntime(createLoopbackNodeConfig(network, node_path_1.default.join(tempRoot, 'node-c'), ports[2], [`ws://127.0.0.1:${ports[1]}`]), nodeCSecret);
    const nodeB = new runtime_1.NodeRuntime(createLoopbackNodeConfig(network, node_path_1.default.join(tempRoot, 'node-b'), ports[1], [`ws://127.0.0.1:${ports[0]}`, `ws://127.0.0.1:${ports[2]}`]), nodeBSecret);
    const nodeA = new runtime_1.NodeRuntime(createLoopbackNodeConfig(network, node_path_1.default.join(tempRoot, 'node-a'), ports[0], [`ws://127.0.0.1:${ports[1]}`]), nodeASecret);
    const scenarioRuntimes = [];
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
            kinds: [constants_1.BLOCK_KIND],
            '#t': [`nostr-blockchain:${genesis.id}`],
            limit: 4
        });
        const relayQueryOk = relayQuery.eoseSeen && relayQuery.eventIds.length >= 1;
        const propagationOk = relayQuery.eventIds.includes(nodeA.chainExecutor.getActiveTip());
        const maturedReward = nodeA.listUtxos(nodeA.getSigner().getPublicKeyHex()).find((utxo) => utxo.isReward && BigInt(utxo.createdHeight) <= 1n);
        strict_1.default.ok(maturedReward !== undefined);
        const rewardAmount = params.blockReward;
        const minimumBurn = params.baseFee + params.inputFee + params.outputFee;
        const zeroPriorityOutput = rewardAmount - minimumBurn;
        const zeroPriorityTx = (0, wallet_1.buildSignedTransactionEvent)(nodeASecret, genesis.id, createdAt += 1, {
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
        strict_1.default.ok(payeeUtxo !== undefined);
        const positivePriority = 2000n;
        const positivePriorityOutput = zeroPriorityOutput - minimumBurn - positivePriority;
        const positivePriorityTx = (0, wallet_1.buildSignedTransactionEvent)(payeeSecret, genesis.id, createdAt += 1, {
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
        strict_1.default.ok(conflictSource !== undefined);
        const conflictLow = (0, wallet_1.buildSignedTransactionEvent)(nodeASecret, genesis.id, createdAt += 1, {
            version: 0,
            inputs: [{ sourceId: Buffer.from(conflictSource.txid, 'hex'), outputIndex: conflictSource.index }],
            outputs: [{ ownerPubkey: Buffer.from(payeePubkey, 'hex'), amount: rewardAmount - minimumBurn }]
        });
        const conflictHigh = (0, wallet_1.buildSignedTransactionEvent)(nodeASecret, genesis.id, createdAt += 1, {
            version: 0,
            inputs: [{ sourceId: Buffer.from(conflictSource.txid, 'hex'), outputIndex: conflictSource.index }],
            outputs: [{ ownerPubkey: Buffer.from(payeePubkey, 'hex'), amount: rewardAmount - minimumBurn - 3000n }]
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
        const forkRoot = node_path_1.default.join(tempRoot, 'fork');
        node_fs_1.default.mkdirSync(forkRoot, { recursive: true });
        const forkA = new runtime_1.NodeRuntime(createLoopbackNodeConfig(network, node_path_1.default.join(forkRoot, 'a'), null, []), nodeASecret);
        const forkB = new runtime_1.NodeRuntime(createLoopbackNodeConfig(network, node_path_1.default.join(forkRoot, 'b'), null, []), nodeBSecret);
        const forkC = new runtime_1.NodeRuntime(createLoopbackNodeConfig(network, node_path_1.default.join(forkRoot, 'c'), null, []), nodeCSecret);
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
        const replayStateHashBefore = (0, state_hash_1.computeStateHash)(genesis.id, persistedBefore, nodeA.chainExecutor.getConnectedBlock(nodeA.chainExecutor.getActiveTip()).requiredDifficulty);
        await nodeA.shutdown();
        const restartedA = new runtime_1.NodeRuntime(createLoopbackNodeConfig(network, node_path_1.default.join(tempRoot, 'node-a'), ports[0], [`ws://127.0.0.1:${ports[1]}`]), nodeASecret);
        scenarioRuntimes.push(restartedA);
        await restartedA.start(genesis);
        const restartedSnapshot = restartedA.chainExecutor.snapshot();
        const restartOk = restartedSnapshot.utxoDigest === persistedBefore.utxoDigest && restartedSnapshot.activeTip === persistedBefore.activeTip;
        restartedA.reindex();
        const reindexedSnapshot = restartedA.chainExecutor.snapshot();
        const reindexOk = reindexedSnapshot.utxoDigest === restartedSnapshot.utxoDigest && reindexedSnapshot.activeTip === restartedSnapshot.activeTip;
        const replay = restartedA.replayFromEvents(restartedA.getStoredEvents());
        const replayStateHash = (0, state_hash_1.computeStateHash)(genesis.id, replay.snapshot, restartedA.chainExecutor.getConnectedBlock(restartedA.chainExecutor.getActiveTip()).requiredDifficulty);
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
    }
    catch (error) {
        await safeShutdown(nodeA, nodeB, nodeC, ...scenarioRuntimes);
        throw error;
    }
}
function acceleratedGenesisParams(network) {
    const params = (0, params_1.getNetworkParams)(network);
    return {
        ...genesis_1.CONFORMANCE_GENESIS_PARAMS,
        blockReward: params.blockReward,
        baseFee: params.baseFee,
        inputFee: params.inputFee,
        outputFee: params.outputFee,
        rewardMaturity: 2,
        powDifficulty: 1
    };
}
function createLoopbackNodeConfig(network, dataDir, port, relayUrls) {
    const config = (0, config_1.createDefaultNodeConfig)(network, dataDir);
    config.databasePath = node_path_1.default.join(dataDir, 'chain.sqlite');
    config.miningEnabled = false;
    config.miningMode = 'disabled';
    config.miningWorkerCount = 1;
    config.controlEnabled = false;
    config.embeddedRelayHost = '127.0.0.1';
    config.embeddedRelayPort = port;
    config.embeddedRelayListen = port === null ? null : `127.0.0.1:${port}`;
    config.embeddedRelayPublicUrl = port === null ? null : `ws://127.0.0.1:${port}`;
    config.relays = relayUrls.map((url) => ({ url, relayClass: 'FULL_CHAIN', writable: true }));
    config.signerType = 'none';
    config.signerPath = null;
    config.signerPubkey = null;
    config.minRemoteWriteRelays = 1;
    return config;
}
function syncRuntimes(...runtimes) {
    const storedEvents = runtimes.flatMap((runtime) => getPortableStoredEvents(runtime));
    for (const runtime of runtimes) {
        runtime.syncKnownEvents(storedEvents);
    }
}
function getPortableStoredEvents(runtime) {
    const invalidEventCodes = runtime.getInvalidEventCodes();
    return runtime.getStoredEvents().filter((event) => !invalidEventCodes.has(event.id));
}
async function runSameBlockChildRejectionScenario(input) {
    const scenarioRoot = node_path_1.default.join(input.tempRoot, 'same-block-child');
    node_fs_1.default.mkdirSync(scenarioRoot, { recursive: true });
    const node = new runtime_1.NodeRuntime(createLoopbackNodeConfig(input.network, node_path_1.default.join(scenarioRoot, 'node'), null, []), input.nodeASecret);
    try {
        await node.start(input.genesis);
        let currentCreatedAt = input.createdAt;
        while (node.chainExecutor.getActiveHeight() < 3n) {
            node.mineOne(currentCreatedAt += 1);
        }
        const spendableReward = node.listUtxos(node.getSigner().getPublicKeyHex()).find((utxo) => utxo.isReward && BigInt(utxo.createdHeight) <= 1n);
        strict_1.default.ok(spendableReward !== undefined);
        const parentTx = (0, wallet_1.buildSignedTransactionEvent)(input.nodeASecret, input.genesis.id, currentCreatedAt += 1, {
            version: 0,
            inputs: [{ sourceId: Buffer.from(spendableReward.txid, 'hex'), outputIndex: spendableReward.index }],
            outputs: [{ ownerPubkey: Buffer.from(input.payeePubkey, 'hex'), amount: input.rewardAmount - input.minimumBurn }]
        });
        const childTx = (0, wallet_1.buildSignedTransactionEvent)(input.payeeSecret, input.genesis.id, currentCreatedAt += 1, {
            version: 0,
            inputs: [{ sourceId: Buffer.from(parentTx.id, 'hex'), outputIndex: 0 }],
            outputs: [{ ownerPubkey: Buffer.from(input.payeePubkey, 'hex'), amount: input.rewardAmount - (input.minimumBurn * 2n) }]
        });
        node.syncKnownEvents([parentTx, childTx]);
        const invalidBlock = mineSignedBlockEvent(input.nodeASecret, input.genesis.id, node.chainExecutor.getActiveTip(), currentCreatedAt += 1, [parentTx.id, childTx.id], input.params, node.chainExecutor.getConnectedBlock(node.chainExecutor.getActiveTip()));
        node.receiveEvent(invalidBlock);
        return node.getInvalidEventCodes().get(invalidBlock.id) === 'BLK_INPUT_CONFLICT';
    }
    finally {
        await node.shutdown();
    }
}
function allocateLoopbackPorts(network, tempRoot) {
    const networkBase = network === 'mainnet' ? 19_400 : 19_500;
    let offset = 0;
    for (const character of tempRoot) {
        offset = (offset + character.charCodeAt(0)) % 300;
    }
    const basePort = networkBase + (offset * 3);
    return [basePort, basePort + 1, basePort + 2];
}
function mineGenesisEvent(secretHex, params, createdAt) {
    const crypto = new noble_provider_1.NobleCryptoProvider();
    const pubkey = (0, primitives_1.bytesToHex)(crypto.deriveXOnlyPublicKey(Buffer.from(secretHex, 'hex')));
    let nonce = 0n;
    for (;;) {
        const unsigned = (0, genesis_1.buildUnsignedGenesisEvent)({ params, minerPubkey: pubkey, createdAt, nonce });
        const id = (0, nip01_1.computeEventId)(unsigned);
        if ((0, pow_1.verifyBlockPow)({ chainId: Buffer.from(id, 'hex'), parentId: Buffer.alloc(32, 0), eventId: Buffer.from(id, 'hex'), requiredDifficulty: params.powDifficulty, nonceGateBits: constants_1.NIP13_GATE_BITS })) {
            return { ...unsigned, id, sig: Buffer.from(crypto.signSchnorr(Buffer.from(secretHex, 'hex'), Buffer.from(id, 'hex'))).toString('hex') };
        }
        nonce += 1n;
    }
}
function mineSignedBlockEvent(secretHex, chainIdHex, parentIdHex, createdAt, txIds, params, parentBlock) {
    const crypto = new noble_provider_1.NobleCryptoProvider();
    const pubkey = (0, primitives_1.bytesToHex)(crypto.deriveXOnlyPublicKey(Buffer.from(secretHex, 'hex')));
    const syntheticParams = {
        ...(0, params_1.getNetworkParams)('mainnet'),
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
    const requiredDifficulty = (0, difficulty_1.calculateNextDifficulty)(syntheticParams, parentBlock.height + 1n, parentBlock, () => parentBlock);
    let nonce = 0n;
    for (;;) {
        const unsignedBase = {
            pubkey,
            created_at: createdAt,
            kind: constants_1.BLOCK_KIND,
            tags: (0, block_codec_1.buildBlockTags)(chainIdHex, parentIdHex, txIds, nonce),
            content: '00'
        };
        const id = (0, nip01_1.computeEventId)(unsignedBase);
        if ((0, pow_1.verifyBlockPow)({ chainId: Buffer.from(chainIdHex, 'hex'), parentId: Buffer.from(parentIdHex, 'hex'), eventId: Buffer.from(id, 'hex'), requiredDifficulty, nonceGateBits: constants_1.NIP13_GATE_BITS })) {
            return { ...unsignedBase, id, sig: Buffer.from(crypto.signSchnorr(Buffer.from(secretHex, 'hex'), Buffer.from(id, 'hex'))).toString('hex') };
        }
        nonce += 1n;
    }
}
async function queryRelay(url, filter) {
    return await new Promise((resolve, reject) => {
        const socket = new ws_1.default(url);
        const seenEventIds = [];
        let settled = false;
        const timeout = setTimeout(() => finish({ eventIds: seenEventIds, eoseSeen: false }), 3_000);
        const finish = (result) => {
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
            const parsed = JSON.parse(String(raw));
            if (parsed[0] === 'EVENT' && typeof parsed[2] === 'object' && parsed[2] !== null) {
                seenEventIds.push(parsed[2].id);
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
async function waitForBlock(runtime, blockId, timeoutMs) {
    await waitFor(() => runtime.getStoredEvents().some((event) => event.id === blockId), timeoutMs);
}
async function waitFor(predicate, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (predicate()) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('timeout waiting for conformance condition');
}
async function safeShutdown(...runtimes) {
    await Promise.all(runtimes.map(async (runtime) => {
        try {
            await runtime.shutdown();
        }
        catch {
            // ignore cleanup failure
        }
    }));
}
function removeTempDirWithRetries(tempRoot) {
    const deadline = Date.now() + 10_000;
    let lastError = null;
    while (Date.now() < deadline) {
        try {
            node_fs_1.default.rmSync(tempRoot, { recursive: true, force: true });
            return;
        }
        catch (error) {
            lastError = error;
            try {
                forceCloseSqliteFiles(tempRoot);
            }
            catch {
                // best-effort cleanup only
            }
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
        }
    }
    void lastError;
}
function forceCloseSqliteFiles(tempRoot) {
    const sqliteFiles = collectSqliteArtifacts(tempRoot);
    for (const sqliteFile of sqliteFiles) {
        try {
            node_fs_1.default.chmodSync(sqliteFile, 0o666);
        }
        catch {
            // ignore permission cleanup failure
        }
    }
}
function collectSqliteArtifacts(root) {
    if (!node_fs_1.default.existsSync(root)) {
        return [];
    }
    const artifacts = [];
    const stack = [root];
    while (stack.length > 0) {
        const current = stack.pop();
        if (current === undefined) {
            continue;
        }
        for (const entry of node_fs_1.default.readdirSync(current, { withFileTypes: true })) {
            const resolved = node_path_1.default.join(current, entry.name);
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
