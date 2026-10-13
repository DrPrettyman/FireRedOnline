// Shapes of public/gen/battle/*.json (tools/extract_battle.py).

export interface BattleScriptsData {
  romBase: number;
  /** base64 of the assembled battle_scripts_1/2.s + battle_ai_scripts.s + STRINGID tables. */
  rom: string;
  /** label -> ROM address */
  labels: Record<string, number>;
  /** RAM symbol -> address (each symbol owns `ramSlot` bytes). */
  ram: Record<string, number>;
  ramSlot: number;
}

export interface BattleWindowText {
  fillValue: number;
  fontId: number;
  x: number;
  y: number;
  letterSpacing: number;
  lineSpacing: number;
  speed: number;
  fgColor: number;
  bgColor: number;
  shadowColor: number;
}

export interface BattleStringsData {
  /** C string symbol -> raw decomp string ($-terminated). */
  strings: Record<string, string>;
  /** STRINGID_* -> C string symbol (gBattleStringsTable). */
  battleStrings: Record<string, string>;
  battleStringsStart: number;
  stringIdTables: Record<string, number[]>;
  pointerTables: Record<string, (string | null)[]>;
  /** sGrammarMoveUsedTable */
  grammarMoveUsed: number[];
  /** sTextOnWindowsInfo_Normal indexed by B_WIN_* */
  textOnWindows: (BattleWindowText | null)[];
  abilityNames: (string | null)[];
  typeNames: (string | null)[];
  trainerClassNames: (string | null)[];
}

export interface TrainerMonData {
  iv: number;
  lvl: number;
  species: number;
  heldItem?: number;
  moves?: number[];
}

export interface TrainerData {
  id: string;
  trainerClass: number;
  encounterMusicGender: number;
  trainerPic: number;
  trainerName: string;
  items: number[];
  doubleBattle: number;
  aiFlags: number;
  partyFlags: number;
  party: TrainerMonData[];
}

export interface BattleTablesData {
  /** gTypeEffectiveness: [atk, def, multiplier] triples, TYPE_FORESIGHT / TYPE_ENDTABLE terminated. */
  typeEffectiveness: number[];
  /** gTrainerMoneyTable: [classId, value], ends with classId 0xFF. */
  trainerMoney: [number, number][];
  /** gStatStageRatios */
  statStageRatios: [number, number][];
  trainers: (TrainerData | null)[];
  coords: {
    /** [size, y_offset]; size = width tiles << 4 | height tiles */
    monFront: ([number, number] | null)[];
    monBack: ([number, number] | null)[];
    trainerFront: ([number, number] | null)[];
    trainerBack: ([number, number] | null)[];
    enemyElevation: number[];
  };
}

export type Rgb = [number, number, number];

export interface BattlePalettesData {
  textbox: Rgb[];
  healthbox: Rgb[];
  healthbar: Rgb[];
}

export interface BattleData {
  scripts: BattleScriptsData;
  strings: BattleStringsData;
  tables: BattleTablesData;
  palettes: BattlePalettesData;
}

export async function loadBattleData(base: string): Promise<BattleData> {
  const get = async <T>(f: string): Promise<T> => {
    const res = await fetch(`${base}/battle/${f}`);
    if (!res.ok) throw new Error(`Failed to load battle/${f}: ${res.status}`);
    return res.json() as Promise<T>;
  };
  const [scripts, strings, tables, palettes] = await Promise.all([
    get<BattleScriptsData>('scripts.json'),
    get<BattleStringsData>('strings.json'),
    get<BattleTablesData>('tables.json'),
    get<BattlePalettesData>('palettes.json'),
  ]);
  return { scripts, strings, tables, palettes };
}
