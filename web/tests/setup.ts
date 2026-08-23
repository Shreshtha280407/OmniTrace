import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

/**
 * jsdom under this Node version does not expose a working `localStorage`
 * (Node's own experimental global shadows it and is unusable without
 * `--localstorage-file`). Session persistence is a real behaviour we test, so
 * we install a spec-shaped in-memory Storage rather than mocking the module.
 */
function installLocalStorage() {
  const backing = new Map<string, string>();

  const storage: Storage = {
    get length() {
      return backing.size;
    },
    key(index: number) {
      return [...backing.keys()][index] ?? null;
    },
    getItem(key: string) {
      return backing.has(key) ? backing.get(key)! : null;
    },
    setItem(key: string, value: string) {
      backing.set(String(key), String(value));
    },
    removeItem(key: string) {
      backing.delete(key);
    },
    clear() {
      backing.clear();
    },
  };

  // Defined on both so `window.localStorage` (production code) and bare
  // `localStorage` (tests) resolve to the same object.
  Object.defineProperty(window, "localStorage", { value: storage, configurable: true, writable: true });
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true, writable: true });
}

installLocalStorage();

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

/**
 * Installed unconditionally and as a plain function, not a `vi.fn()`:
 * `restoreAllMocks()` in afterEach would otherwise strip the implementation
 * and leave later tests calling a stub that returns undefined.
 */
window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

if (!global.IntersectionObserver) {
  global.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
    root = null;
    rootMargin = "";
    thresholds = [];
  } as unknown as typeof IntersectionObserver;
}
