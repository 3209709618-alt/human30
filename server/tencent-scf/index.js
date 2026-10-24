/* ==========================================================================
 * Human3.0 人生评估 —— AI 深聊代理（腾讯云云函数 SCF）
 * --------------------------------------------------------------------------
 * 作用：把浏览器的请求转发给模型服务商，Key 只存在云函数环境变量里。
 * 前端永远拿不到 Key。
 *
 * 环境变量：
 *   BASE_URL     模型服务商地址，默认 https://api.deepseek.com/v1
 *   API_KEY      你的 Key（必填，不要写进代码或仓库）
 *   MODEL        模型名，默认 deepseek-chat（当前部署即此值）
 *   ALLOW_ORIGIN 允许的来源，默认 *；建议填 https://3209709618-alt.github.io
 *   ACCESS_CODES 兑换码白名单，逗号或空格分隔；留空表示不校验（任何人可调用）。
 *                设置后，前端必须带 X-Access-Code 请求头（或 body.code）才能调用。
 *   MAX_TOKENS   单次最大输出 token，默认 4096
 *   RATE_LIMIT   每个 IP 每小时最多请求次数，默认 30（尽力而为，见 README）
 *
 * 说明：本函数只做转发，不落盘、不记录对话内容。
 * 实际使用哪个模型，只看环境变量 MODEL / BASE_URL，与下面的兜底值无关。
 * ========================================================================== */
'use strict';

var BASE_URL = String(process.env.BASE_URL || 'https://api.deepseek.com/v1').replace(/\/+$/, '');
var API_KEY = String(process.env.API_KEY || '');
var MODEL = String(process.env.MODEL || 'deepseek-chat');
var ALLOW_ORIGIN = String(process.env.ALLOW_ORIGIN || '*');
var MAX_TOKENS = Math.min(Number(process.env.MAX_TOKENS || 4096) || 4096, 8192);
var RATE_LIMIT = Math.max(1, Number(process.env.RATE_LIMIT || 30) || 30);
var RATE_WINDOW = 60 * 60 * 1000;
var MAX_MESSAGES = 60;
var MAX_ASSISTANT_TURNS = 10;

/* 兑换码白名单：未配置时不启用校验，保持「任何人可调用」的旧行为 */
var ACCESS_CODES = String(process.env.ACCESS_CODES || '')
  .split(/[\s,，、]+/)
  .map(function (s) { return s.trim(); })
  .filter(Boolean);
var CODE_GATE = ACCESS_CODES.length > 0;

var hits = {}; // 尽力而为的内存限流；冷启动会重置，严格限流见 README

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': ALLOW_ORIGIN === '*' ? '*' : (origin || ALLOW_ORIGIN),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Access-Code',
    'Access-Control-Max-Age': '86400'
  };
}

function reply(status, body, origin) {
  var headers = corsHeaders(origin);
  headers['Content-Type'] = 'application/json; charset=utf-8';
  return { statusCode: status, headers: headers, body: JSON.stringify(body), isBase64Encoded: false };
}

function header(event, name) {
  var h = event.headers || {};
  var lower = name.toLowerCase();
  for (var k in h) {
    if (k.toLowerCase() === lower) return h[k];
  }
  return '';
}

/* 兑换码：优先取请求头，其次取 body.code / body.accessCode */
function accessCode(event, body) {
  var c = header(event, 'x-access-code');
  if (!c && body) c = body.code || body.accessCode;
  return String(c == null ? '' : c).trim();
}

/* 校验放在转发模型之前：无效请求不会消耗模型额度 */
function codeOk(code) {
  if (!CODE_GATE) return true;
  return ACCESS_CODES.indexOf(code) !== -1;
}

function clientIp(event) {
  var rc = event.requestContext || {};
  return rc.sourceIp || header(event, 'x-forwarded-for').split(',')[0].trim() || 'unknown';
}

function rateOk(ip) {
  var now = Date.now();
  var rec = hits[ip];
  if (!rec || now > rec.reset) {
    hits[ip] = { count: 1, reset: now + RATE_WINDOW };
    return true;
  }
  rec.count += 1;
  return rec.count <= RATE_LIMIT;
}

function parseBody(event) {
  var raw = event.body;
  if (raw === undefined || raw === null) return {};
  if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
  if (typeof raw !== 'string') return raw;
  return JSON.parse(raw);
}

exports.main_handler = async function (event) {
  event = event || {};
  var origin = header(event, 'origin');
  var method = String(event.httpMethod || (event.requestContext && event.requestContext.httpMethod) || 'POST').toUpperCase();

  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(origin), body: '', isBase64Encoded: false };
  }
  if (method === 'GET') {
    return reply(200, { ok: true, configured: !!API_KEY, model: MODEL, requireCode: CODE_GATE }, origin);
  }
  if (method !== 'POST') {
    return reply(405, { error: { message: '只支持 POST' } }, origin);
  }
  if (!API_KEY) {
    return reply(500, { error: { message: '服务端未配置 API_KEY' } }, origin);
  }

  var ip = clientIp(event);
  if (!rateOk(ip)) {
    return reply(429, { error: { message: '请求过于频繁，请稍后再试' } }, origin);
  }

  var body;
  try {
    body = parseBody(event);
  } catch (e) {
    return reply(400, { error: { message: '请求体不是合法 JSON' } }, origin);
  }

  var messages = body.messages;
  if (!Array.isArray(messages) || !messages.length) {
    return reply(400, { error: { message: '缺少 messages' } }, origin);
  }
  if (messages.length > MAX_MESSAGES) {
    return reply(400, { error: { message: '对话过长' } }, origin);
  }
  var turns = messages.filter(function (m) { return m && m.role === 'assistant'; }).length;
  if (turns > MAX_ASSISTANT_TURNS) {
    return reply(400, { error: { message: '追问轮次超过上限' } }, origin);
  }
  if (!codeOk(accessCode(event, body))) {
    return reply(403, {
      error: { message: '兑换码无效或未填写，请检查后重试', code: 'ACCESS_CODE' }
    }, origin);
  }

  var payload = {
    model: MODEL,
    messages: messages.map(function (m) {
      return { role: m.role, content: String(m.content == null ? '' : m.content) };
    }),
    temperature: Math.min(Math.max(Number(body.temperature == null ? 0.7 : body.temperature) || 0, 0), 1.2),
    max_tokens: Math.min(Number(body.max_tokens || MAX_TOKENS) || MAX_TOKENS, MAX_TOKENS)
  };

  try {
    var r = await fetch(BASE_URL + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + API_KEY },
      body: JSON.stringify(payload)
    });
    var text = await r.text();
    var j = null;
    try { j = JSON.parse(text); } catch (e) { /* 上游返回非 JSON */ }

    if (!r.ok) {
      var msg = (j && j.error && (j.error.message || j.error)) || ('上游返回 ' + r.status);
      return reply(r.status, { error: { message: String(msg) } }, origin);
    }
    var c = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    if (!c) {
      return reply(502, { error: { message: '上游返回了空内容' } }, origin);
    }
    return reply(200, { content: c }, origin);
  } catch (e) {
    return reply(502, { error: { message: '上游请求失败：' + (e && e.message ? e.message : '未知错误') } }, origin);
  }
};
