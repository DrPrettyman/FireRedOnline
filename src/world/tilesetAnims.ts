// Port of tileset_anims.c: per-tileset callbacks that queue frames of animated tiles (water, flowers,
// fountains, ...) and copy them into BG VRAM, here the tile stores of `tilesetVram`, which redraw the
// atlas slots of every metatile using those tiles.

import { gfx } from '../gba/gfx';
import { NUM_TILES_IN_PRIMARY, tilesetVram } from './TilesetVram';

interface TransferEntry {
  src: string;
  destTile: number;
  numTiles: number;
}

const frames = (name: string, n: number) => Array.from({ length: n }, (_, i) => `sTilesetAnims_${name}_Frame${i}`);

const sTilesetAnims_General_Flower = frames('General_Flower', 5);
const sTilesetAnims_General_Water_Current_LandWatersEdge = frames('General_Water_Current_LandWatersEdge', 8);
const sTilesetAnims_General_SandWatersEdge = frames('General_SandWatersEdge', 8);
const sTilesetAnims_CeladonCity_Fountain = frames('CeladonCity_Fountain', 5);
const sTilesetAnims_SilphCo_Fountain = frames('SilphCo_Fountain', 4);
const sTilesetAnims_MtEmber_Steam = frames('MtEmber_Steam', 4);
const sTilesetAnims_VermilionGym_MotorizedDoor = frames('VermilionGym_MotorizedDoor', 2);
const sTilesetAnims_CeladonGym_Flowers = [...frames('CeladonGym_Flowers', 3), 'sTilesetAnims_CeladonGym_Flowers_Frame1'];

// sTilesetDMA3TransferBuffer
const MAX_TRANSFERS = 20;
let transferBuffer: TransferEntry[] = [];
let primaryCounter = 0;
let primaryCounterMax = 0;
let secondaryCounter = 0;
let secondaryCounterMax = 0;
let primaryCallback: ((timer: number) => void) | undefined;
let secondaryCallback: ((timer: number) => void) | undefined;
/** The current map's tilesets (gMapHeader.mapLayout->primaryTileset / secondaryTileset). */
let primaryName = '';
let secondaryName = '';

function ResetTilesetAnimBuffer(): void {
  transferBuffer = [];
}

/** `destTile` is the tile number in BG VRAM (TILE_OFFSET_4BPP), `numTiles` the size in tiles. */
function AppendTilesetAnimToBuffer(src: string, destTile: number, numTiles: number): void {
  if (transferBuffer.length < MAX_TRANSFERS) transferBuffer.push({ src, destTile, numTiles });
}

/** VBlank's DmaCopy16 of the queued frames. Tiles below 640 belong to the primary tileset. */
export function TransferTilesetAnimsBuffer(): void {
  for (const { src, destTile, numTiles } of transferBuffer) {
    if (destTile < NUM_TILES_IN_PRIMARY) tilesetVram.writeTiles(primaryName, destTile, gfx(src), numTiles);
    else tilesetVram.writeTiles(secondaryName, destTile - NUM_TILES_IN_PRIMARY, gfx(src), numTiles);
  }
  transferBuffer = [];
  tilesetVram.flush();
}

/** The tilesets' `callback` init functions, by the name tilesets/index.json gives. */
const INIT_CALLBACKS: Record<string, () => void> = {
  InitTilesetAnim_General,
  InitTilesetAnim_CeladonCity,
  InitTilesetAnim_SilphCo,
  InitTilesetAnim_MtEmber,
  InitTilesetAnim_VermilionGym,
  InitTilesetAnim_CeladonGym,
};

/** Every graphics symbol a tileset's animation can queue (to preload before it runs). */
export const TILESET_ANIM_SYMBOLS: Record<string, string[]> = {
  InitTilesetAnim_General: [...sTilesetAnims_General_Flower, ...sTilesetAnims_General_Water_Current_LandWatersEdge, ...sTilesetAnims_General_SandWatersEdge],
  InitTilesetAnim_CeladonCity: sTilesetAnims_CeladonCity_Fountain,
  InitTilesetAnim_SilphCo: sTilesetAnims_SilphCo_Fountain,
  InitTilesetAnim_MtEmber: sTilesetAnims_MtEmber_Steam,
  InitTilesetAnim_VermilionGym: sTilesetAnims_VermilionGym_MotorizedDoor,
  InitTilesetAnim_CeladonGym: [...new Set(sTilesetAnims_CeladonGym_Flowers)],
};

export interface TilesetAnimInfo {
  name: string;
  callback?: string;
}

/** InitTilesetAnimations (on a warp or any full map load). */
export function InitTilesetAnimations(primary: TilesetAnimInfo, secondary: TilesetAnimInfo): void {
  ResetTilesetAnimBuffer();
  _InitPrimaryTilesetAnimation(primary);
  _InitSecondaryTilesetAnimation(secondary);
}

/** InitSecondaryTilesetAnimation (LoadMapFromCameraTransition: a map connection was crossed). */
export function InitSecondaryTilesetAnimation(secondary: TilesetAnimInfo): void {
  _InitSecondaryTilesetAnimation(secondary);
}

