import type {
  CompressionPreview,
  CompressionPreviewState,
  CompressionProgress,
  VideoCompressionResult,
} from "@/types/video-compressor";

const previewStates: CompressionPreviewState[] = ["idle", "processing", "complete", "error"];

const idleProgress: CompressionProgress = {
  phase: "idle",
  completed: 0,
  total: 0,
  percent: 0,
  label: "",
  currentFile: "",
};

const completedResults: VideoCompressionResult[] = [
  {
    id: 2,
    state: "success",
    sourceName: "产品演示-横版.mp4",
    outputName: "产品演示-横版-compressed.mp4",
    duration: "01:42",
    compressionDuration: 28_600,
    canRecompress: true,
    sourceResolution: "3840 × 2160",
    outputResolution: "1920 × 1080",
    quality: "medium",
    frameRate: "original",
    originalSize: 90_596_966,
    compressedSize: 33_344_307,
    savedPercentage: 63,
  },
  {
    id: 1,
    state: "success",
    sourceName: "访谈片段.mp4",
    outputName: "访谈片段-compressed.mp4",
    duration: "03:18",
    compressionDuration: 46_200,
    canRecompress: true,
    sourceResolution: "1920 × 1080",
    outputResolution: "1920 × 1080",
    quality: "low",
    frameRate: "30",
    originalSize: 136_839_168,
    compressedSize: 71_303_168,
    savedPercentage: 48,
  },
];

const processingResults: VideoCompressionResult[] = [
  {
    id: 3,
    state: "stopped",
    sourceName: "访谈片段.mp4",
    originalSize: 136_839_168,
    duration: "03:18",
    compressionDuration: 0,
    canRecompress: false,
    sourceResolution: "1920 × 1080",
    outputResolution: "1920 × 1080",
    quality: "medium",
    frameRate: "original",
  },
  {
    id: 2,
    state: "queued",
    sourceName: "旅行记录.mp4",
    originalSize: 54_525_952,
    duration: "02:27",
    compressionDuration: 0,
    canRecompress: false,
    sourceResolution: "1920 × 1080",
    outputResolution: "1920 × 1080",
    quality: "low",
    frameRate: "30",
  },
  {
    id: 1,
    state: "processing",
    sourceName: "产品演示-横版.mp4",
    originalSize: 90_596_966,
    duration: "01:42",
    compressionDuration: 12_400,
    canRecompress: true,
    sourceResolution: "3840 × 2160",
    outputResolution: "1920 × 1080",
    quality: "high",
    frameRate: "60",
    progress: 46,
  },
];

const errorResults: VideoCompressionResult[] = [
  {
    id: 2,
    state: "error",
    sourceName: "损坏的视频.mp4",
    originalSize: 12_582_912,
    duration: "--:--",
    compressionDuration: 1_800,
    canRecompress: false,
    sourceResolution: "未知",
    outputResolution: "",
    quality: "high",
    frameRate: "original",
    errorMessage: "当前浏览器无法读取此视频文件",
  },
  completedResults[1],
];

const previewMap: Record<CompressionPreviewState, CompressionPreview> = {
  idle: {
    results: [],
    progress: idleProgress,
    summaryText: "",
    isProcessing: false,
  },
  processing: {
    results: processingResults,
    progress: {
      phase: "compressing",
      completed: 0,
      total: 3,
      percent: 15,
      label: "正在压缩视频",
      currentFile: "产品演示-横版.mp4",
    },
    summaryText: "1 个处理中，1 个等待处理，1 个已停止",
    isProcessing: true,
  },
  complete: {
    results: completedResults,
    progress: {
      phase: "done",
      completed: 2,
      total: 2,
      percent: 100,
      label: "压缩完成",
      currentFile: "2 个视频已处理完成",
    },
    summaryText: "成功压缩 2 个视频",
    isProcessing: false,
  },
  error: {
    results: errorResults,
    progress: {
      phase: "error",
      completed: 2,
      total: 2,
      percent: 100,
      label: "部分视频处理失败",
      currentFile: "1 个成功，1 个失败",
    },
    summaryText: "1 个成功，1 个失败",
    isProcessing: false,
  },
};

const isPreviewState = (value: string | null): value is CompressionPreviewState =>
  previewStates.some((state) => state === value);

export const resolvePreviewState = (search: string, isDevelopment: boolean): CompressionPreviewState | null => {
  if (!isDevelopment) return null;

  const requestedState = new URLSearchParams(search).get("preview");
  return isPreviewState(requestedState) ? requestedState : null;
};

export const createCompressionPreview = (state: CompressionPreviewState): CompressionPreview => previewMap[state];
