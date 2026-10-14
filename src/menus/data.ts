// public/gen/menus.json (tools/extract_menus.py): tables the party menu and bag index.

export interface MenusData {
  /** gMonIconTable: species -> icon graphics symbol */
  monIcons: (string | null)[];
  /** gMonIconPaletteIndices */
  monIconPaletteIndices: (number | null)[];
  /** sItemIconTable: item -> [tiles symbol, palette symbol] */
  itemIcons: ([string, string] | null)[];
  /** sTMHMMoves */
  tmhmMoves: number[];
  /** sTutorMoves */
  tutorMoves: number[];
  /** sTutorLearnsets: species -> bits by TUTOR_MOVE_* */
  tutorLearnsets: (number | null)[];
  /** sTMHMLearnsets: species -> [TM01..TM32 bits, TM33..HM08 bits] */
  tmhmLearnsets: ([number, number] | null)[];
  /** gEvolutionTable: species -> [method, param, targetSpecies][] */
  evolutions: ([number, number, number][] | null)[];
}

export let menusData: MenusData;
let loading: Promise<MenusData> | undefined;

export async function loadMenusData(base: string): Promise<MenusData> {
  loading ??= fetch(`${base}/menus.json`).then((res) => {
    if (!res.ok) throw new Error(`Failed to load menus.json: ${res.status}`);
    return res.json() as Promise<MenusData>;
  });
  menusData = await loading;
  return menusData;
}
