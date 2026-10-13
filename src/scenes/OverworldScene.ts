import Phaser from 'phaser';
import { spriteTextureKey, type Assets } from '../data/assets';
import type { ObjectEventData, WarpEventData } from '../data/types';
import { NpcBrain } from '../entities/NpcBrain';
import { ObjectEvent } from '../entities/ObjectEvent';
import { Input } from '../input/Input';
import { PokemonData } from '../pokemon/Pokemon';
import { Defines } from '../script/Defines';
import { ScriptEngine, textColorFromId, type ScriptHost, type TrainerBattle, type Wait } from '../script/ScriptEngine';
import { GameState } from '../state/GameState';
import { Charmap } from '../text/charmap';
import { Fonts } from '../text/Font';
import { MessageBox } from '../text/MessageBox';
import { Behaviors } from '../world/behaviors';
import { DELTA, type Direction } from '../world/direction';
import { MAPGRID_COLLISION_MASK, TILE } from '../world/MapChunk';
import { World } from '../world/World';
import { StartMenu } from '../ui/StartMenu';
import { YesNoMenu } from '../ui/YesNoMenu';
import { MonPicBox } from '../ui/MonPicBox';
import { ScreenFade } from '../ui/ScreenFade';

/** GBA runs at ~59.73Hz; we tick game logic at a fixed 60Hz regardless of display refresh. */
const FRAME_MS = 1000 / 60;
/** Frames a tap spends turning in place before a held direction starts walking. */
const TURN_FRAMES = 8;
const FADE_MS = 200;
const PLAYER_GFX = 'OBJ_EVENT_GFX_RED_NORMAL';
const LOCALID_PLAYER = 255;

export interface OverworldStart {
  map: string;
  x: number;
  y: number;
  facing?: Direction;
}

interface Npc {
  localId: number;
  brain: NpcBrain;
}

export class OverworldScene extends Phaser.Scene implements ScriptHost {
  private assets!: Assets;
  private world!: World;
  private behaviors!: Behaviors;
  private state!: GameState;
  private defines!: Defines;
  private scripts!: ScriptEngine;
  private messageBox!: MessageBox;
  private fonts!: Fonts;
  private charmap!: Charmap;
  /** A field UI overlay (start menu, notices) that owns input while open. */
  private overlay?: { tick(): boolean };
  private screenFade!: ScreenFade;
  private monPic?: MonPicBox;
  player!: ObjectEvent;
  selectedObject?: ObjectEvent;
  private npcs: Npc[] = [];
  /** Object templates per map, editable by setobjectxyperm/setobjectmovementtype. */
  private templates = new Map<string, ObjectEventData[]>();
  private buttons!: Input;
  private accumulator = 0;
  private busy = true;
  private turnFrames = 0;
  private wasMoving = false;
  private pendingWarp?: WarpEventData;
  private hud!: Phaser.GameObjects.Text;

  constructor() {
    super('Overworld');
  }

  init(): void {
    this.assets = this.registry.get('assets');
    this.behaviors = new Behaviors(this.assets.behaviorIds);
    this.defines = new Defines(this.assets.scripts.defines);
    this.charmap = new Charmap(this.assets.charmap);
    const a = this.assets;
    const pokemon = new PokemonData(a.species, a.moves, a.items, a.pokemonTables, this.charmap);
    this.state = new GameState(this.defines, a.constants.newGameFlags, pokemon);
  }

  async create(start: OverworldStart): Promise<void> {
    const kb = this.input.keyboard!;
    this.buttons = new Input(this);

    this.cameras.main.setRoundPixels(true);
    this.hud = this.add.text(2, 2, '', { fontFamily: 'monospace', fontSize: '8px', color: '#fff', backgroundColor: '#0008' });
    this.hud.setScrollFactor(0).setDepth(Number.MAX_SAFE_INTEGER).setResolution(4).setVisible(false);
    kb.on('keydown-BACKTICK', () => this.hud.setVisible(!this.hud.visible));

    await this.assets.loadTextTextures(this);
    const charmap = this.charmap;
    this.screenFade = new ScreenFade(this);
    this.fonts = new Fonts(this, this.assets.fonts);
    this.messageBox = new MessageBox(this, this.fonts, this.buttons, charmap, this.state);
    this.scripts = new ScriptEngine(
      this.assets.scripts,
      this.defines,
      this.state,
      this.assets.strings,
      charmap,
      this.messageBox,
      this.buttons,
      this,
    );

    this.world = new World(this, this.assets);
    const playerInfo = await this.assets.loadSprite(this, PLAYER_GFX);
    if (!playerInfo) throw new Error(`Missing player sprite ${PLAYER_GFX}`);
    this.player = new ObjectEvent(this, playerInfo, 0, 0);
    this.cameras.main.startFollow(this.player.sprite, true, 1, 1, 0, TILE / 2);

    await this.enterMap(start.map, start.x, start.y, start.facing ?? 'down', true);
    this.busy = false;
  }

