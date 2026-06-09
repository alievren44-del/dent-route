import Dexie, { type Table } from 'dexie';

export interface OfflineOp {
  id?: number;
  opType: 'sample.create' | 'visit.create' | 'order.create' | 'route.complete' | 'visit.update';
  payload: Record<string, unknown>;
  /** UUID — replay'de duplicate önler; orders için Supabase idempotency_key olarak da kullanılır. */
  idempotencyKey: string;
  createdAt: string;
  retryCount: number;
  lastError?: string;
  status: 'pending' | 'syncing' | 'completed' | 'failed';
}

export class SahaOfflineDB extends Dexie {
  ops!: Table<OfflineOp, number>;

  constructor() {
    super('saha-offline');
    this.version(1).stores({
      ops: '++id, status, createdAt, opType',
      accounts: 'id, cachedAt',
    });
    // v2: dead 'accounts' store kaldırıldı (null = drop). v1 upgrade path korunur.
    this.version(2).stores({
      ops: '++id, status, createdAt, opType',
      accounts: null,
    });
    // v3: idempotencyKey kolonu eklendi; index'e alındı (duplicate guard + lookup).
    this.version(3).stores({
      ops: '++id, status, createdAt, opType, idempotencyKey',
    });
  }
}

export const offlineDB = new SahaOfflineDB();
