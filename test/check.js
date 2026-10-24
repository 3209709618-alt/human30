/* 交付合规检查：node test/check.js
 * 检查可部署文件中是否出现密钥、网络请求、存储、支付等不应存在的内容。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FILES = ['index.html', 'assets/config.js', 'assets/data.js', 'assets/logic.js', 'assets/app.js',
  'assets/style.css', 'assets/ai-prompt.js', 'assets/ai-chat.js'];

// allow：v4 起，AI 深聊版经 docs/adr/0002（用户自带 Key、浏览器直连）与
// docs/adr/0003（访谈状态只存本人浏览器）授权，请求与本地存储只允许出现在
// ai-chat.js 这一处；其余文件保持「不发请求、不存储」的原线不动。
const RULES = [
  { name: '疑似 API Key', re: /\b(sk-[A-Za-z0-9_-]{10,}|api[_-]?key\s*[:=]\s*['"][^'"]{6,})/i },
  { name: '密钥字段', re: /\b(client[_-]?secret|access[_-]?token|private[_-]?key|bearer\s+[A-Za-z0-9._-]{10,})\b/i },
  { name: '网络请求', re: /\b(fetch\s*\(|XMLHttpRequest|sendBeacon|new\s+WebSocket|axios|\.ajax\s*\()/, allow: ['assets/ai-chat.js'] },
  { name: '本地存储', re: /\b(localStorage|sessionStorage|indexedDB|document\.cookie)\b/ },
  { name: '支付相关', re: /\b(stripe|alipay|paypal|checkout|wechatpay|wxpay|payment)[A-Za-z_]*\b/i },
  { name: '外链脚本/样式', re: /<(script|link)[^>]+(src|href)\s*=\s*["']https?:\/\//i },
  { name: '内联事件处理器', re: /\son(click|load|error|submit)\s*=/i }
];

let problems = 0;
let checks = 0;

console.log('检查可部署文件：' + FILES.join(', ') + '\n');

FILES.forEach(f => {
  const p = path.join(ROOT, f);
  const text = fs.readFileSync(p, 'utf8');
  RULES.forEach(rule => {
    checks++;
    const m = text.match(rule.re);
    if (m && !(rule.allow && rule.allow.includes(f))) {
      problems++;
      console.log('  ✗ ' + f + ' → ' + rule.name + '：' + JSON.stringify(m[0]));
    }
  });
});

// 外部链接白名单检查
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const urls = [...html.matchAll(/https?:\/\/[^\s"'<>)]+/g)].map(m => m[0]);
const allowed = [
  'http://www.w3.org/2000/svg',
  'https://letters.thedankoe.com/p/a-complete-knowledge-base-of-human',
  'https://letters.thedankoe.com/p/prompt-human-30-self-discovery-and'
];
urls.forEach(u => {
  checks++;
  if (!allowed.some(a => u.startsWith(a))) {
    problems++;
    console.log('  ✗ index.html 出现未预期外链：' + u);
  }
});

// 必需内容检查
const must = [
  ['理论来源链接 1', 'a-complete-knowledge-base-of-human'],
  ['理论来源链接 2', 'prompt-human-30-self-discovery-and'],
  ['Dan Koe 署名', 'Dan Koe'],
  ['非诊断声明', '不是诊断'],
  ['三类诊断声明', '心理、医疗或职业诊断'],
  ['非验证测评声明', '不是经过验证的客观测评'],
  ['四维：心智', '心智'],
  ['四维：身体', '身体'],
  ['四维：关系与意义', '关系与意义'],
  ['四维：职业与贡献', '职业与贡献'],
  ['初步画像入口', 'prelimDeep'],
  ['AI 报告声明', '本报告由 AI 根据你的 32 题答案与深聊生成'],
  ['深聊数据说明', '本站不额外留存']
];
must.forEach(([label, needle]) => {
  checks++;
  if (!html.includes(needle)) {
    problems++;
    console.log('  ✗ index.html 缺少：' + label);
  }
});

// 规则引擎与交互层的必备措辞
const logic = fs.readFileSync(path.join(ROOT, 'assets/logic.js'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'assets/app.js'), 'utf8');
const mustInLogic = [
  ['理论来源', 'Dan Koe'],
  ['跨维度议题', 'LINKAGE'],
  ['跨维度建议', 'LEVERAGE'],
  ['无分数声明', '不输出数字分数']
];
mustInLogic.forEach(([label, needle]) => {
  checks++;
  if (!logic.includes(needle)) {
    problems++;
    console.log('  ✗ logic.js 缺少：' + label);
  }
});
const mustInApp = [
  ['笔记不参与判断说明', '不参与阶段判断'],
  ['笔记原文展示', 'note-report'],
  ['依据展开', 'basis'],
  ['自动跳题', 'advanceTimer'],
  ['单一版本入口', 'canonicalizeUrl']
];
mustInApp.forEach(([label, needle]) => {
  checks++;
  if (!app.includes(needle)) {
    problems++;
    console.log('  ✗ app.js 缺少：' + label);
  }
});

// AI 访谈官提示词的六处加固（v4）
const prompt = fs.readFileSync(path.join(ROOT, 'assets/ai-prompt.js'), 'utf8');
const mustInPrompt = [
  ['时间盒', '4–8'],
  ['角色锁定（防注入）', '角色锁定'],
  ['禁止提前输出报告', '禁止提前输出报告'],
  ['未知汇总规则', '无证据'],
  ['结构化契约', 'json 代码块'],
  ['结束语', '访谈完成'],
  ['词汇表注入', 'METATYPES'],
  ['四象限覆盖', '关系与意义']
];
mustInPrompt.forEach(([label, needle]) => {
  checks++;
  if (!prompt.includes(needle)) {
    problems++;
    console.log('  ✗ ai-prompt.js 缺少：' + label);
  }
});

// AI 深聊版控制器
const chat = fs.readFileSync(path.join(ROOT, 'assets/ai-chat.js'), 'utf8');
const mustInChat = [
  ['代理调用', 'AI_PROXY_URL'],
  ['限流提示', '429'],
  ['Key 失效提示', '401'],
  ['报告解析', 'parseReport'],
  ['计数器开关', 'GOATCOUNTER_URL']
];
mustInChat.forEach(([label, needle]) => {
  checks++;
  if (!chat.includes(needle)) {
    problems++;
    console.log('  ✗ ai-chat.js 缺少：' + label);
  }
});

console.log('\n共 ' + checks + ' 项检查，' + (problems ? problems + ' 项异常' : '全部通过'));
process.exit(problems ? 1 : 0);
