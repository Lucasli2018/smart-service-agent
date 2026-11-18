// 智能客服 Agent · FAQ 知识库种子数据（幂等：仅当 cs_faqs 为空时写入）
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

const FAQS = [
  // 退款
  { q: "如何申请退款？", a: "您可以在「我的订单」中找到对应订单，点击「申请退款」并填写原因。审核通过后，款项将在 1-3 个工作日内原路退回。", c: "refund", k: ["退款", "退钱", "申请退款", "退回"] },
  { q: "退款多久能到账？", a: "退款审核通过后一般 1-3 个工作日到账，实际时间取决于您的支付渠道。微信/支付宝通常当天到账，银行卡可能需要 3-5 个工作日。", c: "refund", k: ["退款", "到账", "多久", "几天"] },
  { q: "退款被拒绝了怎么办？", a: "若退款被拒绝，通常是订单已超过退款期限或商品已使用。您可以补充说明情况重新提交，或联系人工客服协助处理。", c: "refund", k: ["退款", "拒绝", "失败", "不同意"] },
  // 订单
  { q: "怎么查询我的订单？", a: "登录后进入「我的订单」页面即可查看全部订单。您也可以在本对话中提供订单号（格式如 DD2024xxxxxxxx），我来帮您查询状态。", c: "order", k: ["订单", "查询", "查订单", "我的订单"] },
  { q: "订单什么时候发货？", a: "现货商品通常在付款后 24 小时内发货，预售商品以商品页标注的发货时间为准。发货后您会收到物流短信通知。", c: "order", k: ["发货", "什么时候", "订单", "发出"] },
  { q: "如何取消订单？", a: "未发货的订单可在「我的订单」中点击「取消订单」。若已发货，请等待收货后申请退货退款，或联系人工客服拦截。", c: "order", k: ["取消", "订单", "不要了", "退单"] },
  { q: "物流信息迟迟不更新？", a: "物流信息一般每天更新 1-2 次。若超过 48 小时未更新，可能是包裹在转运中。您可以提供订单号，我帮您核实。", c: "order", k: ["物流", "快递", "不更新", "没动静"] },
  // 技术支持
  { q: "登录不上/提示密码错误？", a: "请先确认账号密码输入正确，可尝试「忘记密码」重置。若仍无法登录，可能是账号被临时锁定，请联系人工客服解锁。", c: "tech", k: ["登录", "密码", "登不上", "错误"] },
  { q: "App 闪退/卡顿怎么办？", a: "建议先更新到最新版本，并清理缓存后重试。若问题依旧，请提供您的手机型号和系统版本，我会记录并反馈给技术团队。", c: "tech", k: ["闪退", "卡顿", "崩溃", "打不开"] },
  { q: "支付失败是什么原因？", a: "支付失败常见原因：余额不足、银行卡限额、网络超时。建议更换支付方式或稍后重试。多次失败请联系人工客服。", c: "tech", k: ["支付", "失败", "付不了", "付款"] },
  // 通用
  { q: "你们客服的工作时间？", a: "智能客服 7×24 小时在线。人工客服服务时间为每天 9:00-21:00，非工作时间留言我们会在次日回复。", c: "general", k: ["客服", "时间", "上班", "人工"] },
  { q: "如何联系人工客服？", a: "您可以直接说「转人工」，或点击对话窗口的「转人工」按钮，我会立即为您接入人工客服（服务时间 9:00-21:00）。", c: "general", k: ["人工", "转人工", "真人", "客服"] },
];

async function main() {
  if (!TOKEN) { console.error("缺少 CLOUDFLARE_API_TOKEN"); process.exit(1); }
  const base = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DB_ID}/query`;
  const hdr = { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" };

  // 幂等：已有 FAQ 则跳过
  const chk = await fetch(base, { method: "POST", headers: hdr, body: JSON.stringify({ sql: "SELECT COUNT(*) AS n FROM cs_faqs" }) }).then(r => r.json());
  const n = chk.result?.[0]?.results?.[0]?.n ?? 0;
  if (n > 0) { console.log(`FAQ 知识库已有 ${n} 条数据，跳过播种（如需重置请先清空 cs_faqs）。`); return; }

  const now = Date.now();
  const esc = s => String(s).replace(/'/g, "''");
  const stmts = FAQS.map((f, i) =>
    `INSERT INTO cs_faqs (id,question,answer,category,keywords,hits,enabled,created) VALUES (` +
    `'faq_${String(i + 1).padStart(3, "0")}','${esc(f.q)}','${esc(f.a)}','${f.c}','${JSON.stringify(f.k)}',0,1,${now})`
  );
  const res = await fetch(base, { method: "POST", headers: hdr, body: JSON.stringify({ sql: stmts.join(";\n") }) }).then(r => r.json());
  if (!res.success) { console.error("播种失败：", JSON.stringify(res.errors || res, null, 2)); process.exit(1); }
  console.log(`✅ 已写入 ${FAQS.length} 条 FAQ（退款/订单/技术支持/通用）`);
}
main().catch(e => { console.error("异常：", e.message); process.exit(1); });