  update(_time: number, delta: number): void {
    if (!this.player || !this.scripts) return;
    this.accumulator = Math.min(this.accumulator + delta, FRAME_MS * 5);
    while (this.accumulator >= FRAME_MS) {
      this.accumulator -= FRAME_MS;
      this.tick();
    }
    this.updateHud();
  }

  // ------------------------------------------------------------------ frame logic

  private tick(): void {
    this.buttons.sample();
    // Like the GBA, field input is only considered if no script was running at the start of the
    // frame, so the A press that dismisses a message can't also start a new interaction.
    const scriptAtFrameStart = this.scripts.running;
    this.scripts.tick();
    this.messageBox.tick();
    this.screenFade.tick();
    this.monPic?.tick();
    if (this.monPic?.gone) this.monPic = undefined;
    const overlay = this.overlay;
    // An overlay may hand off to another (start menu → notice); only clear it if it wasn't replaced.
    if (overlay && overlay.tick() && this.overlay === overlay) this.overlay = undefined;
    const scripted = this.scripts.running || this.overlay !== undefined;
    for (const n of this.npcs) {
      n.brain.paused = scripted;
      n.brain.tick();
    }
    const arrived = this.player.tick();
    if (arrived) this.trySpawnObjectsInView(); // the camera moved a tile, scripted or not
    if (arrived && !scripted) this.onPlayerArrived();
    // Re-check after arrival: a coord trigger or warp started this frame must also block movement
    // (on the GBA, TryStartCoordEventScript makes ProcessPlayerFieldInput return before moving).
    const blocked = this.scripts.running || this.overlay !== undefined;
    if (!this.busy && !scriptAtFrameStart && !blocked && !this.player.isMoving) {
      if (!this.tryOnFrameScript()) this.handleInput();
    }
    this.wasMoving = this.player.isMoving;
  }

  private handleInput(): void {
    // ProcessPlayerFieldInput checks START before movement.
    if (this.buttons.pressed('START')) {
      this.openStartMenu();
      return;
    }
    // ProcessPlayerFieldInput tries an A-press interaction before movement, whatever is held.
    if (this.buttons.pressed('A') && this.interact()) return;
    const dir = this.heldDirection();
    if (!dir) {
      this.turnFrames = 0;
      return;
    }

    const here = this.world.tileAt(this.player.tileX, this.player.tileY);
    const pushWarp = this.warpAt(this.player.tileX, this.player.tileY);
    if (pushWarp && this.behaviors.isPushWarp(here.behavior, dir)) {
      this.player.face(dir);
      void this.takeWarp(pushWarp);
      return;
    }

    // Tap to turn: from a standstill, a new direction turns first and only walks if still held.
    if (dir !== this.player.facing && !this.wasMoving) {
      this.player.face(dir);
      this.turnFrames = TURN_FRAMES;
      return;
    }
    if (this.turnFrames > 0) {
      this.turnFrames--;
      return;
    }

    const { dx, dy } = DELTA[dir];
    const tx = this.player.tileX + dx;
    const ty = this.player.tileY + dy;
    const target = this.world.tileAt(tx, ty);

    if (dir === 'up' && this.behaviors.isDoor(target.behavior)) {
      const door = this.warpAt(tx, ty);
      if (door) {
        this.pendingWarp = door;
        this.player.move(dir);
        return;
      }
    }

    if (this.behaviors.isJump(target.behavior, dir) && this.canOccupy(this.player, tx + dx, ty + dy)) {
      this.player.move(dir, 'jump');
      return;
    }

    if (this.canMove(this.player, dir)) {
      const run = this.buttons.held('B') && this.world.current.data.allowRunning;
      this.player.move(dir, run ? 'run' : 'walk');
    } else {
      this.player.face(dir);
    }
  }

