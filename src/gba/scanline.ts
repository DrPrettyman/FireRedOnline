// scanline_effect.c: per-scanline register writes by HBlank DMA, modelled as a per-line register
// table the PPU reads (hw.hblankRegs). `dmaDest` is a REG_OFFSET_*.

import { hblankRegs } from './hw';
import { DestroyTask } from './task';

export const SCANLINE_EFFECT_DMACNT_16BIT = 0xa2600001;
export const SCANLINE_EFFECT_DMACNT_32BIT = 0xa6600001;

/** gScanlineEffectRegBuffers[2][0x3C0] */
export const gScanlineEffectRegBuffers = [new Uint16Array(0x3c0), new Uint16Array(0x3c0)];

export interface ScanlineEffectParams {
  dmaDest: number;
  dmaControl: number;
  initState: number;
}

export const gScanlineEffect = {
  dmaDest: -1,
  dmaControl: 0,
  srcBuffer: 0,
  state: 0,
  waveTaskId: 0xff,
};

function stopDma(): void {
  if (gScanlineEffect.dmaDest < 0) return;
  hblankRegs.delete(gScanlineEffect.dmaDest);
  hblankRegs.delete(gScanlineEffect.dmaDest + 2);
}

export function ScanlineEffect_Stop(): void {
  gScanlineEffect.state = 0;
  stopDma();
  if (gScanlineEffect.waveTaskId !== 0xff) {
    DestroyTask(gScanlineEffect.waveTaskId);
    gScanlineEffect.waveTaskId = 0xff;
  }
}

export function ScanlineEffect_Clear(): void {
  stopDma();
  gScanlineEffectRegBuffers[0].fill(0);
  gScanlineEffectRegBuffers[1].fill(0);
  gScanlineEffect.dmaDest = -1;
  gScanlineEffect.dmaControl = 0;
  gScanlineEffect.srcBuffer = 0;
  gScanlineEffect.state = 0;
  gScanlineEffect.waveTaskId = 0xff;
}

export function ScanlineEffect_SetParams(params: ScanlineEffectParams): void {
  gScanlineEffect.dmaControl = params.dmaControl;
  gScanlineEffect.dmaDest = params.dmaDest;
  gScanlineEffect.state = params.initState;
}

/** ScanlineEffect_InitHBlankDmaTransfer (VBlank): the next frame uses the current buffer. */
export function ScanlineEffect_InitHBlankDmaTransfer(): void {
  if (gScanlineEffect.state === 0) return;
  if (gScanlineEffect.state === 3) {
    gScanlineEffect.state = 0;
    stopDma();
    return;
  }
  const buf = gScanlineEffectRegBuffers[gScanlineEffect.srcBuffer];
  const dest = gScanlineEffect.dmaDest;
  if (gScanlineEffect.dmaControl === SCANLINE_EFFECT_DMACNT_16BIT) {
    hblankRegs.set(dest, buf.slice(0, 160));
  } else {
    const lo = new Uint16Array(160);
    const hi = new Uint16Array(160);
    for (let i = 0; i < 160; i++) {
      lo[i] = buf[i * 2];
      hi[i] = buf[i * 2 + 1];
    }
    hblankRegs.set(dest, lo);
    hblankRegs.set(dest + 2, hi);
  }
  gScanlineEffect.srcBuffer ^= 1;
}
