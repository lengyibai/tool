<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  LuCrop,
  LuDownload,
  LuEye,
  LuFilm,
  LuFolderOpen,
  LuPause,
  LuPlay,
  LuRotateCcw,
  LuScissors,
  LuUpload,
  LuX,
} from "vue-icons-plus/lu";

import MediaToolHeader from "@/components/MediaToolHeader/index.vue";
import { useGifEditor } from "@/composables/use-gif-editor";
import { usePageScale } from "@/composables/use-page-scale";
import type { GifCrop, GifQuality } from "@/types/gif-editor";
import { formatFileSize } from "@/utils/media";

type DragMode = "move" | "nw" | "ne" | "sw" | "se";
const cropCorners = ["nw", "ne", "sw", "se"] as const;
const qualityOptions: { value: GifQuality; label: string }[] = [
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
];

/** 文件选择控件 */
const fileInputRef = ref<HTMLInputElement>();
/** 源画面画布 */
const canvasRef = ref<HTMLCanvasElement>();
/** 裁剪画面容器 */
const stageRef = ref<HTMLElement>();
/** 拖入文件状态 */
const isDragging = ref(false);

const { pageScale } = usePageScale();
const editor = useGifEditor();
let dragDepth = 0;
let cropDrag: { mode: DragMode; x: number; y: number; initial: GifCrop } | null = null;

const cropStyle = computed(() => {
  const media = editor.source.value;
  if (!media) return {};
  const crop = editor.crop.value;
  return {
    left: `${(crop.x / media.width) * 100}%`,
    top: `${(crop.y / media.height) * 100}%`,
    width: `${(crop.width / media.width) * 100}%`,
    height: `${(crop.height / media.height) * 100}%`,
  };
});
const stageStyle = computed(() => {
  const media = editor.source.value;
  return media ? {
    aspectRatio: `${media.width} / ${media.height}`,
    maxWidth: `${Math.min(720, 300 * media.width / media.height)}px`,
  } : {};
});
const sourceLabel = computed(() => {
  const media = editor.source.value;
  return media ? `${media.width} × ${media.height} · ${formatFileSize(media.file.size)} · ${formatTime(media.duration)}` : "";
});
const trimSelectionStyle = computed(() => {
  const duration = editor.source.value?.duration;
  return duration ? {
    left: `${(editor.trimStart.value / duration) * 100}%`,
    width: `${(editor.selectedDuration.value / duration) * 100}%`,
  } : {};
});
const trimPlayheadStyle = computed(() => ({
  left: `${(editor.currentTime.value / (editor.source.value?.duration || 1)) * 100}%`,
}));

watch(editor.sourceFrame, (frame) => {
  const canvas = canvasRef.value;
  const media = editor.source.value;
  if (!frame || !canvas || !media) return;
  canvas.width = media.width;
  canvas.height = media.height;
  canvas.getContext("2d")?.drawImage(frame, 0, 0, media.width, media.height);
}, { flush: "post" });

