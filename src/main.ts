import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { OverworldScene } from './scenes/OverworldScene';
import { BattleScene } from './scenes/BattleScene';

// GBA native resolution; scaled up with nearest-neighbour filtering.
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 240,
  height: 160,
  backgroundColor: '#000000',
  pixelArt: true,
  roundPixels: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, OverworldScene, BattleScene],
});

// Handy for poking at state from the devtools console during development.
if (import.meta.env.DEV) (window as unknown as { game: Phaser.Game }).game = game;
