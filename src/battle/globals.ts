import type { Pokemon } from '../pokemon/Pokemon';
import type { Memory } from './memory';
import {
  BattleEnigmaBerry,
  BattlePokemon,
  BattleResources,
  BattleResults,
  BattleSpriteData,
  BattleStruct,
  DisableStruct,
  ProtectStruct,
  SideTimer,
  SpecialStatus,
  WishFutureKnock,
} from './structs';

export const MAX_BATTLERS_COUNT = 4;
const BUFFER_SIZE = 0x200;

/**
 * struct BattleScripting, at gBattleScripting in RAM. Field offsets are hard-coded in
 * include/constants/battle_script_commands.h because scripts address them directly.
 */
export class BattleScripting {
  constructor(
    private mem: Memory,
    private base: number,
  ) {}

  private u8(o: number) {
    return this.mem.u8(this.base + o);
  }
  private set8(o: number, v: number) {
    this.mem.setU8(this.base + o, v);
  }

  get painSplitHp() { return this.mem.s32(this.base + 0x00); }
  set painSplitHp(v) { this.mem.setU32(this.base + 0x00, v); }
  get bideDmg() { return this.mem.s32(this.base + 0x04); }
  set bideDmg(v) { this.mem.setU32(this.base + 0x04, v); }
  /** multihitString[6] */
  get multihitString(): Uint8Array { return new Uint8Array(this.mem.ram.buffer, this.base - this.mem.ramBase + 0x08, 6); }
  get dmgMultiplier() { return this.u8(0x0e); }
  set dmgMultiplier(v) { this.set8(0x0e, v); }
  get twoTurnsMoveStringId() { return this.u8(0x0f); }
  set twoTurnsMoveStringId(v) { this.set8(0x0f, v); }
  get animArg1() { return this.u8(0x10); }
  set animArg1(v) { this.set8(0x10, v); }
  get animArg2() { return this.u8(0x11); }
  set animArg2(v) { this.set8(0x11, v); }
  get tripleKickPower() { return this.mem.u16(this.base + 0x12); }
  set tripleKickPower(v) { this.mem.setU16(this.base + 0x12, v); }
  get moveendState() { return this.u8(0x14); }
  set moveendState(v) { this.set8(0x14, v); }
  get battlerWithAbility() { return this.u8(0x15); }
  set battlerWithAbility(v) { this.set8(0x15, v); }
  get multihitMoveEffect() { return this.u8(0x16); }
  set multihitMoveEffect(v) { this.set8(0x16, v); }
  get battler() { return this.u8(0x17); }
  set battler(v) { this.set8(0x17, v); }
  get animTurn() { return this.u8(0x18); }
  set animTurn(v) { this.set8(0x18, v); }
  get animTargetsHit() { return this.u8(0x19); }
  set animTargetsHit(v) { this.set8(0x19, v); }
  get statChanger() { return this.u8(0x1a); }
  set statChanger(v) { this.set8(0x1a, v); }
  get statAnimPlayed() { return this.u8(0x1b); }
  set statAnimPlayed(v) { this.set8(0x1b, v); }
  get getexpState() { return this.u8(0x1c); }
  set getexpState(v) { this.set8(0x1c, v); }
  get battleStyle() { return this.u8(0x1d); }
  set battleStyle(v) { this.set8(0x1d, v); }
  get drawlvlupboxState() { return this.u8(0x1e); }
  set drawlvlupboxState(v) { this.set8(0x1e, v); }
  get learnMoveState() { return this.u8(0x1f); }
  set learnMoveState(v) { this.set8(0x1f, v); }
  get pursuitDoublesAttacker() { return this.u8(0x20); }
  set pursuitDoublesAttacker(v) { this.set8(0x20, v); }
  get reshowMainState() { return this.u8(0x21); }
  set reshowMainState(v) { this.set8(0x21, v); }
  get reshowHelperState() { return this.u8(0x22); }
  set reshowHelperState(v) { this.set8(0x22, v); }
  get levelUpHP() { return this.u8(0x23); }
  set levelUpHP(v) { this.set8(0x23, v); }
}

/**
 * The battle engine's global variables (battle_main.c EWRAM_DATA and friends), named after the C
 * globals without the `g` prefix. Globals that battle scripts address by pointer live in Memory.
 */