const formatTime = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${(seconds % 60).toFixed(2).padStart(5, "0")}`;
};

const openFilePicker = () => fileInputRef.value?.click();
const handleFileChange = (event: Event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  const file = input.files?.[0];
  input.value = "";
  if (file) void editor.loadFile(file);
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
  if (file) void editor.loadFile(file);
};

const pointerToSource = (event: PointerEvent) => {
  const rect = stageRef.value?.getBoundingClientRect();
  const media = editor.source.value;
  if (!rect || !media) return { x: 0, y: 0 };
  return {
    x: ((event.clientX - rect.left) / rect.width) * media.width,
    y: ((event.clientY - rect.top) / rect.height) * media.height,
  };
};
const startCropDrag = (event: PointerEvent, mode: DragMode) => {
  if (!editor.source.value) return;
  event.preventDefault();
  const point = pointerToSource(event);
  cropDrag = { mode, x: point.x, y: point.y, initial: { ...editor.crop.value } };
  stageRef.value?.setPointerCapture(event.pointerId);
};
const moveCropDrag = (event: PointerEvent) => {
  if (!cropDrag || !editor.source.value) return;
  const point = pointerToSource(event);
  const dx = Math.round(point.x - cropDrag.x);
  const dy = Math.round(point.y - cropDrag.y);
  const { initial, mode } = cropDrag;
  if (mode === "move") {
    editor.setCrop({
      ...initial,
      x: Math.max(0, Math.min(editor.source.value.width - initial.width, initial.x + dx)),
      y: Math.max(0, Math.min(editor.source.value.height - initial.height, initial.y + dy)),
    });
    return;
  }
  let left = initial.x;
  let top = initial.y;
  let right = initial.x + initial.width;
  let bottom = initial.y + initial.height;
  if (mode.includes("w")) left = Math.max(0, Math.min(right - 1, left + dx));
  if (mode.includes("e")) right = Math.min(editor.source.value.width, Math.max(left + 1, right + dx));
  if (mode.includes("n")) top = Math.max(0, Math.min(bottom - 1, top + dy));
  if (mode.includes("s")) bottom = Math.min(editor.source.value.height, Math.max(top + 1, bottom + dy));
  editor.setCrop({ x: left, y: top, width: right - left, height: bottom - top });
};
const finishCropDrag = () => { cropDrag = null; };

const seekPreview = (event: Event) => {
  if (event.target instanceof HTMLInputElement) editor.seek(Number(event.target.value));
};
const changeTrimStart = (event: Event) => {
  if (!(event.target instanceof HTMLInputElement)) return;
  editor.setTrimStart(Number(event.target.value));
  event.target.value = String(editor.trimStart.value);
  if (event.type === "change") editor.seek(editor.currentTime.value);
};
const changeTrimEnd = (event: Event) => {
  if (!(event.target instanceof HTMLInputElement)) return;
  editor.setTrimEnd(Number(event.target.value));
  event.target.value = String(editor.trimEnd.value);
  if (event.type === "change") editor.seek(editor.currentTime.value);
};

const changeMaxEdge = (event: Event) => {
  if (!(event.target instanceof HTMLInputElement)) return;
  editor.setMaxEdge(Number(event.target.value));
  event.target.value = String(editor.maxEdge.value);
};
const changeFrameRate = (event: Event) => {
  if (!(event.target instanceof HTMLInputElement)) return;
  editor.setFrameRate(Number(event.target.value));
  event.target.value = String(editor.fixedFrameRate.value);
};
const toggleOriginalFrameRate = (event: Event) => {
  if (event.target instanceof HTMLInputElement) editor.setFrameRate(event.target.checked ? "original" : editor.fixedFrameRate.value);
};
const resetCrop = () => {
  const media = editor.source.value;
  if (media) editor.setCrop({ x: 0, y: 0, width: media.width, height: media.height });
};

</script>

<template>
  <div class="app-viewport">
    <div class="app-shell" :style="{ zoom: pageScale }">
      <MediaToolHeader title="GIF 编辑器" subtitle="GIF 与视频仅在本地处理，不会上传到服务器" github-label="查看 GitHub 仓库">
        <template #mark><LuFilm :size="25" aria-hidden="true" /></template>
      </MediaToolHeader>

      <div class="editor-grid">
        <div class="workspace-panel" :class="{ 'is-dragging': isDragging }" @dragenter="handleDragEnter" @dragover="handleDragOver" @dragleave="handleDragLeave" @drop="handleDrop">
          <input ref="fileInputRef" class="file-input" type="file" accept="image/gif,video/*,.gif,.mp4,.webm,.mov,.m4v" aria-label="选择 GIF 或视频文件" @change="handleFileChange" />
          <div v-if="!editor.source.value" class="empty-state">
            <div class="upload-symbol"><LuUpload :size="34" aria-hidden="true" /></div>
            <span class="empty-title">{{ editor.isLoading.value ? "正在读取文件" : "拖放 GIF 或视频到这里" }}</span>
            <span class="empty-detail">支持 GIF、MP4、WebM 及当前浏览器可解码的视频</span>
            <button type="button" class="select-button" :disabled="editor.isLoading.value" @click="openFilePicker"><LuFolderOpen :size="18" aria-hidden="true" /><span>选择文件</span></button>
          </div>
          <div v-else class="editor-body">
            <div class="source-heading">
              <div class="source-copy"><span class="source-kicker">当前文件</span><span class="source-name" :title="editor.source.value.file.name">{{ editor.source.value.file.name }}</span><span class="source-meta">{{ sourceLabel }}</span></div>
              <div class="source-actions">
                <button type="button" class="reset-button" title="恢复完整画面" aria-label="恢复完整画面" @click="resetCrop"><LuRotateCcw :size="17" aria-hidden="true" /></button>
                <button type="button" class="replace-button" title="更换文件" @click="openFilePicker"><LuFolderOpen :size="17" aria-hidden="true" /><span>更换文件</span></button>
              </div>
            </div>
            <div class="stage-shell" :class="{ 'has-preview': editor.previewUrl.value }">
              <div ref="stageRef" class="stage" :style="stageStyle" @pointermove="moveCropDrag" @pointerup="finishCropDrag" @pointercancel="finishCropDrag">
                <canvas ref="canvasRef" class="source-canvas" aria-label="源文件画面" />
                <div class="crop-box" :style="cropStyle" @pointerdown="startCropDrag($event, 'move')">
                  <div class="crop-grid"></div>
                  <button v-for="corner in cropCorners" :key="corner" type="button" class="crop-handle" :class="`is-${corner}`" :aria-label="`调整裁剪框${corner}角`" @pointerdown.stop="startCropDrag($event, corner)"></button>
                </div>
              </div>
              <div v-if="editor.previewUrl.value" class="preview-area">
                <div class="preview-heading"><LuEye :size="17" aria-hidden="true" /><span>生成结果预览</span><span class="preview-meta">{{ editor.exportDimensions.value.width }} × {{ editor.exportDimensions.value.height }} · {{ editor.selectedDuration.value.toFixed(2) }} 秒 · {{ formatFileSize(editor.previewBlob.value?.size ?? 0) }}</span></div>
                <img :src="editor.previewUrl.value" alt="已生成的 GIF 动画预览" />
              </div>
            </div>
            <div class="transport">
              <button type="button" class="play-button" title="播放或暂停" :aria-label="editor.isPlaying.value ? '暂停' : '播放'" @click="editor.togglePlayback">
                <LuPause v-if="editor.isPlaying.value" :size="18" aria-hidden="true" /><LuPlay v-else :size="18" aria-hidden="true" />
              </button>
              <span class="transport-time">{{ formatTime(editor.currentTime.value) }}</span>
              <span class="transport-duration">{{ formatTime(editor.trimEnd.value) }}</span>
            </div>
            <input class="seek-bar" type="range" step="0.01" :min="editor.trimStart.value" :max="editor.trimEnd.value" :value="editor.currentTime.value" aria-label="预览位置" @input="seekPreview" />
            <div class="trim-heading"><span>时间修剪</span><span>{{ editor.selectedDuration.value.toFixed(2) }} 秒</span></div>
            <div class="trim-timeline">
              <div class="trim-rail"></div>
              <div class="trim-selection" :style="trimSelectionStyle"></div>
              <div class="trim-playhead" :style="trimPlayheadStyle"></div>
              <input class="trim-start" type="range" min="0" step="0.01" :max="editor.source.value.duration" :value="editor.trimStart.value" aria-label="修剪开始时间" @input="changeTrimStart" @change="changeTrimStart" />
              <input class="trim-end" type="range" min="0" step="0.01" :max="editor.source.value.duration" :value="editor.trimEnd.value" aria-label="修剪结束时间" @input="changeTrimEnd" @change="changeTrimEnd" />
            </div>
            <div class="trim-scale"><span>{{ formatTime(0) }}</span><span>{{ formatTime(editor.source.value.duration) }}</span></div>
          </div>
        </div>

        <div class="controls-panel">
          <div class="panel-heading"><span class="panel-kicker">EDIT / GIF</span><span class="panel-title">导出设置</span></div>
          <div class="control-section">
            <div class="section-heading"><span>时间修剪</span><LuScissors :size="16" aria-hidden="true" /></div>
            <div class="time-fields">
              <label class="number-field"><span>开始</span><div class="input-wrap"><input type="number" min="0" step="0.001" :max="editor.trimEnd.value" :value="Number(editor.trimStart.value.toFixed(3))" :disabled="!editor.source.value" @change="changeTrimStart" /><span>秒</span></div></label>
              <label class="number-field"><span>结束</span><div class="input-wrap"><input type="number" min="0" step="0.001" :max="editor.source.value?.duration || 0" :value="Number(editor.trimEnd.value.toFixed(3))" :disabled="!editor.source.value" @change="changeTrimEnd" /><span>秒</span></div></label>
            </div>
            <span v-if="editor.source.value?.kind === 'video' && editor.selectedDuration.value > 30" class="trim-warning">视频选区最长为 30 秒</span>
          </div>
          <div class="control-section">
            <div class="section-heading"><span>导出尺寸</span><LuCrop :size="16" aria-hidden="true" /></div>
            <label class="number-field"><span>最长边</span><div class="input-wrap"><input type="number" min="1" step="1" :max="editor.maxEdgeLimit.value" :value="editor.maxEdge.value" :disabled="!editor.source.value" @change="changeMaxEdge" /><span>px</span></div></label>
          </div>
          <div class="control-section">
            <div class="section-heading"><span>GIF 编码</span></div>
            <span class="field-label">质量</span>
            <div class="quality-options" role="group" aria-label="GIF 质量">
              <button v-for="option in qualityOptions" :key="option.value" type="button" :aria-pressed="editor.quality.value === option.value" :disabled="!editor.source.value" @click="editor.setQuality(option.value)">{{ option.label }}</button>
            </div>
            <label class="number-field"><span>帧率</span><div class="input-wrap"><input type="number" min="0.001" step="0.001" :max="editor.frameRateLimit.value" :value="editor.fixedFrameRate.value" :disabled="!editor.source.value || editor.frameRate.value === 'original'" @change="changeFrameRate" /><span>fps</span></div></label>
            <label v-if="editor.source.value?.kind === 'gif'" class="check-row"><input type="checkbox" :checked="editor.frameRate.value === 'original'" :disabled="!editor.canPreserveOriginalTiming.value" @change="toggleOriginalFrameRate" /><span>保留原帧时长（选区平均 {{ editor.selectedOriginalFrameRate.value.toFixed(2) }} fps{{ !editor.canPreserveOriginalTiming.value ? '，超过 30 fps 上限' : '' }}）</span></label>
          </div>
          <div
            class="status-line"
            :class="{ 'is-error': editor.status.value.isError }"
            role="status"
            aria-live="polite"
          >
            {{ editor.status.value.message }}
          </div>
          <div class="export-area">
            <div v-if="editor.isGenerating.value" class="progress-row"><span>生成中</span><span>{{ editor.progress.value }}%</span></div>
            <div v-if="editor.isGenerating.value" class="progress-track"><div :style="{ width: `${editor.progress.value}%` }"></div></div>
            <button v-if="editor.isGenerating.value" type="button" class="cancel-button" @click="editor.cancelGeneration"><LuX :size="17" aria-hidden="true" /><span>取消生成</span></button>
            <button v-else type="button" class="generate-button" :disabled="!editor.source.value" @click="editor.generatePreview"><LuEye :size="18" aria-hidden="true" /><span>{{ editor.previewUrl.value ? '重新生成预览' : '生成预览' }}</span></button>
            <button type="button" class="download-button" :disabled="!editor.previewUrl.value || editor.isGenerating.value" @click="editor.downloadPreview"><LuDownload :size="18" aria-hidden="true" /><span>下载 GIF</span></button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="less">
@import "./index.less";
</style>
