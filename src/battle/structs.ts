// Battle structs from include/battle.h and include/pokemon.h. Arrays use typed arrays so element
// writes wrap like the C types (s8 stat stages, u8 PP, u16 moves). Zeroing a struct (memset / the
// byte loops in battle_main.c) is done by replacing it with a fresh one.

/** struct BattlePokemon */
export class BattlePokemon {
  species = 0;
  attack = 0;
  defense = 0;
  speed = 0;
  spAttack = 0;
  spDefense = 0;
  moves = new Uint16Array(4);
  hpIV = 0;
  attackIV = 0;
  defenseIV = 0;
  speedIV = 0;
  spAttackIV = 0;
  spDefenseIV = 0;
  isEgg = 0;
  abilityNum = 0;
  statStages = new Int8Array(8);
  ability = 0;
  type1 = 0;
  type2 = 0;
  unknown = 0;
  pp = new Uint8Array(4);
  hp = 0;
  level = 0;
  friendship = 0;
  maxHP = 0;
  item = 0;
  /** POKEMON_NAME_LENGTH + 1 bytes, EOS-terminated */
  nickname: number[] = [0xff];
  ppBonuses = 0;
  otName: number[] = [0xff];
  experience = 0;
  personality = 0;
  private _status1 = 0;
  private _status2 = 0;
  otId = 0;

  /** u32: JS bit ops yield signed int32, so normalise on write. */
  get status1(): number {
    return this._status1;
  }
  set status1(v: number) {
    this._status1 = v >>> 0;
  }
  get status2(): number {
    return this._status2;
  }
  set status2(v: number) {
    this._status2 = v >>> 0;
  }

  clone(): BattlePokemon {
    const c = Object.assign(new BattlePokemon(), this);
    c.moves = this.moves.slice();
    c.statStages = this.statStages.slice();
    c.pp = this.pp.slice();
    c.nickname = [...this.nickname];
    c.otName = [...this.otName];
    return c;
  }
}

/** struct DisableStruct */
export class DisableStruct {
  transformedMonPersonality = 0;
  disabledMove = 0;
  encoredMove = 0;
  protectUses = 0;
  stockpileCounter = 0;
  substituteHP = 0;
  disableTimer = 0;
  disableTimerStartValue = 0;
  encoredMovePos = 0;
  unkD = 0;
  encoreTimer = 0;
  encoreTimerStartValue = 0;
  perishSongTimer = 0;
  perishSongTimerStartValue = 0;
  furyCutterCounter = 0;
  rolloutTimer = 0;
  rolloutTimerStartValue = 0;
  chargeTimer = 0;
  chargeTimerStartValue = 0;
  tauntTimer = 0;
  tauntTimer2 = 0;
  battlerPreventingEscape = 0;
  battlerWithSureHit = 0;
  isFirstTurn = 0;
  unk17 = 0;
  truantCounter = 0;
  truantSwitchInHack = 0;
  unk18_a_2 = 0;
  mimickedMoves = 0;
  rechargeTimer = 0;
}

/** struct ProtectStruct */
export class ProtectStruct {
  protected = 0;
  endured = 0;
  noValidMoves = 0;
  helpingHand = 0;
  bounceMove = 0;
  stealMove = 0;
  flag0Unknown = 0;
  prlzImmobility = 0;
  confusionSelfDmg = 0;
  targetNotAffected = 0;
  chargingTurn = 0;
  fleeType = 0;
  usedImprisonedMove = 0;
  loveImmobility = 0;
  usedDisabledMove = 0;
  usedTauntedMove = 0;
  flag2Unknown = 0;
  flinchImmobility = 0;
  notFirstStrike = 0;
  physicalDmg = 0;
  specialDmg = 0;
  physicalBattlerId = 0;
  specialBattlerId = 0;
  fieldE = 0;
}

/** struct SpecialStatus */
export class SpecialStatus {
  statLowered = 0;
  lightningRodRedirected = 0;
  restoredBattlerSprite = 0;
  intimidatedMon = 0;
  traced = 0;
  ppNotAffectedByPressure = 0;
  faintedHasReplacement = 0;
  focusBanded = 0;
  dmg = 0;
  physicalDmg = 0;
  specialDmg = 0;
  physicalBattlerId = 0;
  specialBattlerId = 0;
  field12 = 0;
  field13 = 0;
}

