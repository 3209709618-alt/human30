/* ==========================================================================
 * Human3.0 人生评估 —— AI 深聊代理（阿里云函数计算 FC）
 * --------------------------------------------------------------------------
 * 与腾讯云版本逻辑相同：浏览器只调这个函数，Key 只存在函数环境变量里。
 * 使用「事件函数 + HTTP 触发器」：入口为 index.handler。
 *
 * 环境变量：
 *   BASE_URL     模型服务商地址，默认 https://api.siliconflow.cn/v1
 *   API_KEY      你的 Key（必填，不要写进代码或仓库）
 *   MODEL        模型名，默认 zai-org/GLM-5.3-Flash
 *   ALLOW_ORIGIN 允许的来源，建议 https://3209709618-alt.github.io
 *   MAX_TOKENS   单次最大输出 token，默认 4096
 *   RATE_LIMIT   每个 IP 每小时最多请求次数，默认 30（尽力而为）
 * ========================================================================== */
'use strict';

var BASE_URL = String(process.env.BASE_URL || 'https://api.siliconflow.cn/v1').replace(/\/+$/, '');
var API_KEY = String(process.env.API_KEY || '');
var MODEL = String(process.env.MODEL || 'zai-org/GLM-5.3-Flash');
var ALLOW_ORIGIN = String(process.env.ALLOW_ORIGIN || '*');
var MAX_TOKENS = Math.min(Number(process.env.MAX_TOKENS || 4096) || 4096, 8192);
var RATE_LIMIT = Math.max(1, Number(process.env.RATE_LIMIT || 30) || 30);
var RATE_WINDOW = 60 * 60 * 1000;
var MAX_MESSAGES = 60;
var MAX_ASSISTANT_TURNS = 10;

var hits = {};

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': ALLOW_ORIGIN === '*' ? '*' : (origin || ALLOW_ORIGIN),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
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

exports.handler = async function (event) {
  event = event || {};
  var origin = header(event, 'origin');
  var method = String(event.httpMethod || 'POST').toUpperCase();

  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(origin), body: '', isBase64Encoded: false };
  }
  if (method === 'GET') {
    return reply(200, { ok: true, configured: !!API_KEY, model: MODEL }, origin);
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
