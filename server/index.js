import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import exifr from "exifr";
import sharp from "sharp";
import { createServer as createViteServer } from "vite";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(rootDir, "config", "gallery.config.json");
const worldCitiesPath = path.join(rootDir, "reference", "InkTime", "data", "world_cities_zh.csv");
const cityGridDeg = 1.0;
const cityMaxDistanceKm = 80.0;

const defaultScoringPrompt = [
  "你是一个个人相册照片回忆度评估助手，目标是判断一张照片将来是否值得被重新看见。",
  "请只输出 JSON，不要输出 Markdown，不要输出解释。",
  "字段：caption 中文 80~200 字；type 中文标签数组；memory_score 0~100；reason 中文不超过 80 字。",
  "回忆度不是照片好不好看，而是它和个人生活、关系、经历、情绪、地点、时间、事件之间的连接强度。",
  "高回忆度照片通常包含：重要人物或亲密关系；旅行、聚会、毕业、搬家、生日、节日等事件；少见场景或很难复现的瞬间；能唤起明确情绪的表情、动作、物件或环境；能代表某段生活状态的日常细节。",
  "中等回忆度照片通常是普通但有生活痕迹的记录，例如一顿饭、一次出门、某件新买的东西、家里某个角落、一次普通自拍。若它能让人想起具体的人、地点或阶段，可以适当提高分数。",
  "低回忆度照片通常包括：纯截图、账单、广告、表情包、模糊废片、重复快门中信息量较少的一张、没有明确主体的杂物、临时保存的资料图。",
  "重复或相似照片中，如果画面信息接近，应优先给人物表情更自然、事件信息更完整、故事线索更多的一张更高分。",
  "评分参考：90~100 非常值得长期保留；75~89 有明确回忆价值；55~74 普通生活记录但仍有意义；35~54 信息较弱；0~34 基本不值得进入相框轮播。",
].join("\n");

const defaultSideCaptionPrompt = [
  "你是一位为电子相框撰写中文短句的文案助手。",
  "目标不是复述画面，而是为照片补上一点画外之意。",
  "只输出一句中文短句，不要引号，不要解释，不要换行。",
  "长度 8 到 24 个汉字，克制、自然、有余味，可以轻微幽默，但不要鸡汤。",
  "避免使用“这张照片”“这一刻”“时光”“岁月”“世界”“治愈”等套话。",
].join("\n");

await loadLocalEnv(path.join(rootDir, ".env"));
await loadLocalEnv(path.join(rootDir, ".env.local"));

const defaultConfig = {
  imageDir: "C:/Users/29982/Pictures",
  providerBaseUrl: "https://dashscope.aliyuncs.com/api/v1",
  apiKeyEnvName: "DASHSCOPE_API_KEY",
  model: "qwen3.5-flash",
  modelOptions: ["qwen3.5-flash", "qwen3.6-flash", "qwen3.5-plus", "qwen3.7-plus", "qwen3.7-plus-2026-05-26"],
  excludeScreenshots: true,
  excludeNamePatterns: ["screenshot", "screen shot", "screen_shot", "截屏", "截图", "屏幕截图"],
  maxImagesPerRun: 20,
  maxConcurrentImages: 2,
  dataDir: "data",
  databaseFile: "gallery-db.json",
  renderFrameMode: "fixed",
  renderWidth: 480,
  renderHeight: 800,
  footerHeight: 112,
  promptVersion: "v1",
  scoringPrompt: [
    "你是一个个人相册照片评估助手，擅长理解真实照片内容，并从回忆价值和美观角度打分。",
    "请只输出 JSON，不要输出 Markdown，不要输出解释。",
    "字段：caption 中文 80~200 字；type 中文标签数组；memory_score 0~100；beauty_score 0~100；reason 中文不超过 40 字；location 中文地点短语，若无法判断则写“地点未知”。",
    "回忆度偏向人物、关系、旅行、事件、稀缺时刻、情绪和故事价值。",
    "美观度只评价构图、光线、清晰度、色彩和主体突出程度。",
    "低价值截图、账单、广告、随手拍杂物应降低回忆度。",
  ].join("\n"),
  sideCaptionPrompt: [
    "你是一位为电子相框撰写中文短句的文案助手。",
    "目标不是复述画面，而是为照片补上一点画外之意。",
    "只输出一句中文短句，不要引号，不要解释，不要换行。",
    "长度 8 到 24 个汉字，克制、自然、有余味，可以轻微幽默，但不要鸡汤。",
    "避免使用“这张照片”“这一刻”“时光”“岁月”“世界”“治愈”等套话。",
  ].join("\n"),
  scoringPrompt: defaultScoringPrompt,
  sideCaptionPrompt: defaultSideCaptionPrompt,
  excludeNamePatterns: ["screenshot", "screen shot", "screen_shot", "截屏", "截图", "屏幕截图"],
};

