import path from 'node:path';
import { Worker } from 'node:worker_threads';

import { buildBlockTags } from '../consensus/block-codec';
import { computeEventId, NostrEvent } from '../consensus/nip01';
import { evaluateCandidatePow, MiningResult, WorkerSearchInput } from './worker';
import { NetworkParams } from '../networks/params';
import { BlockSigner } from './signer';

export interface MiningCoordinatorStatus {
  enabled: boolean;
  mode: 'continuous' | 'disabled' | 'mine-one';
  workerCount: number;
  activeGeneration: bigint;
  pauseReason: string | null;
}

export class MiningCoordinator {
  private static readonly WORKER_BATCH_ATTEMPTS = 25_000;

  private enabled: boolean;
  private mode: 'continuous' | 'disabled' | 'mine-one';
  private workerCount: number;
  private generation = 0n;
  private pauseReason: string | null = null;

  public constructor(enabled = true, mode: 'continuous' | 'disabled' | 'mine-one' = 'continuous', workerCount = 1) {
    this.enabled = enabled;
    this.mode = mode;
    this.workerCount = workerCount;
    this.pauseReason = enabled ? null : 'DISABLED';
  }

  public getStatus(): MiningCoordinatorStatus {
    return {
      enabled: this.enabled,
      mode: this.mode,
      workerCount: this.workerCount,
      activeGeneration: this.generation,
      pauseReason: this.pauseReason
    };
  }

  public setMode(mode: 'continuous' | 'disabled' | 'mine-one'): void {
    this.mode = mode;
    this.enabled = mode !== 'disabled';
    this.generation += 1n;
    this.pauseReason = this.enabled ? null : 'DISABLED';
  }

  public setPauseReason(pauseReason: string | null): void {
    this.pauseReason = pauseReason;
  }

  public invalidateGeneration(): bigint {
    this.generation += 1n;
    return this.generation;
  }

  public buildUnsignedWinningBlock(parentIdHex: string, chainIdHex: string, networkParams: NetworkParams, signer: BlockSigner, txIds: string[], requiredDifficulty: number, createdAt = Math.floor(Date.now() / 1000)): Omit<NostrEvent, 'id' | 'sig'> & { id: string } {
    let nonce = 0n;
    for (;;) {
      const event: Omit<NostrEvent, 'id' | 'sig'> = {
        pubkey: signer.getPublicKeyHex(),
        created_at: createdAt,
        kind: 7343,
        tags: buildBlockTags(chainIdHex, parentIdHex, txIds, nonce),
        content: '00'
      };
      const eventIdHex = computeEventId(event);
      const result = evaluateCandidatePow({
        chainIdHex,
        parentIdHex,
        eventIdHex,
        requiredDifficulty,
        fixedGateBits: networkParams.nip13GateBits,
        cacheWalkR1: networkParams.cacheWalkR1
      });
      if (result.success) {
        return {
          ...event,
          id: eventIdHex
        };
      }
      nonce += 1n;
    }
  }

  public async searchForWinner(input: {
    readonly generation: bigint;
    readonly chainIdHex: string;
    readonly parentIdHex: string;
    readonly createdAt: number;
    readonly signer: BlockSigner;
    readonly txIds: readonly string[];
    readonly requiredDifficulty: number;
    readonly networkParams: NetworkParams;
  }): Promise<MiningResult | null> {
    const workerScriptPath = path.resolve(__dirname, 'worker.js');
    while (input.generation === this.generation) {
      const workers = Array.from({ length: this.workerCount }, (_, workerIndex) => {
        const worker = new Worker(workerScriptPath);
        const workerInput = buildWorkerSearchInput({
          chainIdHex: input.chainIdHex,
          parentIdHex: input.parentIdHex,
          minerPubkeyHex: input.signer.getPublicKeyHex(),
          txIds: input.txIds,
          requiredDifficulty: input.requiredDifficulty,
          createdAt: input.createdAt,
          workerIndex,
          workerCount: this.workerCount,
          maxAttempts: MiningCoordinator.WORKER_BATCH_ATTEMPTS,
          fixedGateBits: input.networkParams.nip13GateBits,
          cacheWalkR1: input.networkParams.cacheWalkR1
        });
        return new Promise<{ worker: Worker; result: MiningResult }>((resolve, reject) => {
          worker.once('message', (result: MiningResult) => resolve({ worker, result }));
          worker.once('error', reject);
          worker.postMessage(workerInput);
        });
      });
      const results = await Promise.all(workers);
      try {
        const winner = results.find(({ result }) => result.success);
        if (winner !== undefined) {
          return winner.result;
        }
      } finally {
        await Promise.all(results.map(async ({ worker }) => worker.terminate()));
      }
    }
    return null;
  }
}

export function buildWorkerSearchInput(input: {
  readonly chainIdHex: string;
  readonly parentIdHex: string;
  readonly minerPubkeyHex: string;
  readonly txIds: readonly string[];
  readonly requiredDifficulty: number;
  readonly createdAt: number;
  readonly workerIndex: number;
  readonly workerCount: number;
  readonly maxAttempts: number;
  readonly fixedGateBits?: number;
  readonly cacheWalkR1?: NetworkParams['cacheWalkR1'];
}): WorkerSearchInput {
  return {
    chainIdHex: input.chainIdHex,
    parentIdHex: input.parentIdHex,
    minerPubkeyHex: input.minerPubkeyHex,
    txIds: input.txIds,
    requiredDifficulty: input.requiredDifficulty,
    createdAt: input.createdAt,
    startNonce: input.workerIndex.toString(10),
    nonceStep: input.workerCount.toString(10),
    maxAttempts: input.maxAttempts,
    fixedGateBits: input.fixedGateBits,
    cacheWalkR1: input.cacheWalkR1
  };
}
