<script setup lang="ts">
import { onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from "vue";
import { LuUpload } from "vue-icons-plus/lu";

const props = defineProps<{
  quality: number;
  maxEdge: number | null;
  isProcessing: boolean;
}>();

const emit = defineEmits<{
  "update:quality": [value: number | string];
  "update:max-edge": [value: number | string];
  "files-selected": [files: FileList | File[]];
}>();

const isDragging = ref(false);
const qualityInput = ref(String(props.quality));
/** 最长边输入框内容，空字符串表示保留原尺寸 */
const maxEdgeInput = ref(props.maxEdge === null ? "" : String(props.maxEdge));
const fileInput = ref<HTMLInputElement | null>(null);
let dragDepth = 0;
let windowListenersActive = false;

function containsFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

const ensureQualityInput = (): void => {
  if (!qualityInput.value.trim()) qualityInput.value = "90";
};

const commitOutputSettings = (): void => {
  ensureQualityInput();
  emit("update:max-edge", maxEdgeInput.value);
  emit("update:quality", qualityInput.value);
};

function handleInputChange(event: Event): void {
  const input = event.target as HTMLInputElement;
  if (input.files?.length) {
    commitOutputSettings();
    emit("files-selected", input.files);
  }
  input.value = "";
}

function getClipboardImageName(file: File, index: number): string {
  if (file.name) return file.name;

  const extension = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1] || "png";
  return `pasted-image-${index + 1}.${extension}`;
}

//只提取剪贴板中的图片文件，避免文字内容触发转换
function handlePaste(event: ClipboardEvent): void {
  if (props.isProcessing) return;

  const imageFiles: File[] = [];
  for (const item of Array.from(event.clipboardData?.items ?? [])) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue;

    const file = item.getAsFile();
    if (file) {
      imageFiles.push(
        new File([file], getClipboardImageName(file, imageFiles.length), {
          type: file.type,
          lastModified: file.lastModified,
        }),
      );
    }
  }

  if (!imageFiles.length) return;
  event.preventDefault();
  commitOutputSettings();
  emit("files-selected", imageFiles);
}

const handleMaxEdgeInput = (event: Event): void => {
  maxEdgeInput.value = (event.target as HTMLInputElement).value;
};

const commitMaxEdge = (): void => {
  emit("update:max-edge", maxEdgeInput.value);
};

function handleQualityInput(event: Event): void {
  qualityInput.value = (event.target as HTMLInputElement).value;
}

function commitQuality(): void {
  ensureQualityInput();
  emit("update:quality", qualityInput.value);
}

function openFilePicker(): void {
  if (!props.isProcessing) fileInput.value?.click();
}

function handleDragEnter(event: DragEvent): void {
  if (!containsFiles(event) || props.isProcessing) return;
  event.preventDefault();
  dragDepth += 1;
  isDragging.value = true;
}

