"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_SUBSCRIPTION_ID_BYTES = exports.RECENT_TIP_PROBE_LIMIT = exports.MAX_HISTORICAL_LIMIT = exports.MAX_FILTER_AUTHORS = exports.MAX_FILTER_IDS = exports.MAX_RELAY_FILTERS = void 0;
exports.buildLiveBlockSubscription = buildLiveBlockSubscription;
exports.buildRecentTipProbe = buildRecentTipProbe;
exports.buildExactEventFetch = buildExactEventFetch;
exports.buildRelayListFetch = buildRelayListFetch;
exports.MAX_RELAY_FILTERS = 4;
exports.MAX_FILTER_IDS = 512;
exports.MAX_FILTER_AUTHORS = 256;
exports.MAX_HISTORICAL_LIMIT = 2048;
exports.RECENT_TIP_PROBE_LIMIT = 256;
exports.MAX_SUBSCRIPTION_ID_BYTES = 64;
function buildLiveBlockSubscription(chainIdHex) {
    return [{ kinds: [7343], '#t': [`nostr-blockchain:${chainIdHex}`] }];
}
function buildRecentTipProbe(chainIdHex) {
    return [{ kinds: [7343], '#t': [`nostr-blockchain:${chainIdHex}`], limit: exports.RECENT_TIP_PROBE_LIMIT }];
}
function buildExactEventFetch(subscriptionId, eventIds) {
    return {
        subscriptionId,
        filters: [{ ids: [...eventIds] }]
    };
}
function buildRelayListFetch(subscriptionId, pubkey) {
    return {
        subscriptionId,
        filters: [{ kinds: [10002], authors: [pubkey], limit: 1 }]
    };
}