let cachedCities = null;
let cachedCityGrid = null;

const initialConfig = await loadConfig();
const app = express();

app.use(express.json({ limit: "4mb" }));

app.get("/api/config", async (_req, res) => {
  const config = await loadConfig();
  res.json({ ...config, apiKeyConfigured: Boolean(resolveApiKey(config)) });
});

app.put("/api/config", async (req, res) => {
  try {
    const nextConfig = normalizeConfig(req.body ?? {});
    await writeConfig(nextConfig);
    res.json({ ...nextConfig, apiKeyConfigured: Boolean(resolveApiKey(nextConfig)) });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "配置保存失败。" });
  }
});

app.get("/api/photos", async (_req, res) => {
  const config = await loadConfig();
  const db = await readDb(config);
  res.json(db.items);
});

app.post("/api/process", async (req, res) => {
  try {
    const config = await loadConfig();
    const mode = req.body?.mode === "rerun" ? "rerun" : "new";
    const result = mode === "rerun" ? await rerunExistingItems(config) : await processNewItems(config);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "处理失败。" });
  }
});

app.post("/api/rerender", async (req, res) => {
  try {
    const config = await loadConfig();
    const limit = sanitizePositiveInt(req.body?.limit, 0);
    const result = await rerenderExistingItems(config, limit);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "重新渲染失败。" });
  }
});

app.post("/api/library/clear", async (_req, res) => {
  try {
    const config = await loadConfig();
    const result = await clearLibrary(config);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "清空失败。" });
  }
});

app.use("/renders", async (req, res, next) => {
  const config = await loadConfig();
  return express.static(getRendersDir(config))(req, res, next);
});

app.use("/source", async (req, res, next) => {
  const config = await loadConfig();
  return express.static(config.imageDir)(req, res, next);
});

const vite = await createViteServer({
  root: rootDir,
  server: { middlewareMode: true },
  appType: "spa",
});
app.use(vite.middlewares);

app.listen(5173, "127.0.0.1", () => {
  console.log("InkTime Gallery running at http://127.0.0.1:5173");
});

async function processNewItems(config) {
  const files = await listImages(config.imageDir, config);
  const db = await readDb(config);
  const knownSources = new Set(db.items.map((item) => item.sourcePath));
  const knownHashes = new Set(db.items.map((item) => item.fileHash).filter(Boolean));
  const runId = createRunId();
  const candidates = files.filter((file) => !knownSources.has(file));

  const selected = [];
  let skippedDuplicates = 0;
  for (const file of candidates) {
    if (selected.length >= config.maxImagesPerRun) break;
    const fileHash = await hashFile(file);
    if (knownHashes.has(fileHash)) {
      skippedDuplicates += 1;
      continue;
    }
    knownHashes.add(fileHash);
    selected.push({ file, fileHash });
  }

  const results = await mapWithConcurrency(selected, config.maxConcurrentImages, async ({ file, fileHash }) => {
    try {
      return await processImage(file, config, { fileHash, runId });
    } catch {
      return null;
    }
  });
  const processed = results.filter(Boolean);
  if (processed.length) {
    db.items.unshift(...processed);
    await writeDb(config, db);
  }

  return {
    mode: "new",
    runId,
    processed: processed.length,
    skipped: files.length - processed.length,
    skippedDuplicates,
  };
}

