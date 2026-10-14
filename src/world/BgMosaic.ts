import Phaser from 'phaser';

// REG_MOSAIC for the field's map BGs (InitOverworldBgs enables mosaic on BG1-3, the map layers; the text
// window and sprites aren't affected). Each layer is drawn through a post pipeline that, like the GBA,
// gives every block of size x size screen pixels the colour of its top-left pixel.

const PIPELINE = 'GbaBgMosaic';

const FRAG = `
#define SHADER_NAME GBA_BG_MOSAIC_FS
precision mediump float;
uniform sampler2D uMainSampler;
uniform vec2 uResolution;
uniform float uSize;
varying vec2 outTexCoord;
void main() {
  // Screen pixel counted from the top-left, snapped to its block's top-left pixel.
  vec2 px = floor(vec2(outTexCoord.x, 1.0 - outTexCoord.y) * uResolution);
  px = floor(px / uSize) * uSize + 0.5;
  gl_FragColor = texture2D(uMainSampler, vec2(px.x, uResolution.y - px.y) / uResolution);
}`;

/** The mosaic size the layers are drawn with (BG_MOSAIC_SET's low nibble + 1); 1 = off. */
let mosaicSize = 1;

class GbaBgMosaicPipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  constructor(game: Phaser.Game) {
    super({ game, name: PIPELINE, fragShader: FRAG });
  }

  onPreRender(): void {
    this.set1f('uSize', mosaicSize);
    this.set2f('uResolution', this.renderer.width, this.renderer.height);
  }
}

function webgl(scene: Phaser.Scene): Phaser.Renderer.WebGL.WebGLRenderer | undefined {
  const r = scene.game.renderer;
  return r instanceof Phaser.Renderer.WebGL.WebGLRenderer ? r : undefined;
}

/**
 * AdjustBgMosaic(value, BG_MOSAIC_SET) on the given map layers: horizontal size in the low nibble,
 * vertical in the high one (the field only ever sets them equal). 0 turns it off. No-op on canvas.
 */
export function setBgMosaic(scene: Phaser.Scene, layers: Phaser.Tilemaps.TilemapLayer[], value: number): void {
  const r = webgl(scene);
  if (!r) return;
  if (!r.pipelines.getPostPipeline(PIPELINE)) r.pipelines.addPostPipeline(PIPELINE, GbaBgMosaicPipeline);
  mosaicSize = (value & 0xf) + 1;
  for (const layer of layers) {
    const has = layer.postPipelines.some((p) => p.name === PIPELINE);
    if (mosaicSize > 1 && !has) layer.setPostPipeline(PIPELINE);
    else if (mosaicSize === 1 && has) layer.removePostPipeline(PIPELINE);
  }
}
