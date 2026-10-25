interface Mp3Frame {
  /** MPEG 帧字节长度 */
  byteLength: number;
  /** 每帧解码后的采样数 */
  sampleCount: number;
  /** 帧采样率 */
  sampleRate: number;
  /** Xing 标记相对帧起点的偏移 */
  xingOffset: number;
}

interface GaplessInfo {
  /** MP3 帧采样率 */
  sampleRate: number;
  /** 编码帧的总采样数 */
  paddedSamples: number;
  /** LAME 标记中的编码延迟 */
  delay: number;
  /** LAME 标记中的末尾填充 */
  padding: number;
}

const lameDelay = 576;
const decoderDelay = 529;
const lameVersion = "LAME3.100";
const mpeg1Bitrates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const mpeg2Bitrates = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const sampleRates = [44100, 48000, 32000];

const readFrame = (bytes: Uint8Array, offset: number): Mp3Frame | null => {
  if (offset + 4 > bytes.length || bytes[offset] !== 0xff || (bytes[offset + 1] & 0xe0) !== 0xe0) return null;
  const version = (bytes[offset + 1] >> 3) & 3;
  const layer = (bytes[offset + 1] >> 1) & 3;
  const bitrateIndex = (bytes[offset + 2] >> 4) & 15;
  const rateIndex = (bytes[offset + 2] >> 2) & 3;
  if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null;

  const bitrate = (version === 3 ? mpeg1Bitrates : mpeg2Bitrates)[bitrateIndex] * 1000;
  const sampleRate = sampleRates[rateIndex] / (version === 3 ? 1 : version === 2 ? 2 : 4);
  const byteLength = Math.floor(((version === 3 ? 144 : 72) * bitrate) / sampleRate) + ((bytes[offset + 2] >> 1) & 1);
  const mono = (bytes[offset + 3] & 0xc0) === 0xc0;
  const xingOffset = 4 + (version === 3 ? (mono ? 17 : 32) : mono ? 9 : 17);
  return offset + byteLength <= bytes.length
    ? { byteLength, sampleCount: version === 3 ? 1152 : 576, sampleRate, xingOffset }
    : null;
};

const readUint32 = (bytes: Uint8Array, offset: number) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset);
const writeUint32 = (bytes: Uint8Array, offset: number, value: number) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value);

const readXing = (bytes: Uint8Array, frameOffset: number, frame: Mp3Frame) => {
  const offset = frameOffset + frame.xingOffset;
  if (offset + 8 > frameOffset + frame.byteLength) return null;
  const marker = String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (marker !== "Xing" && marker !== "Info") return null;
  const flags = readUint32(bytes, offset + 4);
  let cursor = offset + 8;
  const countOffset = flags & 1 ? cursor : -1;
  if (flags & 1) cursor += 4;
  const sizeOffset = flags & 2 ? cursor : -1;
  if (flags & 2) cursor += 4;
  if (flags & 4) cursor += 100;
  if (flags & 8) cursor += 4;
  return cursor <= frameOffset + frame.byteLength
    ? { offset, flags, countOffset, sizeOffset, lameOffset: cursor }
    : null;
};

const firstFrameOffset = (bytes: Uint8Array) => {
  if (bytes.length < 10 || String.fromCharCode(...bytes.subarray(0, 3)) !== "ID3") return 0;
  const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
  return 10 + size + ((bytes[5] & 0x10) !== 0 ? 10 : 0);
};

const updateCrc = (bytes: Uint8Array, start: number, end: number, initial = 0) => {
  let crc = initial;
  for (let index = start; index < end; index++) {
    crc ^= bytes[index];
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >> 1) ^ 0xa001 : crc >> 1;
  }
  return crc;
};

