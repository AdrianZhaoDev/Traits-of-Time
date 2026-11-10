"use strict";

// Only the WeChat bootstrap loads this before the bundled engine. Its content
// snapshots contain plain data; browser structuredClone is never overwritten.
if (typeof globalThis.structuredClone !== "function") {
  globalThis.structuredClone = function structuredClone(value) {
    const seen = new WeakMap();
    function clone(data) {
      if (data === null || typeof data !== "object") {
        if (typeof data === "function" || typeof data === "symbol") {
          throw new TypeError("structuredClone shim only accepts plain game data");
        }
        return data;
      }
      if (seen.has(data)) return seen.get(data);
      const array = Array.isArray(data);
      const prototype = Object.getPrototypeOf(data);
      if (!array && prototype !== Object.prototype && prototype !== null) {
        throw new TypeError("structuredClone shim only accepts plain game data");
      }
      const result = array ? new Array(data.length) : Object.create(prototype);
      seen.set(data, result);
      for (const key of Object.keys(data)) {
        Object.defineProperty(result, key, {
          value: clone(data[key]), enumerable: true, writable: true, configurable: true,
        });
      }
      return result;
    }
    return clone(value);
  };
}
