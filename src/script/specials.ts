import { adjustFriendship } from '../battle/pokemonBattle';
import type { GameState } from '../state/GameState';
import { animateElevator, getElevatorFloor, initElevatorFloorSelectMenuPos } from '../world/elevator';
import { initRoamer } from '../world/roamer';
import { isPoisoned } from '../world/stepCounters';
import type { ScriptHost } from './ScriptEngine';

export interface SpecialEnv {
  state: GameState;
  host: ScriptHost;
  /** For specials that start a task the script then blocks on with `waitstate` (ScriptContext_Stop/Enable). */
  setWaitState(done: () => boolean): void;
  /** ShowFieldMessage(label); the wait ends once it has printed (IsFieldMessageBoxHidden). */
  showFieldMessage(label: string): () => boolean;
  /** The special left the field (SetMainCallback2), so the script never resumes. */
  endScript(): void;
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
  'Script_FadeOutMapMusic', // audio: its waitstate ends at once
  'InitUnionRoom', // wireless only (and stubbed out from REVISION 0xA): CableClub_OnResume in every Pokémon Center
];

export const SPECIALS: Record<string, Special> = {
  ...Object.fromEntries(NO_OP.map((name) => [name, () => {}])),

  /** EnterSafariMode (safari_zone.c; GAME_STAT_ENTERED_SAFARI_ZONE isn't kept) */
  EnterSafariMode({ state }) {
    state.setFlag('FLAG_SYS_SAFARI_MODE', true);
    state.numSafariBalls = 30;
    state.safariZoneStepCounter = 600;
  },

  /** ExitSafariMode */
  ExitSafariMode({ state }) {
    state.setFlag('FLAG_SYS_SAFARI_MODE', false);
    state.numSafariBalls = 0;
    state.safariZoneStepCounter = 0;
  },

  /** IsThereRoomInAnyBoxForMorePokemon: PC boxes aren't ported, so they never fill up. */
  IsThereRoomInAnyBoxForMorePokemon() {
    return 1;
  },

  /** InitRoamer (roamer.c) */
  InitRoamer({ state }) {
    initRoamer(state);
  },

  /** GetElevatorFloor (field_specials.c): VAR_ELEVATOR_FLOOR from the dynamic warp's map */
  GetElevatorFloor({ state }) {
    getElevatorFloor(state);
  },

  /** InitElevatorFloorSelectMenuPos: the floor select menu's starting cursor */
  InitElevatorFloorSelectMenuPos({ state }) {
    return initElevatorFloorSelectMenuPos(state);
  },

  /** DrawElevatorCurrentFloorWindow: "Now on:" and the floor gSpecialVar_0x8005 names */
  DrawElevatorCurrentFloorWindow({ state, host }) {
    host.elevatorFloorWindow(state.getVar('VAR_0x8005'));
  },

  CloseElevatorCurrentFloorWindow({ host }) {
    host.elevatorFloorWindow(undefined);
  },

  /** AnimateElevator: the shake ends the script's waitstate; the window view may scroll on after it. */
  AnimateElevator(env) {
    const { shake, windowView } = animateElevator(env.state, env.host);
    // RunTasks order: Task_AnimateElevatorWindowView (priority 8) before Task_ElevatorShake (9)
    env.host.startFieldTask(windowView);
    env.host.startFieldTask(shake);
    env.setWaitState(() => shake.done);
  },

  /** EndTrainerApproach (trainer_see.c): the script's waitstate ends once the trainer has walked up. */
  EndTrainerApproach(env) {
    env.setWaitState(env.host.endTrainerApproach());
  },

  /** GetBattleOutcome (battle_setup.c): gBattleOutcome */
  GetBattleOutcome({ state }) {
    return state.battleOutcome;
  },

  /**
   * TryFieldPoisonWhiteOut (field_poison.c): for each mon the field poison knocked out, "X fainted…"
   * (FaintFromFieldPoison clears its status), then VAR_RESULT = whether every mon has fainted.
   */
  TryFieldPoisonWhiteOut(env) {
    const { state } = env;
    let partyId = 0;
    let message: (() => boolean) | undefined;
    env.setWaitState(() => {
      if (message && !message()) return false;
      message = undefined;
      for (; partyId < state.party.length; partyId++) {
        const mon = state.party[partyId];
        if (!mon.isEgg && mon.hp === 0 && isPoisoned(state, mon)) {
          adjustFriendship(mon, state.defines.require('FRIENDSHIP_EVENT_FAINT_OUTSIDE_BATTLE'));
          mon.status = 0;
          state.stringVars[0] = [...mon.nickname];
          message = env.showFieldMessage('gText_PkmnFainted3');
          return false;
        }
      }
      // AllMonsFainted
      state.setVar('VAR_RESULT', state.party.every((mon) => mon.isEgg || mon.hp === 0) ? 1 : 0);
      return true;
    });
  },

  /** OverworldWhiteOutGetMoneyLoss: STR_VAR_1 = ComputeWhiteOutMoneyLoss() */
  OverworldWhiteOutGetMoneyLoss({ state, host }) {
    state.stringVars[0] = state.pokemon.encodeName(String(host.whiteOutMoneyLoss()));
  },

  /** SetCB2WhiteOut (post_battle_event_funcs.c), from the black screen EventScript_FieldWhiteOutFade leaves. */
  SetCB2WhiteOut({ host, endScript }) {
    endScript();
    host.whiteOut();
  },

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