async function rerunExistingItems(config) {
  const db = await readDb(config);
  const runId = createRunId();
  const existing = [...db.items];
  const toProcess = existing.slice(0, config.maxImagesPerRun);
  const untouched = existing.slice(config.maxImagesPerRun);

  const results = await mapWithConcurrency(toProcess, config.maxConcurrentImages, async (item) => {
    try {
      const refreshed = await processImage(item.sourcePath, config, {
        fileHash: item.fileHash || (await hashFile(item.sourcePath)),
        runId,
        existingId: item.id,
      });
      return { item: refreshed, processed: true };
    } catch {
      return { item, processed: false };
    }
  });

  const processed = results.filter((result) => result.processed);
  const nextItems = [...results.map((result) => result.item), ...untouched];
  db.items = nextItems.sort((a, b) => b.processedAt.localeCompare(a.processedAt));
  await writeDb(config, db);

  return {
    mode: "rerun",
    runId,
    processed: processed.length,
    skipped: Math.max(0, existing.length - processed.length),
    skippedDuplicates: 0,
  };
}

async function rerenderExistingItems(config, limit) {
  const db = await readDb(config);
  const rendersDir = getRendersDir(config);
  await fs.mkdir(rendersDir, { recursive: true });

  let rendered = 0;
  let skipped = 0;
  for (const item of db.items) {
    if (limit > 0 && rendered >= limit) {
      skipped += 1;
      continue;
    }
    try {
      const stat = await fs.stat(item.sourcePath);
      const photoDetails = await readPhotoDetails(item.sourcePath, stat);
      await renderImage(
        item.sourcePath,
        {
          caption: item.caption || "",
          side_caption: item.sideCaption || item.caption || "",
          location: photoDetails.location,
        },
        path.join(rendersDir, `${item.id}.png`),
        config,
        photoDetails.capturedDate || item.capturedDate,
      );
      rendered += 1;
    } catch {
      skipped += 1;
    }
  }

  return {
    mode: "rerender",
    rendered,
    skipped,
  };
}

async function clearLibrary(config) {
  const db = await readDb(config);
  const removedItems = db.items.length;
  const rendersDir = getRendersDir(config);
  const removedRenders = await clearRenderFiles(rendersDir);
  await writeDb(config, { items: [] });
  return {
    mode: "clear",
    removedItems,
    removedRenders,
  };
}

async function loadConfig() {
  try {
    const raw = await fs.readFile(configPath, "utf8");
    return normalizeConfig(JSON.parse(raw));
  } catch {
    return normalizeConfig(defaultConfig);
  }
}

async function writeConfig(config) {
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
}

function normalizeConfig(input) {
  const merged = { ...defaultConfig, ...input };
  return {
    imageDir: path.resolve(String(merged.imageDir || defaultConfig.imageDir)),
    providerBaseUrl: String(merged.providerBaseUrl || defaultConfig.providerBaseUrl).trim() || defaultConfig.providerBaseUrl,
    apiKeyEnvName: String(merged.apiKeyEnvName || defaultConfig.apiKeyEnvName).trim() || defaultConfig.apiKeyEnvName,
    model: String(merged.model || defaultConfig.model).trim() || defaultConfig.model,
    modelOptions: normalizeModelOptions(merged.modelOptions),
    excludeScreenshots: Boolean(merged.excludeScreenshots),
    excludeNamePatterns: normalizeStringList(merged.excludeNamePatterns, defaultConfig.excludeNamePatterns),
    maxImagesPerRun: sanitizePositiveInt(merged.maxImagesPerRun, defaultConfig.maxImagesPerRun),
    maxConcurrentImages: Math.min(6, sanitizePositiveInt(merged.maxConcurrentImages, defaultConfig.maxConcurrentImages)),
    dataDir: String(merged.dataDir || defaultConfig.dataDir).trim() || defaultConfig.dataDir,
    databaseFile: normalizeDatabaseFile(merged.databaseFile, defaultConfig.databaseFile),
    renderFrameMode: normalizeRenderFrameMode(merged.renderFrameMode),
    renderWidth: sanitizePositiveInt(merged.renderWidth, defaultConfig.renderWidth),
    renderHeight: sanitizePositiveInt(merged.renderHeight, defaultConfig.renderHeight),
    footerHeight: sanitizePositiveInt(merged.footerHeight, defaultConfig.footerHeight),
    promptVersion: String(merged.promptVersion || defaultConfig.promptVersion).trim() || defaultConfig.promptVersion,
    scoringPrompt: String(merged.scoringPrompt || defaultConfig.scoringPrompt).trim() || defaultConfig.scoringPrompt,
    sideCaptionPrompt: String(merged.sideCaptionPrompt || defaultConfig.sideCaptionPrompt).trim() || defaultConfig.sideCaptionPrompt,
  };
}

