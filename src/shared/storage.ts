/**
 * Minimal structural view of `chrome.storage.local`. Everything that touches
 * storage takes this instead of the global so it can be exercised in tests
 * without a Chrome runtime.
 */
export interface StorageAreaLike {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export function defaultStorageArea(): StorageAreaLike {
  return chrome.storage.local as unknown as StorageAreaLike;
}

/**
 * Serializes read-modify-write cycles against a shared storage record.
 * `chrome.storage.local` has no transactions, so concurrent lookups would
 * otherwise clobber each other's writes.
 */
export function createWriteQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();

  return <T>(task: () => Promise<T>): Promise<T> => {
    const scheduled = tail.catch(() => undefined).then(task);
    tail = scheduled;
    return scheduled;
  };
}
