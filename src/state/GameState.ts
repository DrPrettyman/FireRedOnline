import { TEMP_VARS_END, TEMP_VARS_START, type Defines } from '../script/Defines';
import type { TextSpeed } from '../text/TextPrinter';

/**
 * Save-block style game state: event flags, vars, names, options.
 * Flags and vars are keyed by their numeric ids (as on the GBA), resolved from decomp constant
 * names through Defines, so aliases like `.equ SIGN_LADY_READY, VAR_TEMP_2` just work.
 */
export class GameState {
  playerName = 'PLAYER'; // until the naming screen exists
  rivalName = 'RIVAL';
  playerGender: 'male' | 'female' = 'male';
  textSpeed: TextSpeed = 'mid';

  private flags = new Set<number>();
  private vars = new Map<number, number>();
  /** STR_VAR_1..3 contents as encoded bytes (filled by buffer* script commands). */
  stringVars: number[][] = [[], [], []];

  constructor(
    readonly defines: Defines,
    newGameFlags: string[],
  ) {
    for (const f of newGameFlags) this.setFlag(f);
    this.tempFlags = [defines.get('TEMP_FLAGS_START') ?? 0, defines.get('TEMP_FLAGS_END') ?? -1];
  }

  private tempFlags: [number, number];

  private id(token: string | number): number | undefined {
    const n = this.defines.get(token);
    if (n === undefined) console.warn(`[state] unknown flag/var ${token}`);
    return n;
  }

  getFlag(flag: string | number): boolean {
    const n = this.id(flag);
    return n !== undefined && n !== 0 && this.flags.has(n);
  }

  setFlag(flag: string | number, value = true): void {
    const n = this.id(flag);
    if (n === undefined || n === 0) return;
    if (value) this.flags.add(n);
    else this.flags.delete(n);
  }

  getVar(v: string | number): number {
    const n = this.id(v);
    return n === undefined ? 0 : (this.vars.get(n) ?? 0);
  }

  setVar(v: string | number, value: number): void {
    const n = this.id(v);
    if (n !== undefined) this.vars.set(n, value & 0xffff);
  }

  /** VarGet semantics: ids below VARS_START are literal values, not variables. */
  value(token: string | number): number {
    const n = this.defines.get(token) ?? 0;
    return n >= TEMP_VARS_START ? this.getVar(n) : n;
  }

  /** ClearTempFieldEventData: on every map load. */
  clearTemps(): void {
    const [fs, fe] = this.tempFlags;
    for (const f of [...this.flags]) if (f >= fs && f <= fe) this.flags.delete(f);
    for (let v = TEMP_VARS_START; v <= TEMP_VARS_END; v++) this.vars.delete(v);
  }
}
