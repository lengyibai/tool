export interface PngWorkerRequest {
  /** 输入 PNG 文件内容 */
  buffer: ArrayBuffer;
}

export type PngWorkerResponse =
  | {
      status: "compressed";
      /** 索引色 PNG 文件内容 */
      buffer: ArrayBuffer;
      /** 图片宽度 */
      width: number;
      /** 图片高度 */
      height: number;
      /** 不同的可见 RGBA 颜色数 */
      colorCount: number;
      /** 输出索引位深 */
      bitDepth: number;
    }
  | {
      status: "ineligible" | "error";
      /** 无法压缩的原因 */
      reason: string;
      /** 图片宽度 */
      width?: number;
      /** 图片高度 */
      height?: number;
      /** 已统计的颜色数 */
      colorCount?: number;
    };

export interface PngCompressionResult {
  /** 结果编号 */
  id: number;
  /** 原始文件 */
  source: File;
  /** 最终下载文件 */
  output: Blob;
  /** 下载文件名 */
  outputName: string;
  /** 处理状态 */
  status: "compressed" | "unchanged" | "ineligible" | "error";
  /** 状态说明 */
  message: string;
  /** 图片宽度 */
  width?: number;
  /** 图片高度 */
  height?: number;
  /** 可见颜色数 */
  colorCount?: number;
  /** 索引位深 */
  bitDepth?: number;
}