const addMp3GaplessInfo = (data: ArrayBuffer, inputSamples: number, bitrateKbps: number) => {
  const bytes = new Uint8Array(data);
  const frameOffset = firstFrameOffset(bytes);
  const firstFrame = readFrame(bytes, frameOffset);
  if (!firstFrame) throw new Error("无法识别生成的 MP3 帧。");
  const xing = readXing(bytes, frameOffset, firstFrame);
  if (!xing || xing.countOffset < 0 || xing.sizeOffset < 0) throw new Error("生成的 MP3 缺少 Xing 信息。");

  let offset = frameOffset + firstFrame.byteLength;
  let frameCount = 0;
  while (offset < bytes.length) {
    const frame = readFrame(bytes, offset);
    if (!frame || frame.sampleRate !== firstFrame.sampleRate || frame.sampleCount !== firstFrame.sampleCount)
      throw new Error("生成的 MP3 帧不连续。");
    frameCount++;
    offset += frame.byteLength;
  }

  const padding = frameCount * firstFrame.sampleCount - inputSamples - lameDelay;
  if (!frameCount || padding < decoderDelay || padding > 0xfff) throw new Error("无法确定 MP3 的首尾填充长度。");

  //取消 TOC 字段，为同一 Xing 帧中的 LAME 标签留出空间，音频帧字节保持不变。
  writeUint32(bytes, xing.offset + 4, 0xb);
  writeUint32(bytes, xing.countOffset, frameCount);
  writeUint32(bytes, xing.sizeOffset, bytes.length - frameOffset);
  writeUint32(bytes, xing.offset + 16, 0);
  const lameOffset = xing.offset + 20;
  if (lameOffset + 36 > frameOffset + firstFrame.byteLength) throw new Error("MP3 头部没有足够的标签空间。");
  bytes.fill(0, lameOffset, lameOffset + 36);
  for (let index = 0; index < lameVersion.length; index++) bytes[lameOffset + index] = lameVersion.charCodeAt(index);
  bytes[lameOffset + 9] = 1;
  bytes[lameOffset + 20] = Math.min(255, bitrateKbps);
  bytes[lameOffset + 21] = lameDelay >> 4;
  bytes[lameOffset + 22] = ((lameDelay & 15) << 4) | (padding >> 8);
  bytes[lameOffset + 23] = padding & 0xff;
  writeUint32(bytes, lameOffset + 28, bytes.length - frameOffset - firstFrame.byteLength);
  const musicCrc = updateCrc(bytes, frameOffset + firstFrame.byteLength, bytes.length);
  bytes[lameOffset + 32] = musicCrc >> 8;
  bytes[lameOffset + 33] = musicCrc & 0xff;
  const tagCrc = updateCrc(bytes, frameOffset, lameOffset + 34);
  bytes[lameOffset + 34] = tagCrc >> 8;
  bytes[lameOffset + 35] = tagCrc & 0xff;
  return data;
};

const readMp3GaplessInfo = (data: ArrayBuffer): GaplessInfo | null => {
  const bytes = new Uint8Array(data);
  const frameOffset = firstFrameOffset(bytes);
  const frame = readFrame(bytes, frameOffset);
  if (!frame) return null;
  const xing = readXing(bytes, frameOffset, frame);
  if (!xing || xing.flags !== 0xb || xing.countOffset < 0 || xing.lameOffset + 36 > frameOffset + frame.byteLength)
    return null;
  const version = String.fromCharCode(...bytes.subarray(xing.lameOffset, xing.lameOffset + 9));
  if (version !== lameVersion) return null;
  const delay = (bytes[xing.lameOffset + 21] << 4) | (bytes[xing.lameOffset + 22] >> 4);
  const padding = ((bytes[xing.lameOffset + 22] & 15) << 8) | bytes[xing.lameOffset + 23];
  const paddedSamples = readUint32(bytes, xing.countOffset) * frame.sampleCount;
  if (!delay || padding < decoderDelay || paddedSamples <= delay + padding) return null;
  return { sampleRate: frame.sampleRate, paddedSamples, delay, padding };
};

const trimMp3Padding = (data: ArrayBuffer, decoded: AudioBuffer, context: AudioContext) => {
  const info = readMp3GaplessInfo(data);
  if (!info) return decoded;
  const ratio = decoded.sampleRate / info.sampleRate;
  const expectedLength = Math.round((info.paddedSamples - info.delay - info.padding) * ratio);
  if (decoded.length <= expectedLength + 2) return decoded;

  const rawLength = Math.round(info.paddedSamples * ratio);
  const decoderFrames = Math.round(decoderDelay * ratio);
  const leadingFrames = Math.round((info.delay + decoderDelay) * ratio);
  const trailingFrames = Math.round((info.padding - decoderDelay) * ratio);
  let startTrim = 0;
  if (Math.abs(decoded.length - rawLength) <= 2) startTrim = leadingFrames;
  else if (Math.abs(decoded.length - (rawLength - decoderFrames)) <= 2) startTrim = Math.round(info.delay * ratio);
  else if (Math.abs(decoded.length - (rawLength - trailingFrames)) <= 2) startTrim = leadingFrames;
  else if (Math.abs(decoded.length - (rawLength - leadingFrames)) > 2) return decoded;

  if (expectedLength <= 0 || startTrim + expectedLength > decoded.length) return decoded;
  const trimmed = context.createBuffer(decoded.numberOfChannels, expectedLength, decoded.sampleRate);
  for (let channel = 0; channel < decoded.numberOfChannels; channel++)
    trimmed.copyToChannel(decoded.getChannelData(channel).subarray(startTrim, startTrim + expectedLength), channel);
  return trimmed;
};

export { addMp3GaplessInfo, trimMp3Padding };
