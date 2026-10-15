// Ground effects (event_object_movement.c): GetAllGroundEffectFlags_OnSpawn/OnBeginStep/OnFinishStep,
// their filters and DoFlaggedGroundEffects with the GroundEffect_* functions, which start field effects
// for an object as it spawns, starts a step and finishes one.

import type { Behaviors } from '../world/behaviors';
import type { FieldEffects } from './FieldEffects';
import type { GroundEffectPhase, ObjectEvent } from './ObjectEvent';

export interface GroundEffectsContext {
  readonly behaviors: Behaviors;
  readonly fx: FieldEffects;
  /** MapGridGetMetatileBehaviorAt, world coords */
  behaviorAt(x: number, y: number): number;
  /** GROUND_EFFECT_FLAG_* and SHADOW_SIZE_* / TRACKS_* values, by name. */
  define(name: string): number;
  /** LOCALID_CAMERA: DoFlaggedGroundEffects skips the invisible camera object. */
  isCameraObject(obj: ObjectEvent): boolean;
}

const FLAG_NAMES = [
  'TALL_GRASS_ON_SPAWN',
  'TALL_GRASS_ON_MOVE',
  'LONG_GRASS_ON_SPAWN',
  'LONG_GRASS_ON_MOVE',
  'ICE_REFLECTION',
  'REFLECTION',
  'SHALLOW_FLOWING_WATER',
  'SAND',
  'DEEP_SAND',
  'RIPPLES',
  'PUDDLE',
  'SAND_PILE',
  'LAND_IN_TALL_GRASS',
  'LAND_IN_LONG_GRASS',
  'LAND_IN_SHALLOW_WATER',
  'LAND_IN_DEEP_WATER',
  'LAND_ON_NORMAL_GROUND',
  'SHORT_GRASS',
  'HOT_SPRINGS',
  'SEAWEED',
] as const;
type FlagName = (typeof FLAG_NAMES)[number];

export class GroundEffects {
  private flag: Record<FlagName, number>;
  /** sGroundEffectFuncs, in bit order. */
  private readonly funcs: ((obj: ObjectEvent) => void)[];

  constructor(private readonly ctx: GroundEffectsContext) {
    this.flag = Object.fromEntries(FLAG_NAMES.map((n) => [n, ctx.define(`GROUND_EFFECT_FLAG_${n}`)])) as Record<FlagName, number>;
    this.funcs = [
      (o) => this.spawnOnTallGrass(o),
      (o) => this.stepOnTallGrass(o),
      () => {}, // GroundEffect_SpawnOnLongGrass: MetatileBehavior_IsLongGrass is always FALSE in FRLG
      () => {}, // GroundEffect_StepOnLongGrass
      (o) => ctx.fx.setUpReflection(o, false), // GroundEffect_WaterReflection
      (o) => ctx.fx.setUpReflection(o, true), // GroundEffect_IceReflection
      (o) => ctx.fx.feetInFlowingWater(o), // GroundEffect_FlowingWater
      (o) => this.tracks(o, false), // GroundEffect_SandTracks
      (o) => this.tracks(o, true), // GroundEffect_DeepSandTracks
      (o) => ctx.fx.ripple(o), // GroundEffect_Ripple
      (o) => ctx.fx.splash(o), // GroundEffect_StepOnPuddle
      () => {}, // GroundEffect_SandHeap: deep sand is always FALSE in FRLG
      (o) => this.jumpOnTallGrass(o),
      () => {}, // GroundEffect_JumpOnLongGrass
      (o) => ctx.fx.jumpSmallSplash(o.current.x, o.current.y, o.previousElevation, o.priority), // GroundEffect_JumpOnShallowWater
      (o) => ctx.fx.jumpBigSplash(o.current.x, o.current.y, o.previousElevation, o.priority), // GroundEffect_JumpOnWater
      (o) => ctx.fx.dust(o.current.x, o.current.y, o.previousElevation, o.priority), // GroundEffect_JumpLandingDust
      () => {}, // GroundEffect_ShortGrass: always FALSE in FRLG
      (o) => ctx.fx.hotSpringsWater(o), // GroundEffect_HotSprings
      () => {}, // GroundEffect_Seaweed: FLDEFF_BUBBLES (Dive) isn't ported; no FRLG tileset uses MB_SEAWEED
    ];
  }

