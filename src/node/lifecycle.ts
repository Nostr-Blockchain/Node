export type NodeLifecycleState = 'STARTING' | 'RECOVERING' | 'SYNCING' | 'READY' | 'DEGRADED' | 'SHUTTING_DOWN';

export class NodeLifecycle {
  private state: NodeLifecycleState = 'STARTING';

  public getState(): NodeLifecycleState {
    return this.state;
  }

  public transition(nextState: NodeLifecycleState): void {
    this.state = nextState;
  }
}
