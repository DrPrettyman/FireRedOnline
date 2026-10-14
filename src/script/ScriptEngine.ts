import type { ObjectEvent } from '../entities/ObjectEvent';
import type { Input } from '../input/Input';
import type { Pokemon } from '../pokemon/Pokemon';
import type { GameState } from '../state/GameState';
import type { Charmap } from '../text/charmap';
import type { MessageBox, TextColor } from '../text/MessageBox';
import type { YesNoMenu } from '../ui/YesNoMenu';
import { parseDirection, type Direction } from '../world/direction';
import type { Defines } from './Defines';
import { MovementRunner, towards, type Instruction } from './MovementRunner';
import { SPECIALS, type SpecialEnv } from './specials';

export interface ScriptsData {
  code: Instruction[];
  labels: Record<string, number>;
  defines: Record<string, number>;
  stdScripts: string[];
  /** vs_seeker.c sRematches: each rematchable trainer's parties, SKIP = 0xFFFF. */
  rematches: number[][];
  /** heal_locations.json, indexed by HEAL_LOCATION_* - 1. */
  healLocations: HealLocation[];
  /** ComputeWhiteOutMoneyLoss tables (overworld.c). */
  whiteOut: { moneyLossMultipliers: number[]; moneyLossBadgeFlags: number[] };
}

/** sHealLocations + sWhiteoutRespawnHealCenterMapIdxs + sWhiteoutRespawnHealerNpcIds. */
export interface HealLocation {
  map: string;
  x: number;
  y: number;
  /** Where a white-out sends you (a Pokémon Center 1F, or the player's house). */
  respawnMap: string;
  /** LOCALID_* of the nurse (or Mom) on the respawn map. */
  respawnNpc: string;
}

/** What the interpreter needs from the overworld. Implemented by OverworldScene. */
export interface ScriptHost {
  readonly player: ObjectEvent;
  /** gSelectedObjectEvent: the NPC being talked to, if any. */
  readonly selectedObject?: ObjectEvent;
  objectByLocalId(localId: number): ObjectEvent | undefined;
  /** removeobject: set the object's hide flag and despawn it. */
  removeObject(localId: number): void;
  /** addobject: spawn the object from the map template. */
  addObject(localId: number): void;
  /** gSelectedObjectEvent = the current map's object with this local id (SetMapVarsToTrainer). */
  selectObject(localId: number): void;
  /** SetTrainerMovementType: switch a live object to another MOVEMENT_TYPE_*. */
  setObjectMovementType(obj: ObjectEvent, movementType: string): void;
  /** setobjectxyperm / setobjectmovementtype: edit the map's object template. */
  setObjectTemplate(localId: number, patch: { x?: number; y?: number; movementType?: string }): void;
  setObjectPosition(localId: number, x: number, y: number): void;
  setMetatile(x: number, y: number, metatile: number, impassable: boolean): void;
  warp(mapId: string, warpId: number, x: number, y: number): void;
  /** Map-local player coordinates. */
  playerLocal(): { x: number; y: number };
  /** DisplayYesNoMenuDefaultYes */
  openYesNo(): YesNoMenu;
  /** LOCALID_* names are generated per map from map.json `local_id` fields. */
  resolveLocalId(name: string): number | undefined;
  /** ScriptMenu_ShowPokemonPic */
  showMonPic(species: number, x: number, y: number): void;
  /** ScriptMenu_HidePokemonPic: a wait that ends once the box is gone, or undefined if none is shown. */
  hideMonPic(): Wait | undefined;
  /** FadeScreen: returns a wait for IsPaletteNotActive. */
  fadeScreen(mode: number): Wait;
  /** StartTrainerBattle: `done` ends when the battle is over (screen still black), with the outcome. */
  startTrainerBattle(battle: TrainerBattle): TrainerBattleRun;
  /** A non-trainer battle against `enemyParty` (gEnemyParty), e.g. StartOldManTutorialBattle. */
  startScriptedBattle(battleTypeFlags: number, enemyParty: Pokemon[]): TrainerBattleRun;
  /** FieldEffectStart for an effect over `obj` (the emote icons); false if it isn't ported. */
  startFieldEffect(fldEff: string, obj: ObjectEvent): boolean;
  /** CB2_WhiteOut: from the black screen after a lost battle to the last heal location. */
  whiteOut(): void;
  /** GetCurrentRegionMapSectionId, for a new mon's met location. */
  mapSection(): string;
}

export interface TrainerBattleRun {
  done: Wait;
  playerWon(): boolean;
  /** CB2_ReturnToFieldContinueScriptPlayMapMusic: fade the field back in. */
  returnToField(): Wait;
}

/** The trainer battle configured by `trainerbattle` (battle_setup.c statics). */
export interface TrainerBattle {
  mode: number;
  trainer: number;
  /** Object local id, or the RIVAL_BATTLE_* flags for TRAINER_BATTLE_EARLY_RIVAL. */
  localIdOrFlags: number;
  introText?: string;
  defeatText?: string;
  victoryText?: string;
  cannotBattleText?: string;
  beatenScript?: string;
  /** sTrainerBattleEndScript: the instruction after `trainerbattle`. */
  returnPc: number;
}

export type Wait = () => boolean;

/** Comparison result from `compare`/`checkflag`, consumed by the condition table below. */
const enum Cmp {
  Less,
  Equal,
  Greater,
}

