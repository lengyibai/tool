<script setup lang="ts">
import { ref } from "vue";
import {
  LuAlertTriangle,
  LuArrowRight,
  LuCheck,
  LuDownload,
  LuFileAudio,
  LuRotateCcw,
  LuUpload,
} from "vue-icons-plus/lu";

import MediaToolHeader from "@/components/MediaToolHeader/index.vue";
import { useAudioCompressor } from "@/composables/use-audio-compressor";
import { isAudioFile, useFilePaste } from "@/composables/use-file-paste";
import { usePageScale } from "@/composables/use-page-scale";
import { formatFileSize, getSizeChange } from "@/utils/files";

/** 文件选择控件 */
const fileInputRef = ref<HTMLInputElement>();
/** 文件拖入状态 */
const isDragging = ref(false);

const { pageScale } = usePageScale();
const compressor = useAudioCompressor();
let dragDepth = 0;

useFilePaste(
  isAudioFile,
  () => !compressor.isBusy.value,
  (files) => {
    void compressor.processFiles(files);
  },
);

const formatDuration = (seconds: number) => {
  const wholeSeconds = Math.round(seconds);
  return `${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, "0")}`;
};

const formatChangeLabel = (originalSize: number, compressedSize: number) =>
  compressedSize === originalSize ? "持平" : compressedSize > originalSize ? "增大" : "节省";

const handleBitrateChange = (event: Event) => {
  if (event.target instanceof HTMLSelectElement) compressor.setTargetBitrate(Number(event.target.value));
};

const openFilePicker = () => {
  if (!compressor.isBusy.value) fileInputRef.value?.click();
};

const handleFileChange = (event: Event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  const files = Array.from(input.files ?? []);
  input.value = "";
  if (files.length) void compressor.processFiles(files);
};

const containsFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");

const handleDragEnter = (event: DragEvent) => {
  if (!containsFiles(event) || compressor.isBusy.value) return;
  event.preventDefault();
  dragDepth++;
  isDragging.value = true;
};

const handleDragOver = (event: DragEvent) => {
  if (!containsFiles(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = compressor.isBusy.value ? "none" : "copy";
};

const handleDragLeave = () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) isDragging.value = false;
};

const handleDrop = (event: DragEvent) => {
  if (!containsFiles(event)) return;
  event.preventDefault();
  dragDepth = 0;
  isDragging.value = false;
  if (!compressor.isBusy.value && event.dataTransfer?.files.length)
    void compressor.processFiles(event.dataTransfer.files);
};
</script>

