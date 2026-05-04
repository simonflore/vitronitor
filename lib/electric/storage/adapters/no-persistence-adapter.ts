/**
 * No-op adapter — used in SSR / test environments where IndexedDB is absent.
 * The app degrades to in-memory only: all data refetches on each page load.
 */

import type { PersistenceAdapter, PendingMutation, SyncState, StoredItem } from '../types';

export class NoPersistenceAdapter implements PersistenceAdapter {
  readonly name = 'none';
  readonly isAvailable = false;

  async init(): Promise<void> {
    /* no-op */
  }

  async saveItems<T>(_orgId: string, _collectionId: string, _items: StoredItem<T>[]): Promise<void> {
    /* no-op */
  }

  async getAllItems<T>(_orgId: string, _collectionId: string): Promise<Map<string, T>> {
    return new Map();
  }

  async deleteItems(_orgId: string, _collectionId: string, _keys: string[]): Promise<void> {
    /* no-op */
  }

  async clearCollection(_orgId: string, _collectionId: string): Promise<void> {
    /* no-op */
  }

  async saveSyncState(_orgId: string, _collectionId: string, _state: SyncState): Promise<void> {
    /* no-op */
  }

  async getSyncState(_orgId: string, _collectionId: string): Promise<SyncState | null> {
    return null;
  }

  async saveMutation(_mutation: PendingMutation): Promise<void> {
    /* no-op */
  }

  async updateMutation(_id: string, _patch: Partial<PendingMutation>): Promise<void> {
    /* no-op */
  }

  async deleteMutation(_id: string): Promise<void> {
    /* no-op */
  }

  async getAllPendingMutations(_orgId: string): Promise<PendingMutation[]> {
    return [];
  }

  async clearOrg(_orgId: string): Promise<void> {
    /* no-op */
  }
}
