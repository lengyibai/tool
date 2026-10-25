import { registerMp3Encoder } from "@mediabunny/mp3-encoder";
import { AudioBufferSource, BufferTarget, canEncodeAudio, Mp3OutputFormat, Output, Quality } from "mediabunny";

import { addMp3GaplessInfo } from "./mp3-gapless";

import type { AudioAnalysis, AudioSelection, WaveformPeak } from "@/types/audio-trimmer";

const analyzeAudio = (buffer: AudioBuffer): AudioAnalysis => {
  const count = Math.min(1600, buffer.length);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
  const peaks: WaveformPeak[] = [];
  let sumSquares = 0;
  let absolutePeak = 0;

  for (let bucket = 0; bucket < count; bucket++) {
    let min = 0;
    let max = 0;
    const first = Math.floor((bucket * buffer.length) / count);
    const last = Math.floor(((bucket + 1) * buffer.length) / count);

    for (let frame = first; frame < last; frame++) {
      for (const samples of channels) {
        const sample = samples[frame];
        min = Math.min(min, sample);
        max = Math.max(max, sample);
        sumSquares += sample * sample;
        absolutePeak = Math.max(absolutePeak, Math.abs(sample));
      }
    }
    peaks.push({ min, max });
  }

  const rms = Math.sqrt(sumSquares / (buffer.length * buffer.numberOfChannels));
  return {
    peaks,
    rmsDbfs: rms > 0 ? 20 * Math.log10(rms) : -Infinity,
    peakDbfs: absolutePeak > 0 ? 20 * Math.log10(absolutePeak) : -Infinity,
  };
};

const encodeMp3 = async (
  buffer: AudioBuffer,
  selection: AudioSelection,
  gainDb: number,
  bitrateKbps: number,
  signal: AbortSignal,
  fadeFrames = 0,
  gapless = false,
): Promise<ArrayBuffer> => {
  const quality = new Quality({ bitrate: bitrateKbps * 1000 });
  const channels = Math.min(2, buffer.numberOfChannels);
  if (gapless || !(await canEncodeAudio("mp3", { numberOfChannels: channels, sampleRate: 44100, quality }))) {
    registerMp3Encoder();
  }

  const target = new BufferTarget();
  const output = new Output({ format: new Mp3OutputFormat(), target });
  let encodedFrameCount = 0;
  const source = new AudioBufferSource({
    codec: "mp3",
    quality,
    transform: { numberOfChannels: channels, sampleRate: 44100 },
    onEncodedSample: gapless ? (sample) => (encodedFrameCount += sample.numberOfFrames) : undefined,
  });
  output.addAudioTrack(source);

  try {
    if (signal.aborted) throw new DOMException("已取消生成。", "AbortError");
    await output.start();
    const gain = 10 ** (gainDb / 20);
    const fadeStartFrame = selection.endFrame - fadeFrames;
    //分块复制选区，避免为长音频再创建一整份未压缩缓冲区。
    for (let start = selection.startFrame; start < selection.endFrame; start += buffer.sampleRate) {
      if (signal.aborted) throw new DOMException("已取消生成。", "AbortError");
      const length = Math.min(buffer.sampleRate, selection.endFrame - start);
      const chunk = new AudioBuffer({
        length,
        numberOfChannels: buffer.numberOfChannels,
        sampleRate: buffer.sampleRate,
      });
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const input = buffer.getChannelData(channel).subarray(start, start + length);
        const samples = chunk.getChannelData(channel);
        if (gain === 1 && start + length <= fadeStartFrame) samples.set(input);
        else
          for (let frame = 0; frame < length; frame++) {
            const currentFrame = start + frame;
            const fade =
              currentFrame < fadeStartFrame
                ? 1
                : fadeFrames <= 1
                  ? 0
                  : (selection.endFrame - 1 - currentFrame) / (fadeFrames - 1);
            samples[frame] = Math.max(-1, Math.min(1, input[frame] * gain * fade));
          }
      }
      await source.add(chunk);
    }
    if (signal.aborted) throw new DOMException("已取消生成。", "AbortError");
    source.close();
    await output.finalize();
    if (!target.buffer) throw new Error("浏览器未生成有效的 MP3 文件。");
    return gapless ? addMp3GaplessInfo(target.buffer, encodedFrameCount, bitrateKbps) : target.buffer;
  } catch (error) {
    await output.cancel();
    throw error;
  }
};

export { analyzeAudio, encodeMp3 };