// sScriptConditionTable: rows = condition (LT, EQ, GT, LE, GE, NE), cols = comparison result.
const CONDITIONS: Record<string, [boolean, boolean, boolean]> = {
  lt: [true, false, false],
  eq: [false, true, false],
  gt: [false, false, true],
  le: [true, true, false],
  ge: [false, true, true],
  ne: [true, false, true],
};
const CONDITION_IDS = ['lt', 'eq', 'gt', 'le', 'ge', 'ne'];

const MAX_STEPS_PER_TICK = 10_000;

/** One running script (struct ScriptContext). */
class ScriptContext {
  pc: number;
  stack: number[] = [];
  data: (string | number)[] = [0, 0, 0, 0];
  cmp = Cmp.Equal;
  wait?: Wait;
  done = false;

  constructor(
    pc: number,
    readonly label: string,
  ) {
    this.pc = pc;
  }
}

/**
 * Interpreter for the decomp's event scripts at source-macro level (msgbox, goto_if_eq, ...).
 * The decomp's own std scripts (Std_MsgboxNPC etc.) supply higher-level behaviour, so only
 * low-level commands live here.
 */
export class ScriptEngine {
  private ctx?: ScriptContext;
  private movements: MovementRunner[] = [];
  private warned = new Set<string>();
  /** Default colour for the NPC being talked to (GetColorFromTextColorTable). */
  npcTextColor: TextColor = 'neutral';
  /** Set by specials that the script then blocks on with `waitstate`. */
  private waitState?: Wait;
  private battle?: TrainerBattle;
  private specialEnv: SpecialEnv;

  constructor(
    private data: ScriptsData,
    private defines: Defines,
    private state: GameState,
    private strings: Record<string, string>,
    private charmap: Charmap,
    private messageBox: MessageBox,
    private input: Input,
    private host: ScriptHost,
  ) {
    this.specialEnv = {
      state,
      host,
      setWaitState: (w) => (this.waitState = w),
      warnOnce: (key, message) => {
        if (this.warned.has(key)) return;
        this.warned.add(key);
        console.warn(message);
      },
    };
  }

  get running(): boolean {
    return this.ctx !== undefined;
  }

  hasLabel(label: string): boolean {
    return label in this.data.labels;
  }

  /** ScriptContext_SetupScript: start a script in the global context. */
  start(label: string): boolean {
    const pc = this.data.labels[label];
    if (pc === undefined) {
      console.warn('[script] missing label', label);
      return false;
    }
    this.ctx = new ScriptContext(pc, label);
    // ResetContextNpcTextColor (via ResetFacingNpcOrSignpostVars on field input)
    // Approximation: the GBA does this in ProcessPlayerFieldInput before any interaction, not per script.
    this.state.setVar('VAR_TEXT_COLOR', this.defines.require('NPC_TEXT_COLOR_DEFAULT'));
    return true;
  }

  /** RunScriptImmediately: for map scripts that must finish synchronously (no waits). */
  runImmediately(label: string): void {
    const pc = this.data.labels[label];
    if (pc === undefined) return;
    const ctx = new ScriptContext(pc, label);
    for (let i = 0; i < MAX_STEPS_PER_TICK && !ctx.done; i++) {
      this.step(ctx);
      if (ctx.wait) {
        console.warn('[script] immediate script tried to wait:', label);
        break;
      }
    }
  }

  /** Advance scripts, movements and the message box by one frame. */
  tick(): void {
    for (const m of this.movements) m.tick();
    this.movements = this.movements.filter((m) => !m.done);

    const ctx = this.ctx;
    if (!ctx) return;
    for (let i = 0; i < MAX_STEPS_PER_TICK; i++) {
      if (ctx.wait) {
        if (!ctx.wait()) return;
        ctx.wait = undefined;
      }
      if (ctx.done) break;
      this.step(ctx);
    }
    if (ctx.done) this.ctx = undefined;
  }

  // ---------------------------------------------------------------- map script tables

  /** Find a MAP_SCRIPT_* entry in a map's `<Map>_MapScripts` header. */
  mapScript(mapName: string, type: string): string | undefined {
    let i = this.data.labels[`${mapName}_MapScripts`];
    if (i === undefined) return undefined;
    for (; i < this.data.code.length; i++) {
      const [op, t, label] = this.data.code[i];
      if (op !== 'map_script') return undefined;
      if (t === type) return label;
    }
    return undefined;
  }

  /** ON_FRAME_TABLE / ON_WARP_INTO_MAP_TABLE: first `map_script_2 VAR, value, script` that matches. */
  mapScriptTable(tableLabel: string): string | undefined {
    let i = this.data.labels[tableLabel];
    if (i === undefined) return undefined;
    for (; i < this.data.code.length; i++) {
      const [op, v, value, label] = this.data.code[i];
      if (op !== 'map_script_2') return undefined;
      if (this.state.getVar(v) === this.state.value(value)) return label;
    }
    return undefined;
  }

  // ---------------------------------------------------------------- interpreter

  private step(ctx: ScriptContext): void {
    const ins = this.data.code[ctx.pc++];
    if (!ins || ins[0].startsWith('.')) {
      ctx.done = true; // ran off the end into data
      return;
    }
    const [op, ...a] = ins;
    const handler = (this.commands as Record<string, (ctx: ScriptContext, a: string[]) => void>)[op];
    if (handler) handler.call(this, ctx, a);
    else this.unimplemented(op, a);
  }