/** struct SideTimer */
export class SideTimer {
  reflectTimer = 0;
  reflectBattlerId = 0;
  lightscreenTimer = 0;
  lightscreenBattlerId = 0;
  mistTimer = 0;
  mistBattlerId = 0;
  safeguardTimer = 0;
  safeguardBattlerId = 0;
  followmeTimer = 0;
  followmeTarget = 0;
  spikesAmount = 0;
  fieldB = 0;
}

/** struct WishFutureKnock */
export class WishFutureKnock {
  futureSightCounter = new Uint8Array(4);
  futureSightAttacker = new Uint8Array(4);
  futureSightDmg = new Int32Array(4);
  futureSightMove = new Uint16Array(4);
  wishCounter = new Uint8Array(4);
  wishMonId = new Uint8Array(4);
  weatherDuration = 0;
  knockedOffMons = new Uint8Array(2);
}

/** struct BattleStruct (only what FRLG single/double battles use; link/multi fields kept for parity). */
export class BattleStruct {
  turnEffectsTracker = 0;
  turnEffectsBattlerId = 0;
  turnCountersTracker = 0;
  wrappedMove = new Uint8Array(8);
  moveTarget = new Uint8Array(4);
  expGetterMonId = 0;
  wildVictorySong = 0;
  dynamicMoveType = 0;
  wrappedBy = new Uint8Array(4);
  assistPossibleMoves = new Uint16Array(6 * 4);
  focusPunchBattlerId = 0;
  battlerPreventingSwitchout = 0;
  moneyMultiplier = 0;
  savedTurnActionNumber = 0;
  switchInAbilitiesCounter = 0;
  faintedActionsState = 0;
  faintedActionsBattlerId = 0;
  expValue = 0;
  scriptPartyIdx = 0;
  sentInPokes = 0;
  selectionScriptFinished = new Uint8Array(4);
  battlerPartyIndexes = new Uint8Array(4);
  monToSwitchIntoId = new Uint8Array(4);
  /** [battler][3] */
  battlerPartyOrders = [new Uint8Array(3), new Uint8Array(3), new Uint8Array(3), new Uint8Array(3)];
  runTries = 0;
  caughtMonNick: number[] = [];
  safariRockThrowCounter = 0;
  safariBaitThrowCounter = 0;
  safariEscapeFactor = 0;
  safariCatchFactor = 0;
  formToChangeInto = 0;
  chosenMovePositions = new Uint8Array(4);
  stateIdAfterSelScript = new Uint8Array(4);
  playerPartyIdx = 0;
  stringMoveType = 0;
  expGetterBattlerId = 0;
  absentBattlerFlags = 0;
  AI_monToSwitchIntoId = new Uint8Array(2);
  simulatedInputState = new Uint8Array(4);
  /** lastTakenMove[MAX_BATTLERS_COUNT * 2 * 2] as u16 pairs per battler: index battler */
  lastTakenMove = new Uint16Array(4);
  hpOnSwitchout = new Uint16Array(2);
  abilityPreventingSwitchout = 0;
  hpScale = 0;
  savedBattleTypeFlags = 0;
  synchronizeMoveEffect = 0;
  multiplayerId = 0;
  overworldWeatherDone = 0;
  atkCancellerTracker = 0;
  usedHeldItems = new Uint16Array(4);
  chosenItem = new Uint8Array(4);
  AI_itemType = new Uint8Array(2);
  AI_itemFlags = new Uint8Array(2);
  choicedMove = new Uint16Array(4);
  changedItems = new Uint16Array(4);
  intimidateBattler = 0;
  switchInItemsCounter = 0;
  turnSideTracker = 0;
  givenExpMons = 0;
  /** lastTakenMoveFrom[attacker][target] as u16 (MAX_BATTLERS_COUNT * MAX_BATTLERS_COUNT * 2 bytes) */
  lastTakenMoveFrom = [new Uint16Array(4), new Uint16Array(4), new Uint16Array(4), new Uint16Array(4)];
  wishPerishSongState = 0;
  wishPerishSongBattlerId = 0;
  lastAttackerToFaintOpponent = 0;
}

/** struct AI_ThinkingStruct */
export class AiThinkingStruct {
  aiState = 0;
  movesetIndex = 0;
  moveConsidered = 0;
  score = new Int8Array(4);
  funcResult = 0;
  aiFlags = 0;
  aiAction = 0;
  aiLogicId = 0;
  simulatedRNG = new Uint8Array(4);
}

