// The battle-party ordering helpers from party_menu.c. gBattlePartyCurrentOrder packs six party
// slots as nibbles (battle slot -> party index); link multi battles are not supported.

import { K } from './constants';
import { g } from './env';
import { getBattlerAtPosition, getBattlerSide } from './util';

/** IsMultiBattle */
export function isMultiBattle(): boolean {
  const f = g.battleTypeFlags;
  return !!(f & K.BATTLE_TYPE_MULTI && f & K.BATTLE_TYPE_DOUBLE && f & K.BATTLE_TYPE_TRAINER && f & K.BATTLE_TYPE_LINK);
}

/** BufferBattlePartyCurrentOrderBySide / BufferBattlePartyOrderBySide */
export function bufferBattlePartyCurrentOrderBySide(battlerId: number, flankId: number): void {
  const order = g.battleStruct.battlerPartyOrders[battlerId];
  const partyIndexes = new Array(K.PARTY_SIZE).fill(0);
  let left: number, right: number;
  if (getBattlerSide(battlerId) === K.B_SIDE_PLAYER) {
    left = getBattlerAtPosition(K.B_POSITION_PLAYER_LEFT);
    right = getBattlerAtPosition(K.B_POSITION_PLAYER_RIGHT);
  } else {
    left = getBattlerAtPosition(K.B_POSITION_OPPONENT_LEFT);
    right = getBattlerAtPosition(K.B_POSITION_OPPONENT_RIGHT);
  }
  if (isMultiBattle()) {
    if (flankId !== 0) {
      order[0] = 0 | (3 << 4);
      order[1] = 5 | (4 << 4);
      order[2] = 2 | (1 << 4);
    } else {
      order[0] = 3 | (0 << 4);
      order[1] = 2 | (1 << 4);
      order[2] = 5 | (4 << 4);
    }
    return;
  }
  let j: number;
  if (!(g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE)) {
    j = 1;
    partyIndexes[0] = g.battlerPartyIndexes[left];
    for (let i = 0; i < K.PARTY_SIZE; i++) if (i !== partyIndexes[0]) partyIndexes[j++] = i;
  } else {
    j = 2;
    partyIndexes[0] = g.battlerPartyIndexes[left];
    partyIndexes[1] = g.battlerPartyIndexes[right];
    for (let i = 0; i < K.PARTY_SIZE; i++) if (i !== partyIndexes[0] && i !== partyIndexes[1]) partyIndexes[j++] = i;
  }
  for (let i = 0; i < 3; i++) order[i] = (partyIndexes[i * 2] << 4) | partyIndexes[1 + i * 2];
}

/** GetPartyIdFromBattleSlot */
export function getPartyIdFromBattleSlot(slot: number): number {
  const o = g.battlePartyCurrentOrder[slot >> 1];
  return slot & 1 ? o & 0xf : o >> 4;
}

function setPartyIdAtBattleSlot(slot: number, setVal: number): void {
  const i = slot >> 1;
  const o = g.battlePartyCurrentOrder[i];
  g.battlePartyCurrentOrder[i] = slot & 1 ? (o & 0xf0) | setVal : (o & 0xf) | (setVal << 4);
}

/** SwitchPartyMonSlots */
export function switchPartyMonSlots(slot: number, slot2: number): void {
  const partyId = getPartyIdFromBattleSlot(slot);
  setPartyIdAtBattleSlot(slot, getPartyIdFromBattleSlot(slot2));
  setPartyIdAtBattleSlot(slot2, partyId);
}

/** GetPartyIdFromBattlePartyId */
export function getPartyIdFromBattlePartyId(battlePartyId: number): number {
  for (let i = 0, j = 0; i < 3; ++j, ++i) {
    if (g.battlePartyCurrentOrder[i] >> 4 !== battlePartyId) {
      ++j;
      if ((g.battlePartyCurrentOrder[i] & 0xf) === battlePartyId) return j;
    } else {
      return j;
    }
  }
  return 0;
}

/** SwitchPartyOrderLinkMulti: only does anything in link multi battles. */
export function switchPartyOrderLinkMulti(_battlerId: number, _slot: number, _slot2: number): void {
  if (isMultiBattle()) console.warn('[battle] SwitchPartyOrderLinkMulti: multi battles not supported');
}
