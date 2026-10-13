import type { Pokemon, PokemonData } from '../pokemon/Pokemon';
import { TEMP_VARS_END, TEMP_VARS_START, type Defines } from '../script/Defines';
import type { TextSpeed } from '../text/TextPrinter';
import { random32 } from '../util/random';
import { Bag } from './Bag';

/**
 * Save-block style game state: event flags, vars, names, options, party, bag, Pokédex.
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

  /** gSaveBlock2Ptr->playerTrainerId. The GBA rolls it in Oak's intro; until that exists, at state creation. */
  trainerId = random32();
  /** NewGameInitData: SetMoney(&gSaveBlock1Ptr->money, 3000) */
  money = 3000;
  /** gPlayerParty: up to PARTY_SIZE mons, no gaps. */
  party: Pokemon[] = [];
  readonly bag: Bag;
  /** Pokédex seen/caught flags by national dex number. */
  readonly dexSeen = new Set<number>();
  readonly dexCaught = new Set<number>();
  nationalDexEnabled = false;

  constructor(
    readonly defines: Defines,
    newGameFlags: string[],
    readonly pokemon: PokemonData,
  ) {
    for (const f of newGameFlags) this.setFlag(f);
    this.tempFlags = [defines.get('TEMP_FLAGS_START') ?? 0, defines.get('TEMP_FLAGS_END') ?? -1];
    this.bag = new Bag(
      {
        capacities: ['BAG_ITEMS_COUNT', 'BAG_KEYITEMS_COUNT', 'BAG_POKEBALLS_COUNT', 'BAG_TMHM_COUNT', 'BAG_BERRIES_COUNT'].map((c) =>
          defines.require(c),
        ),
        ITEM_NONE: defines.require('ITEM_NONE'),
        ITEM_TM_CASE: defines.require('ITEM_TM_CASE'),
        ITEM_BERRY_POUCH: defines.require('ITEM_BERRY_POUCH'),
        POCKET_KEY_ITEMS: defines.require('POCKET_KEY_ITEMS'),
        POCKET_TM_CASE: defines.require('POCKET_TM_CASE'),
        POCKET_BERRY_POUCH: defines.require('POCKET_BERRY_POUCH'),
      },
      (item) => pokemon.itemPocket(item),
      () => this.setFlag('FLAG_SYS_GOT_BERRY_POUCH'),
    );
  }

  /**
   * GiveMonToPlayer: OT is the player; first free party slot. When the party is full the GBA calls
   * SendMonToPC; PC storage doesn't exist yet, so that case returns MON_CANT_GIVE.
   */
  giveMon(mon: Pokemon): number {
    const c = this.pokemon.c;
    mon.otName = this.playerName;
    mon.otGender = this.playerGender;
    mon.otId = this.trainerId;
    if (this.party.length >= c.PARTY_SIZE) {
      console.warn('[state] party full; SendMonToPC not implemented');
      return c.MON_CANT_GIVE;
    }
    this.party.push(mon);
    return c.MON_GIVEN_TO_PARTY;
  }

  /** GetSetPokedexFlag(FLAG_SET_SEEN / FLAG_SET_CAUGHT) */
  setDexFlags(nationalDex: number, seen: boolean, caught: boolean): void {
    if (nationalDex <= 0) return;
    if (seen) this.dexSeen.add(nationalDex);
    if (caught) this.dexCaught.add(nationalDex);
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
