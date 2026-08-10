import path from 'node:path';

import { RelayConfig } from '../nostr/relay-manager';

export interface NodeConfig {
  dataDir: string;
  databasePath: string;
  miningEnabled: boolean;
  miningMode: 'continuous' | 'disabled' | 'mine-one';
  miningWorkerCount: number;
  relays: RelayConfig[];
  embeddedRelayPort: number | null;
}

export function createDefaultNodeConfig(dataDir: string): NodeConfig {
  return {
    dataDir,
    databasePath: path.join(dataDir, 'nostr-blockchain.sqlite'),
    miningEnabled: true,
    miningMode: 'continuous',
    miningWorkerCount: 1,
    relays: [],
    embeddedRelayPort: null
  };
}
