import type { Input, InputVideoTrack, CanvasSink } from "mediabunny";
import type { ParsedFrame } from "gifuct-js";

/** @description 原始画面中的裁剪区域 */
interface GifCrop {
  /** 左边缘像素坐标 */
  x: number;
  /** 上边缘像素坐标 */
  y: number;
  /** 宽度 */
  width: number;
  /** 高度 */
  height: number;
}

type GifQuality = "low" | "medium" | "high";

/** @description 已载入的 GIF 或视频 */
interface GifSource {
  /** 原文件 */
  file: File;
  /** 媒体类型 */
  kind: "gif" | "video";
  /** 原始画面宽度 */
  width: number;
  /** 原始画面高度 */
  height: number;
  /** 时长，单位秒 */
  duration: number;
  /** GIF 帧及其时间信息 */
  frames?: ParsedFrame[];
  /** GIF 各帧起始时间，单位秒 */
  frameStarts?: number[];
  /** GIF 背景色 */
  background?: [number, number, number] | null;
  /** GIF 背景色表索引 */
  backgroundIndex?: number;
  /** GIF 是否含透明像素 */
  hasTransparency?: boolean;
  /** GIF 画布背景是否透明 */
  transparentBackground?: boolean;
  /** 视频输入实例 */
  input?: Input;
  /** 视频轨道 */
  track?: InputVideoTrack;
  /** 视频画面读取器 */
  sink?: CanvasSink;
  /** 视频轨道起始时间 */
  firstTimestamp?: number;
}

/** @description GIF 导出参数 */
interface GifExportSettings {
  /** 选区开始时间，单位秒 */
  trimStart: number;
  /** 选区结束时间，单位秒 */
  trimEnd: number;
  /** 原始画面中的裁剪区域 */
  crop: GifCrop;
  /** 导出宽度 */
  width: number;
  /** 导出高度 */
  height: number;
  /** 色彩质量 */
  quality: GifQuality;
  /** 导出帧率；原帧率仅用于 GIF 输入 */
  frameRate: number | "original";
}

export type { GifCrop, GifExportSettings, GifQuality, GifSource };
