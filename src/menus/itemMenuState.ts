// item_menu.c's persistent state (gBagMenuState) and the script special vars the menus read and
// write (gSpecialVar_ItemId, gSpecialVar_0x8004, ... are VAR_ITEM_ID, VAR_0x8004, ... in event_data.c).

import { state } from '../battle/env';
import type { MainCallback } from '../gba/main';

/** struct BagStruct */
export const gBagMenuState = {
  bagCallback: null as MainCallback | null,
  location: 0,
  bagOpen: false,
  pocket: 0,
  itemsAbove: [0, 0, 0],
  cursorPos: [0, 0, 0],
};

/** gSpecialVar_ItemId / gSpecialVar_0x8004 / 0x8005 / 0x8007 / gSpecialVar_Result */
export const SpecialVar = {
  get ItemId(): number {
    return state.getVar('VAR_ITEM_ID');
  },
  set ItemId(v: number) {
    state.setVar('VAR_ITEM_ID', v);
  },
  get x8004(): number {
    return state.getVar('VAR_0x8004');
  },
  set x8004(v: number) {
    state.setVar('VAR_0x8004', v);
  },
  get x8005(): number {
    return state.getVar('VAR_0x8005');
  },
  set x8005(v: number) {
    state.setVar('VAR_0x8005', v);
  },
  get x8007(): number {
    return state.getVar('VAR_0x8007');
  },
  get Result(): number {
    return state.getVar('VAR_RESULT');
  },
  set Result(v: number) {
    state.setVar('VAR_RESULT', v);
  },
};
