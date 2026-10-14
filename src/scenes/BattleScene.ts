// The battle screen: CB2_InitBattle / CB2_InitBattleInternal / CB2_HandleStartBattle /
// BattleMainCB2 / VBlankCB_Battle (battle_main.c) running on the emulated GBA video layer in
// src/gba, drawn each frame by the software PPU into a canvas texture.

import Phaser from 'phaser';
import type { Assets } from '../data/assets';
import { battleBgGfxSymbols, InitBattleBgsVideo, LoadBattleTextboxAndBackground, DrawBattleEntryBackground } from '../battle/battleBg';
import { setBattleUi, type BattleUi, type GbaButton } from '../battle/battleUi';
import { setBattleTextSpeed } from '../battle/battleWindow';
import { K } from '../battle/constants';
import { loadBattleData, type BattleData } from '../battle/data';
import { g, bdata, initBattleEnv, setTextStrings } from '../battle/env';
import { AllocateMonSpritesGfx, BattleInitAllSprites, BattleInterfaceSetWindowPals, battleSpriteGfxSymbols } from '../battle/gfx';
import { allocateBattleResources, battleMainCB1, initBattleControllers, initBattleInternal } from '../battle/main';
import { initBattleMessages } from '../battle/message';
import { IsDma3ManagerBusyWithBgCopy, ShowBg } from '../gba/bg';
import { loadGfx } from '../gba/gfx';
import {
  DISPLAY_HEIGHT,
  DISPLAY_WIDTH,
  REG_OFFSET_BG0HOFS,
  REG_OFFSET_BG0VOFS,
  REG_OFFSET_BG1HOFS,
  REG_OFFSET_BG1VOFS,
  REG_OFFSET_BG2HOFS,
  REG_OFFSET_BG2VOFS,
  REG_OFFSET_BG3HOFS,
  REG_OFFSET_BG3VOFS,
  REG_OFFSET_MOSAIC,
  REG_OFFSET_WIN0H,
  REG_OFFSET_WIN0V,
  REG_OFFSET_WIN1H,
  REG_OFFSET_WIN1V,
  REG_OFFSET_WININ,
  REG_OFFSET_WINOUT,
  resetHardware,
  SetGpuReg,
  WIN_RANGE,
} from '../gba/hw';
import { ResetPaletteFade, TransferPlttBuffer, UpdatePaletteFade } from '../gba/palette';
import { renderFrame } from '../gba/ppu';
import { gScanlineEffectRegBuffers, ScanlineEffect_Clear, ScanlineEffect_InitHBlankDmaTransfer, ScanlineEffect_SetParams, SCANLINE_EFFECT_DMACNT_16BIT } from '../gba/scanline';
import { AnimateSprites, BuildOamBuffer, FreeAllSpritePalettes, ProcessSpriteCopyRequests, ResetSpriteData, SetReservedSpritePaletteCount } from '../gba/sprite';
import { ResetTasks, RunTasks } from '../gba/task';
import { initGbaText, RunTextPrinters } from '../gba/window';
import { Input } from '../input/Input';
import type { Pokemon, PokemonData } from '../pokemon/Pokemon';
import type { GameState } from '../state/GameState';
import type { Charmap } from '../text/charmap';
import { Fonts } from '../text/Font';
import { TEXT_SPEED } from '../text/TextPrinter';
import { random } from '../util/random';

const FRAME_MS = 1000 / 60;
const TEXTURE = 'battle_screen';

/** Everything BattleSetup_StartTrainerBattle / StartTrainerBattle leave in globals for the battle. */
export interface BattleStart {
  battleTypeFlags: number;
  trainerBattleOpponent_A: number;
  trainerBattleMode: number;
  rivalBattleFlags: number;
  /** sTrainerADefeatSpeech / sTrainerVictorySpeech, encoded */
  defeatSpeech?: number[];
  victorySpeech?: number[];
  /** ContextNpcGetTextColor: NPC_TEXT_COLOR_* */
  npcTextColor: number;
  /** BattleSetup_GetTerrainId */
  terrain: number;
  /** gMapHeader.battleType (MAP_BATTLE_SCENE_*) and mapType (MAP_TYPE_*) */
  mapBattleScene: number;
  mapType: number;
  /** GetCurrentWeather */
  overworldWeather: number;
  state: GameState;
  pokemon: PokemonData;
  charmap: Charmap;
  /** gMain.savedCallback: called with gBattleOutcome once the screen has faded to black. */
  onEnd(outcome: number): void;
}

