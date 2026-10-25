import { computed, onBeforeUnmount, ref } from "vue";

import {
  VideoCompressionCanceledError,
  checkVideoCompressionSupport,
  compressVideo,
} from "@/services/video-compression";
import type {
  CompressionProgress,
  VideoCompressionResult,
  VideoCompressionSettings,
  VideoCompressionTask,
} from "@/types/video-compressor";

interface UseVideoCompressorOptions {
  /** 是否启用真实压缩能力 */
  enabled: boolean;
}

const CONCURRENT_TASK_LIMIT = 3;

const createDefaultSettings = (): VideoCompressionSettings => ({
  resolution: "original",
  frameRate: "original",
  quality: "high",
});

const isSupportedVideoFile = (file: File): boolean => {
  const fileName = file.name.toLowerCase();
  if (fileName.endsWith(".mp4")) return !file.type || file.type === "video/mp4";
  if (fileName.endsWith(".mov")) return !file.type || file.type === "video/quicktime";
  return false;
};

const createOutputName = (fileName: string, usedNames: Set<string>): string => {
  const baseName = fileName.replace(/\.(mp4|mov)$/i, "");
  let outputName = `${baseName}-compressed.mp4`;
  let duplicateIndex = 2;

  while (usedNames.has(outputName.toLowerCase())) {
    outputName = `${baseName}-compressed-${duplicateIndex}.mp4`;
    duplicateIndex += 1;
  }

  usedNames.add(outputName.toLowerCase());
  return outputName;
};

