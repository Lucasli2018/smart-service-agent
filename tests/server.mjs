// 本地模拟 Pages Functions + 内存 D1，用于端到端测试
import http from "node:http";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { onRequest } from "../functions/api/[[route]].mjs";

const db = new DatabaseSync(":memory:");
const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
db.exec(schema);
// 种子 FAQ
const now = Date.now();
const FAQS = [
  ["如何申请退款", "在「我的订单」点击申请退款，1-3工作日原路退回", "refund", ["退款", "退回"]],
  ["查询订单物流", "进入我的订单查看实时物流状态", "order", ["订单", "物流", "快递"]],
  ["App 闪退怎么办", "更新版本并清理缓存后重试", "tech", ["闪退", "崩溃", "登录"]],
];
for (let i = 0; i < FAQS.length; i++) {
  db.prepare("INSERT INTO cs_faqs (id,question,answer,category,keywords,hits,enabled,created) VALUES (?,?,?,?,?,0,1,?)")
    .run(`faq_${i}`, FAQS[i][0], FAQS[i][1], FAQS[i][2], JSON.stringify(FAQS[i][3]), now);
}
// 极简 D1 适配：prepare().bind().all()/first()/run()
const DB = {
  prepare(sql) {
    let args = [];
    // 支持 ?1 ?2 占位
    const qsql = sql.replace(/\?(\d+)/g, (_, n) => { args[n - 1] = args[n - 1] ?? undefined; return "?"; });
    const stmt = {
      bind(...b) { args = b; return this; },
      all() { const rows = db.prepare(qsql).all(...args.filter(v => v !== undefined)); return { results: rows }; },
      first() { const rows = db.prepare(qsql).all(...args.filter(v => v !== undefined)); return rows[0] || null; },
      run() { db.prepare(qsql).run(...args.filter(v => v !== undefined)); return { success: true }; },
    };
    return stmt;
  },
};
const PORT = parseInt(process.argv[2], 10) || 8787;
const indexHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname.startsWith("/api/")) {
    const body = await new Promise(r => { let d = ""; req.on("data", c => d += c); req.on("end", () => r(d)); });
    const fakeReq = new Request("http://x" + req.url, {
      method: req.method,
      headers: { "Content-Type": "application/json" },
      body: ["POST", "PUT", "PATCH"].includes(req.method) ? (body || "{}") : undefined,
    });
    try {
      const resp = await onRequest({ request: fakeReq, env: { DB, LLM_PROVIDER: "" } });
      res.writeHead(resp.status, { "Content-Type": "application/json" });
      res.end(await resp.text());
    } catch (e) { res.writeHead(500); res.end(JSON.stringify({ ok: false, error: e.message })); }
  } else {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(indexHtml);
  }
}).listen(PORT, () => console.log("test server on " + PORT));
