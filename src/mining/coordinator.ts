import { BlockSigner } from './signer';
import { GenesisParams } from '../consensus/genesis';
import { computeEventId, NostrEvent } from '../consensus/nip01';
import { buildBlockTags } from '../consensus/block-codec';
import { evaluateCandidatePow } from './worker';

export interface MiningCoordinatorStatus {
  enabled: boolean;
  mode: 'continuous' | 'disabled' | 'mine-one';
  workerCount: number;
  activeGeneration: bigint;
  pauseReason: string | null;
}

export class MiningCoordinator {
  private enabled: boolean;
  private mode: 'continuous' | 'disabled' | 'mine-one';
  private workerCount: number;
  private generation = 0n;

  public constructor(enabled = true, mode: 'continuous' | 'disabled' | 'mine-one' = 'continuous', workerCount = 1) {
    this.enabled = enabled;
    this.mode = mode;
    this.workerCount = workerCount;
  }

  public getStatus(): MiningCoordinatorStatus {
    return {
      enabled: this.enabled,
      mode: this.mode,
      workerCount: this.workerCount,
      activeGeneration: this.generation,
      pauseReason: this.enabled ? null : 'disabled'
    };
  }

  public setMode(mode: 'continuous' | 'disabled' | 'mine-one'): void {
    this.mode = mode;
    this.enabled = mode !== 'disabled';
    this.generation += 1n;
  }

  public mineOne(parentIdHex: string, chainIdHex: string, params: GenesisParams, signer: BlockSigner, txIds: string[], createdAt = Math.floor(Date.now() / 1000)): NostrEvent {
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
      const result = evaluateCandidatePow({ chainIdHex, parentIdHex, eventIdHex, powDifficulty: params.powDifficulty });
      if (result.success) {
        return {
          ...event,
          id: eventIdHex,
          sig: signer.signEventId(eventIdHex)
        };
      }
      nonce += 1n;
    }
  }
}
