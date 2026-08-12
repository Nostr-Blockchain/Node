"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runDoctor = runDoctor;
const node_fs_1 = __importDefault(require("node:fs"));
const node_net_1 = __importDefault(require("node:net"));
const descriptor_1 = require("../networks/descriptor");
const params_1 = require("../networks/params");
const relay_manager_1 = require("../nostr/relay-manager");
const config_1 = require("../node/config");
const node_store_1 = require("../storage/node-store");
const local_socket_1 = require("../control/local-socket");
const provider_1 = require("../signer/provider");
async function runDoctor(context, baseDir = process.cwd()) {
    const checks = [];
    try {
        const artifacts = (0, descriptor_1.verifyNetworkArtifacts)((0, params_1.getNetworkParams)(context.runtimeConfig.network), baseDir);
        checks.push({ name: 'descriptor/genesis verification', status: 'PASS', detail: artifacts.chainId });
    }
    catch (error) {
        checks.push({ name: 'descriptor/genesis verification', status: 'FAIL', detail: error instanceof Error ? error.message : String(error) });
    }
    checks.push(checkDataDirPermissions(context.runtimeConfig.dataDir));
    checks.push(checkSignerPath(context));
    checks.push(checkTlsFiles(context));
    checks.push(checkBootstrapUrls(context));
    checks.push(await checkEmbeddedRelayBind(context));
    checks.push(checkFreeDisk(context.runtimeConfig.dataDir));
    if ((0, local_socket_1.hasControlSocket)(context.runtimeConfig.dataDir)) {
        checks.push({ name: 'database lock', status: 'PASS', detail: 'running node owns the data directory lock' });
    }
    else {
        let store = null;
        try {
            store = new node_store_1.NodeStore(context.runtimeConfig.databasePath, context.runtimeConfig.network);
            store.validateChainBinding(context.chainId, (0, params_1.getNetworkParams)(context.runtimeConfig.network).protocolVersion);
            checks.push({ name: 'database lock', status: 'PASS', detail: 'exclusive offline access acquired' });
            checks.push({ name: 'SQLite integrity quick check', status: store.verifyIntegrity() === 'ok' ? 'PASS' : 'FAIL', detail: store.verifyIntegrity() });
            checks.push({ name: 'schema/network/chain ID', status: 'PASS', detail: `${context.runtimeConfig.network}/${context.chainId}` });
            const activeTip = store.getMetaText('active_tip');
            const activeHeight = store.getMetaText('active_height') ?? '0';
            const activeMtp = getActiveMedianTimePast(store);
            if (activeTip !== null && activeTip.length > 0 && activeMtp > Math.floor(Date.now() / 1000) + 120) {
                checks.push({ name: 'system clock sanity relative to active MTP', status: 'FAIL', detail: `local clock is behind active MTP at height ${activeHeight}` });
            }
            else {
                checks.push({ name: 'system clock sanity relative to active MTP', status: 'PASS', detail: `active_tip=${activeTip ?? ''}` });
            }
        }
        catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            checks.push({ name: 'database lock', status: 'FAIL', detail });
            checks.push({ name: 'SQLite integrity quick check', status: 'FAIL', detail });
            checks.push({ name: 'schema/network/chain ID', status: 'FAIL', detail });
        }
        finally {
            store?.close();
        }
    }
    return {
        ok: checks.every((check) => check.status !== 'FAIL'),
        checks
    };
}
function checkDataDirPermissions(dataDir) {
    try {
        const stats = node_fs_1.default.statSync(dataDir);
        if (process.platform !== 'win32' && (stats.mode & 0o077) !== 0) {
            return { name: 'data-dir permissions', status: 'WARN', detail: 'data directory is more permissive than 0700' };
        }
        return { name: 'data-dir permissions', status: 'PASS', detail: dataDir };
    }
    catch (error) {
        return { name: 'data-dir permissions', status: 'FAIL', detail: error instanceof Error ? error.message : String(error) };
    }
}
function checkSignerPath(context) {
    if (context.runtimeConfig.signerType !== 'local-ncryptsec' || context.runtimeConfig.signerPath === null) {
        return { name: 'key readability without exposing secret', status: 'WARN', detail: 'local signer is not configured' };
    }
    try {
        const signerProvider = new provider_1.LocalSignerProvider(context.runtimeConfig.signerPath);
        signerProvider.checkReadable();
        return { name: 'key readability without exposing secret', status: 'PASS', detail: context.runtimeConfig.signerPath };
    }
    catch (error) {
        return { name: 'key readability without exposing secret', status: 'FAIL', detail: error instanceof Error ? error.message : String(error) };
    }
}
function checkTlsFiles(context) {
    const tls = context.rawConfig.embedded_relay?.tls;
    if (tls?.mode !== 'direct') {
        return { name: 'TLS certificate/key load', status: 'PASS', detail: 'TLS disabled' };
    }
    try {
        if (typeof tls.cert !== 'string' || typeof tls.key !== 'string') {
            throw new Error('direct TLS mode requires cert and key paths');
        }
        node_fs_1.default.accessSync(tls.cert, node_fs_1.default.constants.R_OK);
        node_fs_1.default.accessSync(tls.key, node_fs_1.default.constants.R_OK);
        return { name: 'TLS certificate/key load', status: 'PASS', detail: `${tls.cert} | ${tls.key}` };
    }
    catch (error) {
        return { name: 'TLS certificate/key load', status: 'FAIL', detail: error instanceof Error ? error.message : String(error) };
    }
}
function checkBootstrapUrls(context) {
    const urls = context.runtimeConfig.relays.map((relay) => relay.url);
    try {
        urls.forEach((url) => {
            (0, relay_manager_1.normalizeRelayUrl)(url);
        });
        return { name: 'bootstrap URL syntax', status: 'PASS', detail: `${urls.length} configured relay URLs` };
    }
    catch (error) {
        return { name: 'bootstrap URL syntax', status: 'FAIL', detail: error instanceof Error ? error.message : String(error) };
    }
}
async function checkEmbeddedRelayBind(context) {
    if (context.runtimeConfig.embeddedRelayListen === null || context.runtimeConfig.embeddedRelayPort === null) {
        return { name: 'embedded relay bind availability', status: 'PASS', detail: 'embedded relay disabled' };
    }
    if ((0, local_socket_1.hasControlSocket)(context.runtimeConfig.dataDir)) {
        return { name: 'embedded relay bind availability', status: 'PASS', detail: 'running node owns embedded relay listener' };
    }
    try {
        const { host, port } = (0, config_1.parseListenAddress)(context.runtimeConfig.embeddedRelayListen);
        const server = node_net_1.default.createServer();
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(port, host, () => resolve());
        });
        await new Promise((resolve, reject) => {
            server.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve();
            });
        });
        return { name: 'embedded relay bind availability', status: 'PASS', detail: context.runtimeConfig.embeddedRelayListen };
    }
    catch (error) {
        return { name: 'embedded relay bind availability', status: 'FAIL', detail: error instanceof Error ? error.message : String(error) };
    }
}
function checkFreeDisk(dataDir) {
    try {
        const stats = node_fs_1.default.statfsSync(dataDir);
        const freeBytes = BigInt(stats.bavail) * BigInt(stats.bsize);
        if (freeBytes < 100n * 1024n * 1024n) {
            return { name: 'free disk-space warning', status: 'WARN', detail: `${freeBytes.toString(10)} bytes available` };
        }
        return { name: 'free disk-space warning', status: 'PASS', detail: `${freeBytes.toString(10)} bytes available` };
    }
    catch (error) {
        return { name: 'free disk-space warning', status: 'WARN', detail: error instanceof Error ? error.message : String(error) };
    }
}
function getActiveMedianTimePast(store) {
    const row = store.connection
        .prepare('SELECT median_time_past FROM blocks WHERE block_id = ?')
        .get(Buffer.from(store.getMetaText('active_tip') ?? '', 'hex'));
    return row?.median_time_past ?? 0;
}
