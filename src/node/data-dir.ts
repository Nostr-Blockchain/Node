import os from 'node:os';
import path from 'node:path';

import { NetworkName } from '../networks/params';

export function resolveDefaultDataDir(network: NetworkName): string {
  const homeDirectory = os.homedir();
  if (homeDirectory.length === 0) {
    throw new Error('unable to resolve user home directory for default data dir');
  }
  return path.join(homeDirectory, '.nostr-blockchain', network);
}

export function resolveNodeDataDir(network: NetworkName, explicitDataDir?: string): string {
  if (explicitDataDir !== undefined) {
    return path.resolve(explicitDataDir);
  }
  return resolveDefaultDataDir(network);
}