  private onPlayerArrived(): void {
    const { tileX: x, tileY: y } = this.player;
    this.updateElevation(this.player);

    if (this.pendingWarp) {
      const w = this.pendingWarp;
      this.pendingWarp = undefined;
      void this.takeWarp(w);
      return;
    }

    const chunk = this.world.chunkAt(x, y);
    if (chunk && chunk !== this.world.current) {
      this.busy = true;
      void this.world.setCurrent(chunk).then(async () => {
        await this.onMapLoaded(false);
        this.busy = false;
      });
      return;
    }

    const tile = this.world.tileAt(x, y);
    const warp = this.warpAt(x, y);
    if (warp && this.behaviors.isStepWarp(tile.behavior)) {
      void this.takeWarp(warp);
      return;
    }
    this.tryCoordEvent(x, y);
  }

  /** TryStartInteractionScript: NPC in front (or across a counter), then bg events. */
  private interact(): boolean {
    const { dx, dy } = DELTA[this.player.facing];
    let tx = this.player.tileX + dx;
    let ty = this.player.tileY + dy;
    let npc = this.npcAt(tx, ty);
    if (!npc && this.behaviors.is(this.world.tileAt(tx, ty).behavior, 'COUNTER')) {
      tx += dx;
      ty += dy;
      npc = this.npcAt(tx, ty);
    }
    if (npc) {
      const script = npc.brain.data.script;
      if (script && script !== '0x0' && script !== '0') {
        this.selectedObject = npc.brain.obj;
        this.scripts.npcTextColor = textColorFromId(npc.brain.obj.info.textColor);
        this.state.setVar('VAR_LAST_TALKED', npc.localId);
        this.state.setVar('VAR_FACING', directionId(this.player.facing));
        return this.scripts.start(script);
      }
      return false;
    }
    const cur = this.world.current;
    const fx = this.player.tileX + dx - cur.originX;
    const fy = this.player.tileY + dy - cur.originY;
    const bg = cur.data.bgEvents.find((e) => e.x === fx && e.y === fy);
    if (bg?.type === 'sign' && bg.script && signFacingOk(String(bg.player_facing_dir ?? ''), this.player.facing)) {
      this.selectedObject = undefined;
      this.scripts.npcTextColor = 'neutral';
      return this.scripts.start(bg.script);
    }
    return false;
  }

  private tryCoordEvent(x: number, y: number): void {
    const cur = this.world.current;
    const lx = x - cur.originX;
    const ly = y - cur.originY;
    for (const e of cur.data.coordEvents) {
      if (e.type !== 'trigger' || e.x !== lx || e.y !== ly) continue;
      if (this.state.getVar(e.var) !== this.state.value(e.var_value)) continue;
      if (e.script && e.script !== '0x0') {
        this.selectedObject = undefined;
        this.scripts.npcTextColor = 'neutral';
        this.scripts.start(e.script);
      }
      return;
    }
  }

  /** TryRunOnFrameMapScript */
  private tryOnFrameScript(): boolean {
    const table = this.scripts.mapScript(this.world.current.name, 'MAP_SCRIPT_ON_FRAME_TABLE');
    const script = table && this.scripts.mapScriptTable(table);
    if (!script) return false;
    this.selectedObject = undefined;
    this.scripts.npcTextColor = 'neutral';
    return this.scripts.start(script);
  }

  // ------------------------------------------------------------------ collision

  private canMove(obj: ObjectEvent, dir: Direction): boolean {
    const { dx, dy } = DELTA[dir];
    const tx = obj.tileX + dx;
    const ty = obj.tileY + dy;
    const from = this.world.tileAt(obj.tileX, obj.tileY);
    const to = this.world.tileAt(tx, ty);
    if (this.behaviors.blocksMove(from.behavior, to.behavior, dir)) return false;
    if (this.behaviors.isAnyJump(to.behavior)) return false;
    return this.canOccupy(obj, tx, ty);
  }

  /** GetCollisionAtCoords minus the directional check: collision bit, elevation, other objects. */
  private canOccupy(obj: ObjectEvent, x: number, y: number): boolean {
    const t = this.world.tileAt(x, y);
    if (t.collision !== 0) return false;
    if (obj.elevation !== 0 && t.elevation !== 0 && t.elevation !== 15 && t.elevation !== obj.elevation) return false;
    if (obj !== this.player && this.player.tileX === x && this.player.tileY === y) return false;
    return !this.npcs.some((n) => n.brain.obj !== obj && n.brain.obj.tileX === x && n.brain.obj.tileY === y);
  }

