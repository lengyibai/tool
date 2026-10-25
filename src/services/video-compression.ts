import {
  BlobSource,
  BufferTarget,
  CanvasSink,
  Conversion,
  ConversionCanceledError,
  Input,
  MP4,
  Mp4OutputFormat,
  Output,
  Quality,
  QTFF,
  canEncodeVideo,
} from "mediabunny";
import type { ConversionAudioOptions, InputAudioTrack, InputVideoTrack, VideoSample } from "mediabunny";

import type { VideoCompressionQuality, VideoCompressionSettings, VideoOutputFrameRate } from "@/types/video-compressor";

interface VideoDimensions {
  /** 显示宽度 */
  width: number;
  /** 显示高度 */
  height: number;
}

interface VideoTransform extends VideoDimensions {
  /** 传给转换器的目标宽度 */
  targetWidth?: number;
  /** 传给转换器的目标高度 */
  targetHeight?: number;
}

type VideoQualityTier = "4k" | "2k" | "1080p" | "720p";

/** @description 视频元数据 */
export interface VideoCompressionMetadata {
  /** 视频时长文本 */
  duration: string;
  /** 视频精确时长，单位为秒 */
  mediaDuration: number;
  /** 原始分辨率文本 */
  sourceResolution: string;
  /** 源视频帧率，无法估算时为空 */
  sourceFrameRate?: number;
  /** 输出分辨率文本 */
  outputResolution: string;
}

/** @description 视频压缩结果 */
export interface VideoCompressionOutput extends VideoCompressionMetadata {
  /** 输出 MP4 数据 */
  blob: Blob;
}

interface CompressVideoOptions {
  /** 原始 MP4 或 MOV 文件 */
  file: File;
  /** 压缩设置 */
  settings: VideoCompressionSettings;
  /** 取消信号 */
  signal: AbortSignal;
  /** 元数据读取完成回调 */
  onMetadata: (metadata: VideoCompressionMetadata) => void;
  /** 首帧封面生成回调 */
  onThumbnail?: (thumbnail: Blob) => void;
  /** 压缩进度回调 */
  onProgress: (percent: number) => void;
}

/** @description 用户主动取消视频压缩 */
export class VideoCompressionCanceledError extends Error {
  constructor() {
    super("视频压缩已取消");
    this.name = "VideoCompressionCanceledError";
  }
}

