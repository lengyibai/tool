export type CompressionPreviewState = "idle" | "processing" | "complete" | "error";

export type VideoOutputResolution = "original" | "1080p" | "720p";

export type VideoOutputFrameRate = "original" | "30" | "60";

export type VideoCompressionQuality = "low" | "medium" | "high";

export type CompressionProgressPhase = "idle" | "preparing" | "compressing" | "stopped" | "done" | "error";

export type VideoCompressionTaskState = "queued" | "processing" | "stopped" | "success" | "error";

/** @description 视频压缩界面设置 */
export interface VideoCompressionSettings {
  /** 输出分辨率 */
  resolution: VideoOutputResolution;
  /** 输出帧率 */
  frameRate: VideoOutputFrameRate;
  /** 压缩质量档位 */
  quality: VideoCompressionQuality;
}

/** @description 浏览器内的视频压缩任务 */
export interface VideoCompressionTask {
  /** 任务编号 */
  id: number;
  /** 原始文件 */
  file: File;
  /** 入队时的设置快照 */
  settings: VideoCompressionSettings;
  /** 当前任务状态 */
  state: VideoCompressionTaskState;
  /** 当前文件压缩进度 */
  progress: number;
  /** 当前压缩尝试耗时，单位为毫秒 */
  compressionDuration: number;
  /** 原始文件名 */
  sourceName: string;
  /** 输出文件名 */
  outputName: string;
  /** 视频时长文本 */
  duration: string;
  /** 视频精确时长，单位为秒 */
  mediaDuration: number;
  /** 首帧封面地址 */
  thumbnailUrl?: string;
  /** 原始分辨率文本 */
  sourceResolution: string;
  /** 源视频帧率，无法估算时为空 */
  sourceFrameRate?: number;
  /** 输出分辨率文本 */
  outputResolution: string;
  /** 原始文件体积 */
  originalSize: number;
  /** 压缩后文件体积 */
  compressedSize: number;
  /** 节省体积百分比，负数表示体积增加 */
  savedPercentage: number;
  /** 压缩完成后的 MP4 数据 */
  outputBlob?: Blob;
  /** 失败原因 */
  errorMessage: string;
}

/** @description 压缩进度 */
export interface CompressionProgress {
  /** 当前进度阶段 */
  phase: CompressionProgressPhase;
  /** 已完成任务数 */
  completed: number;
  /** 总任务数 */
  total: number;
  /** 当前百分比 */
  percent: number;
  /** 当前状态说明 */
  label: string;
  /** 当前处理文件名 */
  currentFile: string;
}

/** @description 视频压缩记录公共字段 */
interface VideoCompressionResultBase {
  /** 记录编号 */
  id: number;
  /** 原始文件名 */
  sourceName: string;
  /** 原始文件体积 */
  originalSize: number;
  /** 视频时长文本 */
  duration: string;
  /** 原始分辨率文本 */
  sourceResolution: string;
  /** 源视频帧率，无法估算时为空 */
  sourceFrameRate?: number;
  /** 输出分辨率文本 */
  outputResolution: string;
  /** 任务入队时保存的压缩质量 */
  quality: VideoCompressionQuality;
  /** 任务入队时保存的输出帧率 */
  frameRate: VideoOutputFrameRate;
  /** 首帧封面地址 */
  thumbnailUrl?: string;
  /** 当前压缩尝试耗时，单位为毫秒 */
  compressionDuration: number;
  /** 是否可以使用当前设置重新压缩 */
  canRecompress: boolean;
}

/** @description 等待压缩的视频记录 */
export interface VideoCompressionQueued extends VideoCompressionResultBase {
  /** 记录状态 */
  state: "queued";
}

/** @description 正在压缩的视频记录 */
export interface VideoCompressionProcessing extends VideoCompressionResultBase {
  /** 记录状态 */
  state: "processing";
  /** 当前文件压缩进度 */
  progress: number;
}

/** @description 已停止的视频记录 */
export interface VideoCompressionStopped extends VideoCompressionResultBase {
  /** 记录状态 */
  state: "stopped";
}

/** @description 压缩成功的视频记录 */
export interface VideoCompressionSuccess extends VideoCompressionResultBase {
  /** 记录状态 */
  state: "success";
  /** 输出文件名 */
  outputName: string;
  /** 压缩后文件体积 */
  compressedSize: number;
  /** 节省体积百分比 */
  savedPercentage: number;
}

/** @description 压缩失败的视频记录 */
export interface VideoCompressionFailure extends VideoCompressionResultBase {
  /** 记录状态 */
  state: "error";
  /** 失败原因 */
  errorMessage: string;
}

export type VideoCompressionResult =
  | VideoCompressionQueued
  | VideoCompressionProcessing
  | VideoCompressionStopped
  | VideoCompressionSuccess
  | VideoCompressionFailure;

/** @description 静态压缩界面预览数据 */
export interface CompressionPreview {
  /** 压缩记录 */
  results: VideoCompressionResult[];
  /** 总进度 */
  progress: CompressionProgress;
  /** 队列摘要 */
  summaryText: string;
  /** 是否处于处理状态 */
  isProcessing: boolean;
}
