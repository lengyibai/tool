import { useStorage } from "@vueuse/core";
import { computed, onDeactivated, onUnmounted, ref, shallowRef } from "vue";

import { compressAudio, mp3Bitrates } from "@/services/audio-compressor";
import { createZipBlob, downloadBlob } from "@/services/download";
import type { AudioCompressionResult, AudioCompressionSuccess } from "@/types/audio-compressor";
import { toMp3Name } from "@/utils/files";

interface AudioCompressionProgress {
  /** 当前阶段 */
  phase: "idle" | "compressing" | "packaging" | "done";
  /** 已处理文件数 */
  completed: number;
  /** 本批文件总数 */
  total: number;
  /** 当前文件或操作说明 */
  currentFile: string;
  /** 进度百分比 */
  percent: number;
}

const initialProgress = (): AudioCompressionProgress => ({
  phase: "idle",
  completed: 0,
  total: 0,
  currentFile: "",
  percent: 0,
});

const useAudioCompressor = () => {
  /** 用户选择的目标 MP3 码率 */
  const targetBitrate = useStorage("audio-compress:bitrate", 128);
  if (!mp3Bitrates.some((bitrate) => bitrate === targetBitrate.value)) targetBitrate.value = 128;
  /** 本批压缩结果 */
  const results = shallowRef<AudioCompressionResult[]>([]);
  /** 重新压缩使用的原文件 */
  const sourceFiles = shallowRef<File[]>([]);
  /** 正在读取或压缩文件 */
  const isProcessing = ref(false);
  /** 正在准备批量下载 */
  const isPackaging = ref(false);
  /** 当前处理进度 */
  const progress = ref<AudioCompressionProgress>(initialProgress());
  /** 操作提示 */
  const notice = ref("");
  /** 当前结果使用的目标码率 */
  const conversionBitrate = ref(targetBitrate.value);
  let controller: AbortController | null = null;

  const isBusy = computed(() => isProcessing.value || isPackaging.value);
  const successes = computed(() =>
    results.value.filter((result): result is AudioCompressionSuccess => result.state === "success"),
  );
  const smallerResults = computed(() =>
    successes.value.filter((result) => result.compressedSize < result.originalSize),
  );
  const failureCount = computed(() => results.value.length - successes.value.length);
  const originalTotal = computed(() => successes.value.reduce((total, result) => total + result.originalSize, 0));
  const compressedTotal = computed(() => successes.value.reduce((total, result) => total + result.compressedSize, 0));
  const sizeDifference = computed(() => Math.abs(originalTotal.value - compressedTotal.value));
  const changePercent = computed(() =>
    originalTotal.value ? Math.round((sizeDifference.value / originalTotal.value) * 100) : 0,
  );

  const setTargetBitrate = (value: number) => {
    if (mp3Bitrates.some((bitrate) => bitrate === value)) targetBitrate.value = value;
  };

  const processFiles = async (fileList: FileList | File[]) => {
    if (isBusy.value) return;
    const files = Array.from(fileList);
    if (!files.length) return;
    sourceFiles.value = files;
    results.value = [];
    notice.value = "";
    conversionBitrate.value = targetBitrate.value;
    controller = new AbortController();
    const signal = controller.signal;
    isProcessing.value = true;
    progress.value = { phase: "compressing", completed: 0, total: files.length, currentFile: "", percent: 0 };

    //逐个解码和编码，避免同时持有多份未压缩音频缓冲区。
    for (const [index, file] of files.entries()) {
      if (signal.aborted) break;
      progress.value = { ...progress.value, currentFile: file.name };
      try {
        const compressed = await compressAudio(file, conversionBitrate.value, signal);
        if (signal.aborted) break;
        results.value = [
          {
            id: index,
            state: "success",
            sourceName: file.name,
            outputName: toMp3Name(file.name),
            originalSize: file.size,
            compressedSize: compressed.blob.size,
            ...compressed,
          },
          ...results.value,
        ];
      } catch (error) {
        if (signal.aborted) break;
        results.value = [
          {
            id: index,
            state: "error",
            sourceName: file.name,
            errorMessage: error instanceof Error ? error.message : "音频压缩失败。",
          },
          ...results.value,
        ];
      }
      progress.value = {
        ...progress.value,
        completed: index + 1,
        percent: ((index + 1) / files.length) * 100,
      };
    }

    isProcessing.value = false;
    controller = null;
    progress.value = {
      ...progress.value,
      phase: "done",
      currentFile: signal.aborted ? "处理已停止" : "处理完成，请确认结果后下载",
    };
    notice.value = signal.aborted
      ? "处理已停止，已完成的文件仍可下载。"
      : `成功 ${successes.value.length} 个，失败 ${failureCount.value} 个。`;
  };

  const recompress = async () => {
    if (sourceFiles.value.length) await processFiles(sourceFiles.value);
  };

  const downloadResult = (result: AudioCompressionSuccess) => {
    if (!isBusy.value) downloadBlob(result.blob, result.outputName);
  };

  const downloadBatch = async (files: AudioCompressionSuccess[], label: string) => {
    if (isBusy.value || !files.length) return;
    if (files.length === 1) {
      downloadResult(files[0]);
      return;
    }
    isPackaging.value = true;
    progress.value = {
      phase: "packaging",
      completed: files.length,
      total: files.length,
      currentFile: "正在准备 ZIP 文件",
      percent: 0,
    };
    try {
      //同名输出分别放入编号目录，避免 ZIP 覆盖文件，同时保留原文件主名。
      const nameCounts = new Map<string, number>();
      for (const file of files) {
        const key = file.outputName.toLocaleLowerCase();
        nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
      }
      const zip = await createZipBlob(
        files.map((file) => ({
          name:
            (nameCounts.get(file.outputName.toLocaleLowerCase()) ?? 0) > 1
              ? `${file.id + 1}/${file.outputName}`
              : file.outputName,
          blob: file.blob,
        })),
        (percent) => {
          progress.value = { ...progress.value, percent };
        },
      );
      downloadBlob(zip, `音频压缩-${label}-${conversionBitrate.value}kbps.zip`);
      notice.value = "下载已开始。";
    } catch {
      notice.value = "无法生成批量下载文件，请尝试逐项下载。";
    } finally {
      isPackaging.value = false;
      progress.value = { ...progress.value, phase: "done", percent: 100, currentFile: notice.value };
    }
  };

  const downloadSmaller = () => downloadBatch(smallerResults.value, "已压缩");
  const downloadAll = () => downloadBatch(successes.value, "全部");

  onDeactivated(() => controller?.abort());
  onUnmounted(() => controller?.abort());

  return {
    targetBitrate,
    results,
    sourceFiles,
    isProcessing,
    isBusy,
    progress,
    notice,
    successes,
    smallerResults,
    failureCount,
    originalTotal,
    compressedTotal,
    sizeDifference,
    changePercent,
    setTargetBitrate,
    processFiles,
    recompress,
    downloadResult,
    downloadSmaller,
    downloadAll,
    mp3Bitrates,
  };
};

export { useAudioCompressor };