let battleData: Promise<BattleData> | undefined;

/** Graphics the battle can touch: interface, terrain, balls, and pics for everyone involved. */
function gfxSymbolsFor(data: BattleData, start: BattleStart): string[] {
  const a = data.anims;
  const syms = new Set<string>([...battleBgGfxSymbols(), ...battleSpriteGfxSymbols(), 'gPPTextPalette', 'sLevelUpBanner_Gfx', 'sLevelUpBanner_Pal']);
  const add = (s: string | null | undefined) => {
    if (s) syms.add(s);
  };
  const addMon = (species: number) => {
    add(a.monFrontPics[species]);
    add(a.monBackPics[species]);
    add(a.monPalettes[species]);
    add(a.monShinyPalettes[species]);
  };
  addMon(0);
  // Unown letter forms live after NUM_SPECIES in the pic tables
  for (const mon of start.state.party) addMon(mon.species);
  const trainer = data.tables.trainers[start.trainerBattleOpponent_A];
  for (const m of trainer?.party ?? []) addMon(m.species);
  if (trainer) {
    add(a.trainerFrontPics[trainer.trainerPic]?.pic);
    add(a.trainerFrontPalettes[trainer.trainerPic]);
  }
  a.trainerBackPics.forEach(add);
  a.trainerBackPalettes.forEach(add);
  return [...syms];
}

export class BattleScene extends Phaser.Scene implements BattleUi {
  private start!: BattleStart;
  private input2!: Input;
  private accumulator = 0;
  private ready = false;
  private canvas!: Phaser.Textures.CanvasTexture;
  private image!: ImageData;
  private pixels!: Uint32Array;
  /** gMain.callback1 / callback2 */
  private callback1: (() => void) | undefined;
  private callback2: (() => void) | undefined;
  private spritesInit = { state: 0, battlerId: 0 };
  private ended = false;

  constructor() {
    super('Battle');
  }

  async create(start: BattleStart): Promise<void> {
    this.start = start;
    this.ready = false;
    this.ended = false;
    this.accumulator = 0;
    this.input2 = new Input(this);
    const assets: Assets = this.registry.get('assets');

    battleData ??= loadBattleData('gen');
    const data = await battleData;
    initBattleEnv(data, assets.scripts.defines, start.pokemon, start.state, start.charmap);
    await loadGfx(gfxSymbolsFor(data, start));
    setTextStrings(assets.strings);
    initBattleMessages();
    const speed = TEXT_SPEED[start.state.textSpeed];
    initGbaText(new Fonts(this, assets.fonts), this.input2, speed.scroll);
    setBattleTextSpeed(speed.delay);
    setBattleUi(this);

    // StartTrainerBattle and the globals battle_setup.c leaves behind
    g.battleTypeFlags = start.battleTypeFlags;
    g.trainerBattleOpponent_A = start.trainerBattleOpponent_A;
    g.trainerBattleMode = start.trainerBattleMode;
    g.rivalBattleFlags = start.rivalBattleFlags;
    g.trainerADefeatSpeech = start.defeatSpeech;
    g.trainerVictorySpeech = start.victorySpeech;
    g.npcTextColor = start.npcTextColor;
    g.mapBattleScene = start.mapBattleScene;
    g.mapType = start.mapType;
    g.overworldWeather = start.overworldWeather;
    g.playerParty = start.state.party;
    g.onBattleEnd = (outcome) => this.endBattle(outcome);

    this.canvas = this.textures.exists(TEXTURE) ? (this.textures.get(TEXTURE) as Phaser.Textures.CanvasTexture) : this.textures.createCanvas(TEXTURE, DISPLAY_WIDTH, DISPLAY_HEIGHT)!;
    this.image = this.canvas.context.createImageData(DISPLAY_WIDTH, DISPLAY_HEIGHT);
    this.pixels = new Uint32Array(this.image.data.buffer);
    this.add.image(0, 0, TEXTURE).setOrigin(0, 0);

    this.CB2_InitBattle(start.terrain);
    this.ready = true;
  }

