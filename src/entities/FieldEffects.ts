import Phaser from 'phaser';
import { EMOTICONS_TEXTURE, type EmoticonData } from '../data/assets';
import { objectDepth } from '../world/MapChunk';
import type { ObjectEvent, ObjectEventField } from './ObjectEvent';

/**
 * The emote icons' FLDEFF_* ids → sSpriteAnimTable_Emoticons index and the subpriority their
 * FldEff_*Icon function creates the sprite with (trainer_see.c).
 */
const ICONS: Record<string, { anim: number; subpriority: number }> = {
  FLDEFF_EXCLAMATION_MARK_ICON: { anim: 0, subpriority: 0x53 }, // FldEff_ExclamationMarkIcon1
  FLDEFF_DOUBLE_EXCL_MARK_ICON: { anim: 1, subpriority: 0x52 }, // FldEff_DoubleExclMarkIcon
  FLDEFF_X_ICON: { anim: 2, subpriority: 0x52 }, // FldEff_XIcon
  FLDEFF_SMILEY_FACE_ICON: { anim: 3, subpriority: 0x52 }, // FldEff_SmileyFaceIcon
  FLDEFF_QUESTION_MARK_ICON: { anim: 4, subpriority: 0x52 }, // FldEff_QuestionMarkIcon
};

/** An emote icon over an object (SetIconSpriteData + SpriteCB_TrainerIcons). */
class EmoteIcon {
  readonly sprite: Phaser.GameObjects.Sprite;
  /** sData3 / sData4: the bounce's velocity and offset. */
  private velocity = -5;
  private offset = 0;
  private frame = 0;
  done = false;

  constructor(
    scene: Phaser.Scene,
    readonly fldEff: string,
    private readonly obj: ObjectEvent,
    private readonly anim: [number, number][],
    private readonly subpriority: number,
    private readonly field: ObjectEventField,
  ) {
    this.sprite = scene.add.sprite(0, 0, EMOTICONS_TEXTURE, anim[0][0]);
  }

  private get duration(): number {
    return this.anim.reduce((n, [, d]) => n + d, 0);
  }

  /** SpriteCB_TrainerIcons, then AnimateSprite. Stops once the object is gone or the anim has ended. */
  tick(): void {
    if (!this.obj.sprite.active || this.frame >= this.duration) {
      this.destroy();
      return;
    }
    this.offset += this.velocity;
    if (this.offset) this.velocity++;
    else this.velocity = 0;
    // sprite->x/y = the object's centre, 16 px up; x2/y2 = the object's (jump lift) plus the bounce
    const o = this.obj.sprite;
    const y = o.y - o.height / 2 - 16 + this.offset;
    this.sprite.setPosition(o.x, y);
    let t = this.frame++;
    for (const [image, d] of this.anim) {
      if (t < d) {
        this.sprite.setFrame(image);
        break;
      }
      t -= d;
    }
    // oam.priority 1, its own subpriority; ties sort by screen top like the field's objects
    this.sprite.setDepth(objectDepth(1, this.subpriority, y - 8 - this.field.cameraTop));
  }

  destroy(): void {
    this.sprite.destroy();
    this.done = true;
  }
}

/** Field effect sprites that aren't part of an object event. Only the emote icons so far. */
export class FieldEffects {
  private icons: EmoteIcon[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly emoticons: EmoticonData,
    private readonly field: ObjectEventField,
  ) {}

  /** FieldEffectStart for an emote icon over `obj`. Returns false for field effects that aren't ported. */
  start(fldEff: string, obj: ObjectEvent): boolean {
    const icon = ICONS[fldEff];
    if (!icon) return false;
    // Created at the end of the sprite list, so its callback first runs this same frame (in `tick`).
    this.icons.push(new EmoteIcon(this.scene, fldEff, obj, this.emoticons.anims[icon.anim], icon.subpriority, this.field));
    return true;
  }

  /** FieldEffectActiveListContains */
  isActive(fldEff: string): boolean {
    return this.icons.some((e) => e.fldEff === fldEff && !e.done);
  }

  tick(): void {
    for (const e of this.icons) e.tick();
    this.icons = this.icons.filter((e) => !e.done);
  }

  /** Warps destroy every field effect sprite along with the map's objects. */
  clear(): void {
    for (const e of this.icons) e.destroy();
    this.icons = [];
  }
}
