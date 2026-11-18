# 🐱 小蜜智能客服 Agent

零构建的单文件 Web 应用 + Cloudflare Pages Functions 云端后端。支持多轮对话、FAQ 知识库检索、意图自动识别、自动转人工、对话历史持久化、满意度统计与管理后台。

## 功能

### 访客端
- 💬 **多轮对话**：基于会话上下文连续追问，云端持久化历史
- 🎯 **意图识别**：自动识别「退款 / 查询订单 / 技术支持 / 其他」，并在消息上打标签
- 📚 **FAQ 检索**：中文分词 + 关键词加权，命中知识库直接给出准确答案
- 🙋 **自动转人工**：识别「转人工」、负面情绪、多轮未解决时自动转接
- ⭐ **满意度评价**：1-5 星评分 + 文字反馈
- 🕘 **会话历史**：本地保存访客 ID，随时回看历史咨询

### 管理后台
- 📊 总会话 / 消息数 / 转人工数 / 平均满意度实时统计
- 🎯 意图分布、满意度分布可视化
- 💬 全部对话记录，点开可查看完整对话时间线
- 📚 FAQ 知识库在线增删改

### 大模型
- 默认内置 **Mock 引擎**，无需任何密钥即可完整演示
- 可插拔真实大模型：在 `.env` 配置 `LLM_PROVIDER` 即可切换 `openai` / `deepseek` / `workers-ai`

## 部署（Cloudflare Pages）

1. 首次建表（共享 `dev` 库，表前缀 `cs_` 隔离）：
   ```bash
   node init-d1.mjs   # 读取本机 Machine 级 CLOUDFLARE_API_TOKEN，幂等
   node seed.mjs      # 播种 12 条 FAQ（退款/订单/技术/通用）
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

## 接入真实大模型

在项目根 `.env` 中配置（复制 `.env.example`）：

```env
LLM_PROVIDER=deepseek          # openai | deepseek | workers-ai
LLM_API_KEY=sk-xxxx
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_MODEL=deepseek-chat
```

Pages 项目同样需要在 设置→函数→环境变量 里加同名变量。**不留 Key 也能跑_mock**。

## 数据模型（D1 · `cs_` 前缀）

| 表 | 说明 |
|---|---|
| `cs_conversations` | 会话（访客、状态、意图、时间） |
| `cs_messages` | 消息（角色、内容、意图、来源） |
| `cs_faqs` | FAQ 知识库（问题、答案、分类、关键词、命中数） |
| `cs_ratings` | 满意度评价（星级、留言） |

## 文件结构

```
smart-service-agent/
├── index.html                  # 前端单文件（客服 + 管理后台）
├── wrangler.toml               # Pages 配置 + D1 绑定
├── schema.sql                  # cs_ 表结构
├── init-d1.mjs / seed.mjs      # 建表 / 播种
├── scripts/                    # config.mjs · deploy.mjs
├── functions/
│   ├── _lib/core.mjs           # 意图识别 / FAQ 检索 / 转人工 / 可插拔 LLM
│   └── api/[[route]].mjs       # 所有 API
└── tests/server.mjs            # 本地模拟后端
```