export class BattleGlobals {
  readonly battleScripting: BattleScripting;
  readonly battleCommunication: Uint8Array;
  readonly battlerByTurnOrder: Uint8Array;
  /** gBattleTextBuff1..3 (TEXT_BUFF_ARRAY_COUNT bytes); buff1 is in RAM for copyarray etc. */
  readonly battleTextBuff1: Uint8Array;
  readonly battleTextBuff2 = new Uint8Array(16);
  readonly battleTextBuff3 = new Uint8Array(16);
  /** gDisplayedStringBattle */
  displayedStringBattle: number[] = [0xff];

  battleTerrain = 0;
  battleBufferA = [0, 1, 2, 3].map(() => new Uint8Array(BUFFER_SIZE));
  battleBufferB = [0, 1, 2, 3].map(() => new Uint8Array(BUFFER_SIZE));
  /** Structured payloads that ride along with a buffer command (struct copies the GBA does bytewise). */
  battleBufferAObj: unknown[] = [undefined, undefined, undefined, undefined];
  battleBufferBObj: unknown[] = [undefined, undefined, undefined, undefined];
  activeBattler = 0;
  battleControllerExecFlags = 0;
  battlerPartyIndexes = new Uint16Array(4);
  battlerPositions = new Uint8Array(4);
  actionsByTurnOrder = new Uint8Array(4);
  currentTurnActionNumber = 0;
  currentActionFuncId = 0;
  battleMons = [0, 1, 2, 3].map(() => new BattlePokemon());
  battlerSpriteIds = new Uint8Array(4);
  currMovePos = 0;
  chosenMovePos = 0;
  calledMove = 0;
  takenDmg = new Int32Array(4);
  lastUsedAbility = 0;
  potentialItemEffectBattler = 0;
  absentBattlerFlags = 0;
  multiHitCounter = 0;
  /** gBattlescriptCurrInstr: ROM address of the current battle script command. */
  battlescriptCurrInstr = 0;
  chosenActionByBattler = new Uint8Array(4);
  selectionBattleScripts = [0, 0, 0, 0];
  lastPrintedMoves = new Uint16Array(4);
  lastMoves = new Uint16Array(4);
  lastLandedMoves = new Uint16Array(4);
  lastHitByType = new Uint16Array(4);
  lastResultingMoves = new Uint16Array(4);
  lockedMoves = new Uint16Array(4);
  lastHitBy = new Uint8Array(4);
  chosenMoveByBattler = new Uint16Array(4);
  takenDmgByBattler = new Uint8Array(4);
  sideStatuses = new Uint16Array(2);
  sideTimers = [new SideTimer(), new SideTimer()];
  statuses3 = new Uint32Array(4);
  disableStructs = [0, 1, 2, 3].map(() => new DisableStruct());
  pauseCounterBattle = 0;
  paydayMoney = 0;
  randomTurnNumber = 0;
  protectStructs = [0, 1, 2, 3].map(() => new ProtectStruct());
  specialStatuses = [0, 1, 2, 3].map(() => new SpecialStatus());
  wishFutureKnock = new WishFutureKnock();
  introSlideFlags = 0;
  sentPokesToOpponent = new Uint8Array(2);
  expShareExp = 0;
  enigmaBerries = [0, 1, 2, 3].map(() => new BattleEnigmaBerry());
  battleStruct = new BattleStruct();
  battleResources = new BattleResources();
  actionSelectionCursor = new Uint8Array(4);
  moveSelectionCursor = new Uint8Array(4);
  battlerStatusSummaryTaskId = new Uint8Array(4);
  battlerInMenuId = 0;
  doingBattleAnim = false;
  transformedPersonalities = new Uint32Array(4);
  battleSpritesDataPtr = new BattleSpriteData();
  battleMovePower = 0;
  moveToLearn = 0;
  battleMonForms = new Uint8Array(4);
  battleMainFunc: () => void = () => {};
  battleResults = new BattleResults();
  leveledUpInBattle = 0;
  battlerControllerFuncs: (() => void)[] = [() => {}, () => {}, () => {}, () => {}];
  healthboxSpriteIds = new Uint8Array(4);
  multiUsePlayerCursor = 0;
  numberOfMovesToChoose = 0;
  battleControllerData = new Uint8Array(4);
  battle_BG0_X = 0;
  battle_BG0_Y = 0;
  battle_BG1_X = 0;
  battle_BG1_Y = 0;
  battle_BG2_X = 0;
  battle_BG2_Y = 0;
  battle_BG3_X = 0;
  battle_BG3_Y = 0;
  /** gPlayerParty / gEnemyParty: PARTY_SIZE slots, undefined = empty (SPECIES_NONE). */
  playerParty: (Pokemon | undefined)[] = [];
  enemyParty: (Pokemon | undefined)[] = [];
  /** gBattlePartyCurrentOrder (party_menu.c) */
  battlePartyCurrentOrder = new Uint8Array(3);
  trainerBattleOpponent_B = 0;
  /** GetCurrentWeather() at battle start (WEATHER_*), for ABILITYEFFECT_SWITCH_IN_WEATHER. */
  overworldWeather = 0;

