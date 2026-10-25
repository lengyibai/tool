<script setup lang="ts">
import { computed, ref } from "vue";
import { LuFileWarning, LuFolderOpen, LuUpload } from "vue-icons-plus/lu";

import SelectField, { type SelectFieldOption } from "@/components/SelectField/index.vue";
import type { VideoCompressionSettings } from "@/types/video-compressor";

interface Props {
  /** 是否锁定压缩设置 */
  settingsLocked: boolean;
  /** 是否锁定文件选择 */
  filesLocked: boolean;
  /** 是否正在检测浏览器能力 */
  compatibilityPending: boolean;
  /** 浏览器兼容性错误 */
  compatibilityError: string;
}
const $props = defineProps<Props>();
const $emit = defineEmits<{
  "files-selected": [files: File[]];
}>();
const settings = defineModel<VideoCompressionSettings>("settings", { required: true });

const resolutionOptions: SelectFieldOption[] = [
  { value: "original", label: "原始尺寸" },
  { value: "1080p", label: "1080p" },
  { value: "720p", label: "720p" },
];

const frameRateOptions: SelectFieldOption[] = [
  { value: "original", label: "原始帧率" },
  { value: "60", label: "60 FPS" },
  { value: "30", label: "30 FPS" },
];

/** 原生文件选择控件 */
const fileInputRef = ref<HTMLInputElement>();
/** 是否正在拖入文件 */
const dragActive = ref(false);
const canSelectFiles = computed(
  () => !$props.filesLocked && !$props.compatibilityPending && !$props.compatibilityError,
);

const handleSelectClick = () => {
  if (canSelectFiles.value) fileInputRef.value?.click();
};

const handleDropZoneClick = (event: MouseEvent) => {
  if (event.target instanceof HTMLElement && event.target.closest("button")) return;
  handleSelectClick();
};

const handleDropZoneKeydown = (event: KeyboardEvent) => {
  if (event.target instanceof HTMLElement && event.target.closest("button")) return;
  if (event.key !== "Enter" && event.key !== " ") return;

  event.preventDefault();
  handleSelectClick();
};

const handleFileChange = (event: Event) => {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  if (files.length) $emit("files-selected", files);
  input.value = "";
};

const handleDragEnter = () => {
  if (canSelectFiles.value) dragActive.value = true;
};

const handleDragLeave = () => {
  dragActive.value = false;
};

const handleDrop = (event: DragEvent) => {
  dragActive.value = false;
  if (!canSelectFiles.value) return;

  const files = Array.from(event.dataTransfer?.files ?? []);
  if (files.length) $emit("files-selected", files);
};
</script>

<template>
  <div class="workspace" role="region" aria-labelledby="settings-title">
    <div class="settings-panel">
      <div class="settings-heading">
        <div>
          <span id="settings-title" class="title">输出设置</span>
          <span class="description">选择常用参数后添加视频</span>
        </div>
      </div>

      <div class="settings-grid">
        <label class="setting-control">
          <span class="setting-label">分辨率</span>
          <SelectField
            v-model="settings.resolution"
            :options="resolutionOptions"
            :disabled="settingsLocked"
            ariaLabel="输出分辨率"
          />
        </label>

        <div class="quality-control">
          <span class="setting-label">压缩质量</span>
          <div class="quality-options" role="radiogroup" aria-label="压缩质量">
            <label>
              <input
                v-model="settings.quality"
                type="radio"
                name="compression-quality"
                value="low"
                :disabled="settingsLocked"
              />
              <span>低</span>
            </label>
            <label>
              <input
                v-model="settings.quality"
                type="radio"
                name="compression-quality"
                value="medium"
                :disabled="settingsLocked"
              />
              <span>中</span>
            </label>
            <label>
              <input
                v-model="settings.quality"
                type="radio"
                name="compression-quality"
                value="high"
                :disabled="settingsLocked"
              />
              <span>高</span>
            </label>
          </div>
        </div>

        <label class="setting-control">
          <span class="setting-label">输出帧率</span>
          <SelectField
            v-model="settings.frameRate"
            :options="frameRateOptions"
            :disabled="settingsLocked"
            ariaLabel="输出帧率"
          />
        </label>

      </div>
    </div>

    <div
      class="drop-zone"
      :class="{ 'is-busy': filesLocked || compatibilityPending, 'is-dragging': dragActive }"
      :aria-disabled="!canSelectFiles"
      :tabindex="canSelectFiles ? 0 : -1"
      role="button"
      aria-label="选择视频文件"
      @dragenter.prevent="handleDragEnter"
      @dragover.prevent
      @dragleave.prevent="handleDragLeave"
      @drop.prevent="handleDrop"
      @click="handleDropZoneClick"
      @keydown="handleDropZoneKeydown"
    >
      <input
        ref="fileInputRef"
        class="file-input"
        type="file"
        accept=".mp4,.mov,video/mp4,video/quicktime"
        multiple
        :disabled="!canSelectFiles"
        @change="handleFileChange"
      />
      <span class="upload-symbol" aria-hidden="true">
        <LuUpload :size="34" />
      </span>
      <span class="drop-title">{{ compatibilityPending ? "正在检测浏览器能力" : "拖放视频到这里" }}</span>
      <span class="drop-subtitle">支持 MP4、MOV，可一次添加多个视频</span>
      <span v-if="compatibilityError" class="status-message is-error">
        <LuFileWarning :size="16" aria-hidden="true" />
        <span>{{ compatibilityError }}</span>
      </span>
      <button type="button" :disabled="!canSelectFiles" @click="handleSelectClick">
        <LuFolderOpen :size="18" aria-hidden="true" />
        <span>选择视频</span>
      </button>
    </div>
  </div>
</template>

<style scoped lang="less">
@import url("./index.less");
</style>
