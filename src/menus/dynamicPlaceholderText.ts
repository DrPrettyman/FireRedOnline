// dynamic_placeholder_text_util.c: {DYNAMIC n} placeholders filled from up to eight strings.
// (GetColorFromTextColorTable, the NPC text colours, isn't needed yet.)

import { EOS, strBody } from './common';

const CHAR_DYNAMIC = 0xf7;

const sStringPointers: (number[] | null)[] = Array(8).fill(null);

export function DynamicPlaceholderTextUtil_Reset(): void {
  sStringPointers.fill(null);
}

export function DynamicPlaceholderTextUtil_SetPlaceholderPtr(idx: number, ptr: number[]): void {
  if (idx < sStringPointers.length) sStringPointers[idx] = ptr;
}

/** DynamicPlaceholderTextUtil_ExpandPlaceholders: returns the expanded string (with EOS). */
export function DynamicPlaceholderTextUtil_ExpandPlaceholders(src: number[]): number[] {
  const dest: number[] = [];
  for (let i = 0; i < src.length && src[i] !== EOS; ) {
    if (src[i] !== CHAR_DYNAMIC) {
      dest.push(src[i++]);
    } else {
      const ptr = sStringPointers[src[i + 1]];
      if (ptr) dest.push(...strBody(ptr));
      i += 2;
    }
  }
  dest.push(EOS);
  return dest;
}

export function DynamicPlaceholderTextUtil_GetPlaceholderPtr(idx: number): number[] | null {
  return sStringPointers[idx];
}
