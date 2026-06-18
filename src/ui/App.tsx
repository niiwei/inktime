import { ArrowLeft, Download, Home, RefreshCw, RotateCcw, Settings2, Shuffle, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import type { GalleryImage } from "../data/types";

type SortMode = "memory" | "newest";
type ViewMode = { type: "gallery" } | { type: "detail"; id: string };
type ProcessMode = "new" | "rerun";

type ApiConfig = {
  imageDir: string;
  providerBaseUrl: string;
  apiKeyEnvName: string;
  apiKeyConfigured: boolean;
  model: string;
  modelOptions: string[];
  excludeScreenshots: boolean;
  excludeNamePatterns: string[];
  maxImagesPerRun: number;
  maxConcurrentImages: number;
  dataDir: string;
  databaseFile: string;
  renderFrameMode: "fixed" | "adaptive";
  renderWidth: number;
  renderHeight: number;
  footerHeight: number;
  promptVersion: string;
  scoringPrompt: string;
  sideCaptionPrompt: string;
};

type ConfigDraft = Omit<ApiConfig, "apiKeyConfigured" | "modelOptions" | "excludeNamePatterns"> & {
  modelOptionsText: string;
  excludeNamePatternsText: string;
};

const monthOptions = Array.from({ length: 12 }, (_, index) => index + 1);
const dayOptions = Array.from({ length: 31 }, (_, index) => index + 1);

export function App() {
  const [items, setItems] = useState<GalleryImage[]>([]);
  const [config, setConfig] = useState<ApiConfig | null>(null);
  const [draftConfig, setDraftConfig] = useState<ConfigDraft | null>(null);
  const [month, setMonth] = useState<number | "all">("all");
  const [day, setDay] = useState<number | "all">("all");
  const [sortMode, setSortMode] = useState<SortMode>("memory");
  const [view, setView] = useState<ViewMode>({ type: "gallery" });
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void fetchConfig();
    void refreshGallery();
  }, []);

  const filteredItems = useMemo(() => {
    const filtered = items.filter((item) => {
      const date = new Date(`${item.capturedDate}T00:00:00`);
      if (Number.isNaN(date.getTime())) return true;
      if (month !== "all" && date.getMonth() + 1 !== month) return false;
      if (day !== "all" && date.getDate() !== day) return false;
      return true;
    });

    return filtered.sort((a, b) => {
      if (sortMode === "newest") return b.processedAt.localeCompare(a.processedAt);
      return b.scores.memory - a.scores.memory;
    });
  }, [day, items, month, sortMode]);

  const selected = view.type === "detail" ? items.find((item) => item.id === view.id) ?? null : null;
  const databasePath = config ? `${config.dataDir}/${config.databaseFile}` : "--";

  async function fetchConfig() {
    const response = await fetch("/api/config");
    if (!response.ok) return;
    const nextConfig = (await response.json()) as ApiConfig;
    setConfig(nextConfig);
    setDraftConfig(toDraft(nextConfig));
  }

  async function refreshGallery() {
    const response = await fetch("/api/photos");
    if (!response.ok) return;
    setItems((await response.json()) as GalleryImage[]);
  }

  async function processDirectory(mode: ProcessMode) {
    setIsProcessing(true);
    setMessage(mode === "rerun" ? "正在按当前 Prompt 重跑已入库图片..." : "正在处理新图片...");
    try {
      const response = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "处理失败。");
      const prefix = mode === "rerun" ? "重跑完成" : "新增处理";
      const duplicateText = data.skippedDuplicates ? `，跳过完全重复 ${data.skippedDuplicates} 张` : "";
      const runText = data.runId ? `，runId：${data.runId}` : "";
      setMessage(`${prefix} ${data.processed} 张${duplicateText}${runText}。`);
      await refreshGallery();
      await fetchConfig();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "处理失败。");
    } finally {
      setIsProcessing(false);
    }
  }

  async function rerenderGallery() {
    setIsProcessing(true);
    setMessage("正在用当前模板重新生成图片，不会调用模型...");
    try {
      const response = await fetch("/api/rerender", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "重新渲染失败。");
      setMessage(`已重新生成 ${data.rendered} 张图片，跳过 ${data.skipped} 张。`);
      await refreshGallery();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "重新渲染失败。");
    } finally {
      setIsProcessing(false);
    }
  }

  async function saveConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draftConfig) return;
    setIsSavingConfig(true);
    try {
      const response = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageDir: draftConfig.imageDir,
          providerBaseUrl: draftConfig.providerBaseUrl,
          apiKeyEnvName: draftConfig.apiKeyEnvName,
          model: draftConfig.model,
          modelOptions: splitLines(draftConfig.modelOptionsText, ["qwen3.5-flash"]),
          excludeScreenshots: draftConfig.excludeScreenshots,
          excludeNamePatterns: splitLines(draftConfig.excludeNamePatternsText, ["screenshot"]),
          maxImagesPerRun: Number(draftConfig.maxImagesPerRun),
          maxConcurrentImages: Number(draftConfig.maxConcurrentImages),
          dataDir: draftConfig.dataDir,
          databaseFile: draftConfig.databaseFile,
          renderFrameMode: draftConfig.renderFrameMode,
          renderWidth: Number(draftConfig.renderWidth),
          renderHeight: Number(draftConfig.renderHeight),
          footerHeight: Number(draftConfig.footerHeight),
          promptVersion: draftConfig.promptVersion,
          scoringPrompt: draftConfig.scoringPrompt,
          sideCaptionPrompt: draftConfig.sideCaptionPrompt,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "保存配置失败。");
      const nextConfig = data as ApiConfig;
      setConfig(nextConfig);
      setDraftConfig(toDraft(nextConfig));
      setSettingsOpen(false);
      setMessage("配置已保存，下一次处理会使用新的设置。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存配置失败。");
    } finally {
      setIsSavingConfig(false);
    }
  }

  async function clearLibrary() {
    if (!window.confirm("这会清空当前数据库记录和所有已生成的渲染图，原始照片不会删除。要继续吗？")) {
      return;
    }
    setIsProcessing(true);
    setMessage("正在清空数据库和渲染图...");
    try {
      const response = await fetch("/api/library/clear", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "清空失败。");
      setItems([]);
      setView({ type: "gallery" });
      setMessage(`已清空 ${data.removedItems} 条记录，并删除 ${data.removedRenders} 张渲染图。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "清空失败。");
    } finally {
      setIsProcessing(false);
    }
  }

  function randomDay() {
    if (!items.length) return;
    const sample = items[Math.floor(Math.random() * items.length)];
    const date = new Date(`${sample.capturedDate}T00:00:00`);
    if (Number.isNaN(date.getTime())) return;
    setMonth(date.getMonth() + 1);
    setDay(date.getDate());
  }

  function updateDraft(field: keyof ConfigDraft) {
    return (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      setDraftConfig((current) => (current ? { ...current, [field]: event.target.value } : current));
    };
  }

  function updateDraftBoolean(field: "excludeScreenshots") {
    return (event: ChangeEvent<HTMLInputElement>) => {
      setDraftConfig((current) => (current ? { ...current, [field]: event.target.checked } : current));
    };
  }

  if (selected) {
    return <DetailView item={selected} onBack={() => setView({ type: "gallery" })} />;
  }

  return (
    <main className="appFrame">
      <section className="page">
        <header className="pageHeader">
          <div className="titleRow">
            <div>
              <h1>InkTime 照片数据库</h1>
              <p>
                图片目录：{config?.imageDir ?? "未设置"} | 模型：{config?.model ?? "--"} | Prompt 版本：{config?.promptVersion ?? "--"} |
                数据库：{databasePath} | 当前 {filteredItems.length} 张 / 总计 {items.length} 张
              </p>
            </div>
            <button type="button" className="settingsToggle" onClick={() => setSettingsOpen(true)}>
              <Settings2 size={16} /> 设置
            </button>
          </div>
        </header>

        <section className="controlBand">
          <label>
            月份：
            <select value={month} onChange={(event) => setMonth(event.target.value === "all" ? "all" : Number(event.target.value))}>
              <option value="all">全部</option>
              {monthOptions.map((value) => (
                <option key={value} value={value}>
                  {value} 月
                </option>
              ))}
            </select>
          </label>
          <label>
            日期：
            <select value={day} onChange={(event) => setDay(event.target.value === "all" ? "all" : Number(event.target.value))}>
              <option value="all">全部</option>
              {dayOptions.map((value) => (
                <option key={value} value={value}>
                  {value} 日
                </option>
              ))}
            </select>
          </label>
          <label>
            排序：
            <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
              <option value="memory">按回忆度</option>
              <option value="newest">按处理时间</option>
            </select>
          </label>
          <button type="button" onClick={randomDay}>
            <Shuffle size={15} /> 随机一天
          </button>
          <button
            type="button"
            onClick={() => {
              setMonth("all");
              setDay("all");
            }}
          >
            <Home size={15} /> 回到首页
          </button>
          <button type="button" onClick={() => void rerenderGallery()} disabled={isProcessing || !items.length}>
            <Sparkles size={15} /> {isProcessing ? "处理中" : "仅重渲染"}
          </button>
          <button type="button" onClick={() => void processDirectory("rerun")} disabled={isProcessing || !items.length}>
            <RotateCcw size={15} /> {isProcessing ? "处理中" : "重跑已入库"}
          </button>
          <button type="button" className="primaryAction" onClick={() => void processDirectory("new")} disabled={isProcessing}>
            <RefreshCw size={15} /> {isProcessing ? "处理中" : "处理新图"}
          </button>
        </section>

        {message ? <p className="statusLine">{message}</p> : null}

        {filteredItems.length ? (
          <section className="photoGrid">
            {filteredItems.map((item) => (
              <button className="photoCard" type="button" key={item.id} onClick={() => setView({ type: "detail", id: item.id })}>
                <div className="photoThumb">
                  <img src={item.sourceUrl} alt={item.fileName} />
                </div>
                <div className="photoMeta">
                  <strong>{item.sideCaption || item.caption}</strong>
                  <span>{item.sourcePath}</span>
                  <span>类型：{item.tags.join("、") || "未分类"}</span>
                  <span>
                    版本：{item.promptVersion || "-"} · 模型：{item.model || "-"}
                  </span>
                  <b>回忆度：{item.scores.memory.toFixed(1)}</b>
                </div>
              </button>
            ))}
          </section>
        ) : (
          <section className="emptyPanel">
            <h2>数据库里还没有可展示的图片</h2>
            <p>先在“设置”里确认图片目录、模型和提示词，再点击“处理新图”。</p>
          </section>
        )}
      </section>

      {settingsOpen && draftConfig ? (
        <div className="settingsOverlay" onClick={() => setSettingsOpen(false)}>
          <aside className="settingsPanel" onClick={(event) => event.stopPropagation()}>
            <div className="settingsHeader">
              <div>
                <h2>运行设置</h2>
                <p>测试期建议每一版 Prompt 都填写清晰版本号，便于回看和比较。</p>
              </div>
              <button type="button" className="iconOnly" onClick={() => setSettingsOpen(false)}>
                <X size={18} />
              </button>
            </div>

            <form className="settingsForm" onSubmit={(event) => void saveConfig(event)}>
              <label>
                图片目录
                <input value={draftConfig.imageDir} onChange={updateDraft("imageDir")} />
              </label>

              <div className="settingsRow">
                <label>
                  DashScope 接口地址
                  <input value={draftConfig.providerBaseUrl} onChange={updateDraft("providerBaseUrl")} />
                </label>
                <label>
                  API Key 环境变量名
                  <input value={draftConfig.apiKeyEnvName} onChange={updateDraft("apiKeyEnvName")} />
                </label>
              </div>

              <div className="statusLine">
                API Key 状态：{config?.apiKeyConfigured ? "已读取" : "未读取"}，从本地 `.env.local` / `.env` 中读取，不会显示在页面上。
              </div>

              <div className="settingsRow">
                <label>
                  模型
                  <select value={draftConfig.model} onChange={updateDraft("model")}>
                    {splitLines(draftConfig.modelOptionsText, ["qwen3.5-flash"]).map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Prompt 版本
                  <input value={draftConfig.promptVersion} onChange={updateDraft("promptVersion")} />
                </label>
              </div>

              <label>
                模型候选列表（每行一个）
                <textarea rows={5} value={draftConfig.modelOptionsText} onChange={updateDraft("modelOptionsText")} />
              </label>

              <label className="checkboxRow">
                <input type="checkbox" checked={draftConfig.excludeScreenshots} onChange={updateDraftBoolean("excludeScreenshots")} />
                <span>默认剔除屏幕截图</span>
              </label>

              <label>
                剔除文件名关键词（每行一个）
                <textarea rows={4} value={draftConfig.excludeNamePatternsText} onChange={updateDraft("excludeNamePatternsText")} />
              </label>

              <div className="settingsRow">
                <label>
                  每次处理上限
                  <input type="number" min="1" value={draftConfig.maxImagesPerRun} onChange={updateDraft("maxImagesPerRun")} />
                </label>
                <label>
                  并发处理数
                  <input type="number" min="1" max="6" value={draftConfig.maxConcurrentImages} onChange={updateDraft("maxConcurrentImages")} />
                </label>
                <label>
                  数据目录
                  <input value={draftConfig.dataDir} onChange={updateDraft("dataDir")} />
                </label>
                <label>
                  数据库文件名
                  <input value={draftConfig.databaseFile} onChange={updateDraft("databaseFile")} />
                </label>
              </div>
              <p className="settingsHint">每次处理上限表示本轮最多处理多少张照片；并发处理数表示同时处理多少张，数值越大越快，也越容易遇到接口限流。</p>

              <div className="settingsRow">
                <label>
                  短边宽度
                  <select value={draftConfig.renderFrameMode} onChange={updateDraft("renderFrameMode")}>
                    <option value="fixed">固定横竖模板</option>
                    <option value="adaptive">自适应相框</option>
                  </select>
                </label>
                <label>
                  短边宽度
                  <input type="number" min="1" value={draftConfig.renderWidth} onChange={updateDraft("renderWidth")} />
                </label>
                <label>
                  长边高度
                  <input type="number" min="1" value={draftConfig.renderHeight} onChange={updateDraft("renderHeight")} />
                </label>
                <label>
                  底部信息区高度
                  <input type="number" min="1" value={draftConfig.footerHeight} onChange={updateDraft("footerHeight")} />
                </label>
              </div>

              <label>
                回忆度提示词
                <textarea rows={16} value={draftConfig.scoringPrompt} onChange={updateDraft("scoringPrompt")} />
              </label>

              <label>
                底部短句提示词
                <textarea rows={10} value={draftConfig.sideCaptionPrompt} onChange={updateDraft("sideCaptionPrompt")} />
              </label>

              <div className="settingsActions">
                <button type="button" className="dangerAction" onClick={() => void clearLibrary()} disabled={isProcessing}>
                  清空数据库与渲染图
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDraftConfig(config ? toDraft(config) : null);
                    setSettingsOpen(false);
                  }}
                >
                  取消
                </button>
                <button type="submit" className="primaryAction" disabled={isSavingConfig}>
                  {isSavingConfig ? "保存中" : "保存设置"}
                </button>
              </div>
              <div className="dangerPanel">
                <strong>数据管理</strong>
                <p>当前共 {items.length} 条记录。清空按钮会删除数据库里的全部条目和本地生成的渲染图，但不会动原始照片目录。</p>
              </div>
            </form>
          </aside>
        </div>
      ) : null}
    </main>
  );
}

function DetailView({ item, onBack }: { item: GalleryImage; onBack: () => void }) {
  return (
    <main className="appFrame">
      <section className="simPage">
        <div className="renderColumn">
          <img src={item.renderedUrl} alt={`${item.fileName} rendered`} />
        </div>
        <article className="insightPanel">
          <button className="backButton" type="button" onClick={onBack}>
            <ArrowLeft size={16} /> 返回
          </button>
          <h1>{item.sideCaption || item.caption}</h1>
          <div className="tagRow">
            {item.tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
          <p>{item.caption}</p>
          <ScoreBar label="回忆度" value={item.scores.memory} className="memory" />
          <div className="reasonBox">
            <strong>评分理由：</strong>
            {item.reason}
          </div>
          <div className="reasonBox">
            <strong>实验信息：</strong>
            {item.promptVersion || "-"} · {item.model || "-"} · {item.runId || "-"}
          </div>
          <footer>
            <span>{item.sourcePath}</span>
            <a href={item.renderedUrl} download>
              <Download size={15} /> 下载渲染图
            </a>
          </footer>
        </article>
      </section>
    </main>
  );
}

function ScoreBar({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <div className="scoreBar">
      <span>{label}</span>
      <div>
        <i className={className} style={{ width: `${value}%` }} />
      </div>
      <b>{value.toFixed(1)}</b>
    </div>
  );
}

function toDraft(config: ApiConfig): ConfigDraft {
  return {
    imageDir: config.imageDir,
    providerBaseUrl: config.providerBaseUrl,
    apiKeyEnvName: config.apiKeyEnvName,
    model: config.model,
    excludeScreenshots: config.excludeScreenshots,
    maxImagesPerRun: config.maxImagesPerRun,
    maxConcurrentImages: config.maxConcurrentImages,
    dataDir: config.dataDir,
    databaseFile: config.databaseFile,
    renderFrameMode: config.renderFrameMode,
    renderWidth: config.renderWidth,
    renderHeight: config.renderHeight,
    footerHeight: config.footerHeight,
    promptVersion: config.promptVersion,
    scoringPrompt: config.scoringPrompt,
    sideCaptionPrompt: config.sideCaptionPrompt,
    modelOptionsText: config.modelOptions.join("\n"),
    excludeNamePatternsText: config.excludeNamePatterns.join("\n"),
  };
}

function splitLines(text: string, fallback: string[]): string[] {
  const items = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return items.length ? Array.from(new Set(items)) : fallback;
}
