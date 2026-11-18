/* 智能客服 Agent · D1 表结构
   共享 dev 库，所有表带 cs_ 前缀避免跨项目冲突。
   会话 / 消息 / FAQ 知识库 / 满意度评价 */

CREATE TABLE IF NOT EXISTS cs_conversations (
  id TEXT PRIMARY KEY,
  visitor TEXT NOT NULL,              -- 访客标识（前端生成的匿名 ID）
  title TEXT DEFAULT '',              -- 会话标题（首条用户消息截取）
  status TEXT DEFAULT 'open',         -- open | transferred | serving | closed
  intent TEXT DEFAULT 'other',        -- 最近识别的意图
  agent TEXT DEFAULT '',              -- 接入的人工坐席标识
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS cs_idx_conv_visitor ON cs_conversations (visitor, updated DESC);
CREATE INDEX IF NOT EXISTS cs_idx_conv_updated ON cs_conversations (updated DESC);

CREATE TABLE IF NOT EXISTS cs_messages (
  id TEXT PRIMARY KEY,
  conv_id TEXT NOT NULL,
  role TEXT NOT NULL,                 -- user | agent | system
  content TEXT NOT NULL,
  intent TEXT DEFAULT '',             -- 该消息识别出的意图
  source TEXT DEFAULT '',             -- faq | llm | transfer | greeting | mock
  faq_id TEXT DEFAULT '',             -- 命中的 FAQ（若有）
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS cs_idx_msg_conv ON cs_messages (conv_id, created ASC);

CREATE TABLE IF NOT EXISTS cs_faqs (
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  category TEXT DEFAULT 'general',    -- refund | order | tech | general
  keywords TEXT DEFAULT '[]',         -- JSON 数组，用于检索加权
  hits INTEGER DEFAULT 0,
  enabled INTEGER DEFAULT 1,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS cs_idx_faq_cat ON cs_faqs (category, enabled);

CREATE TABLE IF NOT EXISTS cs_ratings (
  id TEXT PRIMARY KEY,
  conv_id TEXT NOT NULL,
  score INTEGER NOT NULL,             -- 1..5
  comment TEXT DEFAULT '',
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS cs_idx_rating_conv ON cs_ratings (conv_id);
