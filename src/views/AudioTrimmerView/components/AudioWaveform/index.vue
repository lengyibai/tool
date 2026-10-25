<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";

import type { AudioSelection, WaveformPeak } from "@/types/audio-trimmer";

interface Props {
  /** 波形极值 */
  peaks: WaveformPeak[];
  /** 音频总帧数 */
  frameCount: number;
  /** 音频采样率 */
  sampleRate: number;
  /** 波形放大倍数 */
  zoom: number;
  /** 当前选区 */
  selection: AudioSelection;
  /** 当前播放头 */
  playheadFrame: number | null;
  /** 是否正在播放选区 */
  isPlaying: boolean;
}

const $props = defineProps<Props>();
const $emit = defineEmits<{
  "selection-change": [selection: AudioSelection];
  "zoom-change": [zoom: number];
  seek: [frame: number];
}>();

/** 波形画布 */
const canvasRef = ref<HTMLCanvasElement>();
/** 波形可见范围的起始帧 */
const viewStartFrame = ref(0);
let resizeObserver: ResizeObserver | null = null;
let dragEdge: "start" | "end" | null = null;
let wheelAnchor: { frame: number; ratio: number } | null = null;

const visibleFrames = computed(() => Math.max(1, Math.ceil($props.frameCount / $props.zoom)));
const maxStartFrame = computed(() => Math.max(0, $props.frameCount - visibleFrames.value));
const viewEndFrame = computed(() => Math.min($props.frameCount, viewStartFrame.value + visibleFrames.value));

const formatClock = (frame: number) => {
  const seconds = Math.floor(frame / $props.sampleRate);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

const drawWaveform = () => {
  const canvas = canvasRef.value;
  if (!canvas || !$props.frameCount) return;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const scale = window.devicePixelRatio || 1;
  const width = Math.round(rect.width * scale);
  const height = Math.round(rect.height * scale);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);
  context.fillStyle = "#111b24";
  context.fillRect(0, 0, rect.width, rect.height);

  const frameToX = (frame: number) => ((frame - viewStartFrame.value) / visibleFrames.value) * rect.width;
  const startX = frameToX($props.selection.startFrame);
  const endX = frameToX($props.selection.endFrame);
  context.fillStyle = "#173d39";
  context.fillRect(startX, 0, endX - startX, rect.height);
  context.strokeStyle = "#273642";
  context.lineWidth = 1;
  for (let index = 1; index < 8; index++) {
    const x = (index / 8) * rect.width + 0.5;
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, rect.height);
    context.stroke();
  }

  const center = rect.height / 2;
  const amplitude = center - 26;
  context.strokeStyle = "#33454d";
  context.beginPath();
  context.moveTo(0, center + 0.5);
  context.lineTo(rect.width, center + 0.5);
  context.stroke();
  const bucketWidth = (rect.width * $props.frameCount) / $props.peaks.length / visibleFrames.value;
  for (let index = 0; index < $props.peaks.length; index++) {
    const peak = $props.peaks[index];
    const x = frameToX(((index + 0.5) * $props.frameCount) / $props.peaks.length);
    if (x < -bucketWidth || x > rect.width + bucketWidth) continue;
    context.strokeStyle = x >= startX && x <= endX ? "#47d6a1" : "#577a81";
    context.lineWidth = Math.max(1, Math.min(4, bucketWidth));
    context.beginPath();
    context.moveTo(x, center - Math.max(1, peak.max * amplitude));
    context.lineTo(x, center - Math.min(-1, peak.min * amplitude));
    context.stroke();
  }

  for (const x of [startX, endX]) {
    if (x < 0 || x > rect.width) continue;
    const handleX = Math.max(1, Math.min(rect.width - 1, x));
    context.strokeStyle = "#f0b35b";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(handleX, 0);
    context.lineTo(handleX, rect.height);
    context.stroke();
    context.fillStyle = "#f0b35b";
    context.fillRect(Math.max(0, Math.min(rect.width - 10, handleX - 5)), 12, 10, 28);
  }

  if ($props.playheadFrame !== null) {
    const x = frameToX($props.playheadFrame);
    if (x >= 0 && x <= rect.width) {
      context.strokeStyle = "#f0f4f8";
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, rect.height);
      context.stroke();
    }
  }
};

const pointerToFrame = (event: PointerEvent) => {
  const rect = canvasRef.value?.getBoundingClientRect();
  if (!rect) return 0;
  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  return Math.min($props.frameCount, Math.round(viewStartFrame.value + ratio * visibleFrames.value));
};

