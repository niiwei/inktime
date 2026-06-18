# InkTime Gallery

这是一个面向本地相册的轻量复刻版 `InkTime`：

- 从固定图片目录读取照片
- 调用视觉模型生成中文描述、标签、回忆度、美观度、推荐理由
- 按 `480x800` 的竖版布局渲染普通 PNG 图片
- 在中文前端里查看画廊、筛选、排序、详情和配置
- 默认做工程预筛选，自动排除常见截图文件名

当前版本不包含：

- 墨水屏色彩抖动
- `.bin` / `.h` 导出
- ESP32 固件与定时刷新

## 启动

```powershell
npm install
npm run dev
```

打开 [http://127.0.0.1:5173](http://127.0.0.1:5173)

## 配置

运行配置保存在 [config/gallery.config.json](/C:/Users/29982/Documents/inktime/config/gallery.config.json)，也可以直接在网页右上角“设置”面板中修改：

- 图片目录
- 百炼兼容接口地址
- API Key 环境变量名
- 模型与模型候选列表
- 截图剔除规则
- 每次处理上限
- 数据目录与数据库文件名
- 渲染尺寸
- 模型评分 Prompt

## API Key

服务端会优先从本地 `.env.local` 读取 API Key，不会在前端页面直接展示。

示例：

```env
DASHSCOPE_API_KEY=your-key
```

## 数据持久化

运行结果默认保存在 `data/`：

- `data/gallery-db.json`：评分结果数据库
- `data/renders/`：渲染后的图片
