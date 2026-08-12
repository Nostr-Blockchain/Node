export interface NostrFilter {
  ids?: string[];
  authors?: string[];
  kinds?: number[];
  '#t'?: string[];
  limit?: number;
}

export interface NostrSubscription {
  id: string;
  filters: NostrFilter[];
}

export const MAX_RELAY_FILTERS = 4;
export const MAX_FILTER_IDS = 512;
export const MAX_FILTER_AUTHORS = 256;
export const MAX_HISTORICAL_LIMIT = 2048;
export const RECENT_TIP_PROBE_LIMIT = 256;
export const MAX_SUBSCRIPTION_ID_BYTES = 64;

export interface ExactFetchRequest {
  readonly subscriptionId: string;
  readonly filters: readonly NostrFilter[];
}

export function buildLiveBlockSubscription(chainIdHex: string): readonly NostrFilter[] {
  return [{ kinds: [7343], '#t': [`nostr-blockchain:${chainIdHex}`] }];
}

export function buildRecentTipProbe(chainIdHex: string): readonly NostrFilter[] {
  return [{ kinds: [7343], '#t': [`nostr-blockchain:${chainIdHex}`], limit: RECENT_TIP_PROBE_LIMIT }];
}

export function buildExactEventFetch(subscriptionId: string, eventIds: readonly string[]): ExactFetchRequest {
  return {
    subscriptionId,
    filters: [{ ids: [...eventIds] }]
  };
}

export function buildRelayListFetch(subscriptionId: string, pubkey: string): ExactFetchRequest {
  return {
    subscriptionId,
    filters: [{ kinds: [10002], authors: [pubkey], limit: 1 }]
  };
}