  /** ObjectEventUpdateElevation: elevation 15 (bridges etc.) preserves whatever we had. */
  private updateElevation(obj: ObjectEvent): void {
    const e = this.world.tileAt(obj.tileX, obj.tileY).elevation;
    if (e !== 15) obj.elevation = e;
  }

  private npcAt(x: number, y: number): Npc | undefined {
    return this.npcs.find((n) => n.brain.obj.tileX === x && n.brain.obj.tileY === y);
  }

  // ------------------------------------------------------------------ maps & warps

  private warpAt(wx: number, wy: number): WarpEventData | undefined {
    const cur = this.world.current;
    return cur.data.warpEvents.find((w) => w.x === wx - cur.originX && w.y === wy - cur.originY);
  }

  private async takeWarp(w: WarpEventData): Promise<void> {
    const name = this.assets.mapNameForId(w.dest_map);
    const destIndex = Number(w.dest_warp_id);
    if (!name || !Number.isInteger(destIndex)) {
      console.warn('[warp] unsupported destination', w.dest_map, w.dest_warp_id);
      return;
    }
    await this.warpTo(name, destIndex, -1, -1);
  }

  /** Warp to a warp event index, or to explicit coordinates when warpId < 0. */
  private async warpTo(name: string, warpId: number, x: number, y: number): Promise<void> {
    this.busy = true;
    await fade(this, 'out');
    const data = await this.assets.loadMap(name);
    const dest = warpId >= 0 ? data.warpEvents[warpId] : { x, y };
    if (!dest) {
      console.warn('[warp] missing warp', name, warpId);
    } else {
      await this.enterMap(name, dest.x, dest.y, this.player.facing, true);
      const arrival = this.world.tileAt(this.player.tileX, this.player.tileY);
      if (this.behaviors.isDoor(arrival.behavior)) this.player.move('down'); // walk out of the doorway
    }
    await fade(this, 'in');
    this.busy = false;
  }

  /** Load a map fresh (origin at 0,0) and put the player at local (x, y). */
  private async enterMap(name: string, x: number, y: number, facing: Direction, warped: boolean): Promise<void> {
    await this.world.load(name);
    this.player.setVisible(true); // the GBA recreates the player object on every warp
    this.player.setPosition(x, y);
    this.player.face(facing);
    this.updateElevation(this.player);
    await this.onMapLoaded(warped);
  }

  /** Map entry sequence: temps cleared, ON_TRANSITION, ON_LOAD, objects spawned, ON_WARP_INTO. */
  private async onMapLoaded(warped: boolean): Promise<void> {
    const name = this.world.current.name;
    await this.preloadMapSprites();
    this.state.clearTemps();
    const transition = this.scripts.mapScript(name, 'MAP_SCRIPT_ON_TRANSITION');
    if (transition) this.scripts.runImmediately(transition);
    const load = this.scripts.mapScript(name, 'MAP_SCRIPT_ON_LOAD');
    if (load) this.scripts.runImmediately(load);
    this.spawnNpcs();
    if (warped) {
      const table = this.scripts.mapScript(name, 'MAP_SCRIPT_ON_WARP_INTO_MAP_TABLE');
      const script = table && this.scripts.mapScriptTable(table);
      if (script) this.scripts.runImmediately(script);
    }
  }

  private templatesFor(name: string): ObjectEventData[] {
    let t = this.templates.get(name);
    if (!t) {
      const chunk = this.world.current;
      t = chunk.data.objectEvents.map((e) => ({ ...e }));
      this.templates.set(name, t);
    }
    return t;
  }

  /**
   * Load the sprite sheet of every object the map might show, including currently hidden ones,
   * so that `addobject` can spawn synchronously mid-script (as on the GBA).
   */
  private async preloadMapSprites(): Promise<void> {
    const templates = this.templatesFor(this.world.current.name);
    await Promise.all(templates.map((e) => this.assets.loadSprite(this, e.graphics_id)));
  }