function normalizeModelOptions(value) {
  const cleaned = normalizeStringList(value, defaultConfig.modelOptions);
  return cleaned.length ? Array.from(new Set(cleaned)) : [...defaultConfig.modelOptions];
}

function normalizeStringList(value, fallback) {
  const source = Array.isArray(value) ? value : fallback;
  const cleaned = source.map((item) => String(item || "").trim()).filter(Boolean);
  return cleaned.length ? Array.from(new Set(cleaned)) : [...fallback];
}

function normalizeDatabaseFile(value, fallback) {
  const raw = String(value || fallback).trim() || fallback;
  return raw.replaceAll("\\", "/").split("/").filter(Boolean).join("/") || fallback;
}

function sanitizePositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.round(parsed);
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await worker(items[currentIndex], currentIndex);
      }
    }),
  );

  return results;
}

function getDataDir(config) {
  return path.resolve(rootDir, config.dataDir);
}

function getDbPath(config) {
  return path.join(getDataDir(config), config.databaseFile);
}

function getRendersDir(config) {
  return path.join(getDataDir(config), "renders");
}

async function readDb(config) {
  try {
    const raw = await fs.readFile(getDbPath(config), "utf8");
    const db = JSON.parse(raw);
    return { items: Array.isArray(db.items) ? db.items : [] };
  } catch {
    return { items: [] };
  }
}

async function writeDb(config, db) {
  await fs.mkdir(path.dirname(getDbPath(config)), { recursive: true });
  await fs.writeFile(getDbPath(config), JSON.stringify(db, null, 2), "utf8");
}

async function clearRenderFiles(rendersDir) {
  try {
    const entries = await fs.readdir(rendersDir, { withFileTypes: true });
    let removed = 0;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      await fs.unlink(path.join(rendersDir, entry.name));
      removed += 1;
    }
    return removed;
  } catch {
    return 0;
  }
}

async function listImages(dir, config) {
  const out = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listImages(fullPath, config)));
    } else if (/\.(jpe?g|png|webp)$/i.test(entry.name) && shouldIncludeImage(fullPath, config)) {
      out.push(fullPath);
    }
  }
  return out;
}

function shouldIncludeImage(filePath, config) {
  if (!config.excludeScreenshots) return true;
  const normalizedPath = filePath.toLowerCase();
  return !config.excludeNamePatterns.some((pattern) => normalizedPath.includes(String(pattern).toLowerCase()));
}

async function processImage(filePath, config, options) {
  const id = options.existingId || crypto.createHash("sha1").update(filePath).digest("hex").slice(0, 16);
  const fileName = path.basename(filePath);
  const stat = await fs.stat(filePath);
  const analysis = await analyzeWithModel(filePath, config);
  const sideCaption = await generateSideCaption(filePath, config, analysis);
  const photoDetails = await readPhotoDetails(filePath, stat);
  const renderName = `${id}.png`;
  const rendersDir = getRendersDir(config);
  await fs.mkdir(rendersDir, { recursive: true });
  await renderImage(
    filePath,
    { ...analysis, side_caption: sideCaption, location: photoDetails.location },
    path.join(rendersDir, renderName),
    config,
    photoDetails.capturedDate,
  );
  const relativeSource = path.relative(config.imageDir, filePath).replaceAll(path.sep, "/");

  return {
    id,
    runId: options.runId,
    promptVersion: config.promptVersion,
    model: config.model,
    fileName,
    fileHash: options.fileHash,
    sourcePath: filePath,
    sourceUrl: `/source/${encodeURI(relativeSource)}`,
    renderedUrl: `/renders/${renderName}`,
    scores: {
      memory: analysis.memory_score,
    },
    metrics: analysis.metrics,
    caption: analysis.caption,
    sideCaption,
    reason: analysis.reason,
    tags: analysis.tags,
    location: photoDetails.location,
    capturedDate: photoDetails.capturedDate,
    processedAt: new Date().toISOString(),
  };
}

