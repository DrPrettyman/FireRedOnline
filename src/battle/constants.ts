// Decomp constants (include/constants/*.h, battle headers, enums) for the battle engine, read from the
// extracted defines. `K.NAME` throws on a typo instead of silently yielding undefined.

const table: Record<string, number> = {};

export const K: Readonly<Record<string, number>> = new Proxy(table, {
  get(t, name) {
    const v = t[name as string];
    if (v === undefined) throw new Error(`[battle] unknown constant ${String(name)}`);
    return v;
  },
});

export function initConstants(defines: Record<string, number>): void {
  Object.assign(table, { TRUE: 1, FALSE: 0, NULL: 0 }, defines);
}

/** Like K.NAME, but undefined instead of throwing (for optional constants). */
export function constant(name: string): number | undefined {
  return table[name];
}
