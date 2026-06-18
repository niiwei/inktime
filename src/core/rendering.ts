import type { GalleryImage, RenderOptions } from "../data/types";

export const defaultRenderOptions: RenderOptions = {
  width: 900,
  height: 1200,
  footerHeight: 190,
};

export async function renderGalleryImage(
  image: HTMLImageElement,
  meta: Pick<GalleryImage, "caption" | "fileName" | "scores" | "tags">,
  options: RenderOptions = defaultRenderOptions,
): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = options.width;
  canvas.height = options.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("浏览器不支持 Canvas 2D");
  }

  ctx.fillStyle = "#f7f2ea";
  ctx.fillRect(0, 0, options.width, options.height);

  const imageHeight = options.height - options.footerHeight;
  drawCoverImage(ctx, image, 0, 0, options.width, imageHeight);

  ctx.fillStyle = "#f7f2ea";
  ctx.fillRect(0, imageHeight, options.width, options.footerHeight);

  ctx.fillStyle = "#171717";
  ctx.font = "600 34px Georgia, 'Times New Roman', serif";
  drawWrappedText(ctx, meta.caption, 44, imageHeight + 52, options.width - 88, 42, 2);

  ctx.font = "500 22px system-ui, sans-serif";
  ctx.fillStyle = "#5b554e";
  ctx.fillText(meta.fileName, 44, imageHeight + 136);

  const scoreText = `回忆度 ${meta.scores.memory.toFixed(1)}`;
  const scoreWidth = ctx.measureText(scoreText).width;
  ctx.fillText(scoreText, options.width - 44 - scoreWidth, imageHeight + 136);

  ctx.font = "600 18px system-ui, sans-serif";
  ctx.fillStyle = "#8f3c28";
  ctx.fillText(meta.tags.slice(0, 3).join(" / "), 44, imageHeight + 168);

  return canvas.toDataURL("image/png");
}

function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  const dx = x + (width - drawWidth) / 2;
  const dy = y + (height - drawHeight) / 2;
  ctx.drawImage(image, dx, dy, drawWidth, drawHeight);
}

function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
) {
  const chars = Array.from(text);
  const lines: string[] = [];
  let line = "";

  for (const char of chars) {
    const next = line + char;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = char;
      if (lines.length >= maxLines) break;
    } else {
      line = next;
    }
  }

  if (line && lines.length < maxLines) lines.push(line);
  lines.forEach((value, index) => ctx.fillText(value, x, y + index * lineHeight));
}