  constructor(readonly mem: Memory) {
    this.battleScripting = new BattleScripting(mem, mem.symbol('gBattleScripting'));
    this.battleCommunication = mem.bytes('gBattleCommunication', 8);
    this.battlerByTurnOrder = mem.bytes('gBattlerByTurnOrder', 4);
    this.battleTextBuff1 = mem.bytes('gBattleTextBuff1', 16);
  }

  private ru8(n: string) { return this.mem.u8(this.mem.symbol(n)); }
  private wu8(n: string, v: number) { this.mem.setU8(this.mem.symbol(n), v); }
  private ru16(n: string) { return this.mem.u16(this.mem.symbol(n)); }
  private wu16(n: string, v: number) { this.mem.setU16(this.mem.symbol(n), v); }

  get hitMarker() { return this.mem.u32(this.mem.symbol('gHitMarker')); }
  set hitMarker(v) { this.mem.setU32(this.mem.symbol('gHitMarker'), v); }
  get moveResultFlags() { return this.ru8('gMoveResultFlags'); }
  set moveResultFlags(v) { this.wu8('gMoveResultFlags', v); }
  get battlerTarget() { return this.ru8('gBattlerTarget'); }
  set battlerTarget(v) { this.wu8('gBattlerTarget', v); }
  get battlerAttacker() { return this.ru8('gBattlerAttacker'); }
  set battlerAttacker(v) { this.wu8('gBattlerAttacker', v); }
  get effectBattler() { return this.ru8('gEffectBattler'); }
  set effectBattler(v) { this.wu8('gEffectBattler', v); }
  get battlerFainted() { return this.ru8('gBattlerFainted'); }
  set battlerFainted(v) { this.wu8('gBattlerFainted', v); }
  get battleOutcome() { return this.ru8('gBattleOutcome'); }
  set battleOutcome(v) { this.wu8('gBattleOutcome', v); }
  get battleMoveDamage() { return this.mem.s32(this.mem.symbol('gBattleMoveDamage')); }
  set battleMoveDamage(v) { this.mem.setU32(this.mem.symbol('gBattleMoveDamage'), v); }
  get hpDealt() { return this.mem.s32(this.mem.symbol('gHpDealt')); }
  set hpDealt(v) { this.mem.setU32(this.mem.symbol('gHpDealt'), v); }
  get battlersCount() { return this.ru8('gBattlersCount'); }
  set battlersCount(v) { this.wu8('gBattlersCount', v); }
  get battleTypeFlags() { return this.mem.u32(this.mem.symbol('gBattleTypeFlags')); }
  set battleTypeFlags(v) { this.mem.setU32(this.mem.symbol('gBattleTypeFlags'), v); }
  get battleWeather() { return this.ru16('gBattleWeather'); }
  set battleWeather(v) { this.wu16('gBattleWeather', v); }
  get chosenMove() { return this.ru16('gChosenMove'); }
  set chosenMove(v) { this.wu16('gChosenMove', v); }
  get currentMove() { return this.ru16('gCurrentMove'); }
  set currentMove(v) { this.wu16('gCurrentMove', v); }
  get critMultiplier() { return this.ru8('gCritMultiplier'); }
  set critMultiplier(v) { this.wu8('gCritMultiplier', v); }
  get dynamicBasePower() { return this.ru16('gDynamicBasePower'); }
  set dynamicBasePower(v) { this.wu16('gDynamicBasePower', v); }
  get lastUsedItem() { return this.ru16('gLastUsedItem'); }
  set lastUsedItem(v) { this.wu16('gLastUsedItem', v); }
  get numSafariBalls() { return this.ru8('gNumSafariBalls'); }
  set numSafariBalls(v) { this.wu8('gNumSafariBalls', v); }
  get trainerBattleOpponent_A() { return this.ru16('gTrainerBattleOpponent_A'); }
  set trainerBattleOpponent_A(v) { this.wu16('gTrainerBattleOpponent_A', v); }
}

/** gBitTable */
export function bit(n: number): number {
  return (1 << n) >>> 0;
}
