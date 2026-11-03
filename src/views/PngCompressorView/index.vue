<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { LuAlertTriangle, LuArrowRight, LuCheck, LuDownload, LuFileImage, LuImage, LuUpload } from "vue-icons-plus/lu";

import MediaToolHeader from "@/components/MediaToolHeader/index.vue";
import { useFilePaste } from "@/composables/use-file-paste";
import { usePageScale } from "@/composables/use-page-scale";
import { usePngCompressor } from "@/composables/use-png-compressor";
import { formatFileSize, getSizeChange } from "@/utils/files";

/** 文件选择控件 */
const fileInputRef = ref<HTMLInputElement>();
/** 文件拖入状态 */
const isDragging = ref(false);
/** 结果缩略图的临时地址 */
const thumbnailUrls = ref<Record<number, string>>({});

const { pageScale } = usePageScale();
const compressor = usePngCompressor();
let dragDepth = 0;
const progressPercent = computed(() =>
  compressor.total.value ? Math.round((compressor.completed.value / compressor.total.value) * 100) : 0,
);

watch(
  () => compressor.results.value,
  (results) => {
    const activeIds = new Set(results.map((result) => result.id));
    const nextUrls = { ...thumbnailUrls.value };

    for (const [resultId, objectUrl] of Object.entries(nextUrls)) {
      if (activeIds.has(Number(resultId))) continue;
      URL.revokeObjectURL(objectUrl);
      delete nextUrls[Number(resultId)];
    }

    for (const result of results) {
      if (result.source.type === "image/png" && !nextUrls[result.id]) {
        nextUrls[result.id] = URL.createObjectURL(result.output);
      }
    }

    thumbnailUrls.value = nextUrls;
  },
  { flush: "sync" },
);

useFilePaste(
  (file) => file.type.startsWith("image/"),
  () => !compressor.isBusy.value,
  (files) => {
    void compressor.processFiles(files);
  },
);

const openFilePicker = (): void => {
  if (!compressor.isBusy.value) fileInputRef.value?.click();
};

const handleFileChange = (event: Event): void => {
  if (!(event.target instanceof HTMLInputElement)) return;
  const files = Array.from(event.target.files ?? []);
  event.target.value = "";
  if (files.length) void compressor.processFiles(files);
};

const containsFiles = (event: DragEvent): boolean => Array.from(event.dataTransfer?.types ?? []).includes("Files");

const handleDragEnter = (event: DragEvent): void => {
  if (!containsFiles(event) || compressor.isBusy.value) return;
  event.preventDefault();
  dragDepth += 1;
  isDragging.value = true;
};

const handleDragOver = (event: DragEvent): void => {
  if (!containsFiles(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = compressor.isBusy.value ? "none" : "copy";
};

const handleDragLeave = (): void => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) isDragging.value = false;
};

const handleDrop = (event: DragEvent): void => {
  if (!containsFiles(event)) return;
  event.preventDefault();
  dragDepth = 0;
  isDragging.value = false;
  if (!compressor.isBusy.value && event.dataTransfer?.files.length)
    void compressor.processFiles(event.dataTransfer.files);
};

onUnmounted(() => {
  for (const objectUrl of Object.values(thumbnailUrls.value)) URL.revokeObjectURL(objectUrl);
});
</script>