const formatDuration = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";

  const totalSeconds = Math.round(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;
  const base = `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  return hours ? `${String(hours).padStart(2, "0")}:${base}` : base;
};

const roundToEven = (value: number): number => Math.max(2, Math.round(value / 2) * 2);

const resolveVideoTransform = (
  source: VideoDimensions,
  resolution: VideoCompressionSettings["resolution"],
): VideoTransform => {
  const shortEdgeLimit = resolution === "1080p" ? 1080 : resolution === "720p" ? 720 : null;
  const shortEdge = Math.min(source.width, source.height);
  if (!shortEdgeLimit || shortEdge <= shortEdgeLimit) return source;

  const scale = shortEdgeLimit / shortEdge;
  const width = roundToEven(source.width * scale);
  const height = roundToEven(source.height * scale);

  return source.width <= source.height
    ? { width, height, targetWidth: shortEdgeLimit }
    : { width, height, targetHeight: shortEdgeLimit };
};

const throwIfCanceled = (signal: AbortSignal) => {
  if (signal.aborted) throw new VideoCompressionCanceledError();
};

const automaticHardwareAcceleration: HardwareAcceleration = "no-preference";
const thumbnailWidth = 320;
const thumbnailHeight = 180;
const thumbnailQuality = 0.8;

const frameRateMap: Record<VideoOutputFrameRate, number | undefined> = {
  original: undefined,
  "30": 30,
  "60": 60,
};

//按最终输出分辨率和质量档位使用固定视频目标比特率，单位为 bits per second
const videoBitrateMap: Record<VideoQualityTier, Record<VideoCompressionQuality, number>> = {
  "4k": { low: 12_000_000, medium: 20_000_000, high: 30_000_000 },
  "2k": { low: 6_000_000, medium: 10_000_000, high: 16_000_000 },
  "1080p": { low: 3_000_000, medium: 6_000_000, high: 10_000_000 },
  "720p": { low: 1_500_000, medium: 3_000_000, high: 5_000_000 },
};

const resolveVideoQualityTier = ({ width, height }: VideoDimensions): VideoQualityTier => {
  const shortEdge = Math.min(width, height);
  if (shortEdge >= 2160) return "4k";
  if (shortEdge >= 1440) return "2k";
  if (shortEdge >= 1080) return "1080p";
  return "720p";
};

const describeDiscardedTrack = (reason: Conversion["discardedTracks"][number]["reason"]): string => {
  const reasonMap = {
    discarded_by_user: "视频轨道已被排除",
    max_track_count_reached: "MP4 容器无法容纳更多轨道",
    max_track_count_of_type_reached: "MP4 容器无法容纳此轨道",
    unknown_source_codec: "无法识别源视频或音频编码",
    undecodable_source_codec: "当前浏览器无法解码源视频或音频",
    no_encodable_target_codec: "当前浏览器无法编码视频或兼容音频",
  } as const;

  return reasonMap[reason];
};

const createAudioOptionsResolver =
  (format: Mp4OutputFormat) =>
  async (track: InputAudioTrack): Promise<ConversionAudioOptions> => {
    const codec = await track.getCodec();
    if (codec && format.getSupportedAudioCodecs().includes(codec)) return {};

    return {
      codec: "aac",
      quality: new Quality("medium"),
    };
  };

const canvasToThumbnailBlob = (canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Blob> => {
  if (canvas instanceof OffscreenCanvas) {
    return canvas.convertToBlob({ type: "image/webp", quality: thumbnailQuality });
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("无法生成视频封面"))),
      "image/webp",
      thumbnailQuality,
    );
  });
};

const createVideoThumbnail = async (videoTrack: InputVideoTrack): Promise<Blob | null> => {
  //将首个可显示画面缩放为列表使用的 16:9 封面
  const canvasSink = new CanvasSink(videoTrack, {
    width: thumbnailWidth,
    height: thumbnailHeight,
    fit: "cover",
  });
  const firstTimestamp = Math.max(0, await videoTrack.getFirstTimestamp());
  const wrappedCanvas = await canvasSink.getCanvas(firstTimestamp);
  return wrappedCanvas ? canvasToThumbnailBlob(wrappedCanvas.canvas) : null;
};

/** @description 检查当前浏览器是否具备基础兼容压缩能力 */
export const checkVideoCompressionSupport = async (): Promise<string> => {
  if (!("VideoEncoder" in globalThis) || !("VideoDecoder" in globalThis)) {
    return "当前浏览器不支持 WebCodecs，请使用最新版 Chrome 或 Edge";
  }

  try {
    const supported = await canEncodeVideo("avc", {
      width: 640,
      height: 360,
      bitrate: 500_000,
    });
    return supported ? "" : "当前设备不支持兼容编码";
  } catch {
    return "无法检测兼容编码能力，请使用最新版 Chrome 或 Edge";
  }
};

/** @description 将单个 MP4 或 MOV 视频压缩为兼容 MP4 */
export const compressVideo = async ({
  file,
  settings,
  signal,
  onMetadata,
  onThumbnail,
  onProgress,
}: CompressVideoOptions): Promise<VideoCompressionOutput> => {
  const input = new Input({
    source: new BlobSource(file),
    formats: [MP4, QTFF],
  });
  let conversion: Conversion | undefined;
  const handleAbort = () => {
    if (conversion) void conversion.cancel();
  };

  signal.addEventListener("abort", handleAbort, { once: true });

  try {
    throwIfCanceled(signal);
    if (!(await input.canRead())) throw new Error("文件不是有效的 MP4 或 MOV 视频");

    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) throw new Error("MP4 或 MOV 文件中没有可处理的视频轨道");
    if (!(await videoTrack.canDecode())) throw new Error("当前浏览器无法解码此视频");
    const isHdr = await videoTrack.hasHighDynamicRange();

    const [displayWidth, displayHeight, metadataDuration, primaryAudioTrack] = await Promise.all([
      videoTrack.getDisplayWidth(),
      videoTrack.getDisplayHeight(),
      input.getDurationFromMetadata([videoTrack]),
      input.getPrimaryAudioTrack(),
    ]);
    const duration = metadataDuration ?? (await videoTrack.computeDuration());
    const transform = resolveVideoTransform({ width: displayWidth, height: displayHeight }, settings.resolution);
    let sourceFrameRate: number | undefined;
    try {
      sourceFrameRate = (await videoTrack.computeFrameRateMetrics()).bestGuessFrameRate;
    } catch {
      sourceFrameRate = undefined;
    }
    const metadata: VideoCompressionMetadata = {
      duration: formatDuration(duration),
      mediaDuration: Number.isFinite(duration) && duration > 0 ? duration : 0,
      sourceResolution: `${Math.round(displayWidth)} × ${Math.round(displayHeight)}`,
      sourceFrameRate,
      outputResolution: `${transform.width} × ${transform.height}`,
    };
    onMetadata(metadata);
    throwIfCanceled(signal);

    if (onThumbnail) {
      try {
        const thumbnail = await createVideoThumbnail(videoTrack);
        throwIfCanceled(signal);
        if (thumbnail) onThumbnail(thumbnail);
      } catch (error) {
        throwIfCanceled(signal);
        console.warn("视频首帧封面生成失败，将使用默认图标", error);
      }
    }

    const qualityTier = resolveVideoQualityTier(transform);
    const bitrate = videoBitrateMap[qualityTier][settings.quality];
    const frameRate = frameRateMap[settings.frameRate];
    const canEncodeAvc = await canEncodeVideo("avc", {
      width: transform.width,
      height: transform.height,
      bitrate,
      hardwareAcceleration: automaticHardwareAcceleration,
    });
    if (!canEncodeAvc) throw new Error("当前设备不支持此分辨率的兼容编码");

    const format = new Mp4OutputFormat();
    const target = new BufferTarget();
    const output = new Output({ format, target });
    const toneMapHdrSample = (sample: VideoSample) => sample.transform({});
    const videoOptions = {
      codec: "avc" as const,
      bitrate,
      hardwareAcceleration: automaticHardwareAcceleration,
      forceTranscode: true,
      frameRate,
      width: transform.targetWidth,
      height: transform.targetHeight,
      //将目标帧率同步到编码能力探测，避免源视频帧率过高导致错误拒绝
      onEncoderConfig: frameRate
        ? (config: VideoEncoderConfig) => {
            config.framerate = frameRate;
          }
        : undefined,
      //HDR 视频先经过浏览器色彩映射，避免输出像素与色彩元数据不一致导致画面偏亮
      process: isHdr ? toneMapHdrSample : undefined,
    };
    conversion = await Conversion.init({
      input,
      output,
      tracks: "primary",
      video: videoOptions,
      audio: createAudioOptionsResolver(format),
    });
    throwIfCanceled(signal);

    const discardedPrimaryTrack = conversion.discardedTracks.find(
      ({ track }) => track === videoTrack || track === primaryAudioTrack,
    );
    if (!conversion.isValid || discardedPrimaryTrack) {
      const reason = discardedPrimaryTrack?.reason ?? conversion.discardedTracks[0]?.reason;
      throw new Error(reason ? describeDiscardedTrack(reason) : "当前视频无法转换为兼容 MP4");
    }

    conversion.onProgress = (progress) => onProgress(progress * 100);
    await conversion.execute();
    throwIfCanceled(signal);

    if (!target.buffer) throw new Error("浏览器未生成有效的 MP4 文件");
    return {
      ...metadata,
      blob: new Blob([target.buffer], { type: "video/mp4" }),
    };
  } catch (error) {
    if (signal.aborted || error instanceof ConversionCanceledError || error instanceof VideoCompressionCanceledError) {
      throw new VideoCompressionCanceledError();
    }
    if (error instanceof Error) throw error;
    throw new Error("视频压缩失败");
  } finally {
    signal.removeEventListener("abort", handleAbort);
    input.dispose();
  }
};