function handleDragOver(event: DragEvent): void {
  if (!containsFiles(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = props.isProcessing ? "none" : "copy";
}

function handleDragLeave(): void {
  if (props.isProcessing || dragDepth === 0) return;
  dragDepth -= 1;
  if (dragDepth === 0) isDragging.value = false;
}

function handleDrop(event: DragEvent): void {
  if (!containsFiles(event)) return;
  event.preventDefault();
  dragDepth = 0;
  isDragging.value = false;
  if (!props.isProcessing && event.dataTransfer?.files.length) {
    commitOutputSettings();
    emit("files-selected", event.dataTransfer.files);
  }
}

watch(
  () => props.quality,
  (quality) => {
    qualityInput.value = String(quality);
  },
);

watch(
  () => props.maxEdge,
  (maxEdge) => {
    maxEdgeInput.value = maxEdge === null ? "" : String(maxEdge);
  },
);

watch(
  () => props.isProcessing,
  (isProcessing) => {
    if (!isProcessing) return;
    dragDepth = 0;
    isDragging.value = false;
  },
);

const addWindowListeners = () => {
  if (windowListenersActive) return;

  window.addEventListener("dragenter", handleDragEnter);
  window.addEventListener("dragover", handleDragOver);
  window.addEventListener("dragleave", handleDragLeave);
  window.addEventListener("drop", handleDrop);
  window.addEventListener("paste", handlePaste);
  windowListenersActive = true;
};

const removeWindowListeners = () => {
  if (!windowListenersActive) return;

  window.removeEventListener("dragenter", handleDragEnter);
  window.removeEventListener("dragover", handleDragOver);
  window.removeEventListener("dragleave", handleDragLeave);
  window.removeEventListener("drop", handleDrop);
  window.removeEventListener("paste", handlePaste);
  windowListenersActive = false;
};

onMounted(addWindowListeners);
onActivated(addWindowListeners);
onDeactivated(removeWindowListeners);
onUnmounted(removeWindowListeners);
</script>

<template>
  <div class="workspace" role="region" aria-label="图片转换工作区">
    <div class="control-bar">
      <div class="control-copy">
        <span class="control-label">输出设置</span>
      </div>
      <div class="output-controls">
        <div class="setting-control">
          <span>最长边</span>
          <span class="number-field">
            <input
              id="max-edge"
              type="number"
              min="1"
              max="16384"
              step="1"
              inputmode="numeric"
              placeholder="原尺寸"
              :value="maxEdgeInput"
              :disabled="isProcessing"
              aria-label="最长边尺寸"
              @input="handleMaxEdgeInput"
              @change="commitMaxEdge"
            />
            <span aria-hidden="true">px</span>
          </span>
        </div>
        <div class="setting-control">
          <span>WebP 品质</span>
          <span class="number-field">
            <input
              id="quality"
              type="number"
              min="1"
              max="99"
              step="1"
              inputmode="numeric"
              :value="qualityInput"
              :disabled="isProcessing"
              @input="handleQualityInput"
              @change="commitQuality"
            />
            <span aria-hidden="true">%</span>
          </span>
        </div>
      </div>
    </div>

    <div
      class="drop-zone"
      :class="{ 'is-dragging': isDragging, 'is-busy': isProcessing }"
      role="button"
      :tabindex="isProcessing ? -1 : 0"
      :aria-disabled="isProcessing"
      @click="openFilePicker"
      @keydown.enter.prevent="openFilePicker"
      @keydown.space.prevent="openFilePicker"
    >
      <input
        id="file-input"
        ref="fileInput"
        class="visually-hidden"
        type="file"
        accept="image/*"
        multiple
        :disabled="isProcessing"
        @click.stop
        @change="handleInputChange"
      />
      <LuUpload class-name="upload-symbol" :size="66" aria-hidden="true" />
      <span class="drop-title">拖放或粘贴导入图片</span>
      <span class="drop-subtitle">或从设备中选择，可一次处理多张图片</span>
      <span class="select-button">选择图片</span>
    </div>
  </div>
</template>

<style scoped lang="less">
.workspace {
  overflow: hidden;
  border: 1px solid @border;
  border-radius: @radius;
  box-shadow: 0 16px 48px fade(#000, 22%);
  background: @surface;
}

.control-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: 82px;
  padding: 16px 20px;
  border-bottom: 1px solid @border;
  gap: 26px;
}

.control-copy {
  display: grid;
  gap: 2px;
}

.control-label {
  color: @text;
  font-size: 17px;
  font-weight: 650;
}

.output-controls {
  display: flex;
  align-items: center;
  gap: 16px;
}

.setting-control {
  display: flex;
  align-items: center;
  gap: 14px;
  color: @text-muted;
  font-size: 15px;
}

.number-field {
  display: flex;
  align-items: center;
  width: 104px;
  height: 44px;
  padding-right: 12px;
  border: 1px solid @border-strong;
  border-radius: 6px;
  background: @bg;

  &:focus-within {
    border-color: @accent;
  }

  input {
    width: 100%;
    min-width: 0;
    height: 100%;
    padding: 0 5px 0 14px;
    color: @text;
    font-size: 16px;
    font-weight: 700;
  }

  > span {
    color: @text-dim;
  }
}

.drop-zone {
  display: flex;
  justify-content: center;
  align-items: center;
  flex-direction: column;
  min-height: 330px;
  margin: 20px;
  padding: 40px 28px;
  border: 1px dashed @border-strong;
  border-radius: @radius;
  cursor: pointer;
  background: fade(@bg, 54%);
  transition:
    border-color 160ms ease,
    background 160ms ease,
    transform 160ms ease;

  &:hover,
  &.is-dragging {
    border-color: @accent;
    background: @accent-soft;
  }

  &.is-dragging {
    transform: translateY(-2px);
  }

  &.is-busy {
    cursor: wait;
    opacity: 0.62;
  }
}

.upload-symbol {
  flex: 0 0 auto;
  margin-bottom: 22px;
  color: @accent;
}

.drop-title {
  color: @text;
  font-size: 20px;
  font-weight: 700;
}

.drop-subtitle {
  margin-top: 6px;
  color: @text-muted;
  font-size: 15px;
  text-align: center;
}

.select-button {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  min-width: 136px;
  min-height: 46px;
  margin-top: 22px;
  padding: 0 22px;
  border-radius: 6px;
  color: @on-accent;
  font-size: 15px;
  font-weight: 750;
  background: @accent;
  transition: background 160ms ease;
}

.drop-zone:hover .select-button {
  background: @accent-hover;
}

@media (max-width: 767.98px) {
  .control-bar {
    align-items: stretch;
    flex-direction: column;
    gap: 14px;
  }

  .output-controls {
    align-items: stretch;
    flex-direction: column;
    gap: 12px;
  }

  .setting-control {
    justify-content: space-between;
  }

  .number-field {
    height: 44px;
  }

  .drop-zone {
    min-height: 280px;
    margin: 12px;
    padding: 32px 18px;
  }

  .select-button {
    min-height: 46px;
  }
}
</style>
