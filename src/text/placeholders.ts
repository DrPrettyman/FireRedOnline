import type { GameState } from '../state/GameState';
import { EOS, PLACEHOLDER_BEGIN, type Charmap } from './charmap';

/** StringExpandPlaceholders: substitute {PLAYER}, {RIVAL}, {STR_VAR_n} in an encoded string. */
export function expandPlaceholders(bytes: number[], charmap: Charmap, state: GameState): number[] {
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === PLACEHOLDER_BEGIN) {
      out.push(...placeholder(bytes[++i], charmap, state));
      continue;
    }
    out.push(b);
    if (b === EOS) break;
  }
  return out;
}

function placeholder(id: number, charmap: Charmap, state: GameState): number[] {
  switch (id) {
    case 0x01:
      return charmap.encodePlain(state.playerName);
    case 0x02:
    case 0x03:
    case 0x04:
      return state.stringVars[id - 2];
    case 0x06:
      return charmap.encodePlain(state.rivalName);
    default:
      return []; // KUN and the RS-only placeholders are empty in FRLG
  }
}
