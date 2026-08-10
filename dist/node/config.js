"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDefaultNodeConfig = createDefaultNodeConfig;
const node_path_1 = __importDefault(require("node:path"));
function createDefaultNodeConfig(dataDir) {
    return {
        dataDir,
        databasePath: node_path_1.default.join(dataDir, 'nostr-blockchain.sqlite'),
        miningEnabled: true,
        miningMode: 'continuous',
        miningWorkerCount: 1,
        relays: [],
        embeddedRelayPort: null
    };
}
