import { calculateMedianTimePast, calculateNextDifficulty } from '../consensus/difficulty';
import { ChainStateSnapshot } from '../chain/chain-executor';
import { NodeRuntime } from '../node/runtime';
import { computeStateHash } from './state-hash';

export interface NodeStatusSnapshot {
  readonly network: string;
  readonly chainId: string;
  readonly protocolVersion: number;
  readonly lifecycle: string;
  readonly height: string;
  readonly tip: string | null;
  readonly cumulativeWork: string;
  readonly currentDifficulty: number;
  readonly nextDifficulty: number;
  readonly mtp: number;
  readonly supply: string;
  readonly utxoCount: number;
  readonly utxoDigest: string;
  readonly stateHash: string;
  readonly mempoolCount: number;
  readonly embeddedRelay: {
    readonly enabled: boolean;
    readonly state: 'RUNNING' | 'DISABLED';
    readonly listen: string | null;
    readonly publicUrl: string | null;
  };
  readonly remoteRelays: {
    readonly count: number;
    readonly readUrls: readonly string[];
    readonly writeUrls: readonly string[];
  };
  readonly missingObjects: {
    readonly count: number;
  };
  readonly signer: {
    readonly configured: boolean;
    readonly state: 'LOCKED' | 'UNLOCKED' | 'UNAVAILABLE' | 'NOT_IMPLEMENTED';
  };
  readonly mining: {
    readonly mode: string;
    readonly workerCount: number;
    readonly pauseReason: string | null;
  };
  readonly storage: {
    readonly databasePath: string;
    readonly integrity: string;
  };
}

export function buildRuntimeStatus(runtime: NodeRuntime): NodeStatusSnapshot {
  const snapshot = runtime.chainExecutor.snapshot();
  const activeBlock = snapshot.activeTip === null ? null : runtime.chainExecutor.getConnectedBlock(snapshot.activeTip);
  const currentDifficulty = activeBlock?.requiredDifficulty ?? runtime.getGenesisParams().powDifficulty;
  const nextDifficulty = activeBlock === null
    ? runtime.getGenesisParams().powDifficulty
    : calculateNextDifficulty(runtime.getActiveNetworkParams(), snapshot.activeHeight + 1n, activeBlock, (blockId) => runtime.chainExecutor.getConnectedBlock(blockId));
  const mtp = calculateMedianTimePast(snapshot.activeTip, (blockId) => runtime.chainExecutor.getConnectedBlock(blockId));

  return {
    network: runtime.config.network,
    chainId: runtime.getChainIdHex(),
    protocolVersion: runtime.getGenesisParams().protocolVersion,
    lifecycle: runtime.lifecycle.getState(),
    height: snapshot.activeHeight.toString(10),
    tip: snapshot.activeTip,
    cumulativeWork: snapshot.activeCumulativeWork.toString(10),
    currentDifficulty,
    nextDifficulty,
    mtp,
    supply: snapshot.totalSupply.toString(10),
    utxoCount: snapshot.utxos.length,
    utxoDigest: snapshot.utxoDigest,
    stateHash: computeStateHash(runtime.getChainIdHex(), snapshot, currentDifficulty),
    mempoolCount: runtime.chainExecutor.getMempool().size(),
    embeddedRelay: {
      enabled: runtime.config.embeddedRelayPort !== null,
      state: runtime.config.embeddedRelayPort === null ? 'DISABLED' : 'RUNNING',
      listen: runtime.config.embeddedRelayListen,
      publicUrl: runtime.config.embeddedRelayPublicUrl
    },
    remoteRelays: {
      count: runtime.relayManager.getRemoteRelayUrls().length,
      readUrls: runtime.relayManager.getRemoteRelayUrls(),
      writeUrls: runtime.relayManager.getRemoteWritableRelayUrls()
    },
    missingObjects: {
      count: runtime.getMissingObjectCount()
    },
    signer: {
      configured: runtime.config.signerType === 'local-ncryptsec',
      state: runtime.getSignerState()
    },
    mining: {
      mode: runtime.miningCoordinator.getStatus().mode,
      workerCount: runtime.miningCoordinator.getStatus().workerCount,
      pauseReason: deriveMiningPauseReason(runtime, snapshot)
    },
    storage: {
      databasePath: runtime.config.databasePath,
      integrity: runtime.verifyIntegrity()
    }
  };
}

export function formatStatusHuman(status: NodeStatusSnapshot, softwareVersion: string): string[] {
  return [
    `software version: ${softwareVersion}`,
    `protocol version: ${status.protocolVersion}`,
    `network: ${status.network}`,
    `chain ID: ${status.chainId}`,
    `lifecycle: ${status.lifecycle}`,
    `height: ${status.height}`,
    `tip: ${status.tip ?? 'null'}`,
    `cumulative work: ${status.cumulativeWork}`,
    `current difficulty: ${status.currentDifficulty}`,
    `next difficulty: ${status.nextDifficulty}`,
    `MTP: ${status.mtp}`,
    `supply: ${status.supply}`,
    `UTXO count: ${status.utxoCount}`,
    `UTXO digest: ${status.utxoDigest}`,
    `state hash: ${status.stateHash}`,
    `mempool count: ${status.mempoolCount}`,
    `embedded relay: ${status.embeddedRelay.state}${status.embeddedRelay.listen === null ? '' : ` (${status.embeddedRelay.listen})`}`,
    `embedded relay public URL: ${status.embeddedRelay.publicUrl ?? 'null'}`,
    `remote relays: ${status.remoteRelays.count}`,
    `remote read relays: ${status.remoteRelays.readUrls.join(', ') || 'none'}`,
    `remote write relays: ${status.remoteRelays.writeUrls.join(', ') || 'none'}`,
    `missing objects: ${status.missingObjects.count}`,
    `signer state: ${status.signer.state}`,
    `mining mode: ${status.mining.mode}`,
    `worker count: ${status.mining.workerCount}`,
    `pause reason: ${status.mining.pauseReason ?? 'none'}`,
    `database integrity: ${status.storage.integrity}`
  ];
}

function deriveMiningPauseReason(runtime: NodeRuntime, snapshot: ChainStateSnapshot): string | null {
  if (runtime.lifecycle.getState() !== 'READY') {
    return 'BOOT_SYNC_INCOMPLETE';
  }
  if (runtime.getSignerState() === 'UNAVAILABLE') {
    return 'BOOT_SIGNER_UNAVAILABLE';
  }
  if (runtime.getSignerState() !== 'UNLOCKED') {
    return 'BOOT_SIGNER_LOCKED';
  }
  const minimumRemoteWriteRelays = runtime.config.minRemoteWriteRelays ?? 1;
  if (runtime.relayManager.getRemoteWriteRelayCount() < minimumRemoteWriteRelays) {
    return 'NO_REMOTE_WRITE_RELAY';
  }
  const activeTip = snapshot.activeTip;
  if (activeTip !== null) {
    const mtp = calculateMedianTimePast(activeTip, (blockId) => runtime.chainExecutor.getConnectedBlock(blockId));
    if (mtp + 1 > Math.floor(Date.now() / 1000) + 120) {
      return 'CLOCK_BEHIND_CHAIN';
    }
  }
  return null;
}
