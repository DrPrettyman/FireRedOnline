// string_util.c helpers on encoded strings.

import { K } from './constants';

export const STR_CONV_MODE_LEFT_ALIGN = 0;
export const STR_CONV_MODE_RIGHT_ALIGN = 1;
export const STR_CONV_MODE_LEADING_ZEROS = 2;

const CHAR_SPACE = 0x00;
const CHAR_0 = 0xa1;
const CHAR_QUESTION_MARK = 0xac;

/** ConvertIntToDecimalStringN: the digits (no EOS). */
export function ConvertIntToDecimalStringN(value: number, mode: number, n: number): number[] {
  const out: number[] = [];
  let state = mode === STR_CONV_MODE_RIGHT_ALIGN ? 2 : mode === STR_CONV_MODE_LEADING_ZEROS ? 1 : 0; // WAITING / WRITING_DIGITS / WRITING_SPACES
  for (let powerOfTen = 10 ** (n - 1); powerOfTen > 0; powerOfTen = Math.trunc(powerOfTen / 10)) {
    const digit = Math.trunc(value / powerOfTen) & 0xffff;
    const temp = value - powerOfTen * digit;
    if (state === 1) {
      out.push(digit <= 9 ? CHAR_0 + digit : CHAR_QUESTION_MARK);
    } else if (digit !== 0 || powerOfTen === 1) {
      state = 1;
      out.push(digit <= 9 ? CHAR_0 + digit : CHAR_QUESTION_MARK);
    } else if (state === 2) {
      out.push(CHAR_SPACE);
    }
    value = temp;
  }
  return out;
}

/** StringCopy semantics: bytes up to (not including) EOS. */
export function strBody(s: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length && s[i] !== K.EOS; i++) out.push(s[i]);
  return out;
}
