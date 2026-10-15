// Browser globals that game modules touch at import time (gba/window.ts makes a 1x1 ImageData), stubbed
// for Node. Nothing in the unit tests draws.

if (typeof globalThis.ImageData === 'undefined') {
  globalThis.ImageData = class {
    readonly data: Uint8ClampedArray;
    constructor(
      readonly width: number,
      readonly height: number,
    ) {
      this.data = new Uint8ClampedArray(width * height * 4);
    }
  } as unknown as typeof ImageData;
}
