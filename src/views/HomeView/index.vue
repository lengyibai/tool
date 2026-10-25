<script setup lang="ts">
import { RouterLink } from "vue-router";
import {
  LuArrowUpRight,
  LuAudioLines,
  LuCheck,
  LuFileAudio,
  LuFileImage,
  LuFilm,
  LuGithub,
  LuImage,
  LuShieldCheck,
} from "vue-icons-plus/lu";

const tools = [
  {
    path: "/webp",
    icon: LuFileImage,
    eyebrow: "IMAGE / 01",
    title: "图片转换",
    description: "批量将 JPG、PNG、GIF 转为轻量 WebP，保留清晰度，缩小体积。",
    detail: "支持质量与最长边调整",
    tone: "mint",
  },
  {
    path: "/video",
    icon: LuFilm,
    eyebrow: "VIDEO / 02",
    title: "视频压缩",
    description: "在浏览器本地压缩视频，快速得到更易分享、更省空间的文件。",
    detail: "支持 MP4、MOV 等常见格式",
    tone: "blue",
  },
  {
    path: "/audio",
    icon: LuAudioLines,
    eyebrow: "AUDIO / 03",
    title: "音频裁剪",
    description: "选择一段音频，试听并导出 MP3 文件。",
    detail: "支持波形选区与精确时间输入",
    tone: "amber",
  },
  {
    path: "/audio-compress",
    icon: LuFileAudio,
    eyebrow: "AUDIO / 04",
    title: "音频压缩",
    description: "批量将音频转换为 MP3，按原音码率设置输出上限。",
    detail: "逐项查看体积并批量下载",
    tone: "blue",
  },
  {
    path: "/gif",
    icon: LuImage,
    eyebrow: "GIF / 05",
    title: "GIF 编辑",
    description: "裁剪动画画面与时长，或把视频片段制作为 GIF。",
    detail: "先生成预览，再决定下载",
    tone: "mint",
  },
] as const;

const principles = [
  "文件始终留在你的设备",
  "无需注册，不限次数",
  "处理完成后随时下载",
];
</script>

<template>
  <div class="home-page">
    <div class="home-shell">
      <div class="topbar">
        <RouterLink to="/" class="brand" aria-label="返回本地媒体工作台">
          <span class="brand-mark">//</span>
          <span class="brand-name">LOCAL<span>MEDIA</span></span>
        </RouterLink>
        <div class="topbar-status"><span class="status-dot"></span><span>处理在本地完成</span></div>
      </div>

      <div class="hero">
        <div class="hero-copy">
          <span class="hero-kicker">YOUR FILES. YOUR DEVICE.</span>
          <span class="hero-title">把媒体处理，<br /><span>留在本地。</span></span>
          <span class="hero-description">一个安静、快速的媒体工具箱。图片、视频和音频都在本地处理，打开即用。</span>
        </div>
        <div class="hero-orbit" aria-hidden="true">
          <span class="orbit-ring ring-one"></span>
          <span class="orbit-ring ring-two"></span>
          <span class="orbit-core">LM</span>
          <span class="orbit-label label-top">PRIVATE BY DEFAULT</span>
          <span class="orbit-label label-bottom">100% LOCAL</span>
        </div>
      </div>

      <div class="tool-grid">
        <RouterLink v-for="tool in tools" :key="tool.path" :to="tool.path" class="tool-card" :class="`is-${tool.tone}`">
          <div class="tool-card-top"><span class="tool-eyebrow">{{ tool.eyebrow }}</span><LuArrowUpRight :size="22" aria-hidden="true" /></div>
          <div class="tool-icon"><component :is="tool.icon" :size="26" stroke-width="1.8" aria-hidden="true" /></div>
          <span class="tool-title">{{ tool.title }}</span>
          <span class="tool-description">{{ tool.description }}</span>
          <span class="tool-detail"><LuCheck :size="15" aria-hidden="true" />{{ tool.detail }}</span>
        </RouterLink>
      </div>

      <div class="bottom-row">
        <div class="privacy-panel">
          <div class="privacy-icon"><LuShieldCheck :size="20" aria-hidden="true" /></div>
          <div class="privacy-copy"><span class="privacy-title">隐私优先的工作流</span><span class="privacy-text">文件不会离开当前浏览器标签页。</span></div>
          <div class="principle-list"><span v-for="principle in principles" :key="principle">{{ principle }}</span></div>
        </div>
        <a class="source-link" href="https://github.com/lengyibai/tool" target="_blank" rel="noopener noreferrer"><LuGithub :size="17" aria-hidden="true" /><span>查看源码</span><LuArrowUpRight :size="16" aria-hidden="true" /></a>
      </div>

    </div>
  </div>
</template>

<style scoped lang="less">
@import "./index.less";
</style>
