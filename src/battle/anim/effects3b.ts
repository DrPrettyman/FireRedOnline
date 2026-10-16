// battle_anim_effects_3.c, second half: from AnimTask_PainSplitMovement (C line 2914) to the end of the file.
// The first half is in effects3.ts; the file is split in two only so two workers could port it at once (the
// halves don't call each other). AnimRoarNoiseLine and AnimTask_MonToSubstitute are from this half but were
// ported earlier and live in effects3.ts.

import type { SpriteCallback } from '../../gba/sprite';
import type { TaskFunc } from '../../gba/task';

export const effects3bSpriteCallbacks: Record<string, SpriteCallback> = {};

export const effects3bTasks: Record<string, TaskFunc> = {};
