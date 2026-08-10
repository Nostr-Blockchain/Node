"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NodeLifecycle = void 0;
class NodeLifecycle {
    state = 'STARTING';
    getState() {
        return this.state;
    }
    transition(nextState) {
        this.state = nextState;
    }
}
exports.NodeLifecycle = NodeLifecycle;
