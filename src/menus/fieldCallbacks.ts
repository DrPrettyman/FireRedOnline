// The overworld's return points (overworld.c) as main callbacks the GBA-side screens can hand to
// SetMainCallback2. The overworld isn't a GBA screen, so the menu host scene fills in what they do:
// leave the menu scene and wake the field, optionally reopening the start menu.

export const fieldReturn = {
  /** CB2_ReturnToFieldWithOpenMenu: back to the field with the start menu open. */
  withOpenMenu: (): void => console.warn('[menus] CB2_ReturnToFieldWithOpenMenu: no field host'),
  /** CB2_ReturnToField */
  plain: (): void => console.warn('[menus] CB2_ReturnToField: no field host'),
};

export function CB2_ReturnToFieldWithOpenMenu(): void {
  fieldReturn.withOpenMenu();
}

export function CB2_ReturnToField(): void {
  fieldReturn.plain();
}

/** CB2_ReturnToFieldContinueScriptPlayMapMusic: the field host fades back in and the waiting script resumes. */
export function CB2_ReturnToFieldContinueScriptPlayMapMusic(): void {
  fieldReturn.plain();
}