  private unimplemented(op: string, a: string[]): void {
    if (!this.warned.has(op)) {
      this.warned.add(op);
      console.warn('[script] unimplemented command', op, a.join(', '));
    }
  }

  private jump(ctx: ScriptContext, label: string): void {
    const pc = this.data.labels[label];
    if (pc === undefined) {
      console.warn('[script] missing label', label);
      ctx.done = true;
      return;
    }
    ctx.pc = pc;
  }

  private call(ctx: ScriptContext, label: string): void {
    ctx.stack.push(ctx.pc);
    this.jump(ctx, label);
  }

  private compare(ctx: ScriptContext, a: number, b: number): void {
    ctx.cmp = a < b ? Cmp.Less : a === b ? Cmp.Equal : Cmp.Greater;
  }

  private test(ctx: ScriptContext, cond: string): boolean {
    const c = CONDITIONS[cond] ?? CONDITIONS[CONDITION_IDS[Number(this.defines.get(cond))]];
    return c ? c[ctx.cmp] : false;
  }

  /** goto_if_eq/call_if_eq etc.: `VAR, value, label` (or `label` alone to reuse the last compare). */
  private condBranch(ctx: ScriptContext, a: string[], cond: string, isCall: boolean): void {
    let label: string;
    if (a.length >= 3) {
      this.compare(ctx, this.state.getVar(a[0]), this.state.value(a[1]));
      label = a[2];
    } else {
      label = a[0];
    }
    if (this.test(ctx, cond)) {
      if (isCall) this.call(ctx, label);
      else this.jump(ctx, label);
    }
  }

  private flagBranch(ctx: ScriptContext, a: string[], wantSet: boolean, isCall: boolean): void {
    if (this.state.getFlag(a[0]) === wantSet) {
      if (isCall) this.call(ctx, a[1]);
      else this.jump(ctx, a[1]);
    }
  }

  /** Object id argument: a number, a var (VarGet), or a map-specific LOCALID_* name. */
  private localId(token: string): number {
    if (this.defines.get(token) !== undefined) return this.state.value(token);
    const id = this.host.resolveLocalId(token);
    if (id === undefined) console.warn('[script] unknown object id', token);
    return id ?? 0;
  }

  private objectArg(token: string): ObjectEvent | undefined {
    return this.host.objectByLocalId(this.localId(token));
  }

  private stringFor(ctx: ScriptContext, token: string): number[] | undefined {
    const label = token === '0x0' || token === '0' ? String(ctx.data[0]) : token;
    const raw = this.strings[label];
    if (raw === undefined) {
      console.warn('[script] missing text', label);
      return undefined;
    }
    return this.charmap.encode(raw);
  }

  private showMessage(ctx: ScriptContext, token: string): void {
    const bytes = this.stringFor(ctx, token);
    if (bytes) this.messageBox.show(bytes, this.contextTextColor());
  }

  /** ContextNpcGetTextColor */
  contextTextColor(): TextColor {
    const c = this.state.getVar('VAR_TEXT_COLOR');
    if (c !== this.defines.require('NPC_TEXT_COLOR_DEFAULT')) return textColorFromId(c, this.defines);
    return this.host.selectedObject ? this.npcTextColor : 'neutral';
  }

  /** The `stringvar` macro: STR_VAR_1..3 -> 0..2, anything else is a literal index. */
  private stringVar(token: string): number {
    const m = /^STR_VAR_([123])$/.exec(token.trim());
    return m ? Number(m[1]) - 1 : (this.defines.get(token) ?? 0);
  }

  private callSpecial(name: string): number | void {
    if (TRAINER_SPECIALS.has(name)) return this.trainerSpecial(name);
    const special = SPECIALS[name];
    if (special) return special(this.specialEnv);
    this.unimplemented(`special ${name}`, []);
  }

