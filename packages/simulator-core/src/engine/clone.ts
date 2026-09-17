/**
 * Clone simulator state without routing the whole object through JSON.
 *
 * Battle state is plain data, so structuredClone preserves the same value
 * semantics while avoiding JSON serialization's intermediate strings. The
 * fallback keeps the core usable in older runtimes and test environments.
 */
export function clone<T>(value: T): T {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}
