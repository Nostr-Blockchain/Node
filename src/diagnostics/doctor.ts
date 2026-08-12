import fs from 'node:fs';
import net from 'node:net';

import { verifyNetworkArtifacts } from '../networks/descriptor';
import { getNetworkParams } from '../networks/params';
import { normalizeRelayUrl } from '../nostr/relay-manager';
import { LoadedNodeContext, parseListenAddress } from '../node/config';
import { NodeStore } from '../storage/node-store';
import { hasControlSocket } from '../control/local-socket';
import { LocalSignerProvider } from '../signer/provider';

export interface DoctorCheck {
  readonly name: string;
  readonly status: 'PASS' | 'FAIL' | 'WARN';
  readonly detail: string;
}

export interface DoctorReport {
  readonly ok: boolean;
  readonly checks: readonly DoctorCheck[];
}

export async function runDoctor(context: LoadedNodeContext, baseDir = process.cwd()): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  try {
    const artifacts = verifyNetworkArtifacts(getNetworkParams(context.runtimeConfig.network), baseDir);
    checks.push({ name: 'descriptor/genesis verification', status: 'PASS', detail: artifacts.chainId });
  } catch (error) {
    checks.push({ name: 'descriptor/genesis verification', status: 'FAIL', detail: error instanceof Error ? error.message : String(error) });
  }

  checks.push(checkDataDirPermissions(context.runtimeConfig.dataDir));
  checks.push(checkSignerPath(context));
  checks.push(checkTlsFiles(context));
  checks.push(checkBootstrapUrls(context));
  checks.push(await checkEmbeddedRelayBind(context));
  checks.push(checkFreeDisk(context.runtimeConfig.dataDir));

  if (hasControlSocket(context.runtimeConfig.dataDir)) {
    checks.push({ name: 'database lock', status: 'PASS', detail: 'running node owns the data directory lock' });
  } else {
    let store: NodeStore | null = null;
    try {
      store = new NodeStore(context.runtimeConfig.databasePath, context.runtimeConfig.network);
      store.validateChainBinding(context.chainId, getNetworkParams(context.runtimeConfig.network).protocolVersion);
      checks.push({ name: 'database lock', status: 'PASS', detail: 'exclusive offline access acquired' });
      checks.push({ name: 'SQLite integrity quick check', status: store.verifyIntegrity() === 'ok' ? 'PASS' : 'FAIL', detail: store.verifyIntegrity() });
      checks.push({ name: 'schema/network/chain ID', status: 'PASS', detail: `${context.runtimeConfig.network}/${context.chainId}` });
      const activeTip = store.getMetaText('active_tip');
      const activeHeight = store.getMetaText('active_height') ?? '0';
      const activeMtp = getActiveMedianTimePast(store);
      if (activeTip !== null && activeTip.length > 0 && activeMtp > Math.floor(Date.now() / 1000) + 120) {
        checks.push({ name: 'system clock sanity relative to active MTP', status: 'FAIL', detail: `local clock is behind active MTP at height ${activeHeight}` });
      } else {
        checks.push({ name: 'system clock sanity relative to active MTP', status: 'PASS', detail: `active_tip=${activeTip ?? ''}` });
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      checks.push({ name: 'database lock', status: 'FAIL', detail });
      checks.push({ name: 'SQLite integrity quick check', status: 'FAIL', detail });
      checks.push({ name: 'schema/network/chain ID', status: 'FAIL', detail });
    } finally {
      store?.close();
    }
  }

  return {
    ok: checks.every((check) => check.status !== 'FAIL'),
    checks
  };
}

function checkDataDirPermissions(dataDir: string): DoctorCheck {
  try {
    const stats = fs.statSync(dataDir);
    if (process.platform !== 'win32' && (stats.mode & 0o077) !== 0) {
      return { name: 'data-dir permissions', status: 'WARN', detail: 'data directory is more permissive than 0700' };
    }
    return { name: 'data-dir permissions', status: 'PASS', detail: dataDir };
  } catch (error) {
    return { name: 'data-dir permissions', status: 'FAIL', detail: error instanceof Error ? error.message : String(error) };
  }
}

