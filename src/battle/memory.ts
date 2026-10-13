import type { BattleScriptsData } from './data';

/**
 * The address space battle and AI scripts see: the assembled script ROM and the RAM globals they
 * reference by address (gBattleScripting + offset, gHitMarker, ...). Reads/writes are little-endian
 * like the GBA. Script pointers are plain numbers (ROM addresses).
 */
export class Memory {
  readonly rom: Uint8Array;
  readonly romBase: number;
  readonly ram: Uint8Array;
  readonly ramBase: number;
  private romView: DataView;
  private ramView: DataView;
  readonly labels: Record<string, number>;
  private symbols: Record<string, number>;

  constructor(data: BattleScriptsData) {
    const bin = atob(data.rom);
    this.rom = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) this.rom[i] = bin.charCodeAt(i);
    this.romBase = data.romBase;
    const addrs = Object.values(data.ram);
    this.ramBase = Math.min(...addrs);
    this.ram = new Uint8Array(Math.max(...addrs) - this.ramBase + data.ramSlot);
    this.romView = new DataView(this.rom.buffer);
    this.ramView = new DataView(this.ram.buffer);
    this.labels = data.labels;
    this.symbols = data.ram;
  }

  /** ROM address of a script label (BattleScript_*, AI_*, g*StringIds). */
  label(name: string): number {
    const a = this.labels[name];
    if (a === undefined) throw new Error(`[battle] unknown script label ${name}`);
    return a;
  }

  /** Name of the label at an address, for debugging. */
  labelAt(addr: number): string | undefined {
    for (const [k, v] of Object.entries(this.labels)) if (v === addr) return k;
    return undefined;
  }

  /** RAM address of a global (see RAM_SYMBOLS in tools/extract_battle.py). */
  symbol(name: string): number {
    const a = this.symbols[name];
    if (a === undefined) throw new Error(`[battle] unknown RAM symbol ${name}`);
    return a;
  }

  /** A byte view onto a RAM global, e.g. gBattleCommunication. */
  bytes(name: string, length: number): Uint8Array {
    return new Uint8Array(this.ram.buffer, this.symbol(name) - this.ramBase, length);
  }

  private view(addr: number): [DataView, number] {
    if (addr >= this.romBase) return [this.romView, addr - this.romBase];
    if (addr >= this.ramBase && addr < this.ramBase + this.ram.length) return [this.ramView, addr - this.ramBase];
    throw new Error(`[battle] bad address 0x${addr.toString(16)}`);
  }

  u8(addr: number): number {
    const [v, o] = this.view(addr);
    return v.getUint8(o);
  }

  u16(addr: number): number {
    const [v, o] = this.view(addr);
    return v.getUint16(o, true);
  }

  u32(addr: number): number {
    const [v, o] = this.view(addr);
    return v.getUint32(o, true);
  }

  s8(addr: number): number {
    const [v, o] = this.view(addr);
    return v.getInt8(o);
  }

  s32(addr: number): number {
    const [v, o] = this.view(addr);
    return v.getInt32(o, true);
  }

  setU8(addr: number, value: number): void {
    const [v, o] = this.view(addr);
    v.setUint8(o, value & 0xff);
  }

  setU16(addr: number, value: number): void {
    const [v, o] = this.view(addr);
    v.setUint16(o, value & 0xffff, true);
  }

  setU32(addr: number, value: number): void {
    const [v, o] = this.view(addr);
    v.setUint32(o, value >>> 0, true);
  }
}
