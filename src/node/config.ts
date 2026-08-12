import path from 'node:path';
import fs from 'node:fs';

import { getNetworkParams, NetworkName } from '../networks/params';
import { normalizeRelayUrl, RelayConfig } from '../nostr/relay-manager';
import { verifyNetworkArtifacts } from '../networks/descriptor';

export interface NodeConfig {
  network: NetworkName;
  dataDir: string;
  databasePath: string;
  miningEnabled: boolean;
  miningMode: 'continuous' | 'disabled' | 'mine-one';
  miningWorkerCount: number;
  relays: RelayConfig[];
  embeddedRelayHost: string;
  embeddedRelayPort: number | null;
  embeddedRelayListen: string | null;
  embeddedRelayPublicUrl: string | null;
  signerType: 'local-ncryptsec' | 'none';
  signerPath: string | null;
  signerPubkey?: string | null;
  minRemoteWriteRelays?: number;
  controlEnabled: boolean;
}

export function createDefaultNodeConfig(network: NetworkName, dataDir: string): NodeConfig {
  return {
    network,
    dataDir,
    databasePath: path.join(dataDir, 'chain.sqlite'),
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

interface PersistedNodeConfig {
  readonly network: NetworkName;
  readonly chain_id: string;
  readonly data_dir: string;
  readonly signer?: { readonly type?: unknown; readonly path?: unknown; readonly pubkey?: unknown };
  readonly embedded_relay?: {
    readonly enabled?: unknown;
    readonly listen?: unknown;
    readonly public_url?: unknown;
    readonly tls?: { readonly mode?: unknown; readonly cert?: unknown; readonly key?: unknown };
  };
  readonly outbound_relays?: { readonly extra?: unknown };
  readonly mining?: { readonly mode?: unknown; readonly workers?: unknown };
  readonly control?: { readonly enabled?: unknown };
}

export interface LoadedNodeContext {
  readonly configPath: string;
  readonly rawConfig: PersistedNodeConfig;
  readonly runtimeConfig: NodeConfig;
  readonly chainId: string;
}

export function loadNodeContext(network: NetworkName, dataDir: string, baseDir = process.cwd()): LoadedNodeContext {
  const configPath = path.join(dataDir, 'node.json');
  if (!fs.existsSync(configPath)) {
    throw new Error(`missing node configuration: ${configPath}`);
  }

  const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as PersistedNodeConfig;
  if (parsed.network !== network) {
    throw new Error(`existing node.json network mismatch: expected ${network}`);
  }

  const verifiedArtifacts = verifyNetworkArtifacts(getNetworkParams(network), baseDir);

  if (parsed.chain_id !== verifiedArtifacts.chainId) {
    throw new Error('existing node.json chain_id mismatch');
  }

  const relayListen = typeof parsed.embedded_relay?.listen === 'string' ? parsed.embedded_relay.listen : null;
  const relayAddress = relayListen === null ? null : parseListenAddress(relayListen);
  const extraRelays = Array.isArray(parsed.outbound_relays?.extra)
    ? parsed.outbound_relays?.extra.filter((value): value is string => typeof value === 'string')
    : [];
  const embeddedRelayPublicUrl = typeof parsed.embedded_relay?.public_url === 'string' ? parsed.embedded_relay.public_url : null;
  const configuredRelays = [...verifiedArtifacts.descriptor.bootstrap_relays.map((relay) => relay.url), ...extraRelays]
    .filter((relayUrl) => embeddedRelayPublicUrl === null || normalizeRelayUrl(relayUrl) !== normalizeRelayUrl(embeddedRelayPublicUrl));

  return {
    configPath,
    rawConfig: parsed,
    chainId: verifiedArtifacts.chainId,
    runtimeConfig: {
      network,
      dataDir,
      databasePath: path.join(dataDir, 'chain.sqlite'),
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
        ? path.resolve(path.dirname(configPath), parsed.signer.path)
        : null,
      signerPubkey: parsed.signer?.type === 'local-ncryptsec' && typeof parsed.signer.pubkey === 'string'
        ? parsed.signer.pubkey
        : null,
      minRemoteWriteRelays: typeof (parsed.mining as { min_remote_write_relays?: unknown } | undefined)?.min_remote_write_relays === 'number'
        && Number.isInteger((parsed.mining as { min_remote_write_relays?: number }).min_remote_write_relays)
        && (parsed.mining as { min_remote_write_relays?: number }).min_remote_write_relays! > 0
        ? (parsed.mining as { min_remote_write_relays?: number }).min_remote_write_relays!
        : 1,
      controlEnabled: parsed.control?.enabled !== false
    }
  };
}

export function parseListenAddress(value: string): { host: string; port: number } {
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
