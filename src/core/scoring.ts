import type { GalleryImage, ImageMetrics, ImageScores } from "../data/types";

type SampledImage = {
  image: HTMLImageElement;
  metrics: ImageMetrics;
};

const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));

const roundOne = (value: number) => Math.round(value * 10) / 10;

export async function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  await image.decode();
  return image;
}

export function imageToSourceUrl(file: File): string {
  return URL.createObjectURL(file);
}

export function scoreImage(metrics: ImageMetrics): ImageScores {
  const exposure = clamp(100 - Math.abs(metrics.brightness - 0.52) * 150);
  const memory = roundOne(
    clamp(
      50 +
        (metrics.orientation === "landscape" ? 4 : 0) +
        (metrics.orientation === "portrait" ? 2 : 0) +
        metrics.saturation * 18 +
        metrics.contrast * 16 +
        exposure * 0.08,
    ),
  );

  return { memory };
}

export async function analyzeImage(
  file: File,
): Promise<Omit<GalleryImage, "id" | "sourcePath" | "renderedUrl" | "capturedDate" | "processedAt"> & { image: HTMLImageElement }> {
  const image = await loadImageFromFile(file);
  const sourceUrl = imageToSourceUrl(file);
  const sampled = sampleImage(image);
  const scores = scoreImage(sampled.metrics);
  const tags = buildTags(sampled.metrics, scores);
  const caption = buildCaption(sampled.metrics, scores);
  const reason = buildReason(sampled.metrics, scores);

  return {
    image,
    fileName: file.name,
    sourceUrl,
    scores,
    metrics: sampled.metrics,
    caption,
    reason,
    tags,
  };
}

function sampleImage(image: HTMLImageElement): SampledImage {
  const size = 96;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("浏览器不支持 Canvas 2D");
  }

  context.drawImage(image, 0, 0, size, size);
  const pixels = context.getImageData(0, 0, size, size).data;
  let brightnessSum = 0;
  let saturationSum = 0;
  const luminanceValues: number[] = [];

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i] / 255;
    const g = pixels[i + 1] / 255;
    const b = pixels[i + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    brightnessSum += luminance;
    saturationSum += max === 0 ? 0 : (max - min) / max;
    luminanceValues.push(luminance);
  }

  const count = luminanceValues.length;
  const brightness = brightnessSum / count;
  const saturation = saturationSum / count;
  const variance = luminanceValues.reduce((sum, value) => sum + Math.pow(value - brightness, 2), 0) / count;
  const contrast = Math.sqrt(variance);
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const orientation = width === height ? "square" : width > height ? "landscape" : "portrait";

  return {
    image,
    metrics: {
      width,
      height,
      orientation,
      contrast: roundOne(contrast * 100) / 100,
      saturation: roundOne(saturation * 100) / 100,
      brightness: roundOne(brightness * 100) / 100,
    },
  };
}

function buildTags(metrics: ImageMetrics, scores: ImageScores): string[] {
  const tags: string[] = [metrics.orientation === "landscape" ? "横幅" : metrics.orientation === "portrait" ? "竖幅" : "方图"];
  if (scores.memory >= 82) tags.push("优先展示");
  if (metrics.saturation >= 0.42) tags.push("色彩丰富");
  if (metrics.contrast >= 0.24) tags.push("层次明显");
  if (metrics.brightness < 0.32) tags.push("偏暗");
  if (metrics.brightness > 0.72) tags.push("偏亮");
  return tags;
}

function buildCaption(metrics: ImageMetrics, scores: ImageScores): string {
  if (scores.memory >= 84) return "这一张值得放在显眼处。";
  if (metrics.contrast >= 0.24 && metrics.saturation >= 0.38) return "画面有层次，也有一点现场感。";
  return "适合收进画廊，安静地等下一次被看到。";
}

function buildReason(metrics: ImageMetrics, scores: ImageScores): string {
  const parts = [`回忆度 ${scores.memory.toFixed(1)}`, `${metrics.width}x${metrics.height}`];
  if (metrics.saturation >= 0.42) parts.push("色彩较活跃");
  if (metrics.contrast >= 0.24) parts.push("明暗层次清晰");
  if (metrics.brightness < 0.32 || metrics.brightness > 0.72) parts.push("曝光需要留意");
  return parts.join("；");
}
