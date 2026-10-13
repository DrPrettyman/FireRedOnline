// The PREPARE_*_BUFFER macros from include/battle_message.h: fill a gBattleTextBuff with a
// B_BUFF placeholder that BattleStringExpandPlaceholders later expands.

import { K } from './constants';

type Buf = Uint8Array | number[];

function put(buf: Buf, bytes: number[]): void {
  for (let i = 0; i < bytes.length; i++) buf[i] = bytes[i] & 0xff;
}

const BEGIN = 0xfd; // B_BUFF_PLACEHOLDER_BEGIN
const EOS = 0xff; // B_BUFF_EOS

export function prepareFlavorBuffer(buf: Buf, flavorId: number): void {
  put(buf, [BEGIN, K.B_BUFF_NEGATIVE_FLAVOR, flavorId, EOS]);
}

export function prepareStatBuffer(buf: Buf, statId: number): void {
  put(buf, [BEGIN, K.B_BUFF_STAT, statId, EOS]);
}

export function prepareAbilityBuffer(buf: Buf, abilityId: number): void {
  put(buf, [BEGIN, K.B_BUFF_ABILITY, abilityId, EOS]);
}

export function prepareTypeBuffer(buf: Buf, typeId: number): void {
  put(buf, [BEGIN, K.B_BUFF_TYPE, typeId, EOS]);
}

export function prepareByteNumberBuffer(buf: Buf, maxDigits: number, n: number): void {
  put(buf, [BEGIN, K.B_BUFF_NUMBER, 1, maxDigits, n, EOS]);
}

export function prepareHwordNumberBuffer(buf: Buf, maxDigits: number, n: number): void {
  put(buf, [BEGIN, K.B_BUFF_NUMBER, 2, maxDigits, n, (n & 0xff00) >> 8, EOS]);
}

export function prepareWordNumberBuffer(buf: Buf, maxDigits: number, n: number): void {
  put(buf, [BEGIN, K.B_BUFF_NUMBER, 4, maxDigits, n, (n & 0xff00) >> 8, (n & 0xff0000) >> 16, (n >>> 24) & 0xff, EOS]);
}

export function prepareStringBuffer(buf: Buf, stringId: number): void {
  put(buf, [BEGIN, K.B_BUFF_STRING, stringId, (stringId & 0xff00) >> 8, EOS]);
}

export function prepareMoveBuffer(buf: Buf, move: number): void {
  put(buf, [BEGIN, K.B_BUFF_MOVE, move, (move & 0xff00) >> 8, EOS]);
}

export function prepareItemBuffer(buf: Buf, item: number): void {
  put(buf, [BEGIN, K.B_BUFF_ITEM, item, (item & 0xff00) >> 8, EOS]);
}

export function prepareSpeciesBuffer(buf: Buf, species: number): void {
  put(buf, [BEGIN, K.B_BUFF_SPECIES, species, (species & 0xff00) >> 8, EOS]);
}

export function prepareMonNickWithPrefixBuffer(buf: Buf, battler: number, partyId: number): void {
  put(buf, [BEGIN, K.B_BUFF_MON_NICK_WITH_PREFIX, battler, partyId, EOS]);
}

export function prepareMonNickBuffer(buf: Buf, battler: number, partyId: number): void {
  put(buf, [BEGIN, K.B_BUFF_MON_NICK, battler, partyId, EOS]);
}

/** StringCopy into a text buffer (EOS-terminated source). */
export function stringCopy(dst: Buf, src: number[]): void {
  let i = 0;
  for (; i < src.length && src[i] !== EOS; i++) dst[i] = src[i];
  dst[i] = EOS;
}
