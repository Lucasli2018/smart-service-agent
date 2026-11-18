// 探针专用服务器：serve 注入探针的 HTML + 复用 API 路由
import http from "node:http";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { onRequest } from "../functions/api/[[route]].mjs";
const db = new DatabaseSync(":memory:");
db.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
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
const DB = { prepare(sql) { const args = []; const qsql = sql.replace(/\?(\d+)/g, (_, n) => { args[n - 1] = args[n - 1] ?? undefined; return "?"; }); return {
  bind(...b) { args.splice(0, args.length, ...b); return this; },
  all() { return { results: db.prepare(qsql).all(...args.filter(v => v !== undefined)) }; },
  first() { return db.prepare(qsql).all(...args.filter(v => v !== undefined))[0] || null; },
  run() { db.prepare(qsql).run(...args.filter(v => v !== undefined)); return { success: true }; },
}; } };
const html = readFileSync(new URL("../_index_probe.html", import.meta.url), "utf8");
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname.startsWith("/api/")) {
    const body = await new Promise(r => { let d = ""; req.on("data", c => d += c); req.on("end", () => r(d)); });
    const fakeReq = new Request("http://x" + req.url, { method: req.method, headers: { "Content-Type": "application/json" }, body: ["POST", "PUT", "PATCH"].includes(req.method) ? (body || "{}") : undefined });
    try { const resp = await onRequest({ request: fakeReq, env: { DB, LLM_PROVIDER: "" } }); res.writeHead(resp.status, { "Content-Type": "application/json" }); res.end(await resp.text()); }
    catch (e) { res.writeHead(500); res.end(JSON.stringify({ ok: false, error: e.message })); }
  } else if (url.pathname === "/icon.svg") { res.writeHead(200, { "Content-Type": "image/svg+xml" }); res.end(readFileSync(new URL("../icon.svg", import.meta.url), "utf8")); }
  else if (url.pathname === "/manifest.webmanifest") { res.writeHead(200, { "Content-Type": "application/manifest+json" }); res.end(readFileSync(new URL("../manifest.webmanifest", import.meta.url), "utf8")); }
  else if (url.pathname === "/sw.js") { res.writeHead(200, { "Content-Type": "application/javascript" }); res.end(readFileSync(new URL("../sw.js", import.meta.url), "utf8")); }
  else if (url.pathname === "/favicon.ico") { res.writeHead(200, { "Content-Type": "image/x-icon" }); res.end(readFileSync(new URL("../favicon.ico", import.meta.url))); }
  else if (url.pathname === "/apple-touch-icon.png") { res.writeHead(200, { "Content-Type": "image/png" }); res.end(readFileSync(new URL("../apple-touch-icon.png", import.meta.url))); }
  else if (url.pathname === "/icon-192.png") { res.writeHead(200, { "Content-Type": "image/png" }); res.end(readFileSync(new URL("../icon-192.png", import.meta.url))); }
  else if (url.pathname === "/icon-512.png") { res.writeHead(200, { "Content-Type": "image/png" }); res.end(readFileSync(new URL("../icon-512.png", import.meta.url))); }
  else { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(html); }
}).listen(8791, () => console.log("probe server on 8791"));