  /** DoGroundEffects_OnSpawn / OnBeginStep / OnFinishStep after UpdateObjectEventElevationAndPriority. */
  run(obj: ObjectEvent, phase: GroundEffectPhase): void {
    this.updateMetatileBehaviors(obj);
    let flags = 0;
    if (phase === 'spawn') {
      // GetAllGroundEffectFlags_OnSpawn
      flags |= this.reflection(obj);
      flags |= this.tallGrass(obj, this.flag.TALL_GRASS_ON_SPAWN);
      flags |= this.sandHeap(obj) | this.shallowFlowingWater(obj) | this.shortGrass(obj) | this.hotSprings(obj);
    } else if (phase === 'beginStep') {
      // GetAllGroundEffectFlags_OnBeginStep
      flags |= this.reflection(obj);
      flags |= this.tallGrass(obj, this.flag.TALL_GRASS_ON_MOVE);
      flags |= this.trackFlags(obj) | this.sandHeap(obj) | this.shallowFlowingWater(obj) | this.puddle(obj) | this.shortGrass(obj) | this.hotSprings(obj);
      flags = this.filterCovering(obj, flags);
    } else {
      // GetAllGroundEffectFlags_OnFinishStep
      flags |= this.shallowFlowingWater(obj) | this.sandHeap(obj) | this.puddle(obj) | this.rippleFlag(obj);
      flags |= this.shortGrass(obj) | this.hotSprings(obj) | this.seaweed(obj) | this.jumpLanding(obj);
      if (obj.landingJump) flags &= ~this.flag.PUDDLE; // FilterOutStepOnPuddleGroundEffectIfJumping
    }
    // (SetObjectEventSpriteOamTableForLongGrass does nothing: there's no long grass in FRLG.)
    this.doFlagged(obj, flags);
  }

  /** ObjectEventUpdateMetatileBehaviors */
  private updateMetatileBehaviors(obj: ObjectEvent): void {
    obj.previousMetatileBehavior = this.ctx.behaviorAt(obj.previous.x, obj.previous.y);
    obj.currentMetatileBehavior = this.ctx.behaviorAt(obj.current.x, obj.current.y);
  }

  /** DoFlaggedGroundEffects */
  private doFlagged(obj: ObjectEvent, flags: number): void {
    if (this.ctx.isCameraObject(obj) && !obj.visible) return;
    for (let i = 0; i < this.funcs.length; i++, flags >>>= 1) if (flags & 1) this.funcs[i](obj);
  }

  /**
   * GetGroundEffectFlags_Reflection. Ice gives GROUND_EFFECT_FLAG_REFLECTION, water ICE_REFLECTION:
   * the type and flag tables are each the wrong way round, so ice still ends up with the still
   * reflection (GroundEffect_IceReflection) and water with the distorted one.
   */
  private reflection(obj: ObjectEvent): number {
    const type = this.checkForReflectiveSurface(obj);
    if (type) {
      if (!obj.hasReflection) {
        obj.hasReflection = true;
        return type === 1 ? this.flag.REFLECTION : this.flag.ICE_REFLECTION;
      }
    } else {
      obj.hasReflection = false;
    }
    return 0;
  }

  /** ObjectEventCheckForReflectiveSurface: the two tiles below the current and previous tiles. */
  private checkForReflectiveSurface(obj: ObjectEvent): number {
    for (let i = 0; i < 2; i++) {
      for (const c of [obj.current, obj.previous]) {
        const type = this.reflectionType(this.ctx.behaviorAt(c.x, c.y + 1 + i));
        if (type) return type;
      }
    }
    return 0;
  }

  /** GetReflectionTypeByMetatileBehavior */
  private reflectionType(behavior: number): number {
    if (this.ctx.behaviors.isIce(behavior)) return 1;
    if (this.ctx.behaviors.isReflective(behavior)) return 2;
    return 0;
  }

  private tallGrass(obj: ObjectEvent, flag: number): number {
    return this.ctx.behaviors.isTallGrass(obj.currentMetatileBehavior) ? flag : 0;
  }

  /** GetGroundEffectFlags_Tracks */
  private trackFlags(obj: ObjectEvent): number {
    const b = this.ctx.behaviors;
    if (b.isDeepSand(obj.previousMetatileBehavior)) return this.flag.DEEP_SAND;
    if (b.isSand(obj.previousMetatileBehavior) || b.isFootprints(obj.previousMetatileBehavior)) return this.flag.SAND;
    return 0;
  }

  /** GetGroundEffectFlags_SandHeap (deep sand is always FALSE in FRLG, so this only clears inSandPile) */
  private sandHeap(obj: ObjectEvent): number {
    const b = this.ctx.behaviors;
    if (b.isDeepSand(obj.currentMetatileBehavior) && b.isDeepSand(obj.previousMetatileBehavior)) {
      if (!obj.inSandPile) {
        obj.inSandPile = true;
        return this.flag.SAND_PILE;
      }
    } else {
      obj.inSandPile = false;
    }
    return 0;
  }

  /** GetGroundEffectFlags_ShallowFlowingWater */
  private shallowFlowingWater(obj: ObjectEvent): number {
    const b = this.ctx.behaviors;
    const cur = obj.currentMetatileBehavior;
    const prev = obj.previousMetatileBehavior;
    if ((b.isShallowFlowingWater(cur) && b.isShallowFlowingWater(prev)) || (b.isPacifidlogLog(cur) && b.isPacifidlogLog(prev))) {
      if (!obj.inShallowFlowingWater) {
        obj.inShallowFlowingWater = true;
        return this.flag.SHALLOW_FLOWING_WATER;
      }
    } else {
      obj.inShallowFlowingWater = false;
    }
    return 0;
  }