<template>
  <div class="app-viewport">
    <div class="app-shell" :style="{ zoom: pageScale }">
      <MediaToolHeader title="音频压缩" subtitle="本地批量处理，音频不会上传到服务器" github-label="查看 GitHub 仓库">
        <template #mark><LuFileAudio :size="25" aria-hidden="true" /></template>
      </MediaToolHeader>

      <div class="content-grid">
        <div class="primary-column">
          <div class="workspace-panel" role="region" aria-label="音频压缩工作区">
            <div class="control-bar">
              <span class="section-title">输出设置</span>
              <label class="bitrate-field">
                <span>MP3 码率</span>
                <select
                  :value="compressor.targetBitrate.value"
                  :disabled="compressor.isBusy.value"
                  @change="handleBitrateChange"
                >
                  <option v-for="bitrate in compressor.mp3Bitrates" :key="bitrate" :value="bitrate">
                    {{ bitrate }} kbps
                  </option>
                </select>
              </label>
            </div>

            <div
              class="drop-zone"
              :class="{ 'is-dragging': isDragging, 'is-busy': compressor.isBusy.value }"
              role="button"
              :tabindex="compressor.isBusy.value ? -1 : 0"
              :aria-disabled="compressor.isBusy.value"
              @click="openFilePicker"
              @keydown.enter.prevent="openFilePicker"
              @keydown.space.prevent="openFilePicker"
              @dragenter="handleDragEnter"
              @dragover="handleDragOver"
              @dragleave="handleDragLeave"
              @drop="handleDrop"
            >
              <input
                ref="fileInputRef"
                class="visually-hidden"
                type="file"
                accept="audio/*"
                multiple
                :disabled="compressor.isBusy.value"
                aria-label="选择音频文件"
                @click.stop
                @change="handleFileChange"
              />
              <LuUpload class-name="upload-icon" :size="58" aria-hidden="true" />
              <span class="drop-title">拖放或粘贴导入音频</span>
              <span class="drop-subtitle">或从设备中选择，可一次处理多个文件</span>
              <span class="select-button">选择音频</span>
            </div>
          </div>

          <div class="totals-panel" role="region" aria-label="体积总计">
            <div class="totals-heading">
              <div>
                <span class="section-title">体积总计</span>
                <span v-if="compressor.successes.value.length" class="section-subtitle">
                  已统计 {{ compressor.successes.value.length }} 个成功文件
                </span>
              </div>
              <span
                v-if="compressor.successes.value.length"
                class="change-badge"
                :class="{ 'is-larger': compressor.compressedTotal.value > compressor.originalTotal.value }"
              >
                {{ compressor.compressedTotal.value > compressor.originalTotal.value ? "增加" : "节省" }}
                {{ compressor.changePercent.value }}%
              </span>
            </div>
            <div class="total-metrics">
              <div class="metric">
                <span>压缩前</span
                ><span class="metric-value">{{ formatFileSize(compressor.originalTotal.value) }}</span>
              </div>
              <LuArrowRight :size="20" aria-hidden="true" />
              <div class="metric is-after">
                <span>压缩后</span
                ><span class="metric-value">{{ formatFileSize(compressor.compressedTotal.value) }}</span>
              </div>
            </div>
            <div
              class="total-difference"
              :class="{ 'is-larger': compressor.compressedTotal.value > compressor.originalTotal.value }"
            >
              <span>{{
                compressor.compressedTotal.value > compressor.originalTotal.value ? "累计增加" : "累计节省"
              }}</span>
              <span>{{ formatFileSize(compressor.sizeDifference.value) }}</span>
            </div>
          </div>
        </div>

        <div class="results-column">
          <div class="results-panel" role="region" aria-label="压缩记录">
            <div class="results-heading">
              <div>
                <span class="section-title">压缩记录</span>
                <span v-if="compressor.results.value.length" class="section-subtitle">
                  成功 {{ compressor.successes.value.length }} 个，失败 {{ compressor.failureCount.value }} 个
                </span>
              </div>
              <div class="result-actions">
                <button
                  type="button"
                  :disabled="compressor.isBusy.value || !compressor.sourceFiles.value.length"
                  @click="compressor.recompress"
                >
                  <LuRotateCcw :size="16" aria-hidden="true" /><span>重新压缩</span>
                </button>
                <button
                  type="button"
                  :disabled="compressor.isBusy.value || !compressor.smallerResults.value.length"
                  @click="compressor.downloadSmaller"
                >
                  <LuDownload :size="16" aria-hidden="true" /><span
                    >下载已压缩 ({{ compressor.smallerResults.value.length }})</span
                  >
                </button>
                <button
                  type="button"
                  :disabled="compressor.isBusy.value || !compressor.successes.value.length"
                  @click="compressor.downloadAll"
                >
                  <LuDownload :size="16" aria-hidden="true" /><span
                    >下载全部 ({{ compressor.successes.value.length }})</span
                  >
                </button>
              </div>
            </div>

            <div v-if="!compressor.results.value.length" class="empty-results">
              <LuFileAudio :size="46" aria-hidden="true" />
              <span>还没有压缩记录</span>
            </div>
            <div v-else class="result-list" aria-live="polite">
              <div
                v-for="result in compressor.results.value"
                :key="result.id"
                class="result-item"
                :class="{
                  'is-error': result.state === 'error',
                  'is-larger': result.state === 'success' && result.compressedSize > result.originalSize,
                }"
              >
                <span class="result-icon">
                  <LuCheck v-if="result.state === 'success'" :size="18" aria-hidden="true" />
                  <LuAlertTriangle v-else :size="18" aria-hidden="true" />
                </span>
                <div class="result-main">
                  <span class="result-name" :title="result.sourceName">{{ result.sourceName }}</span>
                  <template v-if="result.state === 'success'">
                    <span class="result-meta"
                      >{{ result.sourceBitrate.toFixed(1) }} → {{ result.outputBitrate }} kbps ·
                      {{ formatDuration(result.duration) }}</span
                    >
                    <span class="result-size"
                      >{{ formatFileSize(result.originalSize) }} <LuArrowRight :size="14" aria-hidden="true" />
                      {{ formatFileSize(result.compressedSize) }}</span
                    >
                  </template>
                  <span v-else class="result-error">{{ result.errorMessage }}</span>
                </div>
                <div v-if="result.state === 'success'" class="item-actions">
                  <span class="size-change">{{
                    `${formatChangeLabel(result.originalSize, result.compressedSize)} ${getSizeChange(result.originalSize, result.compressedSize).percentage}`
                  }}</span>
                  <button
                    type="button"
                    :disabled="compressor.isBusy.value"
                    :aria-label="`下载 ${result.outputName}`"
                    @click="compressor.downloadResult(result)"
                  >
                    <LuDownload :size="17" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>

            <div
              v-if="compressor.progress.value.phase !== 'idle'"
              class="progress-panel"
              role="status"
              aria-live="polite"
            >
              <div class="progress-copy">
                <span>{{
                  compressor.progress.value.phase === "packaging"
                    ? "正在打包 ZIP"
                    : compressor.isProcessing.value
                      ? "正在压缩音频"
                      : "处理完成"
                }}</span>
                <span>{{ compressor.progress.value.completed }} / {{ compressor.progress.value.total }}</span>
              </div>
              <div
                class="progress-track"
                role="progressbar"
                aria-label="压缩进度"
                aria-valuemin="0"
                aria-valuemax="100"
                :aria-valuenow="Math.round(compressor.progress.value.percent)"
              >
                <span :style="{ width: `${compressor.progress.value.percent}%` }"></span>
              </div>
              <span class="current-file" :title="compressor.progress.value.currentFile">{{
                compressor.progress.value.currentFile
              }}</span>
            </div>
            <span v-if="compressor.notice.value" class="status-line" role="status">{{ compressor.notice.value }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="less">
@import "./index.less";
</style>