  private spawnNpcs(): void {
    for (const n of this.npcs) n.brain.obj.destroy();
    this.npcs = [];
    this.templatesFor(this.world.current.name).forEach((e, i) => {
      const n = this.spawnNpc(e, i + 1);
      if (n) this.npcs.push(n);
    });
  }

  /**
   * TrySpawnObjectEvents: each time the camera moves a tile, spawn any not-yet-spawned object
   * whose hide flag is clear and which lies in the view window. This is how scripts bring an
   * object back after `removeobject` + `clearflag` without an explicit `addobject`.
   */
  private trySpawnObjectsInView(): void {
    const { x: px, y: py } = this.playerLocal();
    this.templatesFor(this.world.current.name).forEach((t, i) => {
      const localId = i + 1;
      if (t.x < px - 9 || t.x > px + 10 || t.y < py - 7 || t.y > py + 9) return;
      if (this.npcs.some((n) => n.localId === localId)) return;
      const n = this.spawnNpc(t, localId);
      if (n) this.npcs.push(n);
    });
  }

  private spawnNpc(e: ObjectEventData, localId: number): Npc | undefined {
    if (e.type !== 'object' || e.movement_type === 'MOVEMENT_TYPE_INVISIBLE') return undefined;
    if (e.flag && e.flag !== '0' && this.state.getFlag(e.flag)) return undefined;
    const info = this.assets.sprites[e.graphics_id];
    if (!info || !this.textures.exists(spriteTextureKey(info))) return undefined;
    const chunk = this.world.current;
    const obj = new ObjectEvent(this, info, chunk.originX + e.x, chunk.originY + e.y, e.elevation);
    return { localId, brain: new NpcBrain(obj, e, (o, d) => this.canMove(o, d)) };
  }

  // ------------------------------------------------------------------ UI

  private openStartMenu(): void {
    const menu = new StartMenu(this, this.fonts, this.buttons, this.charmap, this.assets.strings, this.state);
    this.overlay = {
      tick: () => {
        const r = menu.tick();
        if (r === undefined) return false;
        if (r !== 'close') this.showNotice(`${r} isn't implemented yet.`);
        return true;
      },
    };
  }

  /** A one-off message (our own text, not game text) dismissed with A/B. */
  private showNotice(text: string): void {
    this.messageBox.show(this.charmap.encode(`${text}$`));
    let opened = false;
    this.overlay = {
      tick: () => {
        if (!opened) {
          opened = true; // skip the frame that opened it
          return false;
        }
        if (this.messageBox.isPrinting || !this.buttons.pressedAorB()) return false;
        this.messageBox.hide();
        return true;
      },
    };
  }

  // ------------------------------------------------------------------ ScriptHost

  openYesNo(): YesNoMenu {
    const text = (label: string) => this.charmap.encode(this.assets.strings[label] ?? '?$');
    return new YesNoMenu(this, this.fonts, this.buttons, { yesNo: text('gText_YesNo'), cursor: text('gText_SelectorArrow2') });
  }

  showMonPic(species: number, x: number, y: number): void {
    if (this.monPic) return; // FindTaskIdByFunc(Task_ScriptShowMonPic) != TASK_NONE
    this.monPic = new MonPicBox(this, this.fonts, this.buttons, x, y, this.assets.loadMonFrontPic(this, species));
  }

  hideMonPic(): Wait | undefined {
    const box = this.monPic;
    if (!box) return undefined;
    box.hide();
    return () => box.gone;
  }

  fadeScreen(mode: number): Wait {
    this.screenFade.begin(mode);
    return () => !this.screenFade.active;
  }

  /** Placeholder until the battle engine exists: say so, and count the battle as won. */
  startTrainerBattle(battle: TrainerBattle): { done: Wait; playerWon(): boolean } {
    console.warn('[battle] not implemented; counting trainer', battle.trainer, 'as defeated');
    this.messageBox.show(this.charmap.encode("Battles aren't implemented yet.\\nLet's say you won!$"));
    let closed = false;
    return {
      done: () => {
        if (closed) return true;
        if (this.messageBox.isPrinting || !this.buttons.pressedAorB()) return false;
        this.messageBox.hide();
        closed = true;
        return true;
      },
      playerWon: () => true,
    };
  }

  mapSection(): string {
    return this.world.current.data.regionMapSection ?? 'MAPSEC_NONE';
  }

  resolveLocalId(name: string): number | undefined {
    const i = this.templatesFor(this.world.current.name).findIndex((t) => t.local_id === name);
    return i < 0 ? undefined : i + 1;
  }

