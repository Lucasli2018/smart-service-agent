# 🐱 小蜜智能客服 Agent

零构建的单文件 Web 应用 + Cloudflare Pages Functions 云端后端。支持多轮对话、FAQ 知识库检索、意图自动识别、自动转人工、对话历史持久化、满意度统计与管理后台。

> **v2 视觉升级**：全面改用内联 SVG 线性图标（零 emoji、零图标库依赖），界面换为「浅色留白 + 深墨文字 + 靛蓝点缀」的简洁高端风格；新增近 14 天会话趋势图、对话状态筛选、FAQ 在线编辑、会话搜索、云端连接状态指示。
>
> **v3 品牌与体验**：新增品牌 SVG favicon（解决标签页默认图标）+ PWA 可安装（manifest + Service Worker + 桌面图标）；会话标题由首条消息自动生成（不再全是「新咨询」）；后台支持导出 CSV、FAQ 按分类筛选。
>
> **v4 人工坐席闭环**：新增「坐席工作台」——待接入队列、坐席接入、人工双向对话、结束会话，转人工后 AI 自动退场不再插嘴；访客端新增欢迎语卡片、快捷问题引导、打字机回复动画、消息已送达状态、人工接待横幅，并补强移动端适配。
>
> **v5 真实大模型接入**：新增「模型设置」后台，可视化切换 **Mock / DeepSeek / OpenAI / 通义千问 / 自定义接口 / Workers AI** 六种引擎，填 Key 即热生效、无需改代码重新部署；支持 API Key 脱敏存储、一键连通性测试、自定义系统提示词与欢迎语；调用失败自动降级 Mock 且错误可观测。

## 功能

### 访客端
- 💬 **多轮对话**：基于会话上下文连续追问，云端持久化历史
- 🎯 **意图识别**：自动识别「退款 / 查询订单 / 技术支持 / 其他」，并在消息上打标签
- 📚 **FAQ 检索**：中文分词 + 关键词加权，命中知识库直接给出准确答案
- 🙋 **自动转人工**：识别「转人工」、负面情绪、多轮未解决时自动转接
- ⭐ **满意度评价**：1-5 星评分 + 文字反馈
- 🕘 **会话历史**：本地保存访客 ID，随时回看历史咨询（标题由首条消息自动生成）
- 👩‍💼 **人工接待**：转人工后进入坐席队列，人工客服接入后消息直达真人，AI 不再插嘴
- ✨ **体验增强**：欢迎语卡片、快捷问题引导、打字机回复动画、消息已送达状态、人工接待横幅
- 📲 **PWA 可安装**：添加到桌面，离线可访问外壳（接口始终实时）

### 坐席工作台
- 📥 **待接入队列**：转人工会话按等待时间排列，红点实时提示待接入数量，5 秒自动刷新
- 🎧 **接入服务**：坐席输入名称后接入会话，访客侧即时显示「人工客服已接入」
- 💬 **人工双向对话**：坐席回复直达访客，人工消息特殊标识
- ✅ **结束会话**：服务完成后关闭会话，访客侧同步收到结束提示
- 👤 **多坐席隔离**：按坐席名称过滤「服务中」会话（名称存本地，可随时切换）

### 管理后台
- 📊 总会话 / 消息数 / 转人工数 / 平均满意度实时统计
- 📈 近 14 天会话趋势图（含日均、峰值）
- 🎯 意图分布、满意度分布可视化
- 💬 全部对话记录，支持按状态筛选，点开可查看完整对话时间线
- 📚 FAQ 知识库在线增删改 + 按分类筛选
- ⬇️ 对话记录一键导出 CSV（UTF-8 BOM，Excel 直接打开）

### 模型设置（v5）
- ⚙️ **六种引擎**：Mock 演示 / DeepSeek / OpenAI / 通义千问 / 自定义 OpenAI 兼容接口 / Cloudflare Workers AI
- 🔑 **后台可视化配置**：选供应商、填 API Key、改模型名与 Temperature，保存即时生效，无需改代码或重新部署
- 🔒 **密钥安全**：API Key 只以脱敏形式回传后台（`sk-a****5678`），存储于云端 D1，留空保存不会覆盖原 Key
- 🔌 **一键连通性测试**：真实调用一次模型并展示耗时与回复；失败自动降级 Mock 并说明原因
- 📝 **自定义提示词 / 欢迎语**：后台直接编辑系统提示词与访客欢迎语，FAQ 命中内容会自动注入提示词作为知识库参考

