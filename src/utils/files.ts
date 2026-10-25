import { partition } from "es-toolkit/array";
import { clamp } from "es-toolkit/math";
import { trim } from "es-toolkit/string";

export function normalizeQuality(value: number | string, fallback = 90): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  return clamp(Number.isFinite(parsed) ? Math.round(parsed) : fallback, 1, 99);
}

export function normalizeMaxEdge(value: number | string | null, fallback: number | null = null): number | null {
  const normalizedValue = typeof value === "string" ? trim(value) : value;
  if (normalizedValue === "" || normalizedValue === null) return null;

  const parsed = Number(normalizedValue);
  return Number.isFinite(parsed) ? clamp(Math.round(parsed), 1, 16384) : fallback;
}

export function getImageFiles(fileList: FileList | File[]): {
  accepted: File[];
  rejected: File[];
} {
  const [accepted, rejected] = partition(Array.from(fileList), (file) => file.type.startsWith("image/"));
  return { accepted, rejected };
}

export function formatFileSize(bytes: number, separator = " "): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";

  const units = ["B", "KB", "MB", "GB"] as const;
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** unitIndex;
  const digits = unitIndex === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)}${separator}${units[unitIndex]}`;
}

export function toWebpName(fileName: string): string {
  const normalizedName = trim(fileName) || "image";
  const extensionIndex = normalizedName.lastIndexOf(".");
  const baseName = extensionIndex > 0 ? normalizedName.slice(0, extensionIndex) : normalizedName;
  return `${baseName}.webp`;
}

export function toMp3Name(fileName: string): string {
  const normalizedName = fileName || "audio";
  if (/\.mp3$/i.test(normalizedName)) return normalizedName;
  const extensionIndex = normalizedName.lastIndexOf(".");
  const baseName = extensionIndex > 0 ? normalizedName.slice(0, extensionIndex) : normalizedName;
  return `${baseName}.mp3`;
}

export function createUniqueName(fileName: string, usedNames: Set<string>): string {
  const extensionIndex = fileName.lastIndexOf(".");
  const baseName = extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName;
  const extension = extensionIndex > 0 ? fileName.slice(extensionIndex) : "";
  const normalizedNames = new Set(Array.from(usedNames, (name) => name.toLocaleLowerCase()));
  let candidate = fileName;
  let suffix = 2;

  while (normalizedNames.has(candidate.toLocaleLowerCase())) {
    candidate = `${baseName} (${suffix})${extension}`;
    suffix += 1;
  }

  usedNames.add(candidate);
  return candidate;
}

export function getSizeChange(
  originalSize: number,
  convertedSize: number,
): {
  value: string;
  percentage: string;
  isLarger: boolean;
} {
  if (originalSize <= 0) {
    return { value: "--", percentage: "--", isLarger: false };
  }

  const difference = Math.abs(originalSize - convertedSize);
  if (difference === 0) {
    return {
      value: "=0B",
      percentage: "=0%",
      isLarger: false,
    };
  }

  const formattedDifference = formatFileSize(difference, "");
  const percentage = `${Math.round((difference / originalSize) * 100)}%`;
  return convertedSize > originalSize
    ? {
        value: `+${formattedDifference}`,
        percentage: `+${percentage}`,
        isLarger: true,
      }
    : {
        value: `-${formattedDifference}`,
        percentage: `-${percentage}`,
        isLarger: false,
      };
}