  private commands = {
    // ------------------------------------------------ flow
    end(ctx: ScriptContext) {
      ctx.done = true;
    },
    return(ctx: ScriptContext) {
      const pc = ctx.stack.pop();
      if (pc === undefined) ctx.done = true;
      else ctx.pc = pc;
    },
    goto(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.jump(ctx, a[0]);
    },
    call(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.call(ctx, a[0]);
    },
    nop() {},
    nop1() {},
    compare(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.compare(ctx, this.state.getVar(a[0]), this.state.value(a[1]));
    },
    compare_var_to_value(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.compare(ctx, this.state.getVar(a[0]), this.defines.get(a[1]) ?? 0);
    },
    compare_var_to_var(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.compare(ctx, this.state.getVar(a[0]), this.state.getVar(a[1]));
    },
    goto_if(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      if (this.test(ctx, a[0])) this.jump(ctx, a[1]);
    },
    call_if(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      if (this.test(ctx, a[0])) this.call(ctx, a[1]);
    },
    goto_if_set(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.flagBranch(ctx, a, true, false);
    },
    goto_if_unset(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.flagBranch(ctx, a, false, false);
    },
    call_if_set(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.flagBranch(ctx, a, true, true);
    },
    call_if_unset(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.flagBranch(ctx, a, false, true);
    },
    goto_if_lt(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.condBranch(ctx, a, 'lt', false);
    },
    goto_if_eq(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.condBranch(ctx, a, 'eq', false);
    },
    goto_if_gt(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.condBranch(ctx, a, 'gt', false);
    },
    goto_if_le(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.condBranch(ctx, a, 'le', false);
    },
    goto_if_ge(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.condBranch(ctx, a, 'ge', false);
    },
    goto_if_ne(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.condBranch(ctx, a, 'ne', false);
    },
    call_if_lt(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.condBranch(ctx, a, 'lt', true);
    },
    call_if_eq(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.condBranch(ctx, a, 'eq', true);
    },
    call_if_gt(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.condBranch(ctx, a, 'gt', true);
    },
    call_if_le(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.condBranch(ctx, a, 'le', true);
    },
    call_if_ge(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.condBranch(ctx, a, 'ge', true);
    },
    call_if_ne(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.condBranch(ctx, a, 'ne', true);
    },
    /** switch VAR → copyvar VAR_0x8000; each `case value, label` compares against it. */
    switch(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.state.setVar('VAR_0x8000', this.state.getVar(a[0]));
    },
    case(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.compare(ctx, this.state.getVar('VAR_0x8000'), this.state.value(a[0]));
      if (ctx.cmp === Cmp.Equal) this.jump(ctx, a[1]);
    },
    goto_if_defeated(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      if (this.trainerDefeated(a[0])) this.jump(ctx, a[1]);
    },
    goto_if_not_defeated(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      if (!this.trainerDefeated(a[0])) this.jump(ctx, a[1]);
    },
    callstd(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      const label = this.data.stdScripts[this.defines.get(a[0]) ?? -1];
      if (label) this.call(ctx, label);
    },
    gotostd(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      const label = this.data.stdScripts[this.defines.get(a[0]) ?? -1];
      if (label) this.jump(ctx, label);
    },

    // ------------------------------------------------ flags & vars
    setflag(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.state.setFlag(a[0], true);
    },
    clearflag(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.state.setFlag(a[0], false);
    },
    checkflag(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      ctx.cmp = this.state.getFlag(a[0]) ? Cmp.Equal : Cmp.Less; // goto_if TRUE tests EQ against 1
    },
    setworldmapflag(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.state.setFlag(a[0], true);
    },
    setvar(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.state.setVar(a[0], this.defines.get(a[1]) ?? this.host.resolveLocalId(a[1]) ?? 0);
    },
    addvar(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.state.setVar(a[0], this.state.getVar(a[0]) + this.state.value(a[1]));
    },
    subvar(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.state.setVar(a[0], this.state.getVar(a[0]) - this.state.value(a[1]));
    },
    copyvar(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.state.setVar(a[0], this.state.getVar(a[1]));
    },
    setorcopyvar(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.state.setVar(a[0], this.state.value(a[1]));
    },
    random(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.state.setVar('VAR_RESULT', Math.floor(Math.random() * Math.max(1, this.state.value(a[0]))));
    },
    checkplayergender(this: ScriptEngine) {
      this.state.setVar('VAR_RESULT', this.state.playerGender === 'male' ? 0 : 1);
    },
    getplayerxy(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      const { x, y } = this.host.playerLocal();
      this.state.setVar(a[0], x);
      this.state.setVar(a[1], y);
    },
    loadword(_ctx: ScriptContext, a: string[]) {
      _ctx.data[Number(a[0])] = a[1];
    },

    // ------------------------------------------------ text
    msgbox(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      ctx.data[0] = a[0];
      const label = this.data.stdScripts[this.defines.get(a[1] ?? 'MSGBOX_DEFAULT') ?? 4];
      if (label) this.call(ctx, label);
    },
    message(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.showMessage(ctx, a[0]);
    },
    messageautoscroll(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.showMessage(ctx, a[0]);
    },
    waitmessage(this: ScriptEngine, ctx: ScriptContext) {
      ctx.wait = () => !this.messageBox.isPrinting;
    },
    waitbuttonpress(this: ScriptEngine, ctx: ScriptContext) {
      ctx.wait = () => this.input.pressedAorB();
    },
    closemessage(this: ScriptEngine) {
      this.messageBox.hide();
    },
    /** ScrCmd_textcolor: also saves the previous colour for EventScript_RestorePrevTextColor. */
    textcolor(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.state.setVar('VAR_PREV_TEXT_COLOR', this.state.getVar('VAR_TEXT_COLOR'));
      this.state.setVar('VAR_TEXT_COLOR', this.defines.require(a[0]));
    },
    signmsg() {},
    normalmsg() {},
    /** ScriptMenu_YesNo: VAR_RESULT = TRUE for YES, FALSE for NO or B. Position args are ignored in FRLG. */
    yesnobox(this: ScriptEngine, ctx: ScriptContext) {
      const menu = this.host.openYesNo();
      ctx.wait = () => {
        if (!menu.tick()) return false;
        this.state.setVar('VAR_RESULT', menu.result ? 1 : 0);
        return true;
      };
    },

    // ------------------------------------------------ objects
    lock() {},
    lockall() {},
    /** ScrCmd_release / ScrCmd_releaseall: both hide the field message box. */
    release(this: ScriptEngine) {
      this.messageBox.hide();
    },
    releaseall(this: ScriptEngine) {
      this.messageBox.hide();
    },
    faceplayer(this: ScriptEngine) {
      const obj = this.host.selectedObject;
      if (obj) obj.face(towards(obj, this.host.player));
    },
    turnobject(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      const dir = dirArg(a[1], this.defines);
      if (dir) this.objectArg(a[0])?.face(dir);
    },
    applymovement(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      const obj = this.objectArg(a[0]);
      const pc = this.data.labels[a[1]];
      if (!obj || pc === undefined) return;
      this.movements = this.movements.filter((m) => m.obj !== obj);
      this.movements.push(new MovementRunner(obj, this.data.code, pc, this.host.player, (f, o) => this.host.startFieldEffect(f, o)));
    },
    waitmovement(this: ScriptEngine, ctx: ScriptContext) {
      ctx.wait = () => this.movements.length === 0;
    },
    removeobject(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.host.removeObject(this.localId(a[0]));
    },
    addobject(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.host.addObject(this.localId(a[0]));
    },
    setobjectxy(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.host.setObjectPosition(this.localId(a[0]), this.state.value(a[1]), this.state.value(a[2]));
    },
    setobjectxyperm(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.host.setObjectTemplate(this.localId(a[0]), { x: this.state.value(a[1]), y: this.state.value(a[2]) });
    },
    setobjectmovementtype(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.host.setObjectTemplate(this.localId(a[0]), { movementType: a[1] });
    },

    // ------------------------------------------------ world
    setmetatile(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.host.setMetatile(
        this.state.value(a[0]),
        this.state.value(a[1]),
        this.defines.get(a[2]) ?? 0,
        (this.defines.get(a[3] ?? 'FALSE') ?? 0) !== 0,
      );
    },
    warp(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.doWarp(ctx, a);
    },
    warpsilent(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.doWarp(ctx, a);
    },
    warpdoor(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.doWarp(ctx, a);
    },
    // TODO: door animations (field_door.c). The door metatiles are left as-is for now.
    opendoor() {},
    closedoor() {},
    waitdooranim() {},
    delay(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      let frames = this.state.value(a[0]);
      ctx.wait = () => --frames <= 0;
    },
    /** ScrCmd_waitstate: block until the task a special started re-enables the script. */
    waitstate(this: ScriptEngine, ctx: ScriptContext) {
      const w = this.waitState;
      this.waitState = undefined;
      if (w) ctx.wait = w;
    },
    special(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.callSpecial(a[0]);
    },
    specialvar(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      const r = this.callSpecial(a[1]);
      this.state.setVar(a[0], typeof r === 'number' ? r : 0);
    },
    fadescreen(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      ctx.wait = this.host.fadeScreen(this.state.value(a[0]));
    },

    // ------------------------------------------------ items
    additem(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      const ok = this.state.bag.add(this.state.value(a[0]), this.state.value(a[1] ?? '1'));
      this.state.setVar('VAR_RESULT', ok ? 1 : 0);
    },
    removeitem(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      const ok = this.state.bag.remove(this.state.value(a[0]), this.state.value(a[1] ?? '1'));
      this.state.setVar('VAR_RESULT', ok ? 1 : 0);
    },
    checkitem(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      const ok = this.state.bag.has(this.state.value(a[0]), this.state.value(a[1] ?? '1'));
      this.state.setVar('VAR_RESULT', ok ? 1 : 0);
    },
    checkitemspace(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      const ok = this.state.bag.hasSpace(this.state.value(a[0]), this.state.value(a[1] ?? '1'));
      this.state.setVar('VAR_RESULT', ok ? 1 : 0);
    },
    /** GetPocketByItemId */
    checkitemtype(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.state.setVar('VAR_RESULT', this.state.pokemon.itemPocket(this.state.value(a[0])));
    },

    // ------------------------------------------------ string buffers
    bufferspeciesname(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.state.stringVars[this.stringVar(a[0])] = [...this.state.pokemon.speciesName(this.state.value(a[1]))];
    },
    bufferleadmonspeciesname(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      const lead = this.state.party.find((m) => !m.isEgg) ?? this.state.party[0]; // GetLeadMonIndex: first non-egg, else slot 0
      this.state.stringVars[this.stringVar(a[0])] = lead ? [...this.state.pokemon.speciesName(lead.species)] : [];
    },
    bufferpartymonnick(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      const mon = this.state.party[this.state.value(a[1])];
      this.state.stringVars[this.stringVar(a[0])] = mon ? [...mon.nickname] : [];
    },
    bufferitemname(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.state.stringVars[this.stringVar(a[0])] = this.state.pokemon.itemName(this.state.value(a[1]));
    },
    /** ScrCmd_bufferitemnameplural: only POKé BALL ("S") and berries ("IES") are pluralised. */
    bufferitemnameplural(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      const item = this.state.value(a[1]);
      const quantity = this.state.value(a[2]);
      const name = this.state.pokemon.itemName(item);
      const first = this.defines.get('FIRST_BERRY_INDEX') ?? -1;
      const last = this.defines.get('LAST_BERRY_INDEX') ?? -1;
      if (item === this.defines.get('ITEM_POKE_BALL') && quantity >= 2) name.push(...this.charmap.encodePlain('S'));
      else if (item >= first && item < last && quantity >= 2 && name.length) name.splice(-1, 1, ...this.charmap.encodePlain('IES'));
      this.state.stringVars[this.stringVar(a[0])] = name;
    },
    buffernumberstring(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.state.stringVars[this.stringVar(a[0])] = this.charmap.encodePlain(String(this.state.value(a[1])));
    },
    bufferstdstring(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      const label = this.state.pokemon.tables.stdStrings[this.state.value(a[1])];
      this.state.stringVars[this.stringVar(a[0])] = label ? this.charmap.encodePlain(this.strings[label] ?? '') : [];
    },
    bufferstring(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.state.stringVars[this.stringVar(a[0])] = this.charmap.encodePlain(this.strings[a[1]] ?? '');
    },

    // ------------------------------------------------ pokemon
    /** ScriptGiveMon: CreateMon with random IVs, OT = player, then party (or PC) and Pokédex flags. */
    givemon(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      const species = this.state.value(a[0]);
      const level = this.defines.get(a[1]) ?? 5;
      const item = this.state.value(a[2] ?? 'ITEM_NONE');
      const mon = this.state.pokemon.createMon(species, level, {
        otId: this.state.trainerId,
        otName: this.state.playerName,
        otGender: this.state.playerGender,
        metLocation: this.host.mapSection(),
      });
      mon.heldItem = item;
      const result = this.state.giveMon(mon);
      const c = this.state.pokemon.c;
      if (result === c.MON_GIVEN_TO_PARTY || result === c.MON_GIVEN_TO_PC) this.state.setDexFlags(this.state.pokemon.nationalDex(species), true, true);
      this.state.setVar('VAR_RESULT', result);
    },
    getpartysize(this: ScriptEngine) {
      this.state.setVar('VAR_RESULT', this.state.party.length);
    },
    showmonpic(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.host.showMonPic(this.state.value(a[0]), this.defines.get(a[1]) ?? 0, this.defines.get(a[2]) ?? 0);
    },
    hidemonpic(this: ScriptEngine, ctx: ScriptContext) {
      const w = this.host.hideMonPic();
      if (w) ctx.wait = w;
    },

    // ------------------------------------------------ trainers
    /**
     * BattleSetup_ConfigureTrainerBattle: load the mode's arguments (TrainerBattleLoadArgs with the
     * matching s*BattleParams table) and jump to the event script that runs the battle. The script
     * continues after `trainerbattle` (sTrainerBattleEndScript) once the battle is over or skipped.
     */
    trainerbattle(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      const d = this.defines;
      const mode = d.get(a[0]) ?? 0;
      const is = (...names: string[]) => names.some((n) => mode === d.get(n));
      const battle: TrainerBattle = {
        mode,
        trainer: d.get(a[1]) ?? 0,
        localIdOrFlags: d.get(a[2]) ?? this.host.resolveLocalId(a[2]) ?? 0,
        returnPc: ctx.pc,
      };
      let script: string;
      let setMapVars = true;
      if (is('TRAINER_BATTLE_SINGLE_NO_INTRO_TEXT')) {
        [battle.defeatText] = a.slice(3); // sOrdinaryNoIntroBattleParams
        script = 'EventScript_DoNoIntroTrainerBattle';
        setMapVars = false;
      } else if (is('TRAINER_BATTLE_EARLY_RIVAL')) {
        [battle.defeatText, battle.victoryText] = a.slice(3); // sEarlyRivalBattleParams (local id = RIVAL_BATTLE_* flags)
        script = 'EventScript_DoNoIntroTrainerBattle';
        setMapVars = false;
      } else if (is('TRAINER_BATTLE_CONTINUE_SCRIPT', 'TRAINER_BATTLE_CONTINUE_SCRIPT_NO_MUSIC')) {
        [battle.introText, battle.defeatText, battle.beatenScript] = a.slice(3); // sContinueScriptBattleParams
        script = 'EventScript_TryDoNormalTrainerBattle';
      } else if (is('TRAINER_BATTLE_CONTINUE_SCRIPT_DOUBLE', 'TRAINER_BATTLE_CONTINUE_SCRIPT_DOUBLE_NO_MUSIC')) {
        [battle.introText, battle.defeatText, battle.cannotBattleText, battle.beatenScript] = a.slice(3); // sContinueScriptDoubleBattleParams
        script = 'EventScript_TryDoDoubleTrainerBattle';
      } else if (is('TRAINER_BATTLE_DOUBLE', 'TRAINER_BATTLE_REMATCH_DOUBLE')) {
        [battle.introText, battle.defeatText, battle.cannotBattleText] = a.slice(3); // sDoubleBattleParams
        script = is('TRAINER_BATTLE_DOUBLE') ? 'EventScript_TryDoDoubleTrainerBattle' : 'EventScript_TryDoDoubleRematchBattle';
      } else {
        [battle.introText, battle.defeatText] = a.slice(3); // sOrdinaryBattleParams (SINGLE, REMATCH, anything else)
        script = is('TRAINER_BATTLE_REMATCH') ? 'EventScript_TryDoRematchBattle' : 'EventScript_TryDoNormalTrainerBattle';
      }
      this.battle = battle;
      // SetMapVarsToTrainer
      if (setMapVars && battle.localIdOrFlags !== d.require('LOCALID_NONE')) {
        this.state.setVar('VAR_LAST_TALKED', battle.localIdOrFlags);
        this.host.selectObject(battle.localIdOrFlags);
      }
      if (is('TRAINER_BATTLE_REMATCH', 'TRAINER_BATTLE_REMATCH_DOUBLE')) battle.trainer = this.getRematchTrainerId(battle.trainer);
      this.jump(ctx, script);
    },
    /** ScrCmd_dotrainerbattle: BattleSetup_StartTrainerBattle, then CB2_EndTrainerBattle. */
    dotrainerbattle(this: ScriptEngine, ctx: ScriptContext) {
      const battle = this.battle;
      if (!battle) return;
      ctx.wait = this.runTrainerBattle(battle, false);
    },
    /** ScrCmd_gotobeatenscript: BattleSetup_GetTrainerPostBattleScript */
    gotobeatenscript(this: ScriptEngine, ctx: ScriptContext) {
      this.jump(ctx, this.battle?.beatenScript ?? 'EventScript_TestSignpostMsg');
    },
    /** BattleSetup_GetScriptAddrAfterBattle */
    gotopostbattlescript(this: ScriptEngine, ctx: ScriptContext) {
      if (this.battle) ctx.pc = this.battle.returnPc;
      else this.jump(ctx, 'EventScript_TestSignpostMsg');
    },
    /** ScrCmd_setrespawn → SetLastHealLocationWarp */
    setrespawn(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      const loc = this.data.healLocations[this.state.value(a[0]) - 1];
      if (loc) this.state.lastHealLocation = { map: loc.map, x: loc.x, y: loc.y };
    },
    checktrainerflag(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      ctx.cmp = this.trainerDefeated(a[0]) ? Cmp.Equal : Cmp.Less;
    },
    settrainerflag(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.setTrainerFlag(this.state.value(a[0]));
    },
    cleartrainerflag(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      const start = this.defines.get('TRAINER_FLAGS_START') ?? 0;
      this.state.setFlag(start + this.state.value(a[0]), false);
    },

    // ------------------------------------------------ audio (not implemented yet)
    playse() {},
    waitse() {},
    playbgm() {},
    savebgm() {},
    fadedefaultbgm() {},
    fadenewbgm() {},
    fadeoutbgm() {},
    fadeinbgm() {},
    playfanfare() {},
    waitfanfare() {},
    playmoncry() {},
    waitmoncry() {},
  };

