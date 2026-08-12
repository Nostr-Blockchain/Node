export class ConsensusError extends Error {
  public readonly code: string;

  public constructor(code: string, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

export type InvalidityClass = 'representation-invalid' | 'id-intrinsic-invalid' | 'state-context-invalid';

export class ClassifiedConsensusError extends ConsensusError {
  public readonly invalidityClass: InvalidityClass;
  public readonly canonicalEventId: string | null;
  public readonly cacheByEventId: boolean;

  public constructor(code: string, invalidityClass: InvalidityClass, canonicalEventId: string | null, cacheByEventId: boolean, message?: string) {
    super(code, message);
    this.invalidityClass = invalidityClass;
    this.canonicalEventId = canonicalEventId;
    this.cacheByEventId = cacheByEventId;
  }
}

export function assertConsensus(condition: unknown, code: string, message?: string): asserts condition {
  if (!condition) {
    throw new ConsensusError(code, message);
  }
}
