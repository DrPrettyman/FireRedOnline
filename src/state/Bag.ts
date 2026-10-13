// item.c: the player's bag. Pocket ids are POCKET_* (1-based), capacities BAG_*_COUNT.

/** item.c compares stack sizes against a literal 999; there is no named constant for it. */
const MAX_BAG_ITEM_CAPACITY = 999;

export interface ItemSlot {
  itemId: number;
  quantity: number;
}

export interface BagConstants {
  capacities: number[]; // per pocket, index = POCKET_* - 1
  ITEM_NONE: number;
  ITEM_TM_CASE: number;
  ITEM_BERRY_POUCH: number;
  POCKET_KEY_ITEMS: number;
  POCKET_TM_CASE: number;
  POCKET_BERRY_POUCH: number;
}

export class Bag {
  readonly pockets: ItemSlot[][];

  constructor(
    private c: BagConstants,
    private pocketOf: (item: number) => number,
    /** FlagSet(FLAG_SYS_GOT_BERRY_POUCH) */
    private onGotBerryPouch: () => void,
  ) {
    this.pockets = c.capacities.map((n) => Array.from({ length: n }, () => ({ itemId: c.ITEM_NONE, quantity: 0 })));
  }

  /** CheckBagHasItem. FRLG only ever looks at the first stack of an item. */
  has(itemId: number, count: number): boolean {
    const slot = this.firstStack(itemId);
    return slot !== undefined && slot.quantity >= count;
  }

  /** CheckBagHasSpace */
  hasSpace(itemId: number, count: number): boolean {
    const pocket = this.pocketOf(itemId);
    if (pocket === 0) return false;
    const slot = this.firstStack(itemId);
    if (slot) return slot.quantity + count <= MAX_BAG_ITEM_CAPACITY;
    return this.firstEmpty(pocket) >= 0;
  }

  /** AddBagItem */
  add(itemId: number, count: number): boolean {
    const pocket = this.pocketOf(itemId);
    if (pocket === 0) return false;
    const slot = this.firstStack(itemId);
    if (slot) {
      if (slot.quantity + count > MAX_BAG_ITEM_CAPACITY) return false;
      slot.quantity += count;
      return true;
    }
    // The TM case and berry pouch are key items handed out with the first TM / berry.
    const c = this.c;
    if (pocket === c.POCKET_TM_CASE && !this.has(c.ITEM_TM_CASE, 1)) {
      if (!this.put(c.POCKET_KEY_ITEMS, c.ITEM_TM_CASE, 1)) return false;
    }
    if (pocket === c.POCKET_BERRY_POUCH && !this.has(c.ITEM_BERRY_POUCH, 1)) {
      if (!this.put(c.POCKET_KEY_ITEMS, c.ITEM_BERRY_POUCH, 1)) return false;
      this.onGotBerryPouch();
    }
    if (itemId === this.c.ITEM_BERRY_POUCH) this.onGotBerryPouch();
    return this.put(pocket, itemId, count);
  }

  /** RemoveBagItem */
  remove(itemId: number, count: number): boolean {
    if (this.pocketOf(itemId) === 0 || itemId === this.c.ITEM_NONE) return false;
    const slot = this.firstStack(itemId);
    if (!slot || slot.quantity < count) return false;
    slot.quantity -= count;
    if (slot.quantity === 0) slot.itemId = this.c.ITEM_NONE;
    return true;
  }

  private firstStack(itemId: number): ItemSlot | undefined {
    const pocket = this.pocketOf(itemId);
    if (pocket === 0) return undefined;
    return this.pockets[pocket - 1].find((s) => s.itemId === itemId);
  }

  /** BagPocketGetFirstEmptySlot */
  private firstEmpty(pocket: number): number {
    return this.pockets[pocket - 1].findIndex((s) => s.itemId === this.c.ITEM_NONE);
  }

  private put(pocket: number, itemId: number, count: number): boolean {
    const i = this.firstEmpty(pocket);
    if (i < 0) return false;
    this.pockets[pocket - 1][i] = { itemId, quantity: count };
    return true;
  }
}