  private doWarp(ctx: ScriptContext, a: string[]): void {
    // warp MAP, warpId  |  warp MAP, x, y  |  warp MAP, warpId, x, y
    const warpId = a.length === 3 ? -1 : this.state.value(a[1] ?? '-1');
    const x = a.length === 3 ? this.state.value(a[1]) : this.state.value(a[2] ?? '-1');
    const y = a.length === 3 ? this.state.value(a[2]) : this.state.value(a[3] ?? '-1');
    this.host.warp(a[0], warpId, x, y);
    ctx.done = true;
  }

  /**
   * DoTrainerBattle, then CB2_EndTrainerBattle: either back to the field to continue the script, or a
   * white-out, which ends the script (ScriptContext_Init) and never comes back to it.
   */
  private runTrainerBattle(battle: TrainerBattle, rematch: boolean): Wait {
    const run = this.host.startTrainerBattle(battle);
    let fadeIn: Wait | undefined;
    return () => {
      if (fadeIn) return fadeIn();
      if (!run.done()) return false;
      if (this.endTrainerBattle(battle, run.playerWon(), rematch)) {
        fadeIn = run.returnToField();
        return false;
      }
      if (this.ctx) this.ctx.done = true;
      this.host.whiteOut();
      return true;
    };
  }

  /**
   * CB2_EndTrainerBattle (and CB2_EndRematchBattle, which also clears the trainer's rematch state).
   * Returns false when the player whites out.
   */
  private endTrainerBattle(battle: TrainerBattle, won: boolean, rematch = false): boolean {
    if (battle.mode === this.defines.get('TRAINER_BATTLE_EARLY_RIVAL')) {
      // VAR_RESULT = player lost. Losing heals only with RIVAL_BATTLE_HEAL_AFTER; otherwise it whites out.
      this.state.setVar('VAR_RESULT', won ? 0 : 1);
      if (!won && !(battle.localIdOrFlags & this.defines.require('RIVAL_BATTLE_HEAL_AFTER'))) return false;
      if (!won) this.callSpecial('HealPlayerParty');
    } else if (!won) {
      return false;
    }
    if (rematch) this.state.trainerRematches[this.state.getVar('VAR_LAST_TALKED')] = 0; // ClearRematchStateOfLastTalked
    this.setTrainerFlag(battle.trainer); // SetBattledTrainerFlag
    return true;
  }

