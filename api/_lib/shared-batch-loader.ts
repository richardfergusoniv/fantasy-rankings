/** Share each key's batch completion, including result publication, across callers. */
export function createSharedBatchLoader(load: (keys: string[]) => Promise<void>) {
  const requests = new Map<string, Promise<void>>();
  return async (keys: string[]): Promise<void> => {
    const wanted = [...new Set(keys)].filter((key) => !requests.has(key));
    if (wanted.length > 0) {
      // Defer invocation so every key is registered before the loader starts.
      const pending = Promise.resolve().then(() => load(wanted)).catch((error: unknown) => {
        for (const key of wanted) requests.delete(key);
        throw error;
      });
      for (const key of wanted) requests.set(key, pending);
    }
    await Promise.all(keys.map((key) => requests.get(key)));
  };
}

/** Priority work must never inherit the completion of a large optional batch. */
export function createPriorityBatchLoaders(load: (keys: string[]) => Promise<void>) {
  return {
    priority: createSharedBatchLoader(load),
    optional: createSharedBatchLoader(load),
  };
}
