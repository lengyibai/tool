import Gif from "gif.js/dist/gif.js";
import workerUrl from "gif.js/dist/gif.worker.js?url";
import { decompressFrames, parseGIF } from "gifuct-js";
import { ALL_FORMATS, BlobSource, CanvasSink, Input } from "mediabunny";

import type { ParsedFrame } from "gifuct-js";
import type { GifExportSettings, GifSource } from "@/types/gif-editor";

const maxVideoDuration = 30;
const maxFramePixels = 70_000_000;
const minFrameDelay = 0.02;

const isGifFile = (file: File) => file.type === "image/gif" || file.name.toLowerCase().endsWith(".gif");

const createCanvas = (width: number, height: number) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

const frameDelay = (frame: ParsedFrame) => Math.max(minFrameDelay, (frame.delay ?? 100) / 1000);

const hasTransparentPixels = (pixels: Uint8ClampedArray) => {
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] < 128) return true;
  }
  return false;
};

const loadGif = async (file: File): Promise<GifSource> => {
  try {
    const parsed = parseGIF(await file.arrayBuffer());
    const { width, height, backgroundColorIndex } = parsed.lsd;
    if (!width || !height || width > 4096 || height > 4096) throw new Error("GIF 画面尺寸无效或过大。");
    const frames = decompressFrames(parsed, true);
    if (!frames.length) throw new Error("GIF 中没有可编辑的画面帧。");
    const frameStarts: number[] = [];
    let duration = 0;
    for (const frame of frames) {
      frameStarts.push(duration);
      duration += frameDelay(frame);
    }
    const background = parsed.gct?.[backgroundColorIndex] ?? null;
    const firstFrame = frames[0];
    const transparentBackground = firstFrame.transparentIndex !== undefined && (
      firstFrame.dims.left > 0 ||
      firstFrame.dims.top > 0 ||
      firstFrame.dims.width < width ||
      firstFrame.dims.height < height ||
      hasTransparentPixels(firstFrame.patch)
    );
    return {
      file,
      kind: "gif",
      width,
      height,
      duration,
      frames,
      frameStarts,
      background,
      backgroundIndex: backgroundColorIndex,
      hasTransparency: transparentBackground || frames.some((frame) => hasTransparentPixels(frame.patch)),
      transparentBackground,
    };
  } catch (error) {
    if (error instanceof Error && /GIF .*无效|GIF 中没有/.test(error.message)) throw error;
    throw new Error("无法解码这个 GIF 文件，请检查文件是否损坏。");
  }
};

const loadVideo = async (file: File): Promise<GifSource> => {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  try {
    if (!(await input.canRead())) throw new Error("无法读取这个视频文件。");
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) throw new Error("当前浏览器无法解码这个视频。");
    const [width, height, firstTimestamp, duration] = await Promise.all([
      track.getDisplayWidth(),
      track.getDisplayHeight(),
      track.getFirstTimestamp(),
      track.computeDuration(),
    ]);
    if (!width || !height || !Number.isFinite(duration) || duration <= 0)
      throw new Error("视频没有可处理的画面或时长信息。");
    return {
      file,
      kind: "video",
      width,
      height,
      duration,
      input,
      track,
      sink: new CanvasSink(track, { poolSize: 2 }),
      firstTimestamp,
    };
  } catch (error) {
    input.dispose();
    if (error instanceof Error && /无法读取|无法解码|没有可处理/.test(error.message)) throw error;
    throw new Error("无法读取这个视频，请检查格式或浏览器解码能力。");
  }
};

const loadGifSource = async (file: File) => {
  if (isGifFile(file)) return loadGif(file);
  if (file.type.startsWith("video/") || /\.(mp4|webm|mov|m4v)$/i.test(file.name)) return loadVideo(file);
  throw new Error("请选择 GIF、MP4、WebM 或浏览器支持的视频文件。");
};

const frameIndexAt = (source: GifSource, time: number) => {
  const starts = source.frameStarts ?? [];
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (starts[middle] <= time) low = middle;
    else high = middle - 1;
  }
  return low;
};