  /**
   * battle_setup.c / vs_seeker.c specials that read the configured battle. The VS Seeker itself isn't
   * implemented, so `state.trainerRematches` stays clear and no trainer is ever ready for a rematch;
   * ShouldTryRematchBattle still sends a beaten trainer down the rematch script, which then falls
   * through to the post-battle text, as on the GBA.
   */
  private trainerSpecial(name: string): number | void {
    const battle = this.battle;
    const d = this.defines;
    switch (name) {
      case 'Script_HasTrainerBeenFought':
        return battle && this.trainerFlag(battle.trainer) ? 1 : 0;
      case 'SetBattledTrainerFlag':
        if (battle) this.setTrainerFlag(battle.trainer);
        return;
      case 'GetTrainerBattleMode':
        return battle?.mode ?? 0;
      case 'SetUpTrainerMovement': {
        // SetTrainerMovementType(GetTrainerFacingDirectionMovementType(facing)): stop wandering
        const obj = this.host.selectedObject;
        if (obj) this.host.setObjectMovementType(obj, `MOVEMENT_TYPE_FACE_${obj.facing.toUpperCase()}`);
        return;
      }
      case 'ShowTrainerIntroSpeech':
        this.showFieldMessage(battle?.introText);
        return;
      case 'ShowTrainerCantBattleSpeech':
        this.showFieldMessage(battle?.cannotBattleText);
        return;
      case 'HasEnoughMonsForDoubleBattle': {
        // GetMonsStateToDoubles
        const party = this.state.party;
        const alive = party.filter((m) => m.hp !== 0 && m.species !== 0 && !m.isEgg).length;
        const result = party.length === 1 ? 'PLAYER_HAS_ONE_MON' : alive > 1 ? 'PLAYER_HAS_TWO_USABLE_MONS' : 'PLAYER_HAS_ONE_USABLE_MON';
        this.state.setVar('VAR_RESULT', d.require(result));
        return;
      }
      case 'ShouldTryRematchBattle': {
        if (!battle) return 0;
        const i = this.data.rematches.findIndex((r) => r[0] === battle.trainer); // GetRematchIdx
        if (i < 0) return 0;
        if (this.trainerRematchable()) return 1; // ShouldTryRematchBattleInternal
        return this.trainerFlag(this.data.rematches[i][0]) ? 1 : 0; // HasRematchTrainerAlreadyBeenFought
      }
      case 'IsTrainerReadyForRematch': {
        // IsTrainerReadyForRematchInternal (LookupVsSeekerOpponentInArray skips SKIP entries)
        const found = battle && this.data.rematches.some((r) => r.includes(battle.trainer));
        return found && this.trainerRematchable() ? 1 : 0;
      }
      case 'StartRematchBattle': {
        if (battle) this.waitState = this.runTrainerBattle(battle, true);
        return;
      }
    }
  }