  update(_time: number, delta: number): void {
    if (!this.ready || this.ended) return;
    this.accumulator = Math.min(this.accumulator + delta, FRAME_MS * 5);
    let ticked = false;
    while (this.accumulator >= FRAME_MS && !this.ended) {
      this.accumulator -= FRAME_MS;
      this.input2.sample();
      this.callback1?.();
      this.callback2?.();
      this.VBlankCB_Battle();
      ticked = true;
    }
    if (ticked && !this.ended) {
      renderFrame(this.pixels);
      this.canvas.context.putImageData(this.image, 0, 0);
      this.canvas.refresh();
    }
  }

  // ------------------------------------------------------------ battle_main.c callbacks

  /** CB2_InitBattle + CB2_InitBattleInternal (link/multi battles aren't supported) */
  private CB2_InitBattle(terrain: number): void {
    allocateBattleResources();
    // AllocateBattleSpritesData: a fresh BattleSpriteData comes with the new globals
    AllocateMonSpritesGfx();

    // CB2_InitBattleInternal
    resetHardware(); // CpuFill32(0, VRAM, VRAM_SIZE)
    SetGpuReg(REG_OFFSET_MOSAIC, 0);
    SetGpuReg(REG_OFFSET_WIN0H, DISPLAY_WIDTH);
    SetGpuReg(REG_OFFSET_WIN0V, WIN_RANGE(DISPLAY_HEIGHT / 2, DISPLAY_HEIGHT / 2 + 1));
    SetGpuReg(REG_OFFSET_WININ, 0);
    SetGpuReg(REG_OFFSET_WINOUT, 0);
    g.battle_WIN0H = DISPLAY_WIDTH;
    g.battle_WIN0V = WIN_RANGE(DISPLAY_HEIGHT / 2, DISPLAY_HEIGHT / 2 + 1);
    ScanlineEffect_Clear();
    for (let i = 0; i < 160; ++i) {
      const v = i < 80 ? 0xf0 : 0xff10;
      gScanlineEffectRegBuffers[0][i] = v;
      gScanlineEffectRegBuffers[1][i] = v;
    }
    // sIntroScanlineParams16Bit
    ScanlineEffect_SetParams({ dmaDest: REG_OFFSET_BG3HOFS, dmaControl: SCANLINE_EFFECT_DMACNT_16BIT, initState: 1 });
    ResetPaletteFade();
    g.battle_BG0_X = g.battle_BG0_Y = 0;
    g.battle_BG1_X = g.battle_BG1_Y = 0;
    g.battle_BG2_X = g.battle_BG2_Y = 0;
    g.battle_BG3_X = g.battle_BG3_Y = 0;
    g.battleTerrain = terrain;
    InitBattleBgsVideo();
    LoadBattleTextboxAndBackground();
    ResetSpriteData();
    ResetTasks();
    DrawBattleEntryBackground();
    FreeAllSpritePalettes();
    SetReservedSpritePaletteCount(4);
    // SetUpBattleVars, CreateNPCTrainerParty, AdjustFriendship(FRIENDSHIP_EVENT_LEAGUE_BATTLE)
    initBattleInternal();
    this.callback2 = () => this.CB2_HandleStartBattle();
  }