<template>
  <div class="app-viewport">
    <div class="app-shell" :style="{ zoom: pageScale }">
      <MediaToolHeader
        title="PNG 索引色压缩"
        subtitle="本地批量处理，图片不会上传到服务器"
        github-label="查看 GitHub 仓库"
      >
        <template #mark><LuFileImage :size="25" aria-hidden="true" /></template>
      </MediaToolHeader>

      <div class="content-grid">
        <div class="primary-column">
          <div class="workspace-panel" role="region" aria-label="PNG 索引色压缩工作区">
            <div class="workspace-heading">
              <span class="section-title">PNG 索引色压缩</span>
              <span class="section-subtitle">保留原始尺寸和可见像素</span>
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
                accept=".png,image/png"
                multiple
                :disabled="compressor.isBusy.value"
                aria-label="选择 PNG 图片"
                @click.stop
                @change="handleFileChange"
              />
              <LuUpload class-name="upload-icon" :size="66" aria-hidden="true" />
              <span class="drop-title">拖放或粘贴导入 PNG</span>
              <span class="drop-subtitle">或从设备中选择，可一次处理多张图片</span>
              <span class="select-button">选择 PNG</span>
            </div>
          </div>

          <div class="totals-panel" role="region" aria-label="体积总计">
            <div class="totals-heading">
              <div>
                <span class="section-title">体积总计</span>
                <span v-if="compressor.results.value.length" class="section-subtitle">
                  已统计 {{ compressor.results.value.length }} 张图片
                </span>
              </div>
              <span v-if="compressor.results.value.length" class="saving-label">
                节省 {{ compressor.savedPercent.value }}%
              </span>
            </div>
            <div class="total-values">
              <div class="total-value">
                <span>压缩前</span>
                <span class="value">{{ formatFileSize(compressor.originalTotal.value) }}</span>
              </div>
              <LuArrowRight class-name="comparison-arrow" :size="21" aria-hidden="true" />
              <div class="total-value total-after">
                <span>压缩后</span>
                <span class="value">{{ formatFileSize(compressor.outputTotal.value) }}</span>
              </div>
            </div>
            <div class="saved-value">
              <span>累计节省</span>
              <span>{{ formatFileSize(compressor.savedBytes.value) }}</span>
            </div>
          </div>
        </div>

        <div class="results-column">
          <div class="results-panel" role="region" aria-label="压缩记录">
            <div class="results-heading">
              <div class="results-copy">
                <span class="section-title">压缩记录</span>
                <span v-if="compressor.results.value.length" class="section-subtitle">
                  已压缩 {{ compressor.compressedCount.value }} · 不适用 {{ compressor.ineligibleCount.value }} · 失败
                  {{ compressor.errorCount.value }}
                </span>
              </div>
              <button
                type="button"
                :disabled="compressor.isBusy.value || !compressor.results.value.length"
                @click="compressor.downloadAll"
              >
                <LuDownload :size="16" aria-hidden="true" /><span>下载全部</span>
              </button>
            </div>

            <div v-if="!compressor.results.value.length" class="empty-results">
              <LuImage :size="48" aria-hidden="true" />
              <span class="empty-title">还没有压缩记录</span>
              <span>单张下载 PNG · 多张打包 ZIP</span>
            </div>
            <div v-else class="result-list" aria-live="polite">
              <div
                v-for="result in compressor.results.value"
                :key="result.id"
                class="result-item"
                :class="`is-${result.status}`"
              >
                <span class="result-icon">
                  <LuCheck v-if="result.status === 'compressed'" :size="17" aria-hidden="true" />
                  <LuAlertTriangle v-else :size="17" aria-hidden="true" />
                </span>
                <span class="result-thumbnail" :class="{ 'is-empty': !thumbnailUrls[result.id] }" aria-hidden="true">
                  <img v-if="thumbnailUrls[result.id]" :src="thumbnailUrls[result.id]" alt="" />
                </span>
                <div class="result-main">
                  <span class="result-name" :title="result.source.name">{{ result.source.name }}</span>
                  <span class="result-detail">
                    <span v-if="result.width && result.height" class="dimension-value">
                      {{ result.width }} × {{ result.height }}
                    </span>
                    <span v-if="result.width && result.height" class="detail-separator" aria-hidden="true">|</span>
                    <span class="size-detail">
                      <span>{{ formatFileSize(result.source.size) }}</span>
                      <LuArrowRight v-if="result.width && result.height" :size="14" aria-hidden="true" />
                      <span v-if="result.width && result.height">{{ formatFileSize(result.output.size) }}</span>
                    </span>
                    <span class="detail-separator" aria-hidden="true">|</span>
                    <span class="result-message">{{ result.message }}</span>
                  </span>
                </div>
                <div class="item-actions">
                  <span v-if="result.status === 'compressed'" class="size-change">
                    <span>{{ getSizeChange(result.source.size, result.output.size).value }}</span>
                    <span>{{ getSizeChange(result.source.size, result.output.size).percentage }}</span>
                  </span>
                  <span v-else class="status-label">{{ result.status === "unchanged" ? "未缩小" : "原图保留" }}</span>
                  <button
                    type="button"
                    :disabled="compressor.isBusy.value"
                    :aria-label="`下载 ${result.outputName}`"
                    :title="`下载 ${result.outputName}`"
                    @click="compressor.downloadResult(result)"
                  >
                    下载
                  </button>
                </div>
              </div>
            </div>

            <div
              v-if="compressor.isBusy.value || compressor.total.value"
              class="progress-panel"
              role="status"
              aria-live="polite"
            >
              <div class="progress-copy">
                <span>{{ compressor.isBusy.value ? "正在处理" : "处理完成" }}</span>
                <span>{{ compressor.completed.value }} / {{ compressor.total.value }}</span>
              </div>
              <div
                class="progress-track"
                role="progressbar"
                aria-label="PNG 压缩进度"
                aria-valuemin="0"
                aria-valuemax="100"
                :aria-valuenow="progressPercent"
              >
                <span :style="{ width: `${progressPercent}%` }"></span>
              </div>
              <span class="current-file" :title="compressor.currentFile.value">
                {{ compressor.currentFile.value || `${compressor.total.value} 张图片处理完成` }}
              </span>
            </div>
            <span v-if="compressor.downloadError.value" class="download-error" role="alert">
              {{ compressor.downloadError.value }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="less">
@import "./index.less";
</style>
