<script setup lang="ts">
import { computed } from "vue";
import {
  LuAlertTriangle,
  LuArrowRight,
  LuCheck,
  LuClock3,
  LuDownload,
  LuFilm,
  LuLoader2,
  LuPlay,
  LuRefreshCw,
  LuSquare,
  LuTrash2,
} from "vue-icons-plus/lu";

import CompressionProgressPanel from "@/components/CompressionProgress/index.vue";
import type {
  CompressionProgress,
  VideoCompressionQuality,
  VideoCompressionResult,
  VideoOutputFrameRate,
} from "@/types/video-compressor";
import { formatFileSize } from "@/utils/media";

interface Props {
  /** 压缩记录 */
  results: VideoCompressionResult[];
  /** 总压缩进度 */
  progress: CompressionProgress;
  /** 队列摘要 */
  summaryText: string;
  /** 是否正在处理视频 */
  isProcessing: boolean;
}
const $props = defineProps<Props>();
const $emit = defineEmits<{
  stop: [id: number];
  "start-task": [id: number];
  remove: [id: number];
  download: [id: number];
  "download-all": [];
  recompress: [id: number];
}>();

const qualityLabelMap: Record<VideoCompressionQuality, string> = {
  low: "低",
  medium: "中",
  high: "高",
};

const frameRateLabelMap: Record<VideoOutputFrameRate, string> = {
  original: "原始",
  "30": "30 FPS",
  "60": "60 FPS",
};

const frameRateLabel = (result: VideoCompressionResult): string => {
  if (result.frameRate !== "original" || result.sourceFrameRate === undefined || !Number.isFinite(result.sourceFrameRate)) {
    return frameRateLabelMap[result.frameRate];
  }

  return `${Math.round(result.sourceFrameRate * 100) / 100} FPS`;
};

const frameRateValueMap: Record<VideoOutputFrameRate, number | undefined> = {
  original: undefined,
  "30": 30,
  "60": 60,
};

const cannotIncreaseFrameRate = (result: VideoCompressionResult): boolean => {
  const outputFrameRate = frameRateValueMap[result.frameRate];
  return (
    outputFrameRate !== undefined &&
    result.sourceFrameRate !== undefined &&
    outputFrameRate > result.sourceFrameRate
  );
};

const canDownloadAll = computed(
  () => !$props.isProcessing && $props.results.some((result) => result.state === "success"),
);

const formatCompressionDuration = (duration: number): string => {
  if (duration <= 0) return "";

  const seconds = duration / 1000;
  if (seconds < 60) return `耗时 ${seconds.toFixed(seconds < 10 ? 1 : 0)} 秒`;

  const roundedSeconds = Math.round(seconds);
  return `耗时 ${Math.floor(roundedSeconds / 60)}分 ${String(roundedSeconds % 60).padStart(2, "0")}秒`;
};
</script>

