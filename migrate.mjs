// 智能客服 Agent · 存量库幂等迁移（给已存在的表补新增列）
// schema.sql 的 CREATE TABLE IF NOT EXISTS 对存量表无效，新增列需在此补 ALTER。
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

const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DB_ID}/query`;
const headers = { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" };
async function query(sql) {
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify({ sql }) });
  const j = await res.json();
  if (!j.success) throw new Error(JSON.stringify(j.errors || j));
  return j.result?.[0]?.results || [];
}

// [表名, 列名, 列定义]
const MIGRATIONS = [
  ["cs_conversations", "agent", "TEXT DEFAULT ''"],
];

for (const [table, column, def] of MIGRATIONS) {
  const cols = await query(`PRAGMA table_info(${table})`);
  const names = cols.map(c => c.name);
  if (names.includes(column)) {
    console.log(`✓ ${table}.${column} 已存在，跳过`);
  } else {
    await query(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
    console.log(`↑ ${table}.${column} 迁移完成`);
  }
}
console.log("✅ 存量库迁移检查完成");