  /** IsThisTrainerRematchable(gSpecialVar_LastTalked) */
  private trainerRematchable(): boolean {
    return !!this.state.trainerRematches[this.state.getVar('VAR_LAST_TALKED')];
  }

  /** GetRematchTrainerId: the next rematch party not yet beaten, held back by story progress. */
  private getRematchTrainerId(trainer: number): number {
    const SKIP = 0xffff;
    const NONE = this.defines.require('TRAINER_NONE');
    const MAX_REMATCH_PARTIES = 6;
    // GetNextAvailableRematchTrainer
    const ids = this.data.rematches.find((r) => r[0] === trainer);
    if (!ids) return 0;
    const at = (j: number) => ids[j] ?? NONE;
    let j = 1;
    for (; j < MAX_REMATCH_PARTIES; j++) {
      if (at(j) === NONE) break;
      if (at(j) === SKIP || this.trainerFlag(at(j))) continue;
      break;
    }
    if (j === MAX_REMATCH_PARTIES || at(j) === NONE) j--;
    if (j === 0) return 0;
    // TryGetRematchTrainerIdGivenGameState: tiers unlock with the VS Seeker, Celadon, Fuchsia, the credits, RS link
    const gate = ['', 'FLAG_GOT_VS_SEEKER', 'FLAG_WORLD_MAP_CELADON_CITY', 'FLAG_WORLD_MAP_FUCHSIA_CITY', 'FLAG_SYS_GAME_CLEAR', 'FLAG_SYS_CAN_LINK_WITH_RS'][j];
    if (gate && !this.state.getFlag(gate)) {
      // GetRematchTrainerIdGivenGameState
      do j--;
      while (j !== 0 && at(j) === SKIP);
    }
    return at(j);
  }

