"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveDefaultDataDir = resolveDefaultDataDir;
exports.resolveNodeDataDir = resolveNodeDataDir;
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
function resolveDefaultDataDir(network) {
    const homeDirectory = node_os_1.default.homedir();
    if (homeDirectory.length === 0) {
        throw new Error('unable to resolve user home directory for default data dir');
    }
    return node_path_1.default.join(homeDirectory, '.nostr-blockchain', network);
}
function resolveNodeDataDir(network, explicitDataDir) {
    if (explicitDataDir !== undefined) {
        return node_path_1.default.resolve(explicitDataDir);
    }
    return resolveDefaultDataDir(network);
}