const updateDrag = (event: PointerEvent) => {
  if (!dragEdge) return;
  const frame = pointerToFrame(event);
  const selection =
    dragEdge === "start"
      ? { startFrame: Math.min(frame, $props.selection.endFrame - 1), endFrame: $props.selection.endFrame }
      : { startFrame: $props.selection.startFrame, endFrame: Math.max(frame, $props.selection.startFrame + 1) };
  $emit("selection-change", selection);
};

const startDrag = (event: PointerEvent) => {
  const frame = pointerToFrame(event);
  if ($props.isPlaying && frame >= $props.selection.startFrame && frame <= $props.selection.endFrame) {
    $emit("seek", frame);
    return;
  }
  dragEdge =
    Math.abs(frame - $props.selection.startFrame) <= Math.abs(frame - $props.selection.endFrame) ? "start" : "end";
  canvasRef.value?.setPointerCapture(event.pointerId);
  updateDrag(event);
};

const finishDrag = () => {
  dragEdge = null;
};

const handleWheel = (event: WheelEvent) => {
  if (!event.deltaY) return;
  const nextZoom = event.deltaY < 0 ? Math.min(8, $props.zoom * 2) : Math.max(1, $props.zoom / 2);
  if (nextZoom === $props.zoom) return;
  const rect = canvasRef.value?.getBoundingClientRect();
  if (!rect?.width) return;
  event.preventDefault();
  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  wheelAnchor = { frame: viewStartFrame.value + ratio * visibleFrames.value, ratio };
  $emit("zoom-change", nextZoom);
};

watch(
  () => $props.zoom,
  (_zoom, previousZoom) => {
    const anchor = wheelAnchor;
    wheelAnchor = null;
    if (anchor) {
      viewStartFrame.value = Math.max(
        0,
        Math.min(maxStartFrame.value, Math.round(anchor.frame - anchor.ratio * visibleFrames.value)),
      );
      drawWaveform();
      return;
    }
    const previousVisible = Math.ceil($props.frameCount / previousZoom);
    const selectionCenter = ($props.selection.startFrame + $props.selection.endFrame) / 2;
    const selectionFits = $props.selection.endFrame - $props.selection.startFrame <= visibleFrames.value;
    const selectionIsVisible =
      selectionCenter >= viewStartFrame.value && selectionCenter <= viewStartFrame.value + previousVisible;
    const center = selectionFits && selectionIsVisible ? selectionCenter : viewStartFrame.value + previousVisible / 2;
    viewStartFrame.value = Math.max(0, Math.min(maxStartFrame.value, Math.round(center - visibleFrames.value / 2)));
    drawWaveform();
  },
);
watch(
  () => $props.frameCount,
  () => {
    wheelAnchor = null;
    viewStartFrame.value = 0;
    drawWaveform();
  },
);
watch([() => $props.peaks, () => $props.selection, () => $props.playheadFrame, viewStartFrame], drawWaveform);
onMounted(() => {
  resizeObserver = new ResizeObserver(drawWaveform);
  if (canvasRef.value) resizeObserver.observe(canvasRef.value);
  drawWaveform();
});
onUnmounted(() => resizeObserver?.disconnect());
</script>

<template>
  <div class="waveform-view">
    <div class="canvas-shell">
      <canvas
        ref="canvasRef"
        class="waveform"
        :aria-label="isPlaying ? '音频波形，点击选区调整播放进度' : '音频波形，拖动两端边界调整选区'"
        @pointerdown="startDrag"
        @pointermove="updateDrag"
        @pointerup="finishDrag"
        @pointercancel="finishDrag"
        @lostpointercapture="finishDrag"
        @wheel="handleWheel"
      />
    </div>
    <div class="timeline">
      <span>{{ formatClock(viewStartFrame) }}</span
      ><span>{{ formatClock((viewStartFrame + viewEndFrame) / 2) }}</span
      ><span>{{ formatClock(viewEndFrame) }}</span>
    </div>
    <input
      v-if="zoom > 1"
      v-model.number="viewStartFrame"
      class="pan-control"
      type="range"
      min="0"
      :max="maxStartFrame"
      step="1"
      aria-label="波形位置"
    />
  </div>
</template>

<style scoped lang="less">
.waveform-view {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;

  > .canvas-shell {
    flex: 1;
    min-height: 0;

    > .waveform {
      display: block;
      width: 100%;
      height: 100%;
      cursor: crosshair;
      touch-action: none;
    }
  }

  > .timeline {
    display: flex;
    justify-content: space-between;
    padding: var(--gap-2) var(--gap-2) 0;
    color: @text-dim;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  > .pan-control {
    width: calc(100% - 16px);
    margin: var(--gap-2);
    accent-color: @accent;
  }
}
</style>
