// The parts of GBA hardware the ported C talks to: VRAM, palette RAM, OAM-facing state and the
// LCD I/O registers (gpu_regs.c). Screens built on this (the battle) render through ppu.ts.

export const DISPLAY_WIDTH = 240;
export const DISPLAY_HEIGHT = 160;

export const VRAM_SIZE = 0x18000;
/** BG_VRAM .. BG_VRAM + 0x10000; OBJ_VRAM0 at 0x10000 */
export const OBJ_VRAM0 = 0x10000;
export const PLTT_SIZE = 0x400;

export const vram = new Uint8Array(VRAM_SIZE);
/** PLTT: the palette RAM the renderer reads (filled from gPlttBufferFaded by TransferPlttBuffer). */
export const pltt = new Uint16Array(PLTT_SIZE / 2);

export const BG_CHAR_ADDR = (n: number) => n * 0x4000;
export const BG_SCREEN_ADDR = (n: number) => n * 0x800;
export const BG_TILE_ADDR = (n: number) => n * 0x20;

// REG_OFFSET_* (include/gba/io_reg.h)
export const REG_OFFSET_DISPCNT = 0x0;
export const REG_OFFSET_DISPSTAT = 0x4;
export const REG_OFFSET_BG0CNT = 0x8;
export const REG_OFFSET_BG1CNT = 0xa;
export const REG_OFFSET_BG2CNT = 0xc;
export const REG_OFFSET_BG3CNT = 0xe;
export const REG_OFFSET_BG0HOFS = 0x10;
export const REG_OFFSET_BG0VOFS = 0x12;
export const REG_OFFSET_BG1HOFS = 0x14;
export const REG_OFFSET_BG1VOFS = 0x16;
export const REG_OFFSET_BG2HOFS = 0x18;
export const REG_OFFSET_BG2VOFS = 0x1a;
export const REG_OFFSET_BG3HOFS = 0x1c;
export const REG_OFFSET_BG3VOFS = 0x1e;
export const REG_OFFSET_WIN0H = 0x40;
export const REG_OFFSET_WIN1H = 0x42;
export const REG_OFFSET_WIN0V = 0x44;
export const REG_OFFSET_WIN1V = 0x46;
export const REG_OFFSET_WININ = 0x48;
export const REG_OFFSET_WINOUT = 0x4a;
export const REG_OFFSET_MOSAIC = 0x4c;
export const REG_OFFSET_BLDCNT = 0x50;
export const REG_OFFSET_BLDALPHA = 0x52;
export const REG_OFFSET_BLDY = 0x54;

// DISPCNT
export const DISPCNT_MODE_0 = 0x0000;
export const DISPCNT_OBJ_1D_MAP = 0x0040;
export const DISPCNT_FORCED_BLANK = 0x0080;
export const DISPCNT_BG0_ON = 0x0100;
export const DISPCNT_BG1_ON = 0x0200;
export const DISPCNT_BG2_ON = 0x0400;
export const DISPCNT_BG3_ON = 0x0800;
export const DISPCNT_BG_ALL_ON = 0x0f00;
export const DISPCNT_OBJ_ON = 0x1000;
export const DISPCNT_WIN0_ON = 0x2000;
export const DISPCNT_WIN1_ON = 0x4000;
export const DISPCNT_OBJWIN_ON = 0x8000;

// WININ/WINOUT
export const WININ_WIN0_BG0 = 1 << 0;
export const WININ_WIN0_BG1 = 1 << 1;
export const WININ_WIN0_BG2 = 1 << 2;
export const WININ_WIN0_BG3 = 1 << 3;
export const WININ_WIN0_BG_ALL = 0xf;
export const WININ_WIN0_OBJ = 1 << 4;
export const WININ_WIN0_CLR = 1 << 5;
export const WININ_WIN1_BG0 = 1 << 8;
export const WININ_WIN1_BG1 = 1 << 9;
export const WININ_WIN1_BG2 = 1 << 10;
export const WININ_WIN1_BG3 = 1 << 11;
export const WININ_WIN1_BG_ALL = 0xf00;
export const WININ_WIN1_OBJ = 1 << 12;
export const WININ_WIN1_CLR = 1 << 13;
export const WINOUT_WIN01_BG0 = 1 << 0;
export const WINOUT_WIN01_BG1 = 1 << 1;
export const WINOUT_WIN01_BG2 = 1 << 2;
export const WINOUT_WIN01_BG3 = 1 << 3;
export const WINOUT_WIN01_BG_ALL = 0xf;
export const WINOUT_WIN01_OBJ = 1 << 4;
export const WINOUT_WIN01_CLR = 1 << 5;

// BLDCNT
export const BLDCNT_TGT1_BG0 = 1 << 0;
export const BLDCNT_TGT1_BG1 = 1 << 1;
export const BLDCNT_TGT1_BG2 = 1 << 2;
export const BLDCNT_TGT1_BG3 = 1 << 3;
export const BLDCNT_TGT1_OBJ = 1 << 4;
export const BLDCNT_TGT1_BD = 1 << 5;
export const BLDCNT_TGT1_ALL = 0x3f;
export const BLDCNT_EFFECT_NONE = 0 << 6;
export const BLDCNT_EFFECT_BLEND = 1 << 6;
export const BLDCNT_EFFECT_LIGHTEN = 2 << 6;
export const BLDCNT_EFFECT_DARKEN = 3 << 6;
export const BLDCNT_TGT2_BG0 = 1 << 8;
export const BLDCNT_TGT2_BG1 = 1 << 9;
export const BLDCNT_TGT2_BG2 = 1 << 10;
export const BLDCNT_TGT2_BG3 = 1 << 11;
export const BLDCNT_TGT2_OBJ = 1 << 12;
export const BLDCNT_TGT2_BD = 1 << 13;
export const BLDCNT_TGT2_ALL = 0x3f00;
export const BLDALPHA_BLEND = (target1: number, target2: number) => ((target2 << 8) | target1) & 0xffff;
export const WIN_RANGE = (a: number, b: number) => ((a & 0xff) << 8) | (b & 0xff);

/** The I/O registers, indexed by byte offset / 2. */
export const regs = new Uint16Array(0x30);

/** SetGpuReg (gpu_regs.c): the GBA buffers some writes until VBlank; ours land immediately. */
export function SetGpuReg(regOffset: number, value: number): void {
  regs[regOffset >> 1] = value;
}

export function GetGpuReg(regOffset: number): number {
  return regs[regOffset >> 1];
}

export function SetGpuRegBits(regOffset: number, mask: number): void {
  regs[regOffset >> 1] |= mask;
}

export function ClearGpuRegBits(regOffset: number, mask: number): void {
  regs[regOffset >> 1] &= ~mask;
}

/**
 * Per-scanline register values written by HBlank DMA (scanline_effect.c). When set, the PPU uses
 * values[line] for that register on each line instead of the register itself.
 */
export const hblankRegs = new Map<number, Uint16Array>();

export function resetHardware(): void {
  vram.fill(0);
  pltt.fill(0);
  regs.fill(0);
  hblankRegs.clear();
}

export const RGB = (r: number, g: number, b: number) => (r & 0x1f) | ((g & 0x1f) << 5) | ((b & 0x1f) << 10);
export const RGB_BLACK = RGB(0, 0, 0);
export const RGB_WHITE = RGB(31, 31, 31);
export const PALETTES_BG = 0x0000ffff;
export const PALETTES_OBJECTS = 0xffff0000;
export const PALETTES_ALL = 0xffffffff;
