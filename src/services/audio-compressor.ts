import { ALL_FORMATS, BlobSource, Input } from "mediabunny";

import { encodeMp3 } from "@/services/audio-trimmer";

const mp3Bitrates = [32, 48, 64, 96, 128, 160, 192, 224, 256, 320] as const;

const throwIfAborted = (signal: AbortSignal) => {
  if (signal.aborted) throw new DOMException("音频压缩已取消。", "AbortError");
};

/** @description 读取音轨全部编码包，避免容器元数据或标签影响码率上限。 */
const readSourceBitrate = async (file: File, signal: AbortSignal): Promise<number> => {
  //只读取本地文件的音轨包统计，不将文件发送到外部服务。
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const handleAbort = () => input.dispose();
  signal.addEventListener("abort", handleAbort, { once: true });
  try {
    throwIfAborted(signal);
    if (!(await input.canRead())) throw new Error("无法读取此音频的源码率。", { cause: "unsupported" });
    const [audioTracks, videoTracks] = await Promise.all([input.getAudioTracks(), input.getVideoTracks()]);
    if (!audioTracks.length || videoTracks.length) throw new Error("请选择纯音频文件。", { cause: "unsupported" });
    if (audioTracks.length > 1) throw new Error("此文件包含多个音轨，无法确定源码率。", { cause: "unsupported" });
    const stats = await audioTracks[0].computePacketStats();
    throwIfAborted(signal);
    if (!Number.isFinite(stats.averageBitrate) || stats.averageBitrate <= 0)
      throw new Error("无法可靠读取此音频的源码率。", { cause: "unsupported" });
    return stats.averageBitrate / 1000;
  } catch (error) {
    throwIfAborted(signal);
    if (error instanceof Error && error.cause === "unsupported") throw error;
    throw new Error("无法可靠读取此音频的源码率。");
  } finally {
    signal.removeEventListener("abort", handleAbort);
    if (!input.disposed) input.dispose();
  }
};

const compressAudio = async (file: File, targetBitrate: number, signal: AbortSignal) => {
  const sourceBitrate = await readSourceBitrate(file, signal);
  const outputBitrate = mp3Bitrates.filter((bitrate) => bitrate <= targetBitrate && bitrate <= sourceBitrate).pop();
  if (!outputBitrate) throw new Error("原音频码率低于 MP3 最低输出档位 32 kbps。");

  const context = new AudioContext();
  try {
    const data = await file.arrayBuffer();
    throwIfAborted(signal);
    let audio: AudioBuffer;
    try {
      audio = await context.decodeAudioData(data);
    } catch {
      throw new Error("当前浏览器无法解码此音频文件。");
    }
    throwIfAborted(signal);
    if (!audio.length || !audio.numberOfChannels) throw new Error("音频文件没有可处理的采样数据。");
    const encoded = await encodeMp3(audio, { startFrame: 0, endFrame: audio.length }, 0, outputBitrate, signal);
    return {
      blob: new Blob([encoded], { type: "audio/mpeg" }),
      duration: audio.duration,
      sourceBitrate,
      outputBitrate,
    };
  } finally {
    await context.close();
  }
};

export { compressAudio, mp3Bitrates };
