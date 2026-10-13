import type { ItemInfo, MoveInfo, SpeciesInfo } from '../data/types';
import type { PokemonData } from '../pokemon/Pokemon';
import type { GameState } from '../state/GameState';
import type { Charmap } from '../text/charmap';
import { initConstants } from './constants';
import type { BattleData } from './data';
import { BattleGlobals } from './globals';
import { Memory } from './memory';

// The battle engine's shared state. In C these are globals visible to every battle file; here they
// are module-level bindings set once by initBattleEnv (ES module exports are live).

export let g: BattleGlobals;
export let mem: Memory;
export let bdata: BattleData;
export let pokemon: PokemonData;
export let state: GameState;
export let charmap: Charmap;
/** gSpeciesInfo */
export let gSpeciesInfo: SpeciesInfo[];
/** gBattleMoves */
export let gBattleMoves: MoveInfo[];
export let gItems: ItemInfo[];

export function initBattleEnv(data: BattleData, defines: Record<string, number>, pk: PokemonData, gs: GameState, cm: Charmap): void {
  initConstants(defines);
  bdata = data;
  mem = new Memory(data.scripts);
  g = new BattleGlobals(mem);
  pokemon = pk;
  state = gs;
  charmap = cm;
  gSpeciesInfo = pk.species;
  gBattleMoves = pk.moves;
  gItems = pk.items;
}

/** ItemId_GetHoldEffect */
export function itemHoldEffect(item: number): number {
  return gItems[item]?.holdEffect ?? 0;
}

/** ItemId_GetHoldEffectParam */
export function itemHoldEffectParam(item: number): number {
  return gItems[item]?.holdEffectParam ?? 0;
}