  /** GetGroundEffectFlags_Puddle */
  private puddle(obj: ObjectEvent): number {
    const b = this.ctx.behaviors;
    return b.isPuddle(obj.currentMetatileBehavior) && b.isPuddle(obj.previousMetatileBehavior) ? this.flag.PUDDLE : 0;
  }

  /** GetGroundEffectFlags_Ripple */
  private rippleFlag(obj: ObjectEvent): number {
    return this.ctx.behaviors.hasRipples(obj.currentMetatileBehavior) ? this.flag.RIPPLES : 0;
  }

  /** GetGroundEffectFlags_ShortGrass (always FALSE in FRLG, so this only clears inShortGrass) */
  private shortGrass(obj: ObjectEvent): number {
    const b = this.ctx.behaviors;
    if (b.isShortGrass(obj.currentMetatileBehavior) && b.isShortGrass(obj.previousMetatileBehavior)) {
      if (!obj.inShortGrass) {
        obj.inShortGrass = true;
        return this.flag.SHORT_GRASS;
      }
    } else {
      obj.inShortGrass = false;
    }
    return 0;
  }

  /** GetGroundEffectFlags_HotSprings */
  private hotSprings(obj: ObjectEvent): number {
    const b = this.ctx.behaviors;
    if (b.isHotSprings(obj.currentMetatileBehavior) && b.isHotSprings(obj.previousMetatileBehavior)) {
      if (!obj.inHotSprings) {
        obj.inHotSprings = true;
        return this.flag.HOT_SPRINGS;
      }
    } else {
      obj.inHotSprings = false;
    }
    return 0;
  }

  /** GetGroundEffectFlags_Seaweed */
  private seaweed(obj: ObjectEvent): number {
    return this.ctx.behaviors.isSeaweed(obj.currentMetatileBehavior) ? this.flag.SEAWEED : 0;
  }

  /** GetGroundEffectFlags_JumpLanding: the first matching surface decides. */
  private jumpLanding(obj: ObjectEvent): number {
    if (!obj.landingJump || obj.disableJumpLandingGroundEffect) return 0;
    const b = this.ctx.behaviors;
    const cur = obj.currentMetatileBehavior;
    if (b.isTallGrass(cur)) return this.flag.LAND_IN_TALL_GRASS;
    if (b.isLongGrass(cur)) return this.flag.LAND_IN_LONG_GRASS;
    if (b.isPuddle(cur)) return this.flag.LAND_IN_SHALLOW_WATER;
    if (b.isSurfable(cur)) return this.flag.LAND_IN_DEEP_WATER;
    if (b.isShallowFlowingWater(cur)) return this.flag.LAND_IN_SHALLOW_WATER;
    return this.flag.LAND_ON_NORMAL_GROUND; // MetatileBehavior_IsATile
  }

  /** filters_out_some_ground_effects */
  private filterCovering(obj: ObjectEvent, flags: number): number {
    if (!obj.disableCoveringGroundEffects) return flags;
    obj.inShortGrass = false;
    obj.inSandPile = false;
    obj.inShallowFlowingWater = false;
    obj.inHotSprings = false;
    const f = this.flag;
    return flags & ~(f.HOT_SPRINGS | f.SHORT_GRASS | f.SAND_PILE | f.SHALLOW_FLOWING_WATER | f.TALL_GRASS_ON_MOVE);
  }

  /** GroundEffect_SpawnOnTallGrass */
  private spawnOnTallGrass(obj: ObjectEvent): void {
    this.ctx.fx.tallGrass(obj.current.x, obj.current.y, obj.previousElevation, 2, obj, true);
  }

  /** GroundEffect_StepOnTallGrass */
  private stepOnTallGrass(obj: ObjectEvent): void {
    this.ctx.fx.tallGrass(obj.current.x, obj.current.y, obj.previousElevation, 2, obj, false);
  }

  /** GroundEffect_JumpOnTallGrass: the landing burst, plus the grass itself unless one is already there. */
  private jumpOnTallGrass(obj: ObjectEvent): void {
    const { x, y } = obj.current;
    this.ctx.fx.jumpTallGrass(x, y, obj.previousElevation, 2);
    if (!this.ctx.fx.hasTallGrass(obj, x, y)) this.spawnOnTallGrass(obj);
  }

  /** GroundEffect_SandTracks / DeepSandTracks → sGroundEffectTracksFuncs[graphicsInfo->tracks] */
  private tracks(obj: ObjectEvent, deep: boolean): void {
    const tracks = this.ctx.define(obj.info.tracks ?? 'TRACKS_NONE');
    const { x, y } = obj.previous;
    if (tracks === this.ctx.define('TRACKS_FOOT')) {
      // DoTracksGroundEffect_Footprints
      this.ctx.fx.footprints(x, y, 149, 2, obj.facing, deep);
    } else if (tracks === this.ctx.define('TRACKS_BIKE_TIRE')) {
      // DoTracksGroundEffect_BikeTireTracks
      const { current } = obj;
      if (current.x !== x || current.y !== y) this.ctx.fx.bikeTireTracks(x, y, 149, 2, obj.previousMovementDirection, obj.facing);
    }
  }
}
