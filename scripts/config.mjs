// 部署脚本统一配置入口：环境变量优先，其次项目根 .env（gitignore）
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  for (const raw of readFileSync(join(__dirname, "..", ".env"), "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    if (process.env[m[1]] === undefined || process.env[m[1]] === "") {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  }
} catch (_) {}
export function env(key, def = "") { const v = process.env[key]; return v === undefined || v === "" ? def : v; }
export function requireEnv(key) { const v = env(key); if (!v) { console.error("缺少配置 " + key + "，请在项目根 .env 中配置"); process.exit(1); } return v; }
export const CF_API_TOKEN = () => requireEnv("CLOUDFLARE_API_TOKEN");
export const CF_ACCOUNT_ID = () => env("CLOUDFLARE_ACCOUNT_ID", "332b848d9f5d9ec2808bdb855763eb8e");
export function wranglerCommand(args) {
  const bin = env("WRANGLER_BIN");
  if (bin && bin.endsWith(".js")) return { cmd: process.execPath, args: [bin, ...args], shell: false };
  if (bin) return { cmd: bin, args, shell: false };
  return { cmd: "wrangler", args, shell: true };
}