/** UpdateTilesetAnimations (OverworldBasic, once per frame). */
export function UpdateTilesetAnimations(): void {
  ResetTilesetAnimBuffer();
  if (++primaryCounter >= primaryCounterMax) primaryCounter = 0;
  if (++secondaryCounter >= secondaryCounterMax) secondaryCounter = 0;
  primaryCallback?.(primaryCounter);
  secondaryCallback?.(secondaryCounter);
}

function _InitPrimaryTilesetAnimation(primary: TilesetAnimInfo): void {
  primaryName = primary.name;
  primaryCounter = 0;
  primaryCounterMax = 0;
  primaryCallback = undefined;
  if (primary.callback) INIT_CALLBACKS[primary.callback]?.();
}

function _InitSecondaryTilesetAnimation(secondary: TilesetAnimInfo): void {
  secondaryName = secondary.name;
  secondaryCounter = 0;
  secondaryCounterMax = 0;
  secondaryCallback = undefined;
  if (secondary.callback) INIT_CALLBACKS[secondary.callback]?.();
}

function QueueAnimTiles_General_Flower(timer: number): void {
  AppendTilesetAnimToBuffer(sTilesetAnims_General_Flower[timer % sTilesetAnims_General_Flower.length], 508, 4);
}

function QueueAnimTiles_General_Water_Current_LandWatersEdge(timer: number): void {
  const anim = sTilesetAnims_General_Water_Current_LandWatersEdge;
  AppendTilesetAnimToBuffer(anim[timer % anim.length], 416, 48);
}

function QueueAnimTiles_General_SandWatersEdge(timer: number): void {
  AppendTilesetAnimToBuffer(sTilesetAnims_General_SandWatersEdge[timer % sTilesetAnims_General_SandWatersEdge.length], 464, 18);
}

function TilesetAnim_General(timer: number): void {
  if (timer % 8 === 0) QueueAnimTiles_General_SandWatersEdge(timer >> 3);
  if (timer % 16 === 1) QueueAnimTiles_General_Water_Current_LandWatersEdge(timer >> 4);
  if (timer % 16 === 2) QueueAnimTiles_General_Flower(timer >> 4);
}

function InitTilesetAnim_General(): void {
  primaryCounter = 0;
  primaryCounterMax = 640;
  primaryCallback = TilesetAnim_General;
}

function QueueAnimTiles_CeladonCity_Fountain(timer: number): void {
  AppendTilesetAnimToBuffer(sTilesetAnims_CeladonCity_Fountain[timer % sTilesetAnims_CeladonCity_Fountain.length], 744, 8);
}

function TilesetAnim_CeladonCity(timer: number): void {
  if (timer % 12 === 0) QueueAnimTiles_CeladonCity_Fountain(Math.floor(timer / 12));
}

function InitTilesetAnim_CeladonCity(): void {
  secondaryCounter = 0;
  secondaryCounterMax = 120;
  secondaryCallback = TilesetAnim_CeladonCity;
}

function QueueAnimTiles_SilphCo_Fountain(timer: number): void {
  AppendTilesetAnimToBuffer(sTilesetAnims_SilphCo_Fountain[timer % sTilesetAnims_SilphCo_Fountain.length], 976, 8);
}

function TilesetAnim_SilphCo(timer: number): void {
  if (timer % 10 === 0) QueueAnimTiles_SilphCo_Fountain(Math.floor(timer / 10));
}

function InitTilesetAnim_SilphCo(): void {
  secondaryCounter = 0;
  secondaryCounterMax = 160;
  secondaryCallback = TilesetAnim_SilphCo;
}

function QueueAnimTiles_MtEmber_Steam(timer: number): void {
  AppendTilesetAnimToBuffer(sTilesetAnims_MtEmber_Steam[timer % sTilesetAnims_MtEmber_Steam.length], 896, 8);
}

function TilesetAnim_MtEmber(timer: number): void {
  if (timer % 16 === 0) QueueAnimTiles_MtEmber_Steam(timer >> 4);
}

function InitTilesetAnim_MtEmber(): void {
  secondaryCounter = 0;
  secondaryCounterMax = 256;
  secondaryCallback = TilesetAnim_MtEmber;
}

function QueueAnimTiles_VermilionGym_MotorizedDoor(timer: number): void {
  const i = timer % sTilesetAnims_VermilionGym_MotorizedDoor.length;
  AppendTilesetAnimToBuffer(sTilesetAnims_VermilionGym_MotorizedDoor[i], 880, 7);
}

function TilesetAnim_VermilionGym(timer: number): void {
  if (timer % 2 === 0) QueueAnimTiles_VermilionGym_MotorizedDoor(timer >> 1);
}

function InitTilesetAnim_VermilionGym(): void {
  secondaryCounter = 0;
  secondaryCounterMax = 240;
  secondaryCallback = TilesetAnim_VermilionGym;
}

function QueueAnimTiles_CeladonGym_Flowers(timer: number): void {
  const i = timer % sTilesetAnims_CeladonGym_Flowers.length;
  AppendTilesetAnimToBuffer(sTilesetAnims_CeladonGym_Flowers[i], 739, 4);
}

function TilesetAnim_CeladonGym(timer: number): void {
  if (timer % 16 === 0) QueueAnimTiles_CeladonGym_Flowers(timer >> 4);
}

function InitTilesetAnim_CeladonGym(): void {
  secondaryCounter = 0;
  secondaryCounterMax = 256;
  secondaryCallback = TilesetAnim_CeladonGym;
}
