import type { GameState } from '../state/GameState';
import type { ScriptHost } from './ScriptEngine';

export interface SpecialEnv {
  state: GameState;
  host: ScriptHost;
  /** For specials that start a task the script then blocks on with `waitstate` (ScriptContext_Stop/Enable). */
  setWaitState(done: () => boolean): void;
  warnOnce(key: string, message: string): void;
}

/** A gSpecials entry (data/specials.inc). The return value is stored by `specialvar`. */
export type Special = (env: SpecialEnv) => number | void;

/** Specials with no effect yet because the system they feed (audio, quest log, help, fame checker) doesn't exist. */
const NO_OP = [
  'PlayTrainerEncounterMusic', // audio
  'QuestLog_CutRecording', // quest log
  'SetHelpContextForMap', // help system
  'Script_SetHelpContext',
  'SetFlavorTextFlagFromSpecialVars', // fame checker
  'UpdatePickStateFromSpecialVar8005',
  'SetUnlockedPokedexFlags', // gcnLinkFlags, only used for GameCube link
  'DisableMsgBoxWalkaway',
];

export const SPECIALS: Record<string, Special> = {
  ...Object.fromEntries(NO_OP.map((name) => [name, () => {}])),

  HealPlayerParty({ state }) {
    healPlayerParty(state);
  },

  /** GetQuestLogState: QL_STATE_* (0 = not recording or playing back). */
  GetQuestLogState() {
    return 0;
  },

  /** EnableNationalPokedex */
  EnableNationalPokedex({ state }) {
    state.nationalDexEnabled = true; // gSaveBlock2Ptr->pokedex.nationalMagic = 0xB9
    state.setVar('VAR_NATIONAL_DEX', 0x6258);
    state.setFlag('FLAG_SYS_NATIONAL_DEX');
  },

  /** GetPokedexCount (prof_pc.c): seen/caught into 0x8005/0x8006; returns IsNationalPokedexEnabled. */
  GetPokedexCount({ state }) {
    const national = state.getVar('VAR_0x8004') !== 0;
    const count = national ? state.pokemon.tables.nationalDexCount : state.pokemon.tables.kantoDexCount;
    const inRange = (set: Set<number>) => [...set].filter((n) => n >= 1 && n <= count).length;
    state.setVar('VAR_0x8005', inRange(state.dexSeen));
    state.setVar('VAR_0x8006', inRange(state.dexCaught));
    return isNationalDexEnabled(state) ? 1 : 0;
  },

  /** ChangePokemonNickname: opens the naming screen, which doesn't exist yet. Keep the name and fade back in. */
  ChangePokemonNickname(env) {
    env.warnOnce('ChangePokemonNickname', '[special] naming screen not implemented; keeping the current name');
    env.setWaitState(env.host.fadeScreen(env.state.defines.require('FADE_FROM_BLACK')));
  },

  /** GetPartyMonSpecies: MON_DATA_SPECIES_OR_EGG of party slot VAR_0x8004. */
  GetPartyMonSpecies({ state }) {
    const mon = state.party[state.getVar('VAR_0x8004')];
    if (!mon) return 0;
    return mon.isEgg ? state.pokemon.c.SPECIES_EGG : mon.species;
  },

  /**
   * StartOldManTutorialBattle (battle_setup.c): a male Lv5 Weedle for the old man to catch, then
   * CB2_ReturnToFieldContinueScriptPlayMapMusic, which the script waits for with `waitstate`.
   */
  StartOldManTutorialBattle({ state, host, setWaitState }) {
    const weedle = state.pokemon.createMaleMon(state.defines.require('SPECIES_WEEDLE'), 5, {
      otName: state.playerName, // CreateBoxMon always copies the player's name and gender
      otGender: state.playerGender,
      metLocation: host.mapSection(),
    });
    const run = host.startScriptedBattle(state.defines.require('BATTLE_TYPE_OLD_MAN_TUTORIAL'), [weedle]);
    let fadeIn: (() => boolean) | undefined;
    setWaitState(() => {
      if (fadeIn) return fadeIn();
      if (run.done()) fadeIn = run.returnToField();
      return false;
    });
  },

  /** BufferMonNickname: nickname of party slot VAR_0x8004 into STR_VAR_1. */
  BufferMonNickname({ state }) {
    state.stringVars[0] = [...(state.party[state.getVar('VAR_0x8004')]?.nickname ?? [])];
  },
};

/** IsNationalPokedexEnabled */
/** HealPlayerParty: full HP, PP (with PP Ups) and no status. */
export function healPlayerParty(state: GameState): void {
  for (const mon of state.party) {
    mon.hp = mon.maxHP;
    for (let j = 0; j < state.pokemon.c.MAX_MON_MOVES; j++) mon.pp[j] = state.pokemon.ppWithBonus(mon.moves[j], mon.ppBonuses, j);
    mon.status = 0;
  }
}

export function isNationalDexEnabled(state: GameState): boolean {
  return state.nationalDexEnabled && state.getVar('VAR_NATIONAL_DEX') === 0x6258 && state.getFlag('FLAG_SYS_NATIONAL_DEX');
}
