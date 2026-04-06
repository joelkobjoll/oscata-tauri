/**
 * Eager config pre-fetcher.
 *
 * `get_config` blocks the Settings modal from rendering (form === null shows
 * a full-screen loading overlay). On first boot, DB initialisation / migration
 * can make that query take a couple of seconds.
 *
 * We fix this by starting the fetch as soon as Library or WebRouter mounts,
 * long before the user can click the Settings button. By the time they do,
 * the promise is already resolved and Settings opens instantly.
 */

import { call } from "./transport";

let _promise: Promise<unknown> | null = null;

/** Fire the get_config fetch now (idempotent – safe to call multiple times). */
export function prefetchConfig(): void {
  if (!_promise) {
    _promise = call("get_config").catch(() => {
      // Reset on error so the next real call retries.
      _promise = null;
    });
  }
}

/** Return the config, re-using the in-flight / resolved promise if available. */
export function getConfig<T>(): Promise<T> {
  if (!_promise) {
    _promise = call("get_config");
  }
  return _promise as Promise<T>;
}

/** Invalidate the cache after saving, so the next Settings open re-fetches. */
export function invalidateConfig(): void {
  _promise = null;
}
