/* 智能客服 Agent · 公共库（Node / Workers 双端可运行）
   职责：响应封装、意图识别、FAQ 检索、转人工判定、可插拔 LLM（Mock 兜底） */

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" } });
}
export function bad(error, status = 400) { return json({ ok: false, error }, status); }
export const now = () => Date.now();
export const uid = () => (globalThis.crypto?.randomUUID?.() || (Date.now() + Math.random().toString(36).slice(2)));

/* ============ 1. 意图识别 ============ */
const INTENT_RULES = [
  { intent: "refund", label: "退款", words: ["退款", "退钱", "退货", "退单", "申请退", "退回", "运费险", "不想要了", "退回来", "钱没到"] },
  { intent: "order", label: "查询订单", words: ["订单", "快递", "物流", "发货", "到哪", "单号", "签收", "配送", "什么时候到", "查订单", "包裹", "运单"] },
  { intent: "tech", label: "技术支持", words: ["报错", "闪退", "卡顿", "崩溃", "登录不", "登不上", "密码", "支付失败", "付不了", "bug", "故障", "无法", "打不开", "用不了", "异常", "黑屏", "验证"] },
];
const HUMAN_WORDS = ["转人工", "人工客服", "真人", "人工服务", "找人工", "接人工", "转接人工"];
const ANGRY_WORDS = ["投诉", "骗人", "骗子", "垃圾", "太差", "什么破", "举报", "曝光", "要到消协", "差评", "没用", "解决不了", "答非所问"];

export function detectIntent(text) {
  const t = String(text || "").toLowerCase();
  let best = { intent: "other", label: "其他", score: 0 };
  for (const rule of INTENT_RULES) {
    let hit = 0;
    for (const w of rule.words) if (t.includes(w)) hit += w.length >= 3 ? 2 : 1;
    if (hit > best.score) best = { intent: rule.intent, label: rule.label, score: hit };
  }
  return best;
}

/* ============ 2. FAQ 检索（轻量中文分词 + 关键词加权） ============ */
function bigrams(s) {
  const t = String(s || "").toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9]/g, "");
  const out = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  if (t.length === 1) out.push(t);
  return out;
}
export function searchFaq(faqs, query, intent) {
  const q = String(query || "").toLowerCase();
  const qgrams = bigrams(q);
  let best = null;
  for (const f of faqs) {
    if (!f.enabled) continue;
    let score = 0;
    // 关键词精确命中权重最高
    let kw = [];
    try { kw = JSON.parse(f.keywords || "[]"); } catch (e) {}
    for (const k of kw) if (q.includes(String(k).toLowerCase())) score += 6;
    // 问题 bigram 重合度
    const fgrams = bigrams(f.question);
    for (const g of qgrams) if (fgrams.includes(g)) score += 1;
    // 意图一致加权
    if (intent && intent !== "other" && f.category === intent) score += 3;
    if (!best || score > best.score) best = { faq: f, score };
  }
  // 阈值：低于 3 视为未命中
  return best && best.score >= 3 ? best : null;
}

/* ============ 3. 转人工判定 ============ */
export function needHuman(text, { intentHit = false, turns = 0, faqHit = false } = {}) {
  const t = String(text || "").toLowerCase();
  if (HUMAN_WORDS.some(w => t.includes(w))) return "用户主动要求";
  if (ANGRY_WORDS.some(w => t.includes(w))) return "检测到负面情绪";
  // 多轮仍未命中知识库 → 人工介入
  if (turns >= 3 && !faqHit && !intentHit) return "多次未能解决";
  return null;
}