<template>
  <div class="queue" role="region" aria-labelledby="queue-title">
    <div class="section-heading">
      <div>
        <span id="queue-title" class="section-title">压缩队列</span>
        <span v-if="summaryText" class="section-description">{{ summaryText }}</span>
        <span v-else class="section-description">等待添加视频</span>
      </div>
      <div v-if="canDownloadAll" class="heading-actions">
        <button type="button" aria-label="下载全部视频" title="下载全部视频" @click="$emit('download-all')">
          <LuDownload :size="18" aria-hidden="true" />
        </button>
      </div>
    </div>

    <div v-if="!results.length" class="empty-state">
      <span class="empty-graphic" aria-hidden="true">
        <LuFilm :size="38" />
      </span>
      <span class="empty-title">还没有压缩任务</span>
      <span class="empty-description">选择视频后，任务会显示在这里</span>
    </div>

    <div v-else class="result-list" aria-live="polite">
      <div v-for="result in results" :key="result.id" class="result-item" :class="`is-${result.state}`">
        <span class="result-status" aria-hidden="true">
          <LuCheck v-if="result.state === 'success'" :size="17" />
          <LuLoader2 v-else-if="result.state === 'processing'" :size="18" />
          <LuSquare v-else-if="result.state === 'stopped'" :size="17" />
          <LuClock3 v-else-if="result.state === 'queued'" :size="17" />
          <LuAlertTriangle v-else :size="17" />
        </span>

        <span class="result-thumbnail" aria-hidden="true">
          <img v-if="result.thumbnailUrl" :src="result.thumbnailUrl" alt="" />
          <LuFilm v-else :size="25" />
          <span>{{ result.duration }}</span>
        </span>

        <div class="result-main">
          <span class="result-name" :title="result.sourceName">
            {{ result.sourceName }}
          </span>

          <span v-if="result.state === 'error'" class="result-detail error-detail">
            {{ result.errorMessage }}
          </span>
          <span v-else class="result-detail conversion-detail">
            <span class="dimension-detail">
              <span>{{ result.sourceResolution }}</span>
              <LuArrowRight
                v-if="result.outputResolution && result.sourceResolution !== result.outputResolution"
                :size="14"
                aria-hidden="true"
              />
              <span v-if="result.outputResolution && result.sourceResolution !== result.outputResolution">
                {{ result.outputResolution }}
              </span>
            </span>
            <span v-if="result.state === 'success' || result.state === 'processing'" class="detail-separator" aria-hidden="true">|</span>
            <span v-if="result.state === 'success' || result.state === 'processing'" class="size-detail">
              <template v-if="result.state === 'success'">
                <span>{{ formatFileSize(result.originalSize) }}</span>
                <LuArrowRight :size="14" aria-hidden="true" />
                <span>{{ formatFileSize(result.compressedSize) }}</span>
              </template>
              <template v-else>{{ formatFileSize(result.originalSize) }}</template>
            </span>
          </span>
          <span class="result-detail setting-detail">
            <span>质量：{{ qualityLabelMap[result.quality] }}</span>
            <span class="detail-separator" aria-hidden="true">|</span>
            <span v-if="!cannotIncreaseFrameRate(result)">
              帧率：{{ frameRateLabel(result) }}
            </span>
            <span v-else class="frame-rate-warning">无法提高帧率</span>
          </span>
        </div>

        <div class="result-actions">
          <div class="result-summary">
            <span v-if="result.compressionDuration > 0" class="compression-duration">
              <LuClock3 :size="14" aria-hidden="true" />
              {{ formatCompressionDuration(result.compressionDuration) }}
            </span>
            <span
              v-if="result.state === 'success'"
              class="result-saving"
              :class="{ 'is-increase': result.savedPercentage < 0 }"
            >
              {{ result.savedPercentage < 0 ? "增加" : "节省" }} {{ Math.abs(result.savedPercentage) }}%
            </span>
            <span v-else-if="result.state === 'processing'" class="result-progress">
              {{ Math.round(result.progress) }}%
            </span>
            <span v-else-if="result.state === 'queued'" class="result-waiting">等待</span>
            <span v-else-if="result.state === 'error'" class="result-error">失败</span>
          </div>
          <button
            v-if="result.state === 'queued' || result.state === 'processing'"
            class="is-danger"
            type="button"
            :aria-label="`停止 ${result.sourceName}`"
            :title="`停止 ${result.sourceName}`"
            @click="$emit('stop', result.id)"
          >
            <LuSquare :size="17" aria-hidden="true" />
          </button>
          <button
            v-if="result.state === 'stopped'"
            class="is-info"
            type="button"
            :aria-label="`开始 ${result.sourceName}`"
            :title="`从头开始压缩 ${result.sourceName}`"
            @click="$emit('start-task', result.id)"
          >
            <LuPlay :size="17" aria-hidden="true" />
          </button>
          <button
            v-if="result.canRecompress && !isProcessing"
            type="button"
            :aria-label="`重新压缩 ${result.sourceName}`"
            :title="`使用当前设置重新压缩 ${result.sourceName}`"
            @click="$emit('recompress', result.id)"
          >
            <LuRefreshCw :size="17" aria-hidden="true" />
          </button>
          <button
            v-if="result.state === 'success'"
            type="button"
            :aria-label="`下载 ${result.outputName}`"
            :title="`下载 ${result.outputName}`"
            @click="$emit('download', result.id)"
          >
            <LuDownload :size="17" aria-hidden="true" />
          </button>
          <button
            class="is-danger"
            type="button"
            :aria-label="`删除 ${result.sourceName}`"
            :title="`删除 ${result.sourceName}`"
            @click="$emit('remove', result.id)"
          >
            <LuTrash2 :size="17" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>

    <CompressionProgressPanel class="queue-progress" :progress />
  </div>
</template>

<style scoped lang="less">
@import url("./index.less");
</style>