/** @description 管理浏览器内的视频压缩队列 */
export const useVideoCompressor = ({ enabled }: UseVideoCompressorOptions) => {
  /** 当前压缩设置 */
  const settings = ref(createDefaultSettings());
  /** 真实压缩任务 */
  const tasks = ref<VideoCompressionTask[]>([]);
  /** 是否正在并发处理队列 */
  const isProcessing = ref(false);
  /** 浏览器能力是否仍在检测 */
  const compatibilityPending = ref(enabled);
  /** 浏览器兼容性错误 */
  const compatibilityError = ref("");
  const activeAbortControllers = new Map<number, AbortController>();
  const activeDownloadUrls = new Map<string, number>();
  let nextTaskId = 1;
  let activeWorkerCount = 0;

  const results = computed<VideoCompressionResult[]>(() =>
    tasks.value.map((task) => {
      const base = {
        id: task.id,
        sourceName: task.sourceName,
        originalSize: task.originalSize,
        duration: task.duration,
        sourceResolution: task.sourceResolution,
        sourceFrameRate: task.sourceFrameRate,
        outputResolution: task.outputResolution,
        quality: task.settings.quality,
        frameRate: task.settings.frameRate,
        thumbnailUrl: task.thumbnailUrl,
        compressionDuration: task.compressionDuration,
        canRecompress: task.state === "success" || (task.state === "error" && task.mediaDuration > 0),
      };

      if (task.state === "processing") return { ...base, state: task.state, progress: task.progress };
      if (task.state === "success") {
        return {
          ...base,
          state: task.state,
          outputName: task.outputName,
          compressedSize: task.compressedSize,
          savedPercentage: task.savedPercentage,
        };
      }
      if (task.state === "error") return { ...base, state: task.state, errorMessage: task.errorMessage };
      return { ...base, state: task.state };
    }),
  );

  const successCount = computed(() => tasks.value.filter((task) => task.state === "success").length);

  const progress = computed<CompressionProgress>(() => {
    const total = tasks.value.length;
    const completed = tasks.value.filter((task) => task.state === "success" || task.state === "error").length;
    const activeTasks = tasks.value.filter((task) => task.state === "processing");
    const stoppedCount = tasks.value.filter((task) => task.state === "stopped").length;
    const activeProgress = activeTasks.reduce((sum, task) => sum + task.progress / 100, 0);
    const percent = total ? Math.round(((completed + activeProgress) / total) * 100) : 0;

    if (!total) return { phase: "idle", completed: 0, total: 0, percent: 0, label: "", currentFile: "" };
    if (isProcessing.value && activeTasks.length) {
      const phase = activeTasks.some((task) => task.progress > 0) ? "compressing" : "preparing";
      return {
        phase,
        completed,
        total,
        percent,
        label: phase === "preparing" ? "正在准备视频" : "正在压缩视频",
        currentFile: activeTasks.length === 1 ? activeTasks[0].sourceName : `${activeTasks.length} 个视频正在同时处理`,
      };
    }
    if (stoppedCount) {
      return {
        phase: "stopped",
        completed,
        total,
        percent,
        label: "压缩已停止",
        currentFile: `${stoppedCount} 个视频已停止`,
      };
    }

    const hasError = tasks.value.some((task) => task.state === "error");
    return {
      phase: hasError ? "error" : "done",
      completed,
      total,
      percent: 100,
      label: hasError ? "部分视频处理失败" : "压缩完成",
      currentFile: hasError
        ? `${successCount.value} 个成功，${completed - successCount.value} 个失败`
        : `${completed} 个视频已处理完成`,
    };
  });

  const summaryText = computed(() => {
    if (!tasks.value.length) return "";
    const queuedCount = tasks.value.filter((task) => task.state === "queued").length;
    const processingCount = tasks.value.filter((task) => task.state === "processing").length;
    const stoppedCount = tasks.value.filter((task) => task.state === "stopped").length;
    const errorCount = tasks.value.filter((task) => task.state === "error").length;
    if (isProcessing.value) {
      return [
        processingCount ? `${processingCount} 个处理中` : "",
        queuedCount ? `${queuedCount} 个等待处理` : "",
        stoppedCount ? `${stoppedCount} 个已停止` : "",
      ]
        .filter(Boolean)
        .join("，");
    }
    if (stoppedCount) return `${stoppedCount} 个已停止`;
    if (errorCount) return `${successCount.value} 个成功，${errorCount} 个失败`;
    return `成功压缩 ${successCount.value} 个视频`;
  });

  const settingsLocked = computed(() => isProcessing.value);

  const createTask = (file: File, outputName: string): VideoCompressionTask => ({
    id: nextTaskId++,
    file,
    settings: { ...settings.value },
    state: "queued",
    progress: 0,
    compressionDuration: 0,
    sourceName: file.name,
    outputName,
    duration: "--:--",
    mediaDuration: 0,
    sourceResolution: "读取中",
    outputResolution: "",
    originalSize: file.size,
    compressedSize: 0,
    savedPercentage: 0,
    errorMessage: "",
  });

  const processTask = async (task: VideoCompressionTask): Promise<void> => {
    task.state = "processing";
    task.progress = 0;
    task.compressionDuration = 0;
    task.errorMessage = "";
    const controller = new AbortController();
    activeAbortControllers.set(task.id, controller);
    const compressionStartedAt = performance.now();
    const updateCompressionDuration = () => {
      task.compressionDuration = performance.now() - compressionStartedAt;
    };
    const durationTimer = window.setInterval(updateCompressionDuration, 200);

    try {
      const output = await compressVideo({
        file: task.file,
        settings: task.settings,
        signal: controller.signal,
        onMetadata: (metadata) => {
          if (controller.signal.aborted || task.state !== "processing") return;
          task.duration = metadata.duration;
          task.mediaDuration = metadata.mediaDuration;
          task.sourceResolution = metadata.sourceResolution;
          task.sourceFrameRate = metadata.sourceFrameRate;
          task.outputResolution = metadata.outputResolution;
        },
        onThumbnail: task.thumbnailUrl
          ? undefined
          : (thumbnail) => {
              if (controller.signal.aborted || task.state !== "processing") return;
              task.thumbnailUrl = URL.createObjectURL(thumbnail);
            },
        onProgress: (percent) => {
          if (controller.signal.aborted || task.state !== "processing") return;
          task.progress = percent;
        },
      });
      if (controller.signal.aborted || task.state !== "processing" || !tasks.value.includes(task)) return;
      task.outputBlob = output.blob;
      task.compressedSize = output.blob.size;
      task.savedPercentage = task.originalSize
        ? Math.round(((task.originalSize - task.compressedSize) / task.originalSize) * 100)
        : 0;
      task.progress = 100;
      task.state = "success";
    } catch (error) {
      if (error instanceof VideoCompressionCanceledError) {
        if (tasks.value.includes(task) && task.state === "processing") {
          task.state = "stopped";
          task.progress = 0;
          task.compressionDuration = 0;
        }
        return;
      }
      if (!tasks.value.includes(task) || task.state !== "processing") return;

      task.state = "error";
      task.errorMessage = error instanceof Error ? error.message : "视频压缩失败";
    } finally {
      window.clearInterval(durationTimer);
      if (task.state === "success" || task.state === "error") updateCompressionDuration();
      if (activeAbortControllers.get(task.id) === controller) activeAbortControllers.delete(task.id);
    }
  };

  const processWorker = async () => {
    while (true) {
      const nextTask = tasks.value.find((task) => task.state === "queued" && !activeAbortControllers.has(task.id));
      if (!nextTask) break;
      await processTask(nextTask);
    }
  };

  const processQueue = () => {
    const queuedCount = tasks.value.filter((task) => task.state === "queued").length;
    const availableWorkerCount = CONCURRENT_TASK_LIMIT - activeWorkerCount;
    const workerCount = Math.min(availableWorkerCount, queuedCount);
    if (workerCount <= 0) return;

    isProcessing.value = true;

    for (let index = 0; index < workerCount; index += 1) {
      activeWorkerCount += 1;
      void processWorker().finally(() => {
        activeWorkerCount -= 1;
        if (activeWorkerCount > 0) return;

        const hasQueuedTask = tasks.value.some((task) => task.state === "queued");
        if (hasQueuedTask) {
          isProcessing.value = false;
          processQueue();
          return;
        }

        isProcessing.value = false;
      });
    }
  };

  const addFiles = (files: File[]) => {
    if (!enabled || compatibilityPending.value || compatibilityError.value) return;

    const usedNames = new Set(tasks.value.map((task) => task.outputName.toLowerCase()));
    const newTasks = files.map((file) => {
      const task = createTask(file, createOutputName(file.name, usedNames));
      if (!isSupportedVideoFile(file)) {
        task.state = "error";
        task.sourceResolution = "未知";
        task.errorMessage = "仅支持 MP4、MOV 格式的视频";
      }
      return task;
    });
    tasks.value.push(...newTasks);
    if (newTasks.some((task) => task.state === "queued")) void processQueue();
  };

  const stopTask = (id: number) => {
    const task = tasks.value.find((item) => item.id === id);
    if (!task || (task.state !== "queued" && task.state !== "processing")) return;

    task.state = "stopped";
    task.progress = 0;
    task.compressionDuration = 0;
    activeAbortControllers.get(id)?.abort();
  };

  const startTask = (id: number) => {
    const task = tasks.value.find((item) => item.id === id);
    if (!task || task.state !== "stopped") return;

    task.settings = { ...settings.value };
    task.state = "queued";
    task.progress = 0;
    task.compressionDuration = 0;
    task.outputResolution = "";
    task.compressedSize = 0;
    task.savedPercentage = 0;
    task.outputBlob = undefined;
    task.errorMessage = "";
    if (!activeAbortControllers.has(id)) void processQueue();
  };

  const removeTask = (id: number) => {
    const taskIndex = tasks.value.findIndex((task) => task.id === id);
    if (taskIndex < 0) return;

    const task = tasks.value[taskIndex];
    activeAbortControllers.get(id)?.abort();
    activeDownloadUrls.forEach((taskId, url) => {
      if (taskId !== id) return;
      URL.revokeObjectURL(url);
      activeDownloadUrls.delete(url);
    });
    if (task.thumbnailUrl) URL.revokeObjectURL(task.thumbnailUrl);
    task.thumbnailUrl = undefined;
    task.outputBlob = undefined;
    tasks.value.splice(taskIndex, 1);
  };

  const triggerDownload = (task: VideoCompressionTask) => {
    if (task.state !== "success" || !task.outputBlob) return;

    const url = URL.createObjectURL(task.outputBlob);
    activeDownloadUrls.set(url, task.id);
    const link = document.createElement("a");
    link.href = url;
    link.download = task.outputName;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
      activeDownloadUrls.delete(url);
    }, 1000);
  };

  const downloadResult = (id: number) => {
    const task = tasks.value.find((item) => item.id === id);
    if (task) triggerDownload(task);
  };

  const downloadAll = () => {
    tasks.value.filter((task) => task.state === "success").forEach(triggerDownload);
  };

  const recompressResult = (id: number) => {
    if (!enabled || compatibilityPending.value || compatibilityError.value || isProcessing.value) {
      return;
    }

    const task = tasks.value.find((item) => item.id === id);
    if (!task || (task.state !== "success" && (task.state !== "error" || task.mediaDuration <= 0))) return;

    task.settings = { ...settings.value };
    task.state = "queued";
    task.progress = 0;
    task.compressionDuration = 0;
    task.outputResolution = "";
    task.compressedSize = 0;
    task.savedPercentage = 0;
    task.outputBlob = undefined;
    task.errorMessage = "";
    void processQueue();
  };

  if (enabled) {
    void checkVideoCompressionSupport().then((message) => {
      compatibilityError.value = message;
      compatibilityPending.value = false;
    });
  }

  onBeforeUnmount(() => {
    activeAbortControllers.forEach((controller) => controller.abort());
    activeAbortControllers.clear();
    activeDownloadUrls.forEach((_, url) => URL.revokeObjectURL(url));
    activeDownloadUrls.clear();
    tasks.value.forEach((task) => {
      if (task.thumbnailUrl) URL.revokeObjectURL(task.thumbnailUrl);
    });
  });

  return {
    settings,
    results,
    progress,
    summaryText,
    isProcessing,
    settingsLocked,
    compatibilityPending,
    compatibilityError,
    addFiles,
    stopTask,
    startTask,
    removeTask,
    downloadResult,
    downloadAll,
    recompressResult,
  };
};
