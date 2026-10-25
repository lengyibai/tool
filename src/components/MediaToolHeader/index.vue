<script setup lang="ts">
import ToolRouteSwitch from "@/components/ToolRouteSwitch/index.vue";

interface Props {
  /** 品牌图标地址 */
  logoSrc?: string;
  /** 页面标题 */
  title: string;
  /** 页面副标题 */
  subtitle: string;
  /** GitHub 链接的无障碍名称 */
  githubLabel: string;
}

defineProps<Props>();

const githubUrl = "https://github.com/lengyibai/tool";
</script>

<template>
  <div class="app-header">
    <div class="brand">
      <img v-if="logoSrc" class="brand-mark" :src="logoSrc" alt="" />
      <div v-else class="brand-mark is-icon"><slot name="mark" /></div>
      <div class="brand-copy">
        <span class="brand-title">{{ title }}</span>
        <span class="brand-subtitle">{{ subtitle }}</span>
      </div>
    </div>

    <div class="header-actions">
      <ToolRouteSwitch />
      <a
        class="github-link"
        :href="githubUrl"
        target="_blank"
        rel="noopener noreferrer"
        :aria-label="githubLabel"
        :title="githubLabel"
      >
        <img src="@/assets/img/github.png" alt="" />
      </a>
    </div>
  </div>
</template>

<style scoped lang="less">
@import "./index.less";
</style>
