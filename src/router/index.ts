import { createRouter, createWebHashHistory } from "vue-router";
import type { RouteRecordRaw } from "vue-router";

const routes: RouteRecordRaw[] = [
  {
    path: "/",
    name: "home",
    component: () => import("@/views/HomeView/index.vue"),
    meta: { title: "本地媒体工作台" },
  },
  {
    path: "/webp",
    name: "image-converter",
    component: () => import("@/views/ImageConverterView/index.vue"),
    meta: { title: "WebP 图片转换器" },
  },
  {
    path: "/video",
    name: "video-compressor",
    component: () => import("@/views/VideoCompressorView/index.vue"),
    meta: { title: "视频压缩器" },
  },
  {
    path: "/audio",
    name: "audio-trimmer",
    component: () => import("@/views/AudioTrimmerView/index.vue"),
    meta: { title: "音频裁剪" },
  },
  {
    path: "/audio-compress",
    name: "audio-compressor",
    component: () => import("@/views/AudioCompressorView/index.vue"),
    meta: { title: "音频压缩" },
  },
  {
    path: "/gif",
    name: "gif-editor",
    component: () => import("@/views/GifEditorView/index.vue"),
    meta: { title: "GIF 编辑器" },
  },
  {
    path: "/:pathMatch(.*)*",
    redirect: "/",
  },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

router.afterEach((route) => {
  if (typeof route.meta.title === "string") document.title = route.meta.title;
});

export { router };
