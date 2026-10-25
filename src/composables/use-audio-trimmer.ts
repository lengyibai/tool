import { useStorage } from "@vueuse/core";
import { onDeactivated, onUnmounted, ref, shallowRef } from "vue";

import { analyzeAudio, encodeMp3 } from "@/services/audio-trimmer";
import { trimMp3Padding } from "@/services/mp3-gapless";
import type { AudioSelection, WaveformPeak } from "@/types/audio-trimmer";
import { toMp3Name } from "@/utils/files";

interface PreparedAudioExport {
  /** 编码后的本地文件 */
  blob: Blob;
  /** 下载文件名 */
  filename: string;
}

const useAudioTrimmer = () => {
  /** 当前文件 */
  const file = shallowRef<File | null>(null);
  /** 已解码音频 */
  const buffer = shallowRef<AudioBuffer | null>(null);
  /** 波形采样极值 */
  const peaks = shallowRef<WaveformPeak[]>([]);
  /** 原音全文件平均电平，单位 dBFS */
  const rmsDbfs = ref(-Infinity);
  /** 原音全文件峰值电平，单位 dBFS */
  const peakDbfs = ref(-Infinity);
  /** 应用于试听与导出的增益，单位 dB */
  const gainDb = ref(0);
  /** 选区末尾的淡出时长，单位秒 */
  const fadeOutSeconds = ref(0);
  /** 当前采样帧选区 */
  const selection = ref<AudioSelection>({ startFrame: 0, endFrame: 0 });
  /** 播放头位置 */
  const playheadFrame = ref<number | null>(null);
  /** 文件载入状态 */
  const isLoading = ref(false);
  /** 试听状态 */
  const isPlaying = ref(false);
  /** 播放启动状态 */
  const playPending = ref(false);
  /** 是否循环试听当前选区 */
  const loopEnabled = useStorage("audio-trim:loop", true);
  /** 操作反馈 */
  const status = ref({ message: "", isError: false });
  /** MP3 导出码率，单位 kbps */
  const mp3Bitrate = useStorage("audio-trim:bitrate", 128);
  /** 文件生成状态 */
  const isExporting = ref(false);
  /** 已生成且可再次下载的文件 */
  const preparedExport = shallowRef<PreparedAudioExport | null>(null);
  const mp3Bitrates = [128, 192, 256, 320] as const;
  if (!mp3Bitrates.some((bitrate) => bitrate === mp3Bitrate.value)) mp3Bitrate.value = 128;

  let audioContext: AudioContext | null = null;
  let gainNode: GainNode | null = null;
  let fadeNode: GainNode | null = null;
  let source: AudioBufferSourceNode | null = null;
  let nextFadeCycleTime = 0;
  let playStartTime = 0;
  let playStartFrame = 0;
  let pausedFrame: number | null = null;
  let animationFrame = 0;
  let playId = 0;
  let loadId = 0;
  let exportId = 0;
  let exportController: AbortController | null = null;

  const setStatus = (message: string, isError = false) => {
    status.value = { message, isError };
  };

  const invalidateExport = () => {
    if (isExporting.value || preparedExport.value) setStatus("");
    exportId++;
    exportController?.abort();
    exportController = null;
    isExporting.value = false;
    preparedExport.value = null;
  };

  const getFadeFrames = () => {
    const audio = buffer.value;
    if (!audio) return 0;
    return Math.min(
      selection.value.endFrame - selection.value.startFrame,
      Math.round(fadeOutSeconds.value * audio.sampleRate),
    );
  };

  const scheduleFadePeriod = (node: GainNode, firstFrame: number, startTime: number, fadeFrames: number) => {
    const audio = buffer.value;
    if (!audio) return;
    const fadeStartFrame = selection.value.endFrame - fadeFrames;
    const level =
      firstFrame < fadeStartFrame
        ? 1
        : fadeFrames <= 1
          ? 0
          : (selection.value.endFrame - 1 - firstFrame) / (fadeFrames - 1);
    node.gain.setValueAtTime(level, startTime);
    if (firstFrame < fadeStartFrame)
      node.gain.setValueAtTime(1, startTime + (fadeStartFrame - firstFrame) / audio.sampleRate);
    const fadeEndTime = startTime + (selection.value.endFrame - 1 - firstFrame) / audio.sampleRate;
    if (fadeFrames <= 1) node.gain.setValueAtTime(0, fadeEndTime);
    else if (fadeEndTime > startTime) node.gain.linearRampToValueAtTime(0, fadeEndTime);
  };

  const scheduleFadeCycles = () => {
    if (!fadeNode || !audioContext || !buffer.value || !loopEnabled.value) return;
    const cycleSeconds = (selection.value.endFrame - selection.value.startFrame) / buffer.value.sampleRate;
    const fadeFrames = getFadeFrames();
    let scheduled = 0;
    //提前安排循环边界，避免每次回到选区起点时延迟恢复音量。
    while (nextFadeCycleTime < audioContext.currentTime + 10 && scheduled < 512) {
      scheduleFadePeriod(fadeNode, selection.value.startFrame, nextFadeCycleTime, fadeFrames);
      nextFadeCycleTime += cycleSeconds;
      scheduled++;
    }
  };

  const getPlaybackFrame = () => {
    if (!audioContext || !buffer.value) return selection.value.startFrame;
    const elapsedFrames = Math.max(0, audioContext.currentTime - playStartTime) * buffer.value.sampleRate;
    const frame = playStartFrame + elapsedFrames;
    if (!loopEnabled.value) return Math.min(selection.value.endFrame, frame);
    const selectedFrames = selection.value.endFrame - selection.value.startFrame;
    return selection.value.startFrame + ((frame - selection.value.startFrame) % selectedFrames);
  };

  const updatePlayhead = () => {
    if (!source || !audioContext || !buffer.value) return;
    scheduleFadeCycles();
    playheadFrame.value = getPlaybackFrame();
    animationFrame = requestAnimationFrame(updatePlayhead);
  };

  const stopPlayback = (pause = false) => {
    playId++;
    cancelAnimationFrame(animationFrame);
    if (source) {
      if (pause && audioContext && buffer.value) pausedFrame = Math.floor(getPlaybackFrame());
      const previousSource = source;
      source = null;
      previousSource.onended = null;
      previousSource.stop();
      previousSource.disconnect();
    }
    fadeNode?.disconnect();
    fadeNode = null;
    if (!pause) pausedFrame = null;
    isPlaying.value = false;
    playheadFrame.value = pausedFrame;
  };

  const loadFile = async (nextFile: File) => {
    const currentLoad = ++loadId;
    invalidateExport();
    stopPlayback();
    file.value = null;
    buffer.value = null;
    peaks.value = [];
    rmsDbfs.value = -Infinity;
    peakDbfs.value = -Infinity;
    gainDb.value = 0;
    fadeOutSeconds.value = 0;
    isLoading.value = true;
    setStatus("正在读取音频…");

    try {
      const data = await nextFile.arrayBuffer();
      const header = data.slice(0, Math.min(data.byteLength, 65536));
      audioContext ??= new AudioContext();
      const decoded = trimMp3Padding(header, await audioContext.decodeAudioData(data), audioContext);
      if (currentLoad !== loadId) return;
      if (!decoded.length || !decoded.numberOfChannels) throw new Error("音频文件没有可裁剪的采样数据。");
      const analysis = analyzeAudio(decoded);
      if (currentLoad !== loadId) return;

      file.value = nextFile;
      buffer.value = decoded;
      peaks.value = analysis.peaks;
      rmsDbfs.value = analysis.rmsDbfs;
      peakDbfs.value = analysis.peakDbfs;
      selection.value = { startFrame: 0, endFrame: decoded.length };
      setStatus("音频已载入，可以调整选区。");
    } catch (error) {
      if (currentLoad !== loadId) return;
      const message =
        error instanceof Error && error.message === "音频文件没有可裁剪的采样数据。"
          ? error.message
          : "无法解码此音频文件，请尝试当前浏览器支持的格式。";
      setStatus(message, true);
    } finally {
      if (currentLoad === loadId) isLoading.value = false;
    }
  };

  const setSelection = (nextSelection: AudioSelection) => {
    if (
      !buffer.value ||
      nextSelection.startFrame < 0 ||
      nextSelection.endFrame > buffer.value.length ||
      nextSelection.startFrame >= nextSelection.endFrame
    )
      return;
    stopPlayback();
    invalidateExport();
    selection.value = nextSelection;
    fadeOutSeconds.value = Math.min(
      fadeOutSeconds.value,
      Math.floor(((nextSelection.endFrame - nextSelection.startFrame) / buffer.value.sampleRate) * 1000) / 1000,
    );
    setStatus("");
  };

  const selectAll = () => {
    if (buffer.value) setSelection({ startFrame: 0, endFrame: buffer.value.length });
  };

  const startPlayback = (firstFrame: number) => {
    const context = audioContext;
    const audio = buffer.value;
    if (!context || !audio) return;
    const nextSource = context.createBufferSource();
    nextSource.buffer = audio;
    if (!gainNode) {
      gainNode = context.createGain();
      gainNode.connect(context.destination);
    }
    gainNode.gain.value = 10 ** (gainDb.value / 20);
    const startTime = context.currentTime + 0.02;
    const fadeFrames = getFadeFrames();
    if (fadeFrames) {
      fadeNode = context.createGain();
      nextSource.connect(fadeNode);
      fadeNode.connect(gainNode);
      scheduleFadePeriod(fadeNode, firstFrame, startTime, fadeFrames);
      nextFadeCycleTime = startTime + (selection.value.endFrame - firstFrame) / audio.sampleRate;
    } else nextSource.connect(gainNode);
    nextSource.loop = loopEnabled.value;
    if (loopEnabled.value) {
      nextSource.loopStart = selection.value.startFrame / audio.sampleRate;
      nextSource.loopEnd = selection.value.endFrame / audio.sampleRate;
    }
    nextSource.onended = () => {
      if (source !== nextSource) return;
      source = null;
      nextSource.disconnect();
      fadeNode?.disconnect();
      fadeNode = null;
      pausedFrame = null;
      isPlaying.value = false;
      playheadFrame.value = selection.value.endFrame;
      cancelAnimationFrame(animationFrame);
    };
    if (loopEnabled.value) nextSource.start(startTime, firstFrame / audio.sampleRate);
    else
      nextSource.start(
        startTime,
        firstFrame / audio.sampleRate,
        (selection.value.endFrame - firstFrame) / audio.sampleRate,
      );
    source = nextSource;
    playStartTime = startTime;
    playStartFrame = firstFrame;
    pausedFrame = null;
    isPlaying.value = true;
    updatePlayhead();
  };

  const seekPlayback = (frame: number) => {
    if (!source || !buffer.value || !Number.isFinite(frame)) return;
    const firstFrame = Math.max(selection.value.startFrame, Math.min(selection.value.endFrame - 1, Math.round(frame)));
    stopPlayback();
    try {
      startPlayback(firstFrame);
    } catch {
      stopPlayback();
      setStatus("无法播放这段音频。", true);
    }
  };

  const togglePlayback = async () => {
    if (!buffer.value || !audioContext || playPending.value) return;
    if (source) {
      stopPlayback(true);
      return;
    }

    const currentLoad = loadId;
    const currentPlay = ++playId;
    playPending.value = true;
    try {
      await audioContext.resume();
      if (currentLoad !== loadId || currentPlay !== playId || !buffer.value) return;
      const firstFrame =
        pausedFrame !== null && pausedFrame < selection.value.endFrame ? pausedFrame : selection.value.startFrame;
      startPlayback(firstFrame);
    } catch {
      if (currentLoad === loadId && currentPlay === playId) {
        stopPlayback();
        setStatus("无法播放这段音频。", true);
      }
    } finally {
      playPending.value = false;
    }
  };

  const setLoopEnabled = (enabled: boolean) => {
    if (loopEnabled.value === enabled) return;
    const restart = isPlaying.value;
    if (restart) stopPlayback(true);
    loopEnabled.value = enabled;
    if (restart) void togglePlayback();
  };

  const setGainDb = (value: number) => {
    if (!Number.isFinite(value)) return;
    const nextGain = Math.max(-24, Math.min(24, value));
    if (gainDb.value !== nextGain) invalidateExport();
    gainDb.value = nextGain;
    if (gainNode && audioContext)
      gainNode.gain.setTargetAtTime(10 ** (gainDb.value / 20), audioContext.currentTime, 0.01);
  };

  const setFadeOutSeconds = (value: number) => {
    if (!Number.isFinite(value) || !buffer.value) return;
    const maxSeconds =
      Math.floor(((selection.value.endFrame - selection.value.startFrame) / buffer.value.sampleRate) * 1000) / 1000;
    const nextSeconds = Math.max(0, Math.min(maxSeconds, Math.round(value * 1000) / 1000));
    if (fadeOutSeconds.value === nextSeconds) return;
    const restart = isPlaying.value;
    if (restart) stopPlayback(true);
    invalidateExport();
    fadeOutSeconds.value = nextSeconds;
    if (restart) void togglePlayback();
  };

  const setMp3Bitrate = (bitrate: number) => {
    if (!mp3Bitrates.some((option) => option === bitrate) || mp3Bitrate.value === bitrate) return;
    invalidateExport();
    mp3Bitrate.value = bitrate;
  };

  const triggerDownload = (output: PreparedAudioExport) => {
    const url = URL.createObjectURL(output.blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = output.filename;
    try {
      link.click();
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  };

  const downloadExport = async () => {
    const audio = buffer.value;
    const inputFile = file.value;
    if (!audio || !inputFile || isExporting.value) return;
    if (preparedExport.value) {
      try {
        triggerDownload(preparedExport.value);
        setStatus("");
      } catch {
        setStatus("无法下载文件，请重试。", true);
      }
      return;
    }
    invalidateExport();
    const currentExport = exportId;
    const controller = new AbortController();
    exportController = controller;
    isExporting.value = true;
    setStatus("正在生成文件…");
    try {
      const encoded = await encodeMp3(
        audio,
        selection.value,
        gainDb.value,
        mp3Bitrate.value,
        controller.signal,
        getFadeFrames(),
        true,
      );
      if (controller.signal.aborted || currentExport !== exportId) return;
      const output = {
        blob: new Blob([encoded], { type: "audio/mpeg" }),
        filename: toMp3Name(inputFile.name),
      };
      triggerDownload(output);
      preparedExport.value = output;
      setStatus("");
    } catch (error) {
      if (currentExport === exportId && !controller.signal.aborted)
        setStatus(error instanceof Error ? error.message : "导出失败，请缩短选区后重试。", true);
    } finally {
      if (currentExport === exportId) {
        isExporting.value = false;
        exportController = null;
      }
    }
  };

  onDeactivated(() => {
    invalidateExport();
    stopPlayback();
  });
  onUnmounted(() => {
    loadId++;
    invalidateExport();
    stopPlayback();
    if (audioContext) void audioContext.close();
  });

  return {
    file,
    buffer,
    peaks,
    rmsDbfs,
    peakDbfs,
    gainDb,
    fadeOutSeconds,
    selection,
    playheadFrame,
    isLoading,
    isPlaying,
    playPending,
    loopEnabled,
    status,
    mp3Bitrate,
    mp3Bitrates,
    isExporting,
    preparedExport,
    loadFile,
    setSelection,
    selectAll,
    togglePlayback,
    seekPlayback,
    setLoopEnabled,
    setGainDb,
    setFadeOutSeconds,
    setMp3Bitrate,
    downloadExport,
  };
};

export { useAudioTrimmer };
