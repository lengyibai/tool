/** @description 音频选区，以采样帧为边界，结束帧不包含在导出范围内。 */
interface AudioSelection {
  /** 起始采样帧 */
  startFrame: number;
  /** 结束采样帧 */
  endFrame: number;
}

/** @description 波形中一个时间桶的采样极值。 */
interface WaveformPeak {
  /** 最小采样值 */
  min: number;
  /** 最大采样值 */
  max: number;
}

/** @description 原音波形与全文件电平统计。 */
interface AudioAnalysis {
  /** 波形采样极值 */
  peaks: WaveformPeak[];
  /** 原始全文件平均电平，单位 dBFS，静音为负无穷 */
  rmsDbfs: number;
  /** 原始全文件峰值电平，单位 dBFS，静音为负无穷 */
  peakDbfs: number;
}

export type { AudioAnalysis, AudioSelection, WaveformPeak };