function checkSignerPath(context: LoadedNodeContext): DoctorCheck {
  if (context.runtimeConfig.signerType !== 'local-ncryptsec' || context.runtimeConfig.signerPath === null) {
    return { name: 'key readability without exposing secret', status: 'WARN', detail: 'local signer is not configured' };
  }
  try {
    const signerProvider = new LocalSignerProvider(context.runtimeConfig.signerPath);
    signerProvider.checkReadable();
    return { name: 'key readability without exposing secret', status: 'PASS', detail: context.runtimeConfig.signerPath };
  } catch (error) {
    return { name: 'key readability without exposing secret', status: 'FAIL', detail: error instanceof Error ? error.message : String(error) };
  }
}

function checkTlsFiles(context: LoadedNodeContext): DoctorCheck {
  const tls = context.rawConfig.embedded_relay?.tls;
  if (tls?.mode !== 'direct') {
    return { name: 'TLS certificate/key load', status: 'PASS', detail: 'TLS disabled' };
  }
  try {
    if (typeof tls.cert !== 'string' || typeof tls.key !== 'string') {
      throw new Error('direct TLS mode requires cert and key paths');
    }
    fs.accessSync(tls.cert, fs.constants.R_OK);
    fs.accessSync(tls.key, fs.constants.R_OK);
    return { name: 'TLS certificate/key load', status: 'PASS', detail: `${tls.cert} | ${tls.key}` };
  } catch (error) {
    return { name: 'TLS certificate/key load', status: 'FAIL', detail: error instanceof Error ? error.message : String(error) };
  }
}

function checkBootstrapUrls(context: LoadedNodeContext): DoctorCheck {
  const urls = context.runtimeConfig.relays.map((relay) => relay.url);
  try {
    urls.forEach((url) => {
      normalizeRelayUrl(url);
    });
    return { name: 'bootstrap URL syntax', status: 'PASS', detail: `${urls.length} configured relay URLs` };
  } catch (error) {
    return { name: 'bootstrap URL syntax', status: 'FAIL', detail: error instanceof Error ? error.message : String(error) };
  }
}

async function checkEmbeddedRelayBind(context: LoadedNodeContext): Promise<DoctorCheck> {
  if (context.runtimeConfig.embeddedRelayListen === null || context.runtimeConfig.embeddedRelayPort === null) {
    return { name: 'embedded relay bind availability', status: 'PASS', detail: 'embedded relay disabled' };
  }
  if (hasControlSocket(context.runtimeConfig.dataDir)) {
    return { name: 'embedded relay bind availability', status: 'PASS', detail: 'running node owns embedded relay listener' };
  }
  try {
    const { host, port } = parseListenAddress(context.runtimeConfig.embeddedRelayListen);
    const server = net.createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => resolve());
    });
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    return { name: 'embedded relay bind availability', status: 'PASS', detail: context.runtimeConfig.embeddedRelayListen };
  } catch (error) {
    return { name: 'embedded relay bind availability', status: 'FAIL', detail: error instanceof Error ? error.message : String(error) };
  }
}

function checkFreeDisk(dataDir: string): DoctorCheck {
  try {
    const stats = fs.statfsSync(dataDir);
    const freeBytes = BigInt(stats.bavail) * BigInt(stats.bsize);
    if (freeBytes < 100n * 1024n * 1024n) {
      return { name: 'free disk-space warning', status: 'WARN', detail: `${freeBytes.toString(10)} bytes available` };
    }
    return { name: 'free disk-space warning', status: 'PASS', detail: `${freeBytes.toString(10)} bytes available` };
  } catch (error) {
    return { name: 'free disk-space warning', status: 'WARN', detail: error instanceof Error ? error.message : String(error) };
  }
}

function getActiveMedianTimePast(store: NodeStore): number {
  const row = (store as unknown as { connection: { prepare: (sql: string) => { get: (...args: unknown[]) => { median_time_past?: number } | undefined } } }).connection
    .prepare('SELECT median_time_past FROM blocks WHERE block_id = ?')
    .get(Buffer.from(store.getMetaText('active_tip') ?? '', 'hex'));
  return row?.median_time_past ?? 0;
}