/* ============ 4. 可插拔 LLM 层（D1 动态配置 + 环境变量兜底） ============ */
// 供应商预设：base/model 缺省值；custom 需自行填写 base+model。
export const LLM_PRESETS = {
  mock:       { label: "Mock 演示", base: "", model: "", needKey: false, desc: "零配置，用规则+FAQ 生成拟人回复" },
  deepseek:   { label: "DeepSeek", base: "https://api.deepseek.com/v1", model: "deepseek-chat", needKey: true, desc: "国内直连、中文效果好、性价比高" },
  openai:     { label: "OpenAI", base: "https://api.openai.com/v1", model: "gpt-4o-mini", needKey: true, desc: "生态成熟，支持 GPT / o 系列" },
  qwen:       { label: "通义千问", base: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", needKey: true, desc: "阿里云百炼，OpenAI 兼容模式" },
  custom:     { label: "自定义接口", base: "", model: "", needKey: true, desc: "任意 OpenAI 兼容的 /chat/completions 端点" },
  "workers-ai":{ label: "Workers AI", base: "", model: "@cf/meta/llama-3.1-8b-instruct", needKey: false, desc: "Cloudflare 边缘模型，无需密钥" },
};

// 密钥脱敏：仅保留前 4 / 后 4 位，供后台安全展示
export function maskSecret(s) {
  const v = String(s || "");
  if (!v) return "";
  if (v.length <= 8) return v.slice(0, 2) + "****";
  return v.slice(0, 4) + "****" + v.slice(-4);
}

// 由 D1 settings（key→value 对象）+ env 归一化出 LLM 配置
export function llmConfig(settings = {}, env = {}) {
  const pick = (k, ek, def = "") => {
    const v = settings[k];
    return (v !== undefined && v !== null && String(v) !== "") ? String(v) : (env[ek] || def);
  };
  const provider = pick("llm_provider", "LLM_PROVIDER", "mock").toLowerCase();
  const p = LLM_PRESETS[provider] || LLM_PRESETS.mock;
  const temperature = Number(pick("llm_temperature", "LLM_TEMPERATURE", "0.7"));
  return {
    provider,
    base: pick("llm_base_url", "LLM_BASE_URL", p.base).trim(),
    model: pick("llm_model", "LLM_MODEL", p.model).trim(),
    apiKey: pick("llm_api_key", "LLM_API_KEY", "").trim(),
    temperature: Number.isFinite(temperature) ? Math.max(0, Math.min(2, temperature)) : 0.7,
    maxTokens: parseInt(pick("llm_max_tokens", "LLM_MAX_TOKENS", "600"), 10) || 600,
    systemPrompt: String(settings.llm_system_prompt || ""),
    needKey: p.needKey,
  };
}

// 调用大模型；无论成功失败都返回字符串（失败自动降级 Mock）。
// 调用结果的可观测信息写回 ctx：llmUsed / llmError / llmModel / llmProvider。
export async function callLLM(messages, env = {}, ctx = {}) {
  const cfg = ctx.llmConfig || llmConfig(ctx.settings || {}, env);
  ctx.llmProvider = cfg.provider;
  ctx.llmModel = cfg.model;
  ctx.llmUsed = false;
  ctx.llmError = "";
  const fallback = (err) => { ctx.llmError = String(err || ""); return mockReply(messages, ctx); };

  if (cfg.provider === "mock") return mockReply(messages, ctx);

  // Workers AI：走 Cloudflare 绑定，无需密钥
  if (cfg.provider === "workers-ai") {
    if (!env.AI) return fallback("Workers AI 未绑定（env.AI 不可用）");
    try {
      const r = await env.AI.run(cfg.model, { messages, temperature: cfg.temperature, max_tokens: cfg.maxTokens });
      const text = String(r?.response || r?.result || "").trim();
      if (!text) throw new Error("模型返回为空");
      ctx.llmUsed = true;
      return text;
    } catch (e) { return fallback(e?.message || e); }
  }

  if (cfg.needKey && !cfg.apiKey) return fallback("未配置 API Key");
  if (!cfg.base) return fallback("未配置接口地址（Base URL）");

  try {
    const r = await fetch(cfg.base.replace(/\/+$/, "") + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.apiKey },
      body: JSON.stringify({ model: cfg.model, messages, temperature: cfg.temperature, max_tokens: cfg.maxTokens, stream: false }),
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      throw new Error("HTTP " + r.status + " " + detail.slice(0, 200));
    }
    const j = await r.json();
    const text = String(j?.choices?.[0]?.message?.content ?? "").trim();
    if (!text) throw new Error("模型返回为空");
    ctx.llmUsed = true;
    return text;
  } catch (e) { return fallback(e?.message || e); }
}

// Mock 回复：根据命中 FAQ + 意图生成拟人化答案，保证零配置也能完整演示。
function mockReply(messages, ctx = {}) {
  const last = [...messages].reverse().find(m => m.role === "user")?.content || "";
  if (ctx.faqAnswer) {
    return ctx.faqAnswer;
  }
  const intent = ctx.intent?.intent || "other";
  const bank = {
    refund: "理解您的心情～关于退款，一般您可以在「我的订单」中发起申请，审核通过后 1-3 个工作日原路退回。如果您的订单情况比较特殊，我可以帮您转接人工客服进一步核实，需要吗？",
    order: "关于订单/物流，您可以在「我的订单」页查看实时状态。若方便的话提供一下订单号，我这就帮您查询～ 也可以直接说「转人工」由专员为您跟进。",
    tech: "抱歉给您带来不便🙁 这类问题通常是版本或网络导致。建议先更新 App 并清理缓存重试；若仍无法解决，我可以帮您转人工客服，由技术专员协助排查。",
    other: "收到您的问题啦～为了更准确地帮到您，可以再补充一些细节吗？比如订单号、问题出现的时间或截图。如果着急，也可以直接说「转人工」。",
  };
  // 简单追问上下文
  if (/订单号|单号/.test(last)) return "好的，我记下了您的订单号。当前为演示环境，真实接入后我会实时查询订单状态；如需立即处理，建议转人工客服哦。";
  return bank[intent] || bank.other;
}

/* ============ 5. 统一系统提示词（支持后台自定义覆盖） ============ */
export const DEFAULT_SYSTEM_PROMPT =
  "你是一名专业、友好、耐心的电商智能客服「小蜜」。请用简体中文回答，语气亲切，回答简洁准确。\n" +
  "规则：1) 优先依据知识库回答；2) 无法解决或用户要求时主动引导转人工；3) 不编造订单/退款结果，涉及具体订单请引导提供订单号或转人工。";

export function systemPrompt(faqContext, custom = "") {
  const base = String(custom || "").trim() || DEFAULT_SYSTEM_PROMPT;
  return base + "\n" + (faqContext ? "【知识库参考】\n" + faqContext + "\n" : "");
}
