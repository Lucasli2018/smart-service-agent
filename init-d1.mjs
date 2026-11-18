// 智能客服 Agent · 在共享 dev 库创建 cs_ 表结构（幂等 IF NOT EXISTS）
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const DB_ID = "3c83aee3-4645-450b-b50b-6488750deeb4";
const ACCOUNT_ID = process.env.CF_ACCOUNT_ID || "332b848d9f5d9ec2808bdb855763eb8e";
let TOKEN = process.env.CF_TOKEN || process.env.CLOUDFLARE_API_TOKEN || "";
if (!TOKEN) {
  try {
    TOKEN = execFileSync("powershell.exe", ["-NoProfile", "-Command", "[Environment]::GetEnvironmentVariable('CLOUDFLARE_API_TOKEN','Machine')"], { encoding: "utf8" }).trim();
  } catch (e) { TOKEN = ""; }
}
if (!TOKEN) { console.error("缺少 CLOUDFLARE_API_TOKEN"); process.exit(1); }

const sql = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DB_ID}/query`;
const res = await fetch(url, {
  method: "POST",
  headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
  body: JSON.stringify({ sql }),
});
const j = await res.json();
if (!j.success) { console.error("建表失败：", JSON.stringify(j.errors || j, null, 2)); process.exit(1); }
console.log("✅ cs_ 表结构已应用到 dev 库（conversations / messages / faqs / ratings / settings）");