  objectByLocalId(localId: number): ObjectEvent | undefined {
    if (localId === LOCALID_PLAYER) return this.player;
    return this.npcs.find((n) => n.localId === localId)?.brain.obj;
  }

  removeObject(localId: number): void {
    const t = this.templatesFor(this.world.current.name)[localId - 1];
    if (t?.flag && t.flag !== '0') this.state.setFlag(t.flag, true);
    const i = this.npcs.findIndex((n) => n.localId === localId);
    if (i >= 0) {
      this.npcs[i].brain.obj.destroy();
      this.npcs.splice(i, 1);
    }
  }

  addObject(localId: number): void {
    if (this.npcs.some((n) => n.localId === localId)) return;
    const t = this.templatesFor(this.world.current.name)[localId - 1];
    if (!t) return;
    const n = this.spawnNpc({ ...t, flag: '0' }, localId);
    if (n) this.npcs.push(n);
  }

  setObjectTemplate(localId: number, patch: { x?: number; y?: number; movementType?: string }): void {
    const t = this.templatesFor(this.world.current.name)[localId - 1];
    if (!t) return;
    if (patch.x !== undefined) t.x = patch.x;
    if (patch.y !== undefined) t.y = patch.y;
    if (patch.movementType !== undefined) t.movement_type = patch.movementType;
  }

  setObjectPosition(localId: number, x: number, y: number): void {
    const cur = this.world.current;
    this.objectByLocalId(localId)?.setPosition(cur.originX + x, cur.originY + y);
  }

  setMetatile(x: number, y: number, metatile: number, impassable: boolean): void {
    this.world.current.setBlock(x, y, metatile | (impassable ? MAPGRID_COLLISION_MASK : 0));
  }

  warp(mapId: string, warpId: number, x: number, y: number): void {
    const name = this.assets.mapNameForId(mapId);
    if (!name) {
      console.warn('[warp] unknown map', mapId);
      return;
    }
    void this.warpTo(name, warpId, x, y);
  }

  playerLocal(): { x: number; y: number } {
    const cur = this.world.current;
    return { x: this.player.tileX - cur.originX, y: this.player.tileY - cur.originY };
  }

  // ------------------------------------------------------------------ input helpers

  /** FieldGetPlayerInput priority: up, down, left, right. */
  private heldDirection(): Direction | undefined {
    if (this.buttons.held('UP')) return 'up';
    if (this.buttons.held('DOWN')) return 'down';
    if (this.buttons.held('LEFT')) return 'left';
    if (this.buttons.held('RIGHT')) return 'right';
    return undefined;
  }

  private updateHud(): void {
    if (!this.hud.visible) return;
    const cur = this.world.current;
    const t = this.world.tileAt(this.player.tileX, this.player.tileY);
    this.hud.setText(
      `${cur.name} (${this.player.tileX - cur.originX},${this.player.tileY - cur.originY})\n` +
        `mt ${t.metatile} beh 0x${t.behavior.toString(16)} col ${t.collision} elev ${t.elevation}/${this.player.elevation}`,
    );
  }
}

/** DIR_SOUTH=1, DIR_NORTH=2, DIR_WEST=3, DIR_EAST=4 */
function directionId(d: Direction): number {
  return { down: 1, up: 2, left: 3, right: 4 }[d];
}

/** bg event player_facing_dir: BG_EVENT_PLAYER_FACING_ANY / _NORTH / _SOUTH / _EAST / _WEST. */
function signFacingOk(req: string, facing: Direction): boolean {
  const m = /FACING_(\w+)$/.exec(req);
  if (!m || m[1] === 'ANY') return true;
  return { NORTH: 'up', SOUTH: 'down', EAST: 'right', WEST: 'left' }[m[1]] === facing;
}

function fade(scene: Phaser.Scene, dir: 'in' | 'out'): Promise<void> {
  return new Promise((resolve) => {
    const cam = scene.cameras.main;
    const event = dir === 'out' ? Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE : Phaser.Cameras.Scene2D.Events.FADE_IN_COMPLETE;
    cam.once(event, () => resolve());
    if (dir === 'out') cam.fadeOut(FADE_MS, 0, 0, 0);
    else cam.fadeIn(FADE_MS, 0, 0, 0);
  });
}
