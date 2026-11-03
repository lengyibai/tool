import UPNG from "@upng/upng-js";

import type { PngWorkerRequest, PngWorkerResponse } from "@/types/png-compressor";

const signature = [137, 80, 78, 71, 13, 10, 26, 10];
const maxPixels = 25_000_000;

class IneligiblePngError extends Error {}

const readChunkName = (bytes: Uint8Array, offset: number): string =>
  String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);

const inspectPng = (buffer: ArrayBuffer): void => {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 45 || signature.some((value, index) => bytes[index] !== value)) {
    throw new Error("文件不是有效的 PNG");
  }

  const view = new DataView(buffer);
  let offset = 8;
  let hasEnd = false;

  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    if (length > bytes.length - offset - 12) throw new Error("PNG 文件数据不完整");

    const name = readChunkName(bytes, offset + 4);
    if (offset === 8 && (name !== "IHDR" || length !== 13)) throw new Error("PNG 文件头无效");
    if (name === "IHDR") {
      const width = view.getUint32(offset + 8);
      const height = view.getUint32(offset + 12);
      if (!width || !height) throw new Error("PNG 图片尺寸无效");
      if (width * height > maxPixels) throw new IneligiblePngError("图片尺寸过大，暂不支持处理");
      if (bytes[offset + 16] === 16) throw new IneligiblePngError("暂不支持 16 位 PNG");
    }
    if (name === "acTL") throw new IneligiblePngError("暂不支持动画 PNG");
    if (["iCCP", "gAMA", "cHRM", "cICP", "mDCV", "cLLI"].includes(name)) {
      throw new IneligiblePngError("图片包含需保留的色彩配置，暂不支持无损转换");
    }
    offset += length + 12;
    if (name === "IEND") {
      hasEnd = true;
      break;
    }
  }

  if (!hasEnd) throw new Error("PNG 文件缺少结束标记");
};

const normalizeTransparentPixels = (pixels: Uint8Array): void => {
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] !== 0) continue;
    pixels[index] = 0;
    pixels[index + 1] = 0;
    pixels[index + 2] = 0;
  }
};

const countColors = (pixels: Uint8Array): number => {
  const colors = new Set<number>();
  for (let index = 0; index < pixels.length; index += 4) {
    const color = (pixels[index] << 24) | (pixels[index + 1] << 16) | (pixels[index + 2] << 8) | pixels[index + 3];
    colors.add(color);
    if (colors.size > 256) return colors.size;
  }
  return colors.size;
};

const matchesPixels = (source: Uint8Array, output: Uint8Array): boolean => {
  if (source.length !== output.length) return false;
  for (let index = 0; index < source.length; index++) {
    if (source[index] !== output[index]) return false;
  }
  return true;
};

const compressPng = (buffer: ArrayBuffer): PngWorkerResponse => {
  inspectPng(buffer);
  const source = UPNG.decode(buffer);

  const sourceFrame = UPNG.toRGBA8(source)[0];
  if (!sourceFrame) throw new Error("无法读取 PNG 像素");
  const pixels = new Uint8Array(sourceFrame);
  normalizeTransparentPixels(pixels);
  const colorCount = countColors(pixels);
  if (colorCount > 256) {
    return {
      status: "ineligible",
      reason: "颜色超过 256 种，无法无损转为索引色 PNG",
      width: source.width,
      height: source.height,
      colorCount,
    };
  }

  //零颜色限制保留全部原色，编码后仍核对索引格式和每个可见像素。
  const output = UPNG.encode([pixels.slice().buffer], source.width, source.height, 0, undefined, {
    sRGB: source.tabs.sRGB,
    pHYs: source.tabs.pHYs,
  });
  const decodedOutput = UPNG.decode(output);
  if (decodedOutput.ctype !== 3 || decodedOutput.width !== source.width || decodedOutput.height !== source.height) {
    throw new Error("编码器未生成索引色 PNG");
  }

  const outputFrame = UPNG.toRGBA8(decodedOutput)[0];
  if (!outputFrame) throw new Error("无法核对压缩后的 PNG");
  const outputPixels = new Uint8Array(outputFrame);
  normalizeTransparentPixels(outputPixels);
  if (!matchesPixels(pixels, outputPixels)) throw new Error("压缩后像素与原图不一致");

  return {
    status: "compressed",
    buffer: output,
    width: source.width,
    height: source.height,
    colorCount,
    bitDepth: decodedOutput.depth,
  };
};

self.onmessage = (event: MessageEvent<PngWorkerRequest>): void => {
  let response: PngWorkerResponse;
  try {
    response = compressPng(event.data.buffer);
  } catch (error) {
    response = {
      status: error instanceof IneligiblePngError ? "ineligible" : "error",
      reason: error instanceof Error ? error.message : "PNG 压缩失败",
    };
  }

  if (response.status === "compressed") {
    self.postMessage(response, { transfer: [response.buffer] });
  } else {
    self.postMessage(response);
  }
};
