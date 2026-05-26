import Dexie, { type Table } from 'dexie';

export interface OfflineOp {
  id?: number;
  opType: 'sample.create' | 'visit.create' | 'order.create' | 'route.complete';
  payload: Record<string, unknown>;
  createdAt: string;
  retryCount: number;
  lastError?: string;
  status: 'pending' | 'syncing' | 'completed' | 'failed';
}

export interface CachedAccount {
  id: string;
  data: Record<string, unknown>;
  cachedAt: string;
}

export class SahaOfflineDB extends Dexie {
  ops!: Table<OfflineOp, number>;
  accounts!: Table<CachedAccount, string>;

  constructor() {
    super('saha-offline');
    this.version(1).stores({
      ops: '++id, status, createdAt, opType',
      accounts: 'id, cachedAt',
    });
  }
}

export const offlineDB = new SahaOfflineDB();
