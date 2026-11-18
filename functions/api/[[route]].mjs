/* 智能客服 Agent · API 路由（Cloudflare Pages Functions，D1 绑定名 DB）
   访客端：新会话 / 发消息（多轮）/ 历史 / 评价 / 转人工
   坐席端：待接入队列 / 接入 / 人工回复 / 结束会话
   管理端：对话记录 / 满意度统计 / FAQ 增删改 / 大模型配置 */
import {
  json, bad, now, uid, detectIntent, searchFaq, needHuman, callLLM, systemPrompt,
  llmConfig, LLM_PRESETS, maskSecret, DEFAULT_SYSTEM_PROMPT
} from "../_lib/core.mjs";

// 读取 D1 中的模型配置（key→value）；表不存在时静默降级为空配置
async function loadSettings(env) {
  try {
    const r = await env.DB.prepare("SELECT key,value FROM cs_settings").all();
    const o = {};
    for (const row of r.results) o[row.key] = row.value;
    return o;
  } catch (e) { return {}; }
}
// 后台展示用的配置（API Key 脱敏）
function publicSettings(s) {
  return {
    llm_provider: s.llm_provider || "mock",
    llm_base_url: s.llm_base_url || "",
    llm_model: s.llm_model || "",
    llm_api_key: maskSecret(s.llm_api_key || ""),
    llm_temperature: s.llm_temperature || "0.7",
    llm_system_prompt: s.llm_system_prompt || "",
    greeting: s.greeting || "",
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  let path = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  const method = request.method;
  if (!env.DB) return bad("D1 未绑定（需在 Pages 配置名为 DB 的 D1 绑定）", 500);
  if (path === "ping") {
    const s = await loadSettings(env);
    return json({ ok: true, ts: now(), llm: s.llm_provider || env.LLM_PROVIDER || "mock" });
  }

  let body = {};
  if (["POST", "PUT", "PATCH"].includes(method)) {
    try { body = await request.json(); } catch (e) { return bad("请求体必须是 JSON"); }
  }
  const get = url.searchParams;

  /* ---------- 访客端：创建会话 ---------- */
  if (path === "conversations" && method === "POST") {
    const visitor = String(body.visitor || get.get("visitor") || uid());
    const id = uid();
    const t = now();
    await env.DB.prepare("INSERT INTO cs_conversations (id,visitor,title,status,intent,created,updated) VALUES (?1,?2,?3,'open','other',?4,?5)")
      .bind(id, visitor, String(body.title || "新咨询").slice(0, 60), t, t).run();
    // 欢迎语
    await env.DB.prepare("INSERT INTO cs_messages (id,conv_id,role,content,intent,source,created) VALUES (?1,?2,'agent',?3,'','greeting',?4)")
      .bind(uid(), id, "您好，我是智能客服小蜜。关于退款、订单查询、技术支持都可以问我～ 也可以直接说「转人工」哦。", t).run();
    return json({ ok: true, id, visitor });
  }

  /* ---------- 访客端：我的会话列表 ---------- */
  if (path === "conversations" && method === "GET") {
    const visitor = String(get.get("visitor") || "");
    if (!visitor) return bad("缺少 visitor");
    const r = await env.DB.prepare("SELECT * FROM cs_conversations WHERE visitor=?1 ORDER BY updated DESC LIMIT 50").bind(visitor).all();
    return json({ ok: true, conversations: r.results });
  }

  /* ---------- 管理端：全部会话 ---------- */
  if (path === "admin/conversations" && method === "GET") {
    const limit = Math.min(200, parseInt(get.get("limit"), 10) || 100);
    const status = get.get("status") || "";
    const sql = status
      ? "SELECT c.*, (SELECT COUNT(*) FROM cs_messages m WHERE m.conv_id=c.id) AS msg_count, (SELECT score FROM cs_ratings r WHERE r.conv_id=c.id ORDER BY r.created DESC LIMIT 1) AS score FROM cs_conversations c WHERE c.status=?1 ORDER BY c.updated DESC LIMIT ?2"
      : "SELECT c.*, (SELECT COUNT(*) FROM cs_messages m WHERE m.conv_id=c.id) AS msg_count, (SELECT score FROM cs_ratings r WHERE r.conv_id=c.id ORDER BY r.created DESC LIMIT 1) AS score FROM cs_conversations c ORDER BY c.updated DESC LIMIT ?1";
    const r = status ? await env.DB.prepare(sql).bind(status, limit).all() : await env.DB.prepare(sql).bind(limit).all();
    return json({ ok: true, conversations: r.results });
  }

  /* ---------- 会话详情（消息） ---------- */
  if (path === "messages" && method === "GET") {
    const cid = String(get.get("conv") || "");
    if (!cid) return bad("缺少 conv");
    const c = await env.DB.prepare("SELECT * FROM cs_conversations WHERE id=?1").bind(cid).first();
    if (!c) return bad("会话不存在", 404);
    const r = await env.DB.prepare("SELECT * FROM cs_messages WHERE conv_id=?1 ORDER BY created ASC LIMIT 300").bind(cid).all();
    const rating = await env.DB.prepare("SELECT * FROM cs_ratings WHERE conv_id=?1 ORDER BY created DESC LIMIT 1").bind(cid).first();
    return json({ ok: true, conversation: c, messages: r.results, rating: rating || null });
  }

  /* ================= 坐席工作台 API ================= */
  // 待接入队列：已转人工、尚无坐席接入
  if (path === "agent/queue" && method === "GET") {
    const r = await env.DB.prepare(
      "SELECT c.*, " +
      "(SELECT content FROM cs_messages m WHERE m.conv_id=c.id AND m.role='user' ORDER BY m.created DESC LIMIT 1) AS last_user, " +
      "(SELECT COUNT(*) FROM cs_messages m WHERE m.conv_id=c.id) AS msg_count " +
      "FROM cs_conversations c WHERE c.status='transferred' AND (c.agent='' OR c.agent IS NULL) ORDER BY c.updated ASC LIMIT 100"
    ).all();
    return json({ ok: true, conversations: r.results });
  }
  // 坐席正在服务的会话
  if (path === "agent/active" && method === "GET") {
    const agent = String(get.get("agent") || "");
    const sql = agent
      ? "SELECT c.*, (SELECT COUNT(*) FROM cs_messages m WHERE m.conv_id=c.id) AS msg_count FROM cs_conversations c WHERE c.status='serving' AND c.agent=?1 ORDER BY c.updated DESC LIMIT 100"
      : "SELECT c.*, (SELECT COUNT(*) FROM cs_messages m WHERE m.conv_id=c.id) AS msg_count FROM cs_conversations c WHERE c.status='serving' ORDER BY c.updated DESC LIMIT 100";
    const r = agent ? await env.DB.prepare(sql).bind(agent).all() : await env.DB.prepare(sql).all();
    return json({ ok: true, conversations: r.results });
  }
  // 坐席接入
  if (path === "agent/accept" && method === "POST") {
    const cid = String(body.conv || "");
    const agent = String(body.agent || "客服专员").trim().slice(0, 40) || "客服专员";
    const c = await env.DB.prepare("SELECT * FROM cs_conversations WHERE id=?1").bind(cid).first();
    if (!c) return bad("会话不存在", 404);
    if (c.status === "closed") return bad("会话已结束，无法接入");
    const t = now();
    await env.DB.prepare("UPDATE cs_conversations SET status='serving',agent=?1,updated=?2 WHERE id=?3").bind(agent, t, cid).run();
    await env.DB.prepare("INSERT INTO cs_messages (id,conv_id,role,content,intent,source,created) VALUES (?1,?2,'agent',?3,'','human',?4)")
      .bind(uid(), cid, `${agent}已接入会话，接下来由我为您服务，请稍候～`, t + 1).run();
    return json({ ok: true, agent });
  }
  // 坐席人工回复
  if (path === "agent/reply" && method === "POST") {
    const cid = String(body.conv || "");
    const text = String(body.text || "").trim().slice(0, 2000);
    const agent = String(body.agent || "客服专员").trim().slice(0, 40) || "客服专员";
    if (!cid || !text) return bad("缺少 conv 或 text");
    const c = await env.DB.prepare("SELECT * FROM cs_conversations WHERE id=?1").bind(cid).first();
    if (!c) return bad("会话不存在", 404);
    if (c.status !== "serving") return bad("会话未处于人工服务中");
    const t = now();
    await env.DB.prepare("INSERT INTO cs_messages (id,conv_id,role,content,intent,source,created) VALUES (?1,?2,'agent',?3,'','human',?4)")
      .bind(uid(), cid, text, t).run();
    await env.DB.prepare("UPDATE cs_conversations SET agent=?1,updated=?2 WHERE id=?3").bind(agent || c.agent, t + 1, cid).run();
    return json({ ok: true });
  }
  // 结束会话
  if (path === "agent/close" && method === "POST" || path === "admin/close" && method === "POST") {
    const cid = String(body.conv || "");
    const c = await env.DB.prepare("SELECT * FROM cs_conversations WHERE id=?1").bind(cid).first();
    if (!c) return bad("会话不存在", 404);
    const t = now();
    await env.DB.prepare("UPDATE cs_conversations SET status='closed',updated=?1 WHERE id=?2").bind(t, cid).run();
    await env.DB.prepare("INSERT INTO cs_messages (id,conv_id,role,content,intent,source,created) VALUES (?1,?2,'system','会话已结束，感谢您的咨询。','','close',?3)")
      .bind(uid(), cid, t + 1).run();
    return json({ ok: true });
  }

  /* ---------- 核心：多轮对话 ---------- */
  if (path === "chat" && method === "POST") {
    const cid = String(body.conv || "");
    const text = String(body.text || "").trim().slice(0, 2000);
    if (!cid || !text) return bad("缺少 conv 或 text");
    const conv = await env.DB.prepare("SELECT * FROM cs_conversations WHERE id=?1").bind(cid).first();
    if (!conv) return bad("会话不存在", 404);

    const t = now();
    const intent = detectIntent(text);
    // 取历史消息（多轮上下文）
    const hist = await env.DB.prepare("SELECT role,content FROM cs_messages WHERE conv_id=?1 ORDER BY created ASC LIMIT 40").bind(cid).all();
    const turns = hist.results.filter(m => m.role === "user").length;

    // FAQ 检索
    const faqRows = await env.DB.prepare("SELECT * FROM cs_faqs WHERE enabled=1").all();
    const hit = searchFaq(faqRows.results, text, intent.intent);
    if (hit) await env.DB.prepare("UPDATE cs_faqs SET hits=hits+1 WHERE id=?1").bind(hit.faq.id).run();

    // 转人工判定
    const humanReason = needHuman(text, { intentHit: intent.score > 0, turns, faqHit: !!hit });

    // 保存用户消息
    await env.DB.prepare("INSERT INTO cs_messages (id,conv_id,role,content,intent,source,faq_id,created) VALUES (?1,?2,'user',?3,?4,'',?5,?6)")
      .bind(uid(), cid, text, intent.intent, hit ? hit.faq.id : "", t).run();

    // 首条用户消息自动生成会话标题（替换默认「新咨询」，便于历史辨认）
    if (turns === 0 && (!conv.title || conv.title === "新咨询")) {
      const autoTitle = text.replace(/\s+/g, " ").slice(0, 24) + (text.length > 24 ? "…" : "");
      await env.DB.prepare("UPDATE cs_conversations SET title=?1 WHERE id=?2").bind(autoTitle, cid).run();
    }

    // 人工已介入的会话不再走 AI，消息直接转交坐席，避免机器人与人工打架
    if (conv.status === "serving" || conv.status === "transferred") {
      await env.DB.prepare("UPDATE cs_conversations SET intent=?1,updated=?2 WHERE id=?3").bind(intent.intent, t + 1, cid).run();
      const mode = conv.status === "serving" ? "人工客服已收到您的消息，会尽快回复～" : "您的问题已转交人工客服，专员接入后会为您处理～";
      return json({ ok: true, reply: mode, intent: intent.intent, intentLabel: intent.label, source: "queue", faqId: "", transferred: true, humanMode: true });
    }

    let reply, source;
    if (humanReason) {
      reply = `已为您转接人工客服（触发原因：${humanReason}）。人工服务时间 9:00-21:00，专员将尽快接入，请稍候～ 您也可以继续留言，我们会一并转交。`;
      source = "transfer";
      await env.DB.prepare("UPDATE cs_conversations SET status='transferred',intent=?1,updated=?2 WHERE id=?3").bind(intent.intent, t + 1, cid).run();
    } else {
      // 组装 LLM 消息（系统提示词支持后台自定义）
      const settings = await loadSettings(env);
      const llmMessages = [{ role: "system", content: systemPrompt(hit ? `Q:${hit.faq.question}\nA:${hit.faq.answer}` : "", settings.llm_system_prompt) }];
      for (const m of hist.results.slice(-10)) llmMessages.push({ role: m.role === "agent" ? "assistant" : "user", content: m.content });
      llmMessages.push({ role: "user", content: text });
      const llmCtx = { intent, faqAnswer: hit ? hit.faq.answer : "", settings };
      reply = await callLLM(llmMessages, env, llmCtx);
      source = llmCtx.llmUsed ? "llm" : (hit ? "faq" : "mock");
      await env.DB.prepare("UPDATE cs_conversations SET intent=?1,updated=?2 WHERE id=?3").bind(intent.intent, t + 1, cid).run();
    }

    await env.DB.prepare("INSERT INTO cs_messages (id,conv_id,role,content,intent,source,faq_id,created) VALUES (?1,?2,'agent',?3,?4,?5,?6,?7)")
      .bind(uid(), cid, reply, intent.intent, source, hit ? hit.faq.id : "", t + 2).run();

    return json({ ok: true, reply, intent: intent.intent, intentLabel: intent.label, source, faqId: hit ? hit.faq.id : "", transferred: !!humanReason });
  }

  /* ---------- 主动转人工 ---------- */
  if (path === "transfer" && method === "POST") {
    const cid = String(body.conv || "");
    const c = await env.DB.prepare("SELECT id FROM cs_conversations WHERE id=?1").bind(cid).first();
    if (!c) return bad("会话不存在", 404);
    await env.DB.prepare("UPDATE cs_conversations SET status='transferred',updated=?1 WHERE id=?2").bind(now(), cid).run();
    await env.DB.prepare("INSERT INTO cs_messages (id,conv_id,role,content,intent,source,created) VALUES (?1,?2,'system','已转接人工客服，请稍候…','','transfer',?3)")
      .bind(uid(), cid, now()).run();
    return json({ ok: true });
  }

  /* ---------- 满意度评价 ---------- */
  if (path === "rating" && method === "POST") {
    const cid = String(body.conv || "");
    const score = Math.max(1, Math.min(5, parseInt(body.score, 10) || 0));
    if (!cid || !score) return bad("缺少 conv 或 score");
    await env.DB.prepare("INSERT INTO cs_ratings (id,conv_id,score,comment,created) VALUES (?1,?2,?3,?4,?5)")
      .bind(uid(), cid, score, String(body.comment || "").slice(0, 500), now()).run();
    return json({ ok: true });
  }

  /* ---------- 管理端：统计 ---------- */
  if (path === "admin/stats" && method === "GET") {
    const conv = await env.DB.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status='transferred' THEN 1 ELSE 0 END) AS transferred, SUM(CASE WHEN status='serving' THEN 1 ELSE 0 END) AS serving, SUM(CASE WHEN status='closed' THEN 1 ELSE 0 END) AS closed FROM cs_conversations").first();
    const msg = await env.DB.prepare("SELECT COUNT(*) AS total FROM cs_messages").first();
    const rating = await env.DB.prepare("SELECT AVG(score) AS avg, COUNT(*) AS cnt FROM cs_ratings").first();
    const dist = await env.DB.prepare("SELECT score, COUNT(*) AS n FROM cs_ratings GROUP BY score ORDER BY score").all();
    const intents = await env.DB.prepare("SELECT intent, COUNT(*) AS n FROM cs_messages WHERE role='user' AND intent!='' GROUP BY intent ORDER BY n DESC").all();
    const daily = await env.DB.prepare("SELECT date(created/1000,'unixepoch','localtime') AS d, COUNT(*) AS n FROM cs_conversations GROUP BY d ORDER BY d DESC LIMIT 14").all();
    const humanMsgs = await env.DB.prepare("SELECT COUNT(*) AS n FROM cs_messages WHERE source='human'").first();
    return json({
      ok: true,
      totalConversations: conv.total || 0,
      transferred: conv.transferred || 0,
      serving: conv.serving || 0,
      closed: conv.closed || 0,
      humanMessages: humanMsgs.n || 0,
      totalMessages: msg.total || 0,
      avgRating: Number((rating.avg || 0).toFixed(2)),
      ratingCount: rating.cnt || 0,
      ratingDist: dist.results,
      intents: intents.results,
      daily: daily.results.reverse(),
    });
  }

  /* ---------- FAQ 列表（公开，供访客端可选展示） ---------- */
  if (path === "faqs" && method === "GET") {
    const r = await env.DB.prepare("SELECT * FROM cs_faqs WHERE enabled=1 ORDER BY hits DESC").all();
    return json({ ok: true, faqs: r.results });
  }

  /* ---------- 管理端：FAQ 新增/编辑/删除 ---------- */
  if (path === "admin/faq" && method === "POST") {
    const q = String(body.question || "").trim(), a = String(body.answer || "").trim();
    if (!q || !a) return bad("问题和答案必填");
    const id = uid();
    await env.DB.prepare("INSERT INTO cs_faqs (id,question,answer,category,keywords,enabled,created) VALUES (?1,?2,?3,?4,?5,1,?6)")
      .bind(id, q, a, String(body.category || "general"), JSON.stringify(Array.isArray(body.keywords) ? body.keywords : []), now()).run();
    return json({ ok: true, id });
  }
  if (path.startsWith("admin/faq/") && method === "PUT") {
    const id = path.split("/")[2];
    const q = String(body.question || "").trim(), a = String(body.answer || "").trim();
    if (!q || !a) return bad("问题和答案必填");
    await env.DB.prepare("UPDATE cs_faqs SET question=?1,answer=?2,category=?3,keywords=?4,enabled=?5 WHERE id=?6")
      .bind(q, a, String(body.category || "general"), JSON.stringify(Array.isArray(body.keywords) ? body.keywords : []), body.enabled === false ? 0 : 1, id).run();
    return json({ ok: true });
  }
  if (path.startsWith("admin/faq/") && method === "DELETE") {
    const id = path.split("/")[2];
    await env.DB.prepare("DELETE FROM cs_faqs WHERE id=?1").bind(id).run();
    return json({ ok: true });
  }

  /* ================= 大模型配置 API ================= */
  // 读取配置（Key 脱敏）+ 供应商预设，供后台渲染
  if (path === "admin/settings" && method === "GET") {
    const s = await loadSettings(env);
    return json({ ok: true, settings: publicSettings(s), presets: LLM_PRESETS, defaultPrompt: DEFAULT_SYSTEM_PROMPT });
  }
  // 保存配置（白名单字段；脱敏占位符不覆盖真实 Key）
  if (path === "admin/settings" && method === "POST") {
    const allowed = ["llm_provider", "llm_base_url", "llm_model", "llm_api_key", "llm_temperature", "llm_system_prompt", "greeting"];
    const t = now();
    const old = await loadSettings(env);
    for (const k of allowed) {
      if (body[k] === undefined) continue;
      let v = String(body[k]).slice(0, 8000);
      // 前端传回的是脱敏串（含 ****）或留空 → 保留原 Key
      if (k === "llm_api_key" && (v.includes("****") || v === "")) {
        if (v === "") continue; // 用户显式清空需传 __CLEAR__
        v = old.llm_api_key || "";
      }
      if (k === "llm_api_key" && v === "__CLEAR__") v = "";
      await env.DB.prepare("INSERT INTO cs_settings (key,value,updated) VALUES (?1,?2,?3) ON CONFLICT(key) DO UPDATE SET value=?2,updated=?3")
        .bind(k, v, t).run();
    }
    return json({ ok: true });
  }
  // 连通性测试：用当前配置真实调用一次，不落库
  if (path === "admin/settings/test" && method === "POST") {
    const s = await loadSettings(env);
    // 允许测试时临时传入新 Key/Base（未保存也能测）
    if (body.llm_provider) s.llm_provider = body.llm_provider;
    if (body.llm_base_url) s.llm_base_url = body.llm_base_url;
    if (body.llm_model) s.llm_model = body.llm_model;
    if (body.llm_temperature !== undefined) s.llm_temperature = body.llm_temperature;
    if (body.llm_api_key && !body.llm_api_key.includes("****")) s.llm_api_key = body.llm_api_key;
    const cfg = llmConfig(s, env);
    const ctx = { settings: s };
    const messages = [
      { role: "system", content: systemPrompt("", s.llm_system_prompt) },
      { role: "user", content: "请只回复：连接成功，我是小蜜。" },
    ];
    const started = Date.now();
    const reply = await callLLM(messages, env, ctx);
    return json({
      ok: true, reply, used: !!ctx.llmUsed, provider: cfg.provider, model: ctx.llmModel,
      error: ctx.llmError || "", elapsed: Date.now() - started,
    });
  }

  return bad("接口不存在: " + path, 404);
}
