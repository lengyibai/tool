/** @description 单个音频的压缩结果 */
export interface AudioCompressionSuccess {
  /** 本批次内的稳定编号 */
  id: number;
  /** 处理结果 */
  state: "success";
  /** 原始文件名 */
  sourceName: string;
  /** 下载文件名 */
  outputName: string;
  /** 原始文件大小，单位字节 */
  originalSize: number;
  /** 压缩后文件大小，单位字节 */
  compressedSize: number;
  /** 原音频实际平均码率，单位 kbps */
  sourceBitrate: number;
  /** 实际输出码率，单位 kbps */
  outputBitrate: number;
  /** 音频时长，单位秒 */
  duration: number;
  /** MP3 文件数据 */
  blob: Blob;
}

/** @description 无法压缩的单个文件 */
export interface AudioCompressionFailure {
  /** 本批次内的稳定编号 */
  id: number;
  /** 处理结果 */
  state: "error";
  /** 原始文件名 */
  sourceName: string;
  /** 失败原因 */
  errorMessage: string;
}

export type AudioCompressionResult = AudioCompressionSuccess | AudioCompressionFailure;