  /** ShowFieldMessage */
  private showFieldMessage(label?: string): void {
    const raw = label && this.strings[label];
    this.messageBox.show(raw ? this.charmap.encode(raw) : this.charmap.encode('$'), this.contextTextColor());
  }

  private trainerFlag(trainer: number): boolean {
    const start = this.defines.get('TRAINER_FLAGS_START');
    return start !== undefined && this.state.getFlag(start + trainer);
  }

  /** SetTrainerFlag */
  private setTrainerFlag(trainer: number): void {
    const start = this.defines.get('TRAINER_FLAGS_START');
    if (start !== undefined) this.state.setFlag(start + trainer, true);
  }

  private trainerDefeated(trainer: string): boolean {
    const start = this.defines.get('TRAINER_FLAGS_START');
    return start !== undefined && this.state.getFlag(start + this.state.value(trainer));
  }
}

/** Specials handled by ScriptEngine.trainerSpecial (some return nothing). */
const TRAINER_SPECIALS = new Set([
  'Script_HasTrainerBeenFought',
  'SetBattledTrainerFlag',
  'GetTrainerBattleMode',
  'SetUpTrainerMovement',
  'ShowTrainerIntroSpeech',
  'ShowTrainerCantBattleSpeech',
  'HasEnoughMonsForDoubleBattle',
  'ShouldTryRematchBattle',
  'IsTrainerReadyForRematch',
  'StartRematchBattle',
]);

/** NPC_TEXT_COLOR_MALE / FEMALE; MON and NEUTRAL both use the default dark-gray text. */
export function textColorFromId(c: number, defines: Defines): TextColor {
  if (c === defines.require('NPC_TEXT_COLOR_MALE')) return 'male';
  if (c === defines.require('NPC_TEXT_COLOR_FEMALE')) return 'female';
  return 'neutral';
}

const DIR_NAMES: [string, Direction][] = [
  ['DIR_SOUTH', 'down'],
  ['DIR_NORTH', 'up'],
  ['DIR_WEST', 'left'],
  ['DIR_EAST', 'right'],
];

/** DIR_* id for a direction. */
export function directionId(d: Direction, defines: Defines): number {
  return defines.require(DIR_NAMES.find(([, dir]) => dir === d)![0]);
}

function dirArg(token: string, defines: Defines): Direction | undefined {
  const n = defines.get(token);
  if (n !== undefined) return DIR_NAMES.find(([name]) => defines.get(name) === n)?.[1];
  return parseDirection(token.replace('DIR_', ''));
}
