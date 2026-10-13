import type { ObjectEvent } from '../entities/ObjectEvent';
import type { Input } from '../input/Input';
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
  /** StartTrainerBattle: returns a wait that ends when the battle is over, with the outcome. */
  startTrainerBattle(battle: TrainerBattle): { done: Wait; playerWon(): boolean };
  /** GetCurrentRegionMapSectionId, for a new mon's met location. */
  mapSection(): string;
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
    this.state.setVar('VAR_TEXT_COLOR', NPC_TEXT_COLOR_DEFAULT);
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
  private contextTextColor(): TextColor {
    const c = this.state.getVar('VAR_TEXT_COLOR');
    if (c !== NPC_TEXT_COLOR_DEFAULT) return textColorFromId(c);
    return this.host.selectedObject ? this.npcTextColor : 'neutral';
  }

  /** The `stringvar` macro: STR_VAR_1..3 -> 0..2, anything else is a literal index. */
  private stringVar(token: string): number {
    const m = /^STR_VAR_([123])$/.exec(token.trim());
    return m ? Number(m[1]) - 1 : (this.defines.get(token) ?? 0);
  }

  private callSpecial(name: string): number | void {
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
      this.state.setVar('VAR_TEXT_COLOR', this.defines.get(a[0]) ?? NPC_TEXT_COLOR_DEFAULT);
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
      this.movements.push(new MovementRunner(obj, this.data.code, pc, this.host.player));
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
      const lead = this.state.party.find((m) => !m.isEgg) ?? this.state.party[0]; // GetLeadMonIndex
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
      if (result !== 2) this.state.setDexFlags(this.state.pokemon.nationalDex(species), true, true);
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
    /** BattleSetup_ConfigureTrainerBattle: record the battle and jump to the script that runs it. */
    trainerbattle(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      const mode = this.defines.get(a[0]) ?? 0;
      const battle: TrainerBattle = {
        mode,
        trainer: this.defines.get(a[1]) ?? 0,
        localIdOrFlags: this.defines.get(a[2]) ?? this.host.resolveLocalId(a[2]) ?? 0,
        returnPc: ctx.pc,
      };
      if (mode === this.defines.get('TRAINER_BATTLE_EARLY_RIVAL')) {
        // sEarlyRivalBattleParams
        battle.defeatText = a[3];
        battle.victoryText = a[4];
        this.battle = battle;
        this.jump(ctx, 'EventScript_DoNoIntroTrainerBattle');
        return;
      }
      if (mode === this.defines.get('TRAINER_BATTLE_SINGLE_NO_INTRO_TEXT')) {
        // sOrdinaryNoIntroBattleParams
        battle.defeatText = a[3];
        this.battle = battle;
        this.jump(ctx, 'EventScript_DoNoIntroTrainerBattle');
        return;
      }
      this.unimplemented(`trainerbattle ${a[0]}`, a);
    },
    /** ScrCmd_dotrainerbattle + CB2_EndTrainerBattle */
    dotrainerbattle(this: ScriptEngine, ctx: ScriptContext) {
      const battle = this.battle;
      if (!battle) return;
      const run = this.host.startTrainerBattle(battle);
      ctx.wait = () => {
        if (!run.done()) return false;
        const won = run.playerWon();
        if (battle.mode === this.defines.get('TRAINER_BATTLE_EARLY_RIVAL')) {
          // Losing the early rival battles doesn't white out; VAR_RESULT says who won.
          this.state.setVar('VAR_RESULT', won ? 0 : 1);
          if (!won) this.callSpecial('HealPlayerParty');
        }
        this.setTrainerFlag(battle.trainer);
        return true;
      };
    },
    /** BattleSetup_GetScriptAddrAfterBattle */
    gotopostbattlescript(this: ScriptEngine, ctx: ScriptContext) {
      if (this.battle) ctx.pc = this.battle.returnPc;
      else ctx.done = true;
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

const NPC_TEXT_COLOR_DEFAULT = 255;

/** NPC_TEXT_COLOR_MALE / FEMALE; MON and NEUTRAL both use the default dark-gray text. */
export function textColorFromId(c: number): TextColor {
  return c === 0 ? 'male' : c === 1 ? 'female' : 'neutral';
}

function dirArg(token: string, defines: Defines): Direction | undefined {
  const n = defines.get(token);
  // DIR_SOUTH=1, DIR_NORTH=2, DIR_WEST=3, DIR_EAST=4
  if (n !== undefined) return ([undefined, 'down', 'up', 'left', 'right'] as const)[n];
  return parseDirection(token.replace('DIR_', ''));
}
