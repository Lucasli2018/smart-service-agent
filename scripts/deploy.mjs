// 部署到 Cloudflare Pages（非交互）
import { execFileSync } from "node:child_process";
import { CF_API_TOKEN, CF_ACCOUNT_ID, wranglerCommand } from "./config.mjs";

const env = { ...process.env, CLOUDFLARE_API_TOKEN: CF_API_TOKEN(), CLOUDFLARE_ACCOUNT_ID: CF_ACCOUNT_ID() };
const PROJECT = "smart-service-agent";
console.log("确保 Pages 项目存在 …");
try {
  const c0 = wranglerCommand(["pages", "project", "create", PROJECT, "--production-branch", "master"]);
  execFileSync(c0.cmd, c0.args, { cwd: process.cwd(), env, stdio: "inherit", shell: c0.shell });
} catch (_) { console.log("（项目可能已存在，忽略）"); }
console.log("开始部署到 Cloudflare Pages …");
const c = wranglerCommand(["pages", "deploy", ".", "--project-name", PROJECT, "--commit-dirty=true"]);
try {
  execFileSync(c.cmd, c.args, { cwd: process.cwd(), env, stdio: "inherit", shell: c.shell });
} catch (e) { console.error("部署失败：", e.message); process.exit(1); }