async function readPhotoDetails(filePath, stat) {
  try {
    const exif = await exifr.parse(filePath, [
      "DateTimeOriginal",
      "CreateDate",
      "ModifyDate",
      "City",
      "State",
      "Country",
      "CountryCode",
      "SubLocation",
      "GPSLatitude",
      "GPSLongitude",
      "latitude",
      "longitude",
    ]);
    const candidate = exif?.DateTimeOriginal || exif?.CreateDate || exif?.ModifyDate;
    return {
      capturedDate: candidate instanceof Date && !Number.isNaN(candidate.getTime()) ? candidate.toISOString().slice(0, 10) : stat.mtime.toISOString().slice(0, 10),
      location: await resolvePhotoLocation(exif),
    };
  } catch {
    // EXIF is optional; fall back to file timestamp.
  }
  return {
    capturedDate: stat.mtime.toISOString().slice(0, 10),
    location: "",
  };
}

async function resolvePhotoLocation(exif) {
  const latitude = Number(exif?.latitude ?? exif?.GPSLatitude);
  const longitude = Number(exif?.longitude ?? exif?.GPSLongitude);
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    const city = await findNearestCity(latitude, longitude);
    if (city) return city;
  }

  const textParts = [exif?.Country, exif?.State, exif?.City, exif?.SubLocation]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  if (textParts.length) {
    return Array.from(new Set(textParts)).join(" ");
  }

  return "";
}

async function analyzeWithModel(filePath, config) {
  const imageBuffer = await fs.readFile(filePath);
  const metadata = await sharp(imageBuffer).metadata();
  const imageWidth = metadata.width || 0;
  const imageHeight = metadata.height || 0;
  const metrics = {
    width: imageWidth,
    height: imageHeight,
    orientation: imageWidth === imageHeight ? "square" : imageWidth > imageHeight ? "landscape" : "portrait",
  };

  const content = await callDashScopeImage(filePath, config, {
    text: `${config.scoringPrompt}\n\nJSON 格式如下：{"caption":"...","type":["..."],"memory_score":0,"reason":"..."}`,
    temperature: 0.2,
  });
  const parsed = JSON.parse(extractJson(content));

  return {
    caption: String(parsed.caption || ""),
    tags: Array.isArray(parsed.type) ? parsed.type.map((item) => String(item)) : [],
    memory_score: clampScore(parsed.memory_score),
    reason: String(parsed.reason || ""),
    location: String(parsed.location || ""),
    metrics,
  };
}

async function generateSideCaption(filePath, config, analysis) {
  try {
    const content = await callDashScopeImage(filePath, config, {
      text: `${config.sideCaptionPrompt}\n\n参考信息：${analysis.caption}\n评分理由：${analysis.reason}`,
      temperature: 0.7,
    });
    return sanitizeOneLine(content, 30) || fallbackSideCaption(analysis);
  } catch {
    return fallbackSideCaption(analysis);
  }
}

async function callDashScopeImage(filePath, config, options) {
  const apiKey = resolveApiKey(config);
  if (!apiKey) {
    throw new Error(`未找到 API Key。请在 .env.local 中配置 ${config.apiKeyEnvName}。`);
  }

  const imageBuffer = await fs.readFile(filePath);
  const response = await fetch(resolveDashScopeEndpoint(config.providerBaseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      input: {
        messages: [
          {
            role: "user",
            content: [
              { image: `data:image/${imageMime(filePath)};base64,${imageBuffer.toString("base64")}` },
              { text: options.text },
            ],
          },
        ],
      },
      parameters: {
        result_format: "message",
        temperature: options.temperature,
      },
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.message || payload?.code || "调用 DashScope 失败。");
  }

  const rawContent = payload?.output?.choices?.[0]?.message?.content;
  const content = Array.isArray(rawContent)
    ? rawContent
        .map((part) => {
          if (typeof part === "string") return part;
          if (part && typeof part.text === "string") return part.text;
          return "";
        })
        .join("")
    : String(rawContent || "");

  if (!content) {
    throw new Error("模型没有返回可解析的内容。");
  }
  return content;
}

async function renderImage(filePath, analysis, outputPath, config, capturedDate) {
  const metadata = await sharp(filePath).rotate().metadata();
  const sourceWidth = metadata.width || config.renderWidth;
  const sourceHeight = metadata.height || config.renderHeight;
  const isLandscape = sourceWidth >= sourceHeight;
  const frame = getFrameSize(config, isLandscape, sourceWidth, sourceHeight);
  const footerHeight = Math.min(Number(config.footerHeight), Math.floor(frame.height * 0.24));
  const photoAreaHeight = frame.height - footerHeight;
  const photoPadding = getPhotoPadding(frame.width, photoAreaHeight);
  const photoBackground = "#f7f2ea";
  const footer = Buffer.from(buildFooterSvg(frame.width, footerHeight, analysis, capturedDate));

  const photo = await sharp(filePath)
    .rotate()
    .resize(frame.width - photoPadding * 2, photoAreaHeight - photoPadding * 2, { fit: "contain", background: photoBackground })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: frame.width,
      height: frame.height,
      channels: 3,
      background: photoBackground,
    },
  })
    .composite([
      { input: photo, left: photoPadding, top: photoPadding },
      { input: footer, left: 0, top: photoAreaHeight },
    ])
    .png()
    .toFile(outputPath);
}