## 部署（Cloudflare Pages）

1. 首次建表（共享 `dev` 库，表前缀 `cs_` 隔离）：
   ```bash
   node init-d1.mjs   # 读取本机 Machine 级 CLOUDFLARE_API_TOKEN，幂等
   node seed.mjs      # 播种 12 条 FAQ（退款/订单/技术/通用）
   node migrate.mjs   # 存量库补新增列（幂等，可重复运行）
   ```
2. 部署：
   ```bash
   node scripts/deploy.mjs
   ```
   或 Pages 连接 Gitee 仓库（构建命令留空、输出目录留空），并在 设置→函数→D1 绑定 添加变量 `DB` → 选择 `dev` 库。
3. 访问 `https://smart-service-agent.pages.dev`

## 本地测试

```bash
node tests/server.mjs 8787     # 本地内存 D1 模拟后端
# 浏览器打开 http://127.0.0.1:8787
```

## 接入真实大模型（推荐：后台可视化配置）

打开线上应用顶部「**模型设置**」标签 → 选择服务商卡片 → 填入 API Key → 保存。Base URL 与模型名会自动带出默认预设，按需修改即可；点「测试连接」验证。保存后**新消息立即生效**，无需改代码或重新部署。

- **DeepSeek**：国内直连、中文效果好，填 `sk-` 开头的 Key 即可
- **OpenAI / 通义千问**：同样只需 API Key，默认端点已预置
- **自定义接口**：任意兼容 `/chat/completions` 的服务，需填 Base URL + 模型名
- **Workers AI**：零密钥，用 Cloudflare 边缘模型（需 Pages 绑定 `AI`）
- **Mock**：默认引擎，零配置即可完整演示

### 环境变量兜底（可选）

也可在项目根 `.env` / Pages 环境变量配置，作为 D1 未配置时的兜底（复制 `.env.example`）：

```env
LLM_PROVIDER=deepseek    # mock|deepseek|openai|qwen|custom|workers-ai
LLM_API_KEY=sk-xxxx
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_MODEL=deepseek-chat
LLM_TEMPERATURE=0.7
```

优先级：**D1 后台配置 > 环境变量 > Mock**。任何方式都不配也能以 Mock 完整运行。

## 数据模型（D1 · `cs_` 前缀）

| 表 | 说明 |
|---|---|
| `cs_conversations` | 会话（访客、状态、意图、时间） |
| `cs_messages` | 消息（角色、内容、意图、来源） |
| `cs_faqs` | FAQ 知识库（问题、答案、分类、关键词、命中数） |
| `cs_ratings` | 满意度评价（星级、留言） |
| `cs_settings` | 系统配置（key-value：大模型供应商/密钥/提示词/欢迎语） |

## 文件结构

```
smart-service-agent/
├── index.html                  # 前端单文件（客服 + 管理后台）
├── favicon.ico                 # 浏览器标签页图标（16/32/48/64，ico 兜底）
├── icon.svg                    # 品牌图标（矢量，现代浏览器首选）
├── apple-touch-icon.png        # iOS 添加到主屏图标（180×180）
├── icon-192.png / icon-512.png # PWA 安装图标
├── manifest.webmanifest        # PWA 清单
├── sw.js                       # Service Worker（静态外壳缓存，API 不缓存）
├── wrangler.toml               # Pages 配置 + D1 绑定
├── schema.sql                  # cs_ 表结构
├── init-d1.mjs / seed.mjs      # 建表 / 播种
├── migrate.mjs                 # 存量库幂等迁移（补新增列，如 v4 的 agent）
├── scripts/                    # config.mjs · deploy.mjs · gen-icons.py（图标生成器）
├── functions/
│   ├── _lib/core.mjs           # 意图识别 / FAQ 检索 / 转人工 / 六引擎可插拔 LLM
│   └── api/[[route]].mjs       # 所有 API
└── tests/                      # server.mjs（本地模拟后端）· probe-server.mjs（E2E 探针）
```
