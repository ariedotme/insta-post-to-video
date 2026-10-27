import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  getFirstEncodableVideoCodec,
} from 'mediabunny';
import { createCanvas } from './media';
import { FPS, H, W, drawFrame, type Scene } from './scene';

/** Instagram re-encodes uploads anyway; this keeps plenty of detail for it to work with. */
const BITRATE = 8_000_000;

/** Renders every frame of the scene and encodes it as an H.264 (or HEVC) MP4. */
export async function exportVideo(
  scene: Scene,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<Blob> {
  const codec = await getFirstEncodableVideoCodec(['avc', 'hevc'], { width: W, height: H, bitrate: BITRATE });
  if (!codec) throw new Error('This browser cannot encode MP4 video. Try a recent Chrome, Edge or Safari.');

  const { canvas, ctx } = createCanvas(W, H);
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target: new BufferTarget(),
  });
  const source = new CanvasSource(canvas, { codec, bitrate: BITRATE, keyFrameInterval: 1 });
  output.addVideoTrack(source, { frameRate: FPS });
  await output.start();

  const frames = Math.max(1, Math.round(scene.total * FPS));
  try {
    for (let i = 0; i < frames; i++) {
      signal.throwIfAborted();
      drawFrame(ctx, scene, i / FPS);
      await source.add(i / FPS, 1 / FPS);
      onProgress((i + 1) / frames);
    }
    source.close();
    await output.finalize();
  } catch (error) {
    await output.cancel();
    throw error;
  }
  return new Blob([output.target.buffer!], { type: 'video/mp4' });
}
