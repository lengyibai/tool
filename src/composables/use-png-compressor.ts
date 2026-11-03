import { sumBy } from "es-toolkit/math";
import { computed, ref, shallowRef } from "vue";

import { createZipBlob, downloadBlob } from "@/services/download";
import type { PngCompressionResult, PngWorkerResponse } from "@/types/png-compressor";
import { createUniqueName } from "@/utils/files";

const isPngFile = (file: File): boolean => file.type === "image/png" || /\.png$/i.test(file.name);

const compressInWorker = async (file: File): Promise<PngWorkerResponse> => {
  const buffer = await file.arrayBuffer();
  //每张图片单独使用 Worker，处理结束后释放解码和编码占用的内存。
  const worker = new Worker(new URL("../workers/png-compressor.worker.ts", import.meta.url), { type: "module" });
  try {
    return await new Promise<PngWorkerResponse>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<PngWorkerResponse>) => resolve(event.data);
      worker.onerror = () => reject(new Error("图片处理线程启动失败"));
      worker.postMessage({ buffer }, [buffer]);
    });
  } finally {
    worker.terminate();
  }
};

const toIndexedName = (fileName: string): string => {
  const baseName = fileName.replace(/\.png$/i, "") || "image";
  return `${baseName}-indexed.png`;
};

export const usePngCompressor = () => {
  /** 当前批次的处理结果 */
  const results = shallowRef<PngCompressionResult[]>([]);
  /** 是否正在压缩或打包 */
  const isBusy = ref(false);
  /** 已完成的文件数 */
  const completed = ref(0);
  /** 本批次的文件总数 */
  const total = ref(0);
  /** 正在处理的文件名 */
  const currentFile = ref("");
  /** 批量下载失败信息 */
  const downloadError = ref("");

  const compressedCount = computed(() => results.value.filter((result) => result.status === "compressed").length);
  const ineligibleCount = computed(() => results.value.filter((result) => result.status === "ineligible").length);
  const errorCount = computed(() => results.value.filter((result) => result.status === "error").length);
  const originalTotal = computed(() => sumBy(results.value, (result) => result.source.size));
  const outputTotal = computed(() => sumBy(results.value, (result) => result.output.size));
  const savedBytes = computed(() => originalTotal.value - outputTotal.value);
  const savedPercent = computed(() =>
    originalTotal.value ? Math.round((savedBytes.value / originalTotal.value) * 100) : 0,
  );

  const processFiles = async (input: FileList | File[]): Promise<void> => {
    if (isBusy.value) return;
    const files = Array.from(input);
    if (!files.length) return;

    isBusy.value = true;
    results.value = [];
    completed.value = 0;
    total.value = files.length;
    currentFile.value = "";
    downloadError.value = "";

    try {
      for (const [index, file] of files.entries()) {
        currentFile.value = file.name;
        let result: PngCompressionResult = {
          id: index + 1,
          source: file,
          output: file,
          outputName: file.name,
          status: "ineligible",
          message: "仅支持 PNG 文件",
        };

        if (isPngFile(file)) {
          try {
            const response = await compressInWorker(file);
            if (response.status === "compressed") {
              const compressed = new Blob([response.buffer], { type: "image/png" });
              const smaller = compressed.size < file.size;
              result = {
                ...result,
                output: smaller ? compressed : file,
                outputName: smaller ? toIndexedName(file.name) : file.name,
                status: smaller ? "compressed" : "unchanged",
                message: smaller
                  ? `${response.colorCount} 色 · ${response.bitDepth} 位索引色`
                  : "索引色文件未缩小，已保留原图",
                width: response.width,
                height: response.height,
                colorCount: response.colorCount,
                bitDepth: response.bitDepth,
              };
            } else {
              result = {
                ...result,
                status: response.status,
                message: response.reason,
                width: response.width,
                height: response.height,
                colorCount: response.colorCount,
              };
            }
          } catch (error) {
            result = {
              ...result,
              status: "error",
              message: error instanceof Error ? error.message : "PNG 压缩失败",
            };
          }
        }

        results.value = [...results.value, result];
        completed.value = index + 1;
      }
    } finally {
      currentFile.value = "";
      isBusy.value = false;
    }
  };

  const downloadResult = (result: PngCompressionResult): void => {
    if (!isBusy.value) downloadBlob(result.output, result.outputName);
  };

  const downloadAll = async (): Promise<void> => {
    if (isBusy.value || !results.value.length) return;
    downloadError.value = "";
    const names = new Set<string>();
    const files = results.value.map((result) => ({
      name: createUniqueName(result.outputName, names),
      blob: result.output,
    }));

    if (files.length === 1) {
      downloadBlob(files[0].blob, files[0].name);
      return;
    }

    isBusy.value = true;
    currentFile.value = "正在打包 ZIP";
    try {
      const zip = await createZipBlob(files);
      downloadBlob(zip, "PNG索引色压缩结果.zip");
    } catch (error) {
      downloadError.value = error instanceof Error ? error.message : "批量下载失败";
    } finally {
      currentFile.value = "";
      isBusy.value = false;
    }
  };

  return {
    results,
    isBusy,
    completed,
    total,
    currentFile,
    downloadError,
    compressedCount,
    ineligibleCount,
    errorCount,
    originalTotal,
    outputTotal,
    savedBytes,
    savedPercent,
    processFiles,
    downloadResult,
    downloadAll,
  };
};
