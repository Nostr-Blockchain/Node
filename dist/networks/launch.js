"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.launchNetwork = launchNetwork;
exports.initializeNetworkDataDir = initializeNetworkDataDir;
exports.sha256File = sha256File;
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const block_codec_1 = require("../consensus/block-codec");
const constants_1 = require("../consensus/constants");
const genesis_1 = require("../consensus/genesis");
const nip01_1 = require("../consensus/nip01");
const pow_1 = require("../consensus/pow");
const primitives_1 = require("../consensus/primitives");
const noble_provider_1 = require("../crypto/noble-provider");
const provider_1 = require("../signer/provider");
const ncryptsec_1 = require("../signer/ncryptsec");
const descriptor_1 = require("./descriptor");
const ZERO_PARENT_ID = Buffer.alloc(32, 0);
const DESCRIPTOR_FORMAT = 'nostr-blockchain-network-v0';
const NODE_CONFIG_FORMAT = 'nostr-blockchain-node-v0';
function launchNetwork(options) {
    const baseDir = node_path_1.default.resolve(options.baseDir ?? process.cwd());
    if (options.params.expectedGenesisId !== null) {
        throw new Error(`launch refused: frozen ${options.params.network} genesis id already set in source`);
    }
    const bootstrapUrls = validateLaunchBootstrapUrls(options.bootstrapUrls);
    const descriptorPath = (0, descriptor_1.getDescriptorPath)(options.params.network, baseDir);
    const genesisPath = (0, descriptor_1.getGenesisArtifactPath)(options.params.network, baseDir);
    refuseExistingArtifact(descriptorPath);
    refuseExistingArtifact(genesisPath);
    const launcherSecret = readLauncherSecretKey(options.launcherKeyPath);
    const cryptoProvider = new noble_provider_1.NobleCryptoProvider();
    const launcherPubkey = (0, primitives_1.bytesToHex)(cryptoProvider.deriveXOnlyPublicKey(launcherSecret));
    const createdAt = options.createdAt ?? Math.floor(Date.now() / 1000);
    const genesisParams = toGenesisParams(options.params);
    const genesisEvent = mineAndSignGenesisEvent(genesisParams, launcherPubkey, launcherSecret, createdAt, cryptoProvider);
    const descriptor = buildDescriptor(options.params, genesisEvent, bootstrapUrls);
    const descriptorJson = `${JSON.stringify(descriptor, null, 2)}\n`;
    const genesisJson = `${JSON.stringify(genesisEvent, null, 2)}\n`;
    writeArtifactPairAtomically(descriptorPath, descriptorJson, genesisPath, genesisJson);
    const verifiedArtifacts = (0, descriptor_1.verifyNetworkArtifacts)(options.params, baseDir);
    return {
        descriptorPath,
        genesisPath,
        descriptor: verifiedArtifacts.descriptor,
        genesisEvent: verifiedArtifacts.genesisEvent,
        descriptorSha256: verifiedArtifacts.descriptorFileSha256,
        genesisSha256: verifiedArtifacts.genesisFileSha256
    };
}
function initializeNetworkDataDir(options) {
    const baseDir = node_path_1.default.resolve(options.baseDir ?? process.cwd());
    const verifiedArtifacts = (0, descriptor_1.verifyNetworkArtifacts)(options.params, baseDir);
    const dataDir = node_path_1.default.resolve(options.dataDir);
    node_fs_1.default.mkdirSync(dataDir, { recursive: true });
    const databasePath = node_path_1.default.join(dataDir, 'chain.sqlite');
    const configPath = node_path_1.default.join(dataDir, 'node.json');
    const lockPath = node_path_1.default.join(dataDir, 'init.lock');
    const lockFileDescriptor = node_fs_1.default.openSync(lockPath, 'wx');
    try {
        refuseIncompatibleExistingDataDir(dataDir, options.params.network, verifiedArtifacts.chainId);
        const storeModule = require('../storage/node-store');
        const nodeStore = new storeModule.NodeStore(databasePath, options.params.network);
        try {
            const existingChainId = nodeStore.getMetaText('chain_id');
            if (existingChainId === null) {
                nodeStore.initializeChain(verifiedArtifacts.chainId, options.params.protocolVersion);
                seedGenesisEvent(nodeStore, verifiedArtifacts.genesisEvent, verifiedArtifacts.chainId);
            }
            nodeStore.validateChainBinding(verifiedArtifacts.chainId, options.params.protocolVersion);
        }
        finally {
            nodeStore.close();
        }
        let signerPubkey = null;
        if (!options.validatorOnly) {
            const signerPassword = process.env.NOSTR_BLOCKCHAIN_KEY_PASSWORD;
            if (typeof signerPassword !== 'string' || signerPassword.length === 0) {
                throw new Error('NOSTR_BLOCKCHAIN_KEY_PASSWORD must be set to initialize an encrypted local signer');
            }
            const signerProvider = new provider_1.LocalSignerProvider(node_path_1.default.join(dataDir, 'miner.ncryptsec'));
            signerPubkey = signerProvider.ensureSignerFile(signerPassword).pubkeyHex;
        }
        const nodeConfig = buildNodeConfig(options, dataDir, verifiedArtifacts.chainId, signerPubkey);
        writeTextFileAtomically(configPath, `${JSON.stringify(nodeConfig, null, 2)}\n`);
    }
    finally {
        node_fs_1.default.closeSync(lockFileDescriptor);
        node_fs_1.default.rmSync(lockPath, { force: true });
    }
    return {
        dataDir,
        configPath,
        databasePath,
        chainId: verifiedArtifacts.chainId,
        verifiedArtifacts
    };
}
function mineAndSignGenesisEvent(genesisParams, launcherPubkey, launcherSecret, initialCreatedAt, cryptoProvider) {
    for (let createdAt = initialCreatedAt; createdAt <= Number.MAX_SAFE_INTEGER; createdAt += 1) {
        for (let nonce = 0n; nonce <= 0xffffffffffffffffn; nonce += 1n) {
            const unsignedEvent = (0, genesis_1.buildUnsignedGenesisEvent)({
                params: genesisParams,
                minerPubkey: launcherPubkey,
                createdAt,
                nonce
            });
            const eventId = (0, nip01_1.computeEventId)(unsignedEvent);
            const powValid = (0, pow_1.verifyBlockPow)({
                chainId: (0, primitives_1.hexToBytes)(eventId, 32),
                parentId: ZERO_PARENT_ID,
                eventId: (0, primitives_1.hexToBytes)(eventId, 32),
                requiredDifficulty: genesisParams.powDifficulty,
                nonceGateBits: 6
            });
            if (!powValid) {
                continue;
            }
            const recomputedId = (0, nip01_1.computeEventId)(unsignedEvent);
            if (recomputedId !== eventId) {
                continue;
            }
            const signature = cryptoProvider.signSchnorr(launcherSecret, (0, primitives_1.hexToBytes)(eventId, 32));
            const signedEvent = {
                ...unsignedEvent,
                id: eventId,
                sig: (0, primitives_1.bytesToHex)(signature)
            };
            (0, nip01_1.validateNip01Event)(signedEvent, constants_1.BLOCK_KIND, cryptoProvider, 'BLK');
            (0, genesis_1.validateGenesisEvent)(signedEvent, cryptoProvider);
            (0, block_codec_1.parseBlockEvent)(signedEvent);
            return signedEvent;
        }
    }
    throw new Error('failed to mine genesis event');
}
function buildDescriptor(params, genesisEvent, bootstrapUrls) {
    return Object.freeze({
        format: DESCRIPTOR_FORMAT,
        network: params.network,
        chain_id: genesisEvent.id,
        protocol_version: params.protocolVersion,
        display_symbol: params.displaySymbol,
        minimum_known_chainwork: '0',
        minimum_known_height: 0,
        minimum_known_block_id: genesisEvent.id,
        genesis_event: genesisEvent,
        bootstrap_relays: Object.freeze(bootstrapUrls.map((url) => Object.freeze({ url })))
    });
}
function buildNodeConfig(options, dataDir, chainId, signerPubkey) {
    const relayPort = options.params.network === 'mainnet' ? 7447 : 17447;
    const listen = options.relayListen ?? `127.0.0.1:${relayPort}`;
    const signer = options.validatorOnly
        ? { type: 'none' }
        : { type: 'local-ncryptsec', path: 'miner.ncryptsec', pubkey: signerPubkey };
    const tlsMode = options.relayTlsCert !== undefined || options.relayTlsKey !== undefined ? 'direct' : 'none';
    return {
        format: NODE_CONFIG_FORMAT,
        network: options.params.network,
        chain_id: chainId,
        data_dir: dataDir,
        signer,
        embedded_relay: {
            enabled: true,
            listen,
            public_url: options.relayPublicUrl ?? null,
            tls: {
                mode: tlsMode,
                cert: options.relayTlsCert ?? null,
                key: options.relayTlsKey ?? null
            }
        },
        outbound_relays: {
            extra: [],
            target_active: 8,
            max_active: 16
        },
        mining: {
            mode: 'continuous',
            workers: 1,
            min_remote_write_relays: 1
        },
        control: {
            enabled: true
        },
        logging: {
            level: 'info'
        }
    };
}
function seedGenesisEvent(nodeStore, genesisEvent, chainId) {
    nodeStore.persistEvent(genesisEvent, 'nostr-blockchain:genesis', 'STATE_VALID', null, nodeStore.nextReceivedSeq());
    const parsedGenesis = (0, block_codec_1.parseBlockEvent)(genesisEvent);
    nodeStore.persistBlockStructure(parsedGenesis, {
        height: 0n,
        validationState: 'STATE_VALID',
        invalidCode: null,
        active: true,
        workDifficulty: (0, genesis_1.decodeGenesisContent)(genesisEvent.content).powDifficulty,
        medianTimePast: genesisEvent.created_at,
        creditedWork: 0n,
        cumulativeWork: 0n,
        totalBurn: 0n,
        totalPriority: 0n,
        rewardAmount: 0n,
        supplyAfter: 0n
    });
}
function toGenesisParams(params) {
    return {
        protocolVersion: params.protocolVersion,
        blockReward: params.blockReward,
        rewardMaturity: params.rewardMaturity,
        powDifficulty: params.initialDifficultyBits,
        baseFee: params.baseFee,
        inputFee: params.inputFee,
        outputFee: params.outputFee,
        maxTxInputs: params.maxTxInputs,
        maxTxOutputs: params.maxTxOutputs,
        maxBlockTransactions: params.maxBlockTransactions
    };
}
function readLauncherSecretKey(launcherKeyPath) {
    return (0, ncryptsec_1.readLegacyOrNcryptsecSecret)(node_path_1.default.resolve(launcherKeyPath), process.env.NOSTR_BLOCKCHAIN_LAUNCHER_PASSWORD ?? null);
}
function validateLaunchBootstrapUrls(urls) {
    if (urls.length < 3) {
        throw new Error('launch requires at least three bootstrap URLs');
    }
    const normalizedUrls = urls.map(normalizeBootstrapUrl);
    const uniqueUrls = new Set(normalizedUrls);
    if (uniqueUrls.size !== normalizedUrls.length) {
        throw new Error('duplicate bootstrap URLs are not allowed');
    }
    const distinctHosts = new Set(normalizedUrls.map((url) => new URL(url).hostname.toLowerCase()));
    if (distinctHosts.size < 3) {
        throw new Error('bootstrap URLs must use at least three distinct hostnames or literal IPs');
    }
    return Object.freeze(normalizedUrls);
}
function normalizeBootstrapUrl(value) {
    let parsedUrl;
    try {
        parsedUrl = new URL(value);
    }
    catch {
        throw new Error(`invalid bootstrap URL: ${value}`);
    }
    if (parsedUrl.protocol !== 'wss:') {
        throw new Error(`bootstrap URL must use wss://: ${value}`);
    }
    if (parsedUrl.username.length > 0 || parsedUrl.password.length > 0 || parsedUrl.search.length > 0 || parsedUrl.hash.length > 0) {
        throw new Error(`bootstrap URL must not contain credentials, query, or fragment: ${value}`);
    }
    return parsedUrl.toString();
}
function refuseExistingArtifact(filePath) {
    if (node_fs_1.default.existsSync(filePath)) {
        throw new Error(`refusing to overwrite existing artifact: ${filePath}`);
    }
}
function refuseIncompatibleExistingDataDir(dataDir, network, chainId) {
    const configPath = node_path_1.default.join(dataDir, 'node.json');
    if (node_fs_1.default.existsSync(configPath)) {
        const config = JSON.parse(node_fs_1.default.readFileSync(configPath, 'utf8'));
        if (config.network !== network) {
            throw new Error(`existing node.json network mismatch: expected ${network}`);
        }
        if (config.chain_id !== chainId) {
            throw new Error('existing node.json chain_id mismatch');
        }
    }
}
function writeArtifactPairAtomically(firstPath, firstText, secondPath, secondText) {
    writeTextFileAtomically(firstPath, firstText);
    try {
        writeTextFileAtomically(secondPath, secondText);
    }
    catch (error) {
        node_fs_1.default.rmSync(firstPath, { force: true });
        throw error;
    }
}
function writeTextFileAtomically(targetPath, text) {
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(targetPath), { recursive: true });
    const temporaryPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
    const fileDescriptor = node_fs_1.default.openSync(temporaryPath, 'wx');
    try {
        node_fs_1.default.writeFileSync(fileDescriptor, text, 'utf8');
        node_fs_1.default.fsyncSync(fileDescriptor);
    }
    finally {
        node_fs_1.default.closeSync(fileDescriptor);
    }
    node_fs_1.default.renameSync(temporaryPath, targetPath);
    const directoryPath = node_path_1.default.dirname(targetPath);
    try {
        const directoryDescriptor = node_fs_1.default.openSync(directoryPath, 'r');
        try {
            node_fs_1.default.fsyncSync(directoryDescriptor);
        }
        finally {
            node_fs_1.default.closeSync(directoryDescriptor);
        }
    }
    catch {
        // Directory fsync is platform-dependent; file fsync + atomic rename remains required baseline.
    }
    const reopenedText = node_fs_1.default.readFileSync(targetPath, 'utf8');
    if (reopenedText !== text) {
        throw new Error(`atomic write verification failed for ${targetPath}`);
    }
}
function sha256File(filePath) {
    const hash = node_crypto_1.default.createHash('sha256');
    hash.update(node_fs_1.default.readFileSync(filePath));
    return hash.digest('hex');
}