/** @description 顺序合成 GIF 局部帧，导出时复用已合成画面 */
const createGifFrameRenderer = (source: GifSource) => {
  const canvas = createCanvas(source.width, source.height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const frames = source.frames;
  if (!context || !frames) throw new Error("无法建立 GIF 画面画布。");
  const patchCanvas = createCanvas(1, 1);
  const patchContext = patchCanvas.getContext("2d");
  if (!patchContext) throw new Error("无法绘制 GIF 帧。");
  if (source.background && !source.transparentBackground) {
    context.fillStyle = `rgb(${source.background.join(",")})`;
    context.fillRect(0, 0, source.width, source.height);
  }
  let restore: ImageData | null = null;
  let renderedIndex = -1;
  const renderTo = (targetIndex: number) => {
    for (let index = renderedIndex + 1; index <= targetIndex; index++) {
      const frame = frames[index];
      const previous = frames[index - 1];
      if (previous?.disposalType === 2) {
        const { left, top, width, height } = previous.dims;
        context.clearRect(left, top, width, height);
        if (source.background && !source.transparentBackground) {
          context.fillStyle = `rgb(${source.background.join(",")})`;
          context.fillRect(left, top, width, height);
        }
      } else if (previous?.disposalType === 3 && restore) {
        context.putImageData(restore, 0, 0);
      }
      restore = frame.disposalType === 3 ? context.getImageData(0, 0, source.width, source.height) : null;
      const { left, top, width, height } = frame.dims;
      patchCanvas.width = width;
      patchCanvas.height = height;
      patchContext.putImageData(new ImageData(frame.patch, width, height), 0, 0);
      context.drawImage(patchCanvas, left, top);
      renderedIndex = index;
    }
    return canvas;
  };
  return { renderTo };
};

const previewRenderers = new WeakMap<GifSource, { renderer: ReturnType<typeof createGifFrameRenderer>; index: number }>();

const renderSourceFrame = async (source: GifSource, time: number) => {
  if (source.kind === "gif") {
    const index = frameIndexAt(source, time);
    let cached = previewRenderers.get(source);
    if (!cached || index < cached.index) {
      cached = { renderer: createGifFrameRenderer(source), index: -1 };
      previewRenderers.set(source, cached);
    }
    const frame = cached.renderer.renderTo(index);
    cached.index = index;
    return frame;
  }
  const result = await source.sink?.getCanvas((source.firstTimestamp ?? 0) + Math.min(time, source.duration - 0.001));
  if (!result) throw new Error("无法读取所选时间的画面。");
  return result.canvas;
};

const validateExport = (source: GifSource, settings: GifExportSettings) => {
  const { crop, width, height, frameRate, trimStart, trimEnd } = settings;
  const selectedDuration = trimEnd - trimStart;
  if (!Number.isFinite(trimStart) || !Number.isFinite(trimEnd) || trimStart < 0 || trimEnd > source.duration + 0.001 || selectedDuration < 0.01)
    throw new Error("请选择有效的开始和结束时间。");
  if (source.kind === "video" && selectedDuration > maxVideoDuration + 0.001)
    throw new Error("视频选区最长支持 30 秒，请缩短开始与结束时间。");
  if (
    ![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) ||
    crop.x < 0 ||
    crop.y < 0 ||
    crop.width < 1 ||
    crop.height < 1 ||
    crop.x + crop.width > source.width ||
    crop.y + crop.height > source.height
  )
    throw new Error("裁剪区域必须位于原始画面内。");
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 1024 || height > 1024 || width > crop.width || height > crop.height)
    throw new Error("导出宽高不能超过裁剪区域的原始尺寸或 1024 像素。");
  if (frameRate !== "original" && (!Number.isFinite(frameRate) || frameRate < 0.001 || frameRate > 30))
    throw new Error("请输入有效的导出帧率。");
  if (source.kind === "video" && frameRate === "original") throw new Error("视频需要选择固定导出帧率。");
  const gifFrames = source.frames ?? [];
  if (source.kind === "gif" && frameRate === "original" && gifFrames.length / source.duration > 30)
    throw new Error("原 GIF 帧率超过 30 fps，请选择固定导出帧率。");
  if (source.kind === "gif" && frameRate !== "original" && frameRate > gifFrames.length / source.duration)
    throw new Error("导出帧率不能高于原 GIF 的平均帧率。");
  const frameCount = source.kind === "gif" && frameRate === "original"
    ? frameIndexAt(source, Math.min(source.duration, trimEnd - 0.000001)) - frameIndexAt(source, trimStart) + 1
    : Math.ceil(selectedDuration * Number(frameRate));
  if (frameRate === "original" && frameCount / selectedDuration > 30 + 0.001)
    throw new Error("所选片段的原帧率超过 30 fps，请选择固定导出帧率。");
  if (!frameCount || frameCount * width * height > maxFramePixels)
    throw new Error("画面量过大，请降低帧率或缩小导出尺寸。");
  return frameCount;
};