function getFrameSize(config, isLandscape, sourceWidth, sourceHeight) {
  if (config.renderFrameMode === "adaptive") {
    return getAdaptiveFrameSize(config, sourceWidth, sourceHeight);
  }

  const shortSide = Number(config.renderWidth);
  const longSide = Number(config.renderHeight);
  if (isLandscape) {
    return { width: Math.max(shortSide, longSide), height: Math.min(shortSide, longSide) };
  }
  return { width: Math.min(shortSide, longSide), height: Math.max(shortSide, longSide) };
}

function getAdaptiveFrameSize(config, sourceWidth, sourceHeight) {
  const ratio = Math.max(0.05, sourceWidth / sourceHeight);
  const longSide = Math.max(Number(config.renderWidth), Number(config.renderHeight));
  const footerHeight = Math.min(Number(config.footerHeight), Math.floor(longSide * 0.24));

  if (ratio >= 1) {
    const photoWidth = longSide;
    const photoHeight = Math.max(160, Math.round(photoWidth / ratio));
    return {
      width: photoWidth,
      height: photoHeight + footerHeight,
    };
  }

  const photoHeight = Math.max(160, longSide - footerHeight);
  const photoWidth = Math.max(180, Math.round(photoHeight * ratio));
  return {
    width: photoWidth,
    height: photoHeight + footerHeight,
  };
}

function normalizeRenderFrameMode(value) {
  return value === "adaptive" ? "adaptive" : "fixed";
}

function getPhotoPadding(width, height) {
  return Math.max(12, Math.round(Math.min(width, height) * 0.025));
}

