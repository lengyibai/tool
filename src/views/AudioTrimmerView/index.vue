<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  LuAudioLines,
  LuDownload,
  LuFolderOpen,
  LuPause,
  LuPlay,
  LuRepeat,
  LuRotateCcw,
  LuUpload,
  LuVolume2,
  LuZoomIn,
  LuZoomOut,
} from "vue-icons-plus/lu";

import AudioWaveform from "./components/AudioWaveform/index.vue";

import MediaToolHeader from "@/components/MediaToolHeader/index.vue";
import { useAudioTrimmer } from "@/composables/use-audio-trimmer";
import { isAudioFile, useFilePaste } from "@/composables/use-file-paste";
import { usePageScale } from "@/composables/use-page-scale";
import { formatFileSize } from "@/utils/media";

/** 原生文件选择控件 */
const fileInputRef = ref<HTMLInputElement>();
/** 拖入文件时的视觉状态 */
const isDragging = ref(false);
/** 波形横向放大倍数 */
const zoom = ref(1);

const { pageScale } = usePageScale();
const trimmer = useAudioTrimmer();
let dragDepth = 0;

useFilePaste(
  isAudioFile,
  () => !trimmer.isLoading.value,
  (files) => {
    void trimmer.loadFile(files[0]);
  },
);

const duration = computed(() => trimmer.buffer.value?.duration ?? 0);
const selectionDuration = computed(() => {
  const buffer = trimmer.buffer.value;
  return buffer ? (trimmer.selection.value.endFrame - trimmer.selection.value.startFrame) / buffer.sampleRate : 0;
});
const fileSize = computed(() => {
  const size = trimmer.file.value?.size ?? 0;
  return size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${(size / 1024).toFixed(1)} KB`;
});
const estimatedRmsDbfs = computed(() => trimmer.rmsDbfs.value + trimmer.gainDb.value);
const willClip = computed(() => trimmer.buffer.value && trimmer.peakDbfs.value + trimmer.gainDb.value > 0);
const estimatedExportSize = computed(() => {
  const buffer = trimmer.buffer.value;
  if (!buffer) return 0;
  const frames = trimmer.selection.value.endFrame - trimmer.selection.value.startFrame;
  return Math.ceil((frames / buffer.sampleRate) * trimmer.mp3Bitrate.value * 125);
});
const exportSizeLabel = computed(() => (trimmer.preparedExport.value ? "实际大小" : "预计大小（约）"));
const exportSize = computed(() => trimmer.preparedExport.value?.blob.size ?? estimatedExportSize.value);
const exportSizeText = computed(() => {
  return trimmer.buffer.value ? formatFileSize(exportSize.value) : "—";
});
const sizeDifference = computed(() => exportSize.value - (trimmer.file.value?.size ?? 0));
const sizeChangeLabel = computed(() => {
  const prefix = trimmer.preparedExport.value ? "" : "预计";
  if (sizeDifference.value === 0) return `${prefix}持平`;
  return `${prefix}${sizeDifference.value > 0 ? "增加" : "缩减"}`;
});
const sizeChangeText = computed(() => {
  const originalSize = trimmer.file.value?.size ?? 0;
  const percentage = originalSize ? (Math.abs(sizeDifference.value) / originalSize) * 100 : 0;
  return `${formatFileSize(Math.abs(sizeDifference.value))} · ${percentage.toFixed(1)}%`;
});

watch(trimmer.buffer, () => {
  zoom.value = 1;
});
const formatClock = (seconds: number) => {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

const formatDbfs = (value: number) => (Number.isFinite(value) ? `${value.toFixed(1)} dBFS` : "静音");
const formatGain = (value: number) => `${value > 0 ? "+" : ""}${value} dB`;
const zoomIn = () => {
  zoom.value = Math.min(8, zoom.value * 2);
};
const zoomOut = () => {
  zoom.value = Math.max(1, zoom.value / 2);
};
const handleZoomChange = (nextZoom: number) => {
  zoom.value = nextZoom;
};

const toggleLoop = () => {
  trimmer.setLoopEnabled(!trimmer.loopEnabled.value);
};

const handleGainInput = (event: Event) => {
  if (event.target instanceof HTMLInputElement) trimmer.setGainDb(Number(event.target.value));
};

const handleFadeOutChange = (event: Event) => {
  if (!(event.target instanceof HTMLInputElement)) return;
  trimmer.setFadeOutSeconds(Number(event.target.value));
  event.target.value = trimmer.fadeOutSeconds.value.toFixed(3);
};

const handleBitrateChange = (event: Event) => {
  if (event.target instanceof HTMLSelectElement) trimmer.setMp3Bitrate(Number(event.target.value));
};

const openFilePicker = () => fileInputRef.value?.click();

const handleFileChange = (event: Event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  const file = input.files?.[0];
  input.value = "";
  if (file) void trimmer.loadFile(file);
};

const containsFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");

const handleDragEnter = (event: DragEvent) => {
  if (!containsFiles(event)) return;
  event.preventDefault();
  dragDepth++;
  isDragging.value = true;
};

const handleDragOver = (event: DragEvent) => {
  if (!containsFiles(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
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
  const file = event.dataTransfer?.files[0];
  if (file) void trimmer.loadFile(file);
};
</script>

<template>
  <div class="app-viewport">
    <div class="app-shell" :style="{ zoom: pageScale }">
      <MediaToolHeader title="音频裁剪" subtitle="音频仅在本地处理，不会上传到服务器" github-label="查看 GitHub 仓库">
        <template #mark><LuAudioLines :size="26" aria-hidden="true" /></template>
      </MediaToolHeader>

      <div class="editor-grid">
        <div
          class="workspace-panel"
          :class="{ 'is-dragging': isDragging }"
          @dragenter="handleDragEnter"
          @dragover="handleDragOver"
          @dragleave="handleDragLeave"
          @drop="handleDrop"
        >
          <input
            ref="fileInputRef"
            class="file-input"
            type="file"
            accept="audio/*"
            aria-label="选择音频文件"
            @change="handleFileChange"
          />

          <div v-if="!trimmer.buffer.value" class="empty-state">
            <div class="upload-symbol"><LuUpload :size="34" aria-hidden="true" /></div>
            <span class="empty-title">{{ trimmer.isLoading.value ? "正在读取音频" : "拖放或粘贴导入音频" }}</span>
            <span class="empty-detail">支持当前浏览器可解码的音频格式</span>
            <button type="button" class="select-button" :disabled="trimmer.isLoading.value" @click="openFilePicker">
              <LuFolderOpen :size="18" aria-hidden="true" /><span>选择音频</span>
            </button>
          </div>

          <div v-else class="track-editor">
            <div class="track-heading">
              <div class="track-name">
                <span class="track-label">当前音频</span>
                <span class="file-name" :title="trimmer.file.value?.name">{{ trimmer.file.value?.name }}</span>
                <span class="file-meta"
                  >{{ fileSize }} · {{ trimmer.buffer.value.sampleRate.toLocaleString() }} Hz ·
                  {{ trimmer.buffer.value.numberOfChannels }} 声道</span
                >
              </div>
              <button type="button" class="replace-button" @click="openFilePicker">
                <LuFolderOpen :size="17" aria-hidden="true" /><span>更换文件</span>
              </button>
            </div>

            <div class="waveform-toolbar">
              <span>波形</span>
              <div class="zoom-controls">
                <button type="button" :disabled="zoom === 1" title="缩小波形" aria-label="缩小波形" @click="zoomOut">
                  <LuZoomOut :size="17" aria-hidden="true" />
                </button>
                <span>{{ zoom }}×</span>
                <button type="button" :disabled="zoom === 8" title="放大波形" aria-label="放大波形" @click="zoomIn">
                  <LuZoomIn :size="17" aria-hidden="true" />
                </button>
              </div>
            </div>
            <div class="waveform-frame">
              <AudioWaveform
                :peaks="trimmer.peaks.value"
                :frame-count="trimmer.buffer.value.length"
                :sample-rate="trimmer.buffer.value.sampleRate"
                :zoom="zoom"
                :selection="trimmer.selection.value"
                :playhead-frame="trimmer.playheadFrame.value"
                :is-playing="trimmer.isPlaying.value"
                @selection-change="trimmer.setSelection"
                @seek="trimmer.seekPlayback"
                @scrub-start="trimmer.beginScrub"
                @scrub-end="trimmer.endScrub"
                @zoom-change="handleZoomChange"
              />
            </div>
            <div class="track-footer">
              <span>总时长 {{ formatClock(duration) }}</span>
              <span>选区 {{ selectionDuration.toFixed(3) }} 秒</span>
            </div>
          </div>
        </div>

        <div class="controls-panel">
          <div class="panel-heading">
            <span class="panel-kicker">TRIM / AUDIO</span>
            <span class="panel-title">音频设置</span>
          </div>
          <label class="quality-row">
            <span>MP3 音质</span>
            <select :value="trimmer.mp3Bitrate.value" @change="handleBitrateChange">
              <option v-for="bitrate in trimmer.mp3Bitrates" :key="bitrate" :value="bitrate">{{ bitrate }} kbps</option>
            </select>
          </label>
          <div class="volume-panel">
            <div class="volume-heading"><LuVolume2 :size="18" aria-hidden="true" /><span>音量调整</span></div>
            <div class="level-row">
              <span>原音平均电平 (RMS)</span
              ><span>{{ trimmer.buffer.value ? formatDbfs(trimmer.rmsDbfs.value) : "—" }}</span>
            </div>
            <div class="level-row">
              <span>增益</span><span class="gain-value">{{ formatGain(trimmer.gainDb.value) }}</span>
            </div>
            <input
              type="range"
              min="-24"
              max="24"
              step="1"
              :value="trimmer.gainDb.value"
              :disabled="!trimmer.buffer.value"
              aria-label="音量增益"
              @input="handleGainInput"
            />
            <div class="gain-limits"><span>-24 dB</span><span>+24 dB</span></div>
            <div class="level-row">
              <span>调整后估值</span><span>{{ trimmer.buffer.value ? formatDbfs(estimatedRmsDbfs) : "—" }}</span>
            </div>
            <span v-if="willClip" class="clip-warning">当前增益可能造成峰值削波</span>
            <label class="fade-field">
              <span>淡出时长</span>
              <span class="input-wrap">
                <input
                  type="number"
                  min="0"
                  :max="selectionDuration"
                  step="0.001"
                  inputmode="decimal"
                  :value="trimmer.fadeOutSeconds.value"
                  :disabled="!trimmer.buffer.value"
                  @change="handleFadeOutChange"
                />
                <span>秒</span>
              </span>
            </label>
          </div>
          <div
            class="status-line"
            :class="{ 'is-error': trimmer.status.value.isError }"
            role="status"
            aria-live="polite"
          >
            {{ trimmer.status.value.message }}
          </div>
          <div class="export-area">
            <div class="size-row" :class="{ 'is-ready': trimmer.preparedExport.value }">
              <span>{{ exportSizeLabel }}</span>
              <span>{{ exportSizeText }}</span>
            </div>
            <div
              v-if="trimmer.file.value && trimmer.buffer.value"
              class="change-row"
              :class="{ 'is-larger': sizeDifference > 0 }"
            >
              <span>{{ sizeChangeLabel }}</span>
              <span>{{ sizeChangeText }}</span>
            </div>
            <button
              type="button"
              class="export-button"
              :disabled="!trimmer.buffer.value || trimmer.isExporting.value"
              @click="trimmer.downloadExport"
            >
              <LuDownload :size="19" aria-hidden="true" />
              <span>{{ trimmer.isExporting.value ? "正在生成…" : "下载文件" }}</span>
            </button>
          </div>
        </div>

        <div class="playback-panel">
          <div class="playback-actions">
            <button
              type="button"
              class="play-button"
              :disabled="!trimmer.buffer.value || trimmer.playPending.value"
              @click="trimmer.togglePlayback"
            >
              <LuPause v-if="trimmer.isPlaying.value" :size="18" aria-hidden="true" />
              <LuPlay v-else :size="18" aria-hidden="true" />
              <span>{{
                trimmer.isPlaying.value
                  ? "暂停"
                  : trimmer.playheadFrame.value !== null &&
                      trimmer.playheadFrame.value < trimmer.selection.value.endFrame
                    ? "继续播放"
                    : "播放选区"
              }}</span>
            </button>
            <button
              type="button"
              class="reset-button"
              :disabled="!trimmer.buffer.value"
              title="选择全部"
              aria-label="选择全部"
              @click="trimmer.selectAll"
            >
              <LuRotateCcw :size="18" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="loop-button"
              :disabled="!trimmer.buffer.value"
              :aria-pressed="trimmer.loopEnabled.value"
              title="循环播放选区"
              aria-label="循环播放选区"
              @click="toggleLoop"
            >
              <LuRepeat :size="18" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="less">
@import "./index.less";
</style>
