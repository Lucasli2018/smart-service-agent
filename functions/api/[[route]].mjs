/* 智能客服 Agent · API 路由（Cloudflare Pages Functions，D1 绑定名 DB）
   访客端：新会话 / 发消息（多轮）/ 历史 / 评价 / 转人工
   管理端：对话记录 / 满意度统计 / FAQ 增删改 */
import {
  json, bad, now, uid, detectIntent, searchFaq, needHuman, callLLM, systemPrompt
} from "../_lib/core.mjs";

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  let path = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  const method = request.method;
  if (!env.DB) return bad("D1 未绑定（需在 Pages 配置名为 DB 的 D1 绑定）", 500);
  if (path === "ping") return json({ ok: true, ts: now(), llm: env.LLM_PROVIDER || "mock" });

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
      .bind(uid(), id, "您好，我是智能客服小蜜🐱 关于退款、订单查询、技术支持都可以问我～ 也可以直接说「转人工」哦。", t).run();
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

    let reply, source;
    if (humanReason) {
      reply = `已为您转接人工客服（触发原因：${humanReason}）。人工服务时间 9:00-21:00，专员将尽快接入，请稍候～ 您也可以继续留言，我们会一并转交。`;
      source = "transfer";
      await env.DB.prepare("UPDATE cs_conversations SET status='transferred',intent=?1,updated=?2 WHERE id=?3").bind(intent.intent, t + 1, cid).run();
    } else {
      // 组装 LLM 消息
      const llmMessages = [{ role: "system", content: systemPrompt(hit ? `Q:${hit.faq.question}\nA:${hit.faq.answer}` : "") }];
      for (const m of hist.results.slice(-10)) llmMessages.push({ role: m.role === "agent" ? "assistant" : "user", content: m.content });
      llmMessages.push({ role: "user", content: text });
      reply = await callLLM(llmMessages, env, { intent, faqAnswer: hit ? hit.faq.answer : "" });
      source = hit ? "faq" : (env.LLM_PROVIDER ? "llm" : "mock");
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
    const conv = await env.DB.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status='transferred' THEN 1 ELSE 0 END) AS transferred FROM cs_conversations").first();
    const msg = await env.DB.prepare("SELECT COUNT(*) AS total FROM cs_messages").first();
    const rating = await env.DB.prepare("SELECT AVG(score) AS avg, COUNT(*) AS cnt FROM cs_ratings").first();
    const dist = await env.DB.prepare("SELECT score, COUNT(*) AS n FROM cs_ratings GROUP BY score ORDER BY score").all();
    const intents = await env.DB.prepare("SELECT intent, COUNT(*) AS n FROM cs_messages WHERE role='user' AND intent!='' GROUP BY intent ORDER BY n DESC").all();
    const daily = await env.DB.prepare("SELECT date(created/1000,'unixepoch','localtime') AS d, COUNT(*) AS n FROM cs_conversations GROUP BY d ORDER BY d DESC LIMIT 14").all();
    return json({
      ok: true,
      totalConversations: conv.total || 0,
      transferred: conv.transferred || 0,
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

  return bad("接口不存在: " + path, 404);
}
