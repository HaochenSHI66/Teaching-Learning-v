// Node v22+ provides a global `localStorage` object, but without
// --localstorage-file pointing to a valid path, its methods throw
// "TypeError: localStorage.getItem is not a function".
// This preload script patches the broken global to prevent SSR crashes.
if (typeof globalThis.localStorage !== 'undefined') {
  try {
    globalThis.localStorage.getItem('__test__');
  } catch {
    globalThis.localStorage = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      get length() { return 0; },
    };
  }
}
