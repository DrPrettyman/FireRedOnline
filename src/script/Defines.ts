/** Resolves decomp constant names (FLAG_*, VAR_*, MSGBOX_*, ITEM_*, ...) to numbers. */
export class Defines {
  constructor(private table: Record<string, number>) {
    this.table = { TRUE: 1, FALSE: 0, ...table };
  }

  /** Number for a name or numeric literal; undefined if unknown. */
  get(token: string | number): number | undefined {
    if (typeof token === 'number') return token;
    const t = token.trim();
    if (/^-?(0x[0-9a-f]+|\d+)$/i.test(t)) return Number(t);
    return this.table[t];
  }

  require(token: string | number): number {
    const v = this.get(token);
    if (v === undefined) throw new Error(`Unknown constant ${token}`);
    return v;
  }
}

// include/constants/vars.h & flags.h
export const VARS_START = 0x4000;
export const TEMP_VARS_START = 0x4000;
export const TEMP_VARS_END = 0x400f;
export const SPECIAL_VARS_START = 0x8000;