  /** CB2_HandleStartBattle (single-player path) */
  private CB2_HandleStartBattle(): void {
    RunTasks();
    AnimateSprites();
    BuildOamBuffer();
    const comm = g.battleCommunication;
    switch (comm[K.MULTIUSE_STATE]) {
      case 0:
        if (!IsDma3ManagerBusyWithBgCopy()) {
          ShowBg(0);
          ShowBg(1);
          ShowBg(2);
          ShowBg(3);
          BattleInterfaceSetWindowPals();
          comm[K.MULTIUSE_STATE] = 1;
        }
        break;
      case 1:
        g.battleTypeFlags |= K.BATTLE_TYPE_IS_MASTER;
        comm[K.MULTIUSE_STATE] = 15;
        // SetAllPlayersBerryData: no Enigma Berry
        break;
      case 15:
        initBattleControllers();
        comm[K.MULTIUSE_STATE]++;
        this.spritesInit = { state: 0, battlerId: 0 };
        break;
      case 16:
        if (BattleInitAllSprites(this.spritesInit)) {
          this.callback1 = battleMainCB1;
          this.callback2 = () => this.BattleMainCB2();
        }
        break;
    }
  }

  /** BattleMainCB2 */
  private BattleMainCB2(): void {
    AnimateSprites();
    BuildOamBuffer();
    RunTextPrinters();
    UpdatePaletteFade();
    RunTasks();
  }

  /** VBlankCB_Battle */
  private VBlankCB_Battle(): void {
    random(); // Change gRngSeed every vblank.
    SetGpuReg(REG_OFFSET_BG0HOFS, g.battle_BG0_X);
    SetGpuReg(REG_OFFSET_BG0VOFS, g.battle_BG0_Y);
    SetGpuReg(REG_OFFSET_BG1HOFS, g.battle_BG1_X);
    SetGpuReg(REG_OFFSET_BG1VOFS, g.battle_BG1_Y);
    SetGpuReg(REG_OFFSET_BG2HOFS, g.battle_BG2_X);
    SetGpuReg(REG_OFFSET_BG2VOFS, g.battle_BG2_Y);
    SetGpuReg(REG_OFFSET_BG3HOFS, g.battle_BG3_X);
    SetGpuReg(REG_OFFSET_BG3VOFS, g.battle_BG3_Y);
    SetGpuReg(REG_OFFSET_WIN0H, g.battle_WIN0H);
    SetGpuReg(REG_OFFSET_WIN0V, g.battle_WIN0V);
    SetGpuReg(REG_OFFSET_WIN1H, g.battle_WIN1H);
    SetGpuReg(REG_OFFSET_WIN1V, g.battle_WIN1V);
    // LoadOam: the PPU reads the OAM buffer directly
    ProcessSpriteCopyRequests();
    TransferPlttBuffer();
    ScanlineEffect_InitHBlankDmaTransfer();
  }

  /** ReturnFromBattleToOverworld: SetMainCallback2(gMain.savedCallback) */
  private endBattle(outcome: number): void {
    this.ended = true;
    this.callback1 = this.callback2 = undefined;
    setBattleUi(undefined as unknown as BattleUi);
    this.start.onEnd(outcome);
  }

  // ------------------------------------------------------------ BattleUi

  joyNew(button: GbaButton): boolean {
    return this.input2.pressed(button);
  }

  joyHeld(button: GbaButton): boolean {
    return this.input2.held(button);
  }

  anyNewKeys(): boolean {
    return (['A', 'B', 'START', 'SELECT', 'L', 'R', 'UP', 'DOWN', 'LEFT', 'RIGHT'] as const).some((b) => this.input2.pressed(b));
  }

  playSE(_songId: number): void {}
  playCry(_species: number): void {}
  playBGM(_songId: number): void {}
  playFanfare(_songId: number): void {}

  addBagItem(itemId: number, count: number): void {
    this.start.state.bag.add(itemId, count);
  }

  playerGender(): number {
    return this.start.state.playerGender === 'female' ? K.FEMALE : K.MALE;
  }

  /** The summary screen doesn't exist yet: keep the old moves. */
  selectMoveToForget(_mon: Pokemon, _moveToLearn: number): { poll(): number | undefined } {
    console.warn('[battle] move-forget summary screen not implemented; keeping old moves');
    return { poll: () => K.MAX_MON_MOVES };
  }
}

/** For devtools: the battle's globals and data. */
export function battleDebug(): { g: typeof g; bdata: typeof bdata } {
  return { g, bdata };
}