/** struct BattleHistory */
export class BattleHistory {
  /** usedMoves[side][8] */
  usedMoves = [new Uint16Array(8), new Uint16Array(8)];
  abilities = new Uint8Array(2);
  itemEffects = new Uint8Array(2);
  trainerItems = new Uint16Array(4);
  itemsNo = 0;
}

export interface ScriptsStack {
  ptr: number[];
  size: number;
}

export interface CallbacksStack {
  function: (() => void)[];
  size: number;
}

/** struct BattleResources */
export class BattleResources {
  flags = new Uint32Array(4);
  battleScriptsStack: ScriptsStack = { ptr: new Array(8).fill(0), size: 0 };
  battleCallbackStack: CallbacksStack = { function: new Array(8).fill(() => {}), size: 0 };
  beforeLvlUp = new Uint16Array(6);
  ai = new AiThinkingStruct();
  battleHistory = new BattleHistory();
  AI_ScriptsStack: ScriptsStack = { ptr: new Array(8).fill(0), size: 0 };
}

/** struct BattleResults */
export class BattleResults {
  playerFaintCounter = 0;
  opponentFaintCounter = 0;
  playerSwitchesCounter = 0;
  numHealingItemsUsed = 0;
  numRevivesUsed = 0;
  playerMonWasDamaged = 0;
  usedMasterBall = 0;
  caughtMonBall = 0;
  shinyWildMon = 0;
  playerMon1Species = 0;
  playerMon1Name: number[] = [];
  battleTurnCounter = 0;
  playerMon2Name: number[] = [];
  lastOpponentSpecies = 0;
  lastUsedMovePlayer = 0;
  lastUsedMoveOpponent = 0;
  playerMon2Species = 0;
  caughtMonSpecies = 0;
  caughtMonNick: number[] = [];
  catchAttempts = new Uint8Array(11);
}

/** struct BattleSpriteInfo */
export class BattleSpriteInfo {
  invisible = 0;
  lowHpSong = 0;
  behindSubstitute = 0;
  flag_x8 = 0;
  hpNumbersNoBars = 0;
  transformSpecies = 0;
}

/** struct BattleHealthboxInfo */
export class BattleHealthboxInfo {
  partyStatusSummaryShown = 0;
  healthboxIsBouncing = 0;
  battlerIsBouncing = 0;
  ballAnimActive = 0;
  statusAnimActive = 0;
  animFromTableActive = 0;
  specialAnimActive = 0;
  triedShinyMonAnim = 0;
  finishedShinyMonAnim = 0;
  opponentDrawPartyStatusSummaryDelay = 0;
  healthboxBounceSpriteId = 0;
  battlerBounceSpriteId = 0;
  animationState = 0;
  partyStatusDelayTimer = 0;
  matrixNum = 0;
  shadowSpriteId = 0;
  soundTimer = 0;
  introEndDelay = 0;
}

/** struct BattleAnimationInfo */
export class BattleAnimationInfo {
  animArg = 0;
  ballThrowCaseId = 0;
  introAnimActive = 0;
  wildMonInvisible = 0;
  numBallParticles = 0;
  ballSubpx = 0;
}

/** struct BattleBarInfo */
export class BattleBarInfo {
  healthboxSpriteId = 0;
  maxValue = 0;
  oldValue = 0;
  receivedValue = 0;
  currValue = 0;
}

/** struct BattleSpriteData */
export class BattleSpriteData {
  battlerData = [0, 1, 2, 3].map(() => new BattleSpriteInfo());
  healthBoxesData = [0, 1, 2, 3].map(() => new BattleHealthboxInfo());
  animationData = new BattleAnimationInfo();
  battleBars = [0, 1, 2, 3].map(() => new BattleBarInfo());
}

/** struct ChooseMoveStruct (battle_controllers.h) */
export interface ChooseMoveStruct {
  moves: number[];
  currentPp: number[];
  maxPp: number[];
  species: number;
  monType1: number;
  monType2: number;
}

/** struct HpAndStatus */
export interface HpAndStatus {
  hp: number;
  status: number;
}

/** struct BattleEnigmaBerry (unused outside link battles, kept so hold-effect lookups read zero). */
export class BattleEnigmaBerry {
  name: number[] = [];
  holdEffect = 0;
  itemEffect = new Uint8Array(18);
  holdEffectParam = 0;
}
