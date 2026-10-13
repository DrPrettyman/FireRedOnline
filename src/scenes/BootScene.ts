import Phaser from 'phaser';
import { Assets } from '../data/assets';
import type { OverworldStart } from './OverworldScene';

/** New game warp target (src/new_game.c: SetWarpDestination(..PLAYERS_HOUSE_2F, -1, 6, 6)). */
const NEW_GAME_START: OverworldStart = { map: 'PalletTown_PlayersHouse_2F', x: 6, y: 6 };

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  async create(): Promise<void> {
    const assets = new Assets();
    try {
      await assets.init();
    } catch (err) {
      console.error(err);
      this.add
        .text(8, 8, 'Assets missing.\nRun: npm run extract', { fontFamily: 'monospace', fontSize: '10px', color: '#f88' })
        .setResolution(4);
      return;
    }
    this.registry.set('assets', assets);
    this.scene.start('Overworld', startFromUrl() ?? NEW_GAME_START);
  }
}

/** Debug: ?map=PalletTown&x=10&y=10 jumps straight to a location. */
function startFromUrl(): OverworldStart | undefined {
  const q = new URLSearchParams(location.search);
  const map = q.get('map');
  if (!map) return undefined;
  return { map, x: Number(q.get('x') ?? 0), y: Number(q.get('y') ?? 0) };
}
