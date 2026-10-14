// sound.c / m4a: audio isn't implemented yet. These keep call sites reading like the C; fanfares
// count as already finished so code that waits on them carries on.

export function PlaySE(_songId: number): void {}

export function PlayFanfare(_songId: number): void {}

export function PlayFanfareByFanfareNum(_fanfareNum: number): void {}

/** WaitFanfare: TRUE once the fanfare has stopped. */
export function WaitFanfare(_stop: boolean): boolean {
  return true;
}

export function IsFanfareTaskInactive(): boolean {
  return true;
}

export function IsSEPlaying(): boolean {
  return false;
}