function buildFooterSvg(width, footerHeight, analysis, capturedDate) {
  const sideCaption = wrapByChars(analysis.side_caption || analysis.caption, 16, 2)
    .map(escapeXml)
    .map((line, index) => `<text x="24" y="${34 + index * 24}" class="caption">${line}</text>`)
    .join("");
  const location = escapeXml(analysis.location || "");
  const date = escapeXml(formatDisplayDate(capturedDate));
  const locationText = location ? `<text x="${width - 24}" y="${footerHeight - 20}" class="meta" text-anchor="end">${location}</text>` : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${footerHeight}" viewBox="0 0 ${width} ${footerHeight}">
  <style>
    .caption { font: 22px "SimSun", "Songti SC", "Noto Serif CJK SC", serif; fill: #16130f; }
    .meta { font: 15px "SimSun", "Songti SC", "Noto Serif CJK SC", serif; fill: #4c453b; }
  </style>
  <rect width="100%" height="100%" fill="#fbf7ef"/>
  ${sideCaption}
  <text x="24" y="${footerHeight - 20}" class="meta">${date}</text>
  ${locationText}
</svg>`;
}

async function loadWorldCities() {
  if (cachedCities && cachedCityGrid) {
    return { cities: cachedCities, grid: cachedCityGrid };
  }

  const raw = await fs.readFile(worldCitiesPath, "utf8");
  const rows = parseCsv(raw);
  const cities = [];
  const grid = new Map();

  for (const row of rows) {
    const latitude = Number((row.lat || "").trim());
    const longitude = Number((row.lon || "").trim());
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    const name = String(row.name_zh || row.name_en || "").trim();
    if (!name) continue;
    const index = cities.length;
    cities.push({ latitude, longitude, name });
    const key = gridKey(latitude, longitude);
    const bucket = grid.get(key) || [];
    bucket.push(index);
    grid.set(key, bucket);
  }

  cachedCities = cities;
  cachedCityGrid = grid;
  return { cities, grid };
}

async function findNearestCity(latitude, longitude) {
  try {
    const { cities, grid } = await loadWorldCities();
    const [gx, gy] = gridKey(latitude, longitude).split(":").map(Number);
    let candidates = collectCityCandidates(grid, gx, gy, 1);
    if (!candidates.length) candidates = collectCityCandidates(grid, gx, gy, 2);
    if (!candidates.length) return "";

    let bestName = "";
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const index of candidates) {
      const city = cities[index];
      const distance = haversineKm(latitude, longitude, city.latitude, city.longitude);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestName = city.name;
      }
    }

    return bestDistance <= cityMaxDistanceKm ? bestName : "";
  } catch {
    return "";
  }
}

function collectCityCandidates(grid, gx, gy, radius) {
  const candidates = [];
  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      const bucket = grid.get(`${gx + dx}:${gy + dy}`);
      if (bucket) candidates.push(...bucket);
    }
  }
  return candidates;
}

function gridKey(latitude, longitude) {
  return `${Math.floor(latitude / cityGridDeg)}:${Math.floor(longitude / cityGridDeg)}`;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const earthRadius = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function parseCsv(raw) {
  const rows = [];
  let current = "";
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    const next = raw[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(current);
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      current = "";
      continue;
    }

    current += char;
  }

  if (current.length || row.length) {
    row.push(current);
    rows.push(row);
  }

  if (!rows.length) return [];
  const headers = rows[0].map((value) => value.trim());
  return rows.slice(1).map((cells) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = cells[index] ?? "";
    });
    return record;
  });
}

function formatDisplayDate(value) {
  return String(value || "").replaceAll("-", ".");
}

function wrapByChars(text, maxChars, maxLines) {
  const chars = Array.from(text || "");
  const lines = [];
  for (let i = 0; i < chars.length && lines.length < maxLines; i += maxChars) {
    lines.push(chars.slice(i, i + maxChars).join(""));
  }
  return lines.length ? lines : [""];
}

function sanitizeOneLine(value, maxChars) {
  const text = String(value || "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^["“”「」『』]+|["“”「」『』]+$/g, "")
    .replace(/\s+/g, "")
    .trim();
  return Array.from(text).slice(0, maxChars).join("");
}

function fallbackSideCaption(analysis) {
  return sanitizeOneLine(analysis.reason || analysis.caption, 24);
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function imageMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "png";
  if (ext === ".webp") return "webp";
  return "jpeg";
}

function clampScore(value) {
  return roundOne(Math.max(0, Math.min(100, Number(value) || 0)));
}

function roundOne(value) {
  return Math.round(value * 10) / 10;
}

async function hashFile(filePath) {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash("sha1").update(buffer).digest("hex");
}

function createRunId() {
  return `${new Date().toISOString().replaceAll(/[-:TZ.]/g, "").slice(0, 14)}-${crypto.randomBytes(3).toString("hex")}`;
}

function resolveApiKey(config) {
  const preferred = String(config.apiKeyEnvName || "").trim();
  if (preferred && process.env[preferred]) {
    return process.env[preferred];
  }
  return process.env.DASHSCOPE_API_KEY || process.env.OPENAI_API_KEY || "";
}

function resolveDashScopeEndpoint(baseUrl) {
  const normalized = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!normalized) {
    return "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
  }
  if (normalized.endsWith("/services/aigc/multimodal-generation/generation")) {
    return normalized;
  }
  if (normalized.endsWith("/compatible-mode/v1")) {
    return `${normalized.slice(0, -"/compatible-mode/v1".length)}/api/v1/services/aigc/multimodal-generation/generation`;
  }
  if (normalized.endsWith("/api/v1")) {
    return `${normalized}/services/aigc/multimodal-generation/generation`;
  }
  return `${normalized}/services/aigc/multimodal-generation/generation`;
}

function extractJson(value) {
  const text = String(value).trim();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) {
    return text.slice(first, last + 1);
  }
  return text;
}

function loadLocalEnv(filePath) {
  return fs
    .readFile(filePath, "utf8")
    .then((raw) => {
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const splitIndex = trimmed.indexOf("=");
        if (splitIndex <= 0) continue;
        const key = trimmed.slice(0, splitIndex).trim();
        const value = trimmed.slice(splitIndex + 1).trim().replace(/^['"]|['"]$/g, "");
        if (key) {
          process.env[key] = value;
        }
      }
    })
    .catch(() => {});
}

await fs.mkdir(getRendersDir(initialConfig), { recursive: true });
