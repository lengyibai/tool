declare module "@upng/upng-js" {
  type DecodedPng = {
    width: number;
    height: number;
    depth: number;
    ctype: number;
    tabs: { sRGB?: number; pHYs?: number[] };
  };

  const UPNG: {
    decode(buffer: ArrayBuffer): DecodedPng;
    toRGBA8(image: DecodedPng): ArrayBuffer[];
    encode(
      frames: ArrayBuffer[],
      width: number,
      height: number,
      colorCount: number,
      delays?: number[],
      metadata?: { sRGB?: number; pHYs?: number[] },
    ): ArrayBuffer;
  };

  export default UPNG;
}
