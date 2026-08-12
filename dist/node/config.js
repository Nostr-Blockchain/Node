"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDefaultNodeConfig = createDefaultNodeConfig;
exports.loadNodeContext = loadNodeContext;
exports.parseListenAddress = parseListenAddress;
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = __importDefault(require("node:fs"));
const params_1 = require("../networks/params");
const relay_manager_1 = require("../nostr/relay-manager");
const descriptor_1 = require("../networks/descriptor");
function createDefaultNodeConfig(network, dataDir) {
    return {
        network,
        dataDir,
        databasePath: node_path_1.default.join(dataDir, 'chain.sqlite'),
        miningEnabled: true,
        miningMode: 'continuous',
        miningWorkerCount: 1,
        relays: [],
        embeddedRelayHost: '127.0.0.1',
        embeddedRelayPort: null,
        embeddedRelayListen: null,
        embeddedRelayPublicUrl: null,
        signerType: 'none',
        signerPath: null,
        signerPubkey: null,
        minRemoteWriteRelays: 1,
        controlEnabled: true
    };
}
function loadNodeContext(network, dataDir, baseDir = process.cwd()) {
    const configPath = node_path_1.default.join(dataDir, 'node.json');
    if (!node_fs_1.default.existsSync(configPath)) {
        throw new Error(`missing node configuration: ${configPath}`);
    }
    const parsed = JSON.parse(node_fs_1.default.readFileSync(configPath, 'utf8'));
    if (parsed.network !== network) {
        throw new Error(`existing node.json network mismatch: expected ${network}`);
    }
    const verifiedArtifacts = (0, descriptor_1.verifyNetworkArtifacts)((0, params_1.getNetworkParams)(network), baseDir);
    if (parsed.chain_id !== verifiedArtifacts.chainId) {
        throw new Error('existing node.json chain_id mismatch');
    }
    const relayListen = typeof parsed.embedded_relay?.listen === 'string' ? parsed.embedded_relay.listen : null;
    const relayAddress = relayListen === null ? null : parseListenAddress(relayListen);
    const extraRelays = Array.isArray(parsed.outbound_relays?.extra)
        ? parsed.outbound_relays?.extra.filter((value) => typeof value === 'string')
        : [];
    const embeddedRelayPublicUrl = typeof parsed.embedded_relay?.public_url === 'string' ? parsed.embedded_relay.public_url : null;
    const configuredRelays = [...verifiedArtifacts.descriptor.bootstrap_relays.map((relay) => relay.url), ...extraRelays]
        .filter((relayUrl) => embeddedRelayPublicUrl === null || (0, relay_manager_1.normalizeRelayUrl)(relayUrl) !== (0, relay_manager_1.normalizeRelayUrl)(embeddedRelayPublicUrl));
    return {
        configPath,
        rawConfig: parsed,
        chainId: verifiedArtifacts.chainId,
        runtimeConfig: {
            network,
            dataDir,
            databasePath: node_path_1.default.join(dataDir, 'chain.sqlite'),
            miningEnabled: true,
            miningMode: parsed.mining?.mode === 'disabled' || parsed.mining?.mode === 'mine-one' ? parsed.mining.mode : 'continuous',
            miningWorkerCount: typeof parsed.mining?.workers === 'number' && Number.isInteger(parsed.mining.workers) && parsed.mining.workers > 0 ? parsed.mining.workers : 1,
            relays: configuredRelays.map((url) => ({ url, relayClass: 'FULL_CHAIN', writable: true })),
            embeddedRelayHost: relayAddress?.host ?? '127.0.0.1',
            embeddedRelayPort: relayAddress?.port ?? null,
            embeddedRelayListen: relayListen,
            embeddedRelayPublicUrl,
            signerType: parsed.signer?.type === 'local-ncryptsec' ? 'local-ncryptsec' : 'none',
            signerPath: parsed.signer?.type === 'local-ncryptsec' && typeof parsed.signer.path === 'string'
                ? node_path_1.default.resolve(node_path_1.default.dirname(configPath), parsed.signer.path)
                : null,
            signerPubkey: parsed.signer?.type === 'local-ncryptsec' && typeof parsed.signer.pubkey === 'string'
                ? parsed.signer.pubkey
                : null,
            minRemoteWriteRelays: typeof parsed.mining?.min_remote_write_relays === 'number'
                && Number.isInteger(parsed.mining.min_remote_write_relays)
                && parsed.mining.min_remote_write_relays > 0
                ? parsed.mining.min_remote_write_relays
                : 1,
            controlEnabled: parsed.control?.enabled !== false
        }
    };
}
function parseListenAddress(value) {
    const separatorIndex = value.lastIndexOf(':');
    if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
        throw new Error(`invalid relay listen address: ${value}`);
    }
    const host = value.slice(0, separatorIndex);
    const port = Number(value.slice(separatorIndex + 1));
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new Error(`invalid relay listen address: ${value}`);
    }
    return { host, port };
}
