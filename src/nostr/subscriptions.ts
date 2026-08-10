export interface NostrFilter {
  ids?: string[];
  kinds?: number[];
  '#t'?: string[];
  limit?: number;
}

export interface NostrSubscription {
  id: string;
  filters: NostrFilter[];
}