const cropFrame = (frame: HTMLCanvasElement | OffscreenCanvas, settings: GifExportSettings) => {
  const canvas = createCanvas(settings.width, settings.height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("无法绘制导出画面。");
  const { x, y, width, height } = settings.crop;
  context.drawImage(frame, x, y, width, height, 0, 0, settings.width, settings.height);
  const data = context.getImageData(0, 0, settings.width, settings.height);
  let hasTransparency = false;
  for (let index = 0; index < data.data.length; index += 4) {
    if (data.data[index + 3] >= 128) continue;
    hasTransparency = true;
    data.data[index] = 255;
    data.data[index + 1] = 0;
    data.data[index + 2] = 255;
  }
  return { data, hasTransparency };
};

const prepareFrameColors = (pixels: Uint8ClampedArray, quality: GifExportSettings["quality"], hasTransparency: boolean) => {
  if (quality === "high" || (quality === "low" && !hasTransparency)) return;
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] < 128) continue;
    if (quality === "medium") {
      for (let channel = 0; channel < 3; channel++)
        pixels[index + channel] = Math.round(pixels[index + channel] * 7 / 255) * 255 / 7;
    }
    //透明色使用洋红色标记，避免不透明像素量化到同一个色值。
    if (hasTransparency && pixels[index] === 255 && pixels[index + 1] === 0 && pixels[index + 2] === 255)
      pixels[index + 2] = quality === "low" ? 128 : Math.round(6 * 255 / 7);
  }
};

interface EncodeCallbacks {
  /** 取消信号 */
  signal: AbortSignal;
  /** 进度回调 */
  onProgress: (progress: number) => void;
}

const encodeGif = async (source: GifSource, settings: GifExportSettings, callbacks: EncodeCallbacks) => {
  const frameCount = validateExport(source, settings);
  const quality = { low: 30, medium: 15, high: 5 }[settings.quality];
  const dither: "Atkinson" | "FloydSteinberg-serpentine" | false = source.hasTransparency
    ? false
    : settings.quality === "low" ? "Atkinson" : settings.quality === "high" ? "FloydSteinberg-serpentine" : false;
  //gif.js 的浏览器发行版包含实际的 GIF 类，Worker 文件通过 Vite 资源 URL 提供。
  const encoderOptions = {
    width: settings.width,
    height: settings.height,
    workers: Math.min(2, navigator.hardwareConcurrency || 2),
    workerScript: workerUrl,
    quality,
    dither,
    transparent: null,
    repeat: 0,
  };
  const encoder = new Gif(encoderOptions);
  const addFrame = (frame: HTMLCanvasElement | OffscreenCanvas, delay: number) => {
    const cropped = cropFrame(frame, settings);
    prepareFrameColors(cropped.data.data, settings.quality, cropped.hasTransparency);
    encoder.setOption("transparent", cropped.hasTransparency ? "0xff00ff" : null);
    encoder.addFrame(cropped.data, { delay });
  };
  const abort = () => encoder.abort();
  callbacks.signal.addEventListener("abort", abort, { once: true });
  try {
    const gifRenderer = source.kind === "gif" ? createGifFrameRenderer(source) : null;
    if (source.kind === "gif" && settings.frameRate === "original") {
      if (!gifRenderer) throw new Error("无法合成 GIF 帧。");
      const frames = source.frames ?? [];
      const firstIndex = frameIndexAt(source, settings.trimStart);
      for (let index = firstIndex; index < firstIndex + frameCount; index++) {
        if (callbacks.signal.aborted) throw new DOMException("已取消生成。", "AbortError");
        const frameStart = source.frameStarts?.[index] ?? 0;
        const overlap = Math.min(settings.trimEnd, frameStart + frameDelay(frames[index])) - Math.max(settings.trimStart, frameStart);
        addFrame(gifRenderer.renderTo(index), Math.max(20, Math.round(overlap * 1000 / 10) * 10));
        callbacks.onProgress(((index - firstIndex + 1) / frameCount) * 0.5);
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }
    } else {
      const rate = Number(settings.frameRate);
      for (let index = 0; index < frameCount; index++) {
        if (callbacks.signal.aborted) throw new DOMException("已取消生成。", "AbortError");
        const time = settings.trimStart + index / rate;
        const frame = gifRenderer ? gifRenderer.renderTo(frameIndexAt(source, time)) : await renderSourceFrame(source, time);
        const delay = Math.max(20, Math.round((Math.min(settings.trimEnd, time + 1 / rate) - time) * 1000 / 10) * 10);
        addFrame(frame, delay);
        callbacks.onProgress(((index + 1) / frameCount) * 0.5);
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }
    }
    if (callbacks.signal.aborted) throw new DOMException("已取消生成。", "AbortError");
    return await new Promise<Blob>((resolve, reject) => {
      encoder.on("progress", (progress) => callbacks.onProgress(0.5 + progress * 0.5));
      encoder.once("finished", (blob) => resolve(blob));
      encoder.once("abort", () => reject(new DOMException("已取消生成。", "AbortError")));
      encoder.render();
    });
  } finally {
    callbacks.signal.removeEventListener("abort", abort);
    if (encoder.running) encoder.abort();
    //库没有公开 Worker 清理方法，结束后释放它保留的空闲 Worker。
    const workers = (encoder as Gif & { freeWorkers: Worker[] }).freeWorkers;
    workers?.forEach((worker) => worker.terminate());
  }
};

export { encodeGif, frameIndexAt, loadGifSource, renderSourceFrame, validateExport };
