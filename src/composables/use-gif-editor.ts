import { computed, onUnmounted, ref, shallowRef, triggerRef } from "vue";

import { encodeGif, frameIndexAt, loadGifSource, renderSourceFrame, validateExport } from "@/services/gif-editor";
import type { GifCrop, GifExportSettings, GifQuality, GifSource } from "@/types/gif-editor";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const useGifEditor = () => {
  /** 当前媒体 */
  const source = shallowRef<GifSource | null>(null);
  /** 当前源画面 */
  const sourceFrame = shallowRef<HTMLCanvasElement | OffscreenCanvas | null>(null);
  /** 裁剪区域 */
  const crop = ref<GifCrop>({ x: 0, y: 0, width: 1, height: 1 });
  /** 播放位置 */
  const currentTime = ref(0);
  /** 选区开始时间 */
  const trimStart = ref(0);
  /** 选区结束时间 */
  const trimEnd = ref(0);
  /** 播放状态 */
  const isPlaying = ref(false);
  /** 文件读取状态 */
  const isLoading = ref(false);
  /** 文件生成状态 */
  const isGenerating = ref(false);
  /** 生成进度 */
  const progress = ref(0);
  /** 导出最长边 */
  const maxEdge = ref(0);
  /** GIF 质量 */
  const quality = ref<GifQuality>("low");
  /** 导出帧率 */
  const frameRate = ref<number | "original">(10);
  /** 固定导出帧率 */
  const fixedFrameRate = ref(10);
  /** 实际生成的 GIF */
  const previewBlob = shallowRef<Blob | null>(null);
  /** 预览地址 */
  const previewUrl = ref("");
  /** 操作反馈 */
  const status = ref({ message: "", isError: false });

  let loadId = 0;
  let renderId = 0;
  let generationId = 0;
  let generationController: AbortController | null = null;
  let playFrame = 0;
  let playStartedAt = 0;
  let playStartedFrom = 0;

  const maxEdgeLimit = computed(() => source.value ? Math.min(1024, Math.max(crop.value.width, crop.value.height)) : 0);
  const exportDimensions = computed(() => {
    if (!source.value) return { width: 0, height: 0 };
    const scale = maxEdge.value / Math.max(crop.value.width, crop.value.height);
    return {
      width: Math.max(1, Math.round(crop.value.width * scale)),
      height: Math.max(1, Math.round(crop.value.height * scale)),
    };
  });
  const originalFrameRate = computed(() => {
    const media = source.value;
    return media?.kind === "gif" ? (media.frames?.length ?? 0) / media.duration : 0;
  });
  const frameRateLimit = computed(() => source.value?.kind === "gif"
    ? Math.max(0.001, Math.min(30, Math.floor(originalFrameRate.value * 1000) / 1000))
    : 30);
  const selectedDuration = computed(() => Math.max(0, trimEnd.value - trimStart.value));
  const selectedOriginalFrameRate = computed(() => {
    const media = source.value;
    if (media?.kind !== "gif" || !selectedDuration.value) return 0;
    const count = frameIndexAt(media, Math.max(trimStart.value, trimEnd.value - 0.000001)) - frameIndexAt(media, trimStart.value) + 1;
    return count / selectedDuration.value;
  });
  const canPreserveOriginalTiming = computed(() => originalFrameRate.value <= 30 && selectedOriginalFrameRate.value <= 30);

  const setStatus = (message: string, isError = false) => {
    status.value = { message, isError };
  };

  const clearPreview = () => {
    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
    previewUrl.value = "";
    previewBlob.value = null;
  };

  const cancelGeneration = () => {
    generationId++;
    generationController?.abort();
    generationController = null;
    isGenerating.value = false;
    progress.value = 0;
    setStatus("已取消生成。");
  };

  const invalidateExport = () => {
    if (isGenerating.value) cancelGeneration();
    clearPreview();
    setStatus("");
  };

  const stopPlayback = () => {
    isPlaying.value = false;
    cancelAnimationFrame(playFrame);
  };

  const showFrame = async (time: number) => {
    const media = source.value;
    if (!media) return;
    const activeRender = ++renderId;
    try {
      const frame = await renderSourceFrame(media, clamp(time, 0, media.duration));
      if (activeRender === renderId && source.value === media) {
        const sameCanvas = sourceFrame.value === frame;
        sourceFrame.value = frame;
        if (sameCanvas) triggerRef(sourceFrame);
      }
    } catch {
      if (activeRender === renderId) setStatus("无法显示此位置的画面。", true);
    }
  };

  const seek = (time: number, fromPlayback = false) => {
    if (!source.value) return;
    currentTime.value = clamp(time, trimStart.value, trimEnd.value);
    if (isPlaying.value && !fromPlayback) {
      playStartedFrom = currentTime.value;
      playStartedAt = performance.now();
    }
    void showFrame(currentTime.value);
  };

  const tickPlayback = (timestamp: number) => {
    if (!isPlaying.value) return;
    const next = playStartedFrom + (timestamp - playStartedAt) / 1000;
    if (next >= trimEnd.value) {
      stopPlayback();
      seek(trimStart.value);
      return;
    }
    if (Math.abs(next - currentTime.value) >= 0.06) seek(next, true);
    playFrame = requestAnimationFrame(tickPlayback);
  };

  const togglePlayback = () => {
    if (!source.value) return;
    if (isPlaying.value) {
      stopPlayback();
      return;
    }
    if (currentTime.value >= trimEnd.value) seek(trimStart.value);
    playStartedFrom = currentTime.value;
    playStartedAt = performance.now();
    isPlaying.value = true;
    playFrame = requestAnimationFrame(tickPlayback);
  };

  const loadFile = async (file: File) => {
    const activeLoad = ++loadId;
    renderId++;
    stopPlayback();
    invalidateExport();
    source.value?.input?.dispose();
    source.value = null;
    sourceFrame.value = null;
    crop.value = { x: 0, y: 0, width: 1, height: 1 };
    currentTime.value = 0;
    trimStart.value = 0;
    trimEnd.value = 0;
    maxEdge.value = 0;
    quality.value = "low";
    frameRate.value = 10;
    fixedFrameRate.value = 10;
    isLoading.value = true;
    setStatus("正在读取文件…");
    try {
      const media = await loadGifSource(file);
      if (activeLoad !== loadId) {
        media.input?.dispose();
        return;
      }
      source.value = media;
      crop.value = { x: 0, y: 0, width: media.width, height: media.height };
      trimStart.value = 0;
      trimEnd.value = media.kind === "video" ? Math.min(30, media.duration) : media.duration;
      currentTime.value = 0;
      maxEdge.value = Math.min(320, maxEdgeLimit.value);
      quality.value = "low";
      frameRate.value = media.kind === "gif" && canPreserveOriginalTiming.value ? "original" : Math.min(10, frameRateLimit.value);
      fixedFrameRate.value = Math.min(10, frameRateLimit.value);
      await showFrame(0);
      setStatus("文件已载入，可以调整画面和导出参数。");
    } catch (error) {
      if (activeLoad === loadId) setStatus(error instanceof Error ? error.message : "无法读取这个文件。", true);
    } finally {
      if (activeLoad === loadId) isLoading.value = false;
    }
  };

  const setCrop = (nextCrop: GifCrop) => {
    const media = source.value;
    if (!media) return false;
    if (![nextCrop.x, nextCrop.y, nextCrop.width, nextCrop.height].every(Number.isFinite) || nextCrop.width < 1 || nextCrop.height < 1) {
      setStatus("请输入有效的裁剪位置和尺寸。", true);
      return false;
    }
    const x = clamp(Math.round(nextCrop.x), 0, media.width - 1);
    const y = clamp(Math.round(nextCrop.y), 0, media.height - 1);
    const width = clamp(Math.round(nextCrop.width), 1, media.width - x);
    const height = clamp(Math.round(nextCrop.height), 1, media.height - y);
    if (x === crop.value.x && y === crop.value.y && width === crop.value.width && height === crop.value.height) return true;
    invalidateExport();
    const previousEdge = maxEdge.value;
    crop.value = { x, y, width, height };
    maxEdge.value = Math.min(previousEdge, maxEdgeLimit.value);
    return true;
  };

  const setMaxEdge = (value: number) => {
    if (!source.value || !Number.isFinite(value)) return;
    const edge = clamp(Math.round(value), 1, maxEdgeLimit.value);
    if (edge === maxEdge.value) return;
    invalidateExport();
    maxEdge.value = edge;
  };

  const setQuality = (value: GifQuality) => {
    if (quality.value === value) return;
    invalidateExport();
    quality.value = value;
  };

  const setTrim = (start: number, end: number) => {
    const media = source.value;
    if (!media || !Number.isFinite(start) || !Number.isFinite(end)) return;
    const minDuration = Math.min(0.02, media.duration);
    if (start >= end || end - start < minDuration - 0.000001) return;
    if (start === trimStart.value && end === trimEnd.value) return;
    stopPlayback();
    renderId++;
    invalidateExport();
    trimStart.value = start;
    trimEnd.value = end;
    if (frameRate.value === "original" && !canPreserveOriginalTiming.value) frameRate.value = fixedFrameRate.value;
    currentTime.value = clamp(currentTime.value, start, end);
  };
  const setTrimStart = (value: number) => {
    const media = source.value;
    if (!media || !Number.isFinite(value)) return;
    const start = clamp(Math.round(value * 1000) / 1000, 0, trimEnd.value - Math.min(0.02, media.duration));
    setTrim(start, trimEnd.value);
  };
  const setTrimEnd = (value: number) => {
    const media = source.value;
    if (!media || !Number.isFinite(value)) return;
    const end = clamp(Math.round(value * 1000) / 1000, trimStart.value + Math.min(0.02, media.duration), media.duration);
    setTrim(trimStart.value, end);
  };

  const setFrameRate = (value: number | "original") => {
    if (value === "original" && (source.value?.kind !== "gif" || !canPreserveOriginalTiming.value)) return;
    if (value !== "original") {
      if (!Number.isFinite(value)) return;
      value = Math.min(Math.max(0.001, Math.round(value * 1000) / 1000), frameRateLimit.value);
    }
    if (frameRate.value === value) return;
    invalidateExport();
    frameRate.value = value;
    if (value !== "original") fixedFrameRate.value = value;
  };

  const settings = (): GifExportSettings => ({
    trimStart: trimStart.value,
    trimEnd: trimEnd.value,
    crop: crop.value,
    width: exportDimensions.value.width,
    height: exportDimensions.value.height,
    quality: quality.value,
    frameRate: frameRate.value,
  });

  const generatePreview = async () => {
    const media = source.value;
    if (!media || isGenerating.value) return;
    invalidateExport();
    const options = settings();
    try {
      validateExport(media, options);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "无法生成预览。", true);
      return;
    }
    const controller = new AbortController();
    const activeGeneration = ++generationId;
    generationController = controller;
    isGenerating.value = true;
    progress.value = 0;
    setStatus("正在生成 GIF 预览…");
    try {
      const blob = await encodeGif(media, options, {
        signal: controller.signal,
        onProgress: (value) => {
          if (activeGeneration === generationId) progress.value = Math.round(value * 100);
        },
      });
      if (activeGeneration !== generationId || controller.signal.aborted) return;
      previewBlob.value = blob;
      previewUrl.value = URL.createObjectURL(blob);
      setStatus("预览已生成，确认效果后可下载 GIF。");
    } catch (error) {
      if (activeGeneration !== generationId || controller.signal.aborted) return;
      setStatus(error instanceof Error ? error.message : "GIF 生成失败，请调整导出参数后重试。", true);
    } finally {
      if (activeGeneration === generationId) {
        isGenerating.value = false;
        generationController = null;
      }
    }
  };

  const downloadPreview = () => {
    if (!previewUrl.value || !source.value) return;
    const link = document.createElement("a");
    link.href = previewUrl.value;
    link.download = `${source.value.file.name.replace(/\.[^.]+$/, "") || "animation"}.gif`;
    link.click();
  };

  onUnmounted(() => {
    loadId++;
    renderId++;
    stopPlayback();
    cancelGeneration();
    clearPreview();
    source.value?.input?.dispose();
  });

  return {
    source,
    sourceFrame,
    crop,
    currentTime,
    trimStart,
    trimEnd,
    selectedDuration,
    isPlaying,
    isLoading,
    isGenerating,
    progress,
    maxEdge,
    maxEdgeLimit,
    quality,
    frameRate,
    fixedFrameRate,
    originalFrameRate,
    selectedOriginalFrameRate,
    canPreserveOriginalTiming,
    frameRateLimit,
    previewBlob,
    previewUrl,
    status,
    exportDimensions,
    loadFile,
    seek,
    togglePlayback,
    setCrop,
    setMaxEdge,
    setQuality,
    setTrimStart,
    setTrimEnd,
    setFrameRate,
    generatePreview,
    cancelGeneration,
    downloadPreview,
  };
};

export { useGifEditor };
