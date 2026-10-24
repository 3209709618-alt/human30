/* ==========================================================================
 * Human3.0 人生评估 —— AI 深聊代理（阿里云函数计算 FC）
 * --------------------------------------------------------------------------
 * 双模式入口：同一份 index.handler 同时兼容
 *   1) 事件函数 + HTTP 触发器：handler(event) -> {statusCode, headers, body}
 *   2) HTTP 函数：handler(req, resp, context) -> resp.send(...)
 * 这样不管建的是哪种函数类型，都能跑。
 *
 * 环境变量：
 *   BASE_URL / API_KEY / MODEL / ALLOW_ORIGIN / ACCESS_CODES / MAX_TOKENS / RATE_LIMIT
 *   ACCESS_CODES  兑换码白名单，逗号或空格分隔；留空表示不校验（任何人可调用）
 * ========================================================================== */
'use strict';

var crypto = require('crypto');

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
/* 签名码密钥：设置后用 H30-<序号>-<校验位> 形式的码，服务端不存码表，可无限发放 */
var CODE_SECRET = String(process.env.CODE_SECRET || '').trim();
var CODE_ALPHABET = 'ACDEFGHJKMNPQRTUVWXY34679';

var CODE_GATE = ACCESS_CODES.length > 0 || !!CODE_SECRET;

var hits = {};

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
/* 签名码校验位：HMAC(secret, 序号) 取 6 个字符。不落码表，改 secret 即全废 */
function signSeq(seq) {
  var h = crypto.createHmac('sha256', CODE_SECRET).update(String(Number(seq))).digest();
  var out = '';
  for (var i = 0; i < 6; i++) out += CODE_ALPHABET[h[i] % CODE_ALPHABET.length];
  return out;
}

/* 白名单码与签名码都认；两者都没配 → 不校验 */
function codeOk(code) {
  if (!CODE_GATE) return true;
  code = String(code || '').trim();
  if (!code) return false;
  if (ACCESS_CODES.indexOf(code) !== -1) return true;
  if (CODE_SECRET) {
    var m = /^H30-(\d{1,6})-([ACDEFGHJKMNPQRTUVWXY34679]{6})$/.exec(code);
    if (m && signSeq(m[1]) === m[2]) return true;
  }
  return false;
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
  if (Buffer.isBuffer(raw)) raw = raw.toString('utf8');
  if (event.isBase64Encoded && typeof raw === 'string') raw = Buffer.from(raw, 'base64').toString('utf8');
  if (typeof raw !== 'string') return raw;
  return JSON.parse(raw);
}

async function handle(event) {
  event = event || {};
  var origin = header(event, 'origin');
  var method = String(event.httpMethod || event.method || 'POST').toUpperCase();

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
}

/* 双模式入口 */
exports.handler = async function (a, b, c) {
  // HTTP 函数：a = req, b = resp
  if (b && typeof b.send === 'function') {
    var event = {
      httpMethod: a.method || a.httpMethod || 'POST',
      headers: a.headers || {},
      body: a.body,
      isBase64Encoded: false,
      requestContext: a.requestContext || {}
    };
    var result = await handle(event);
    if (typeof b.setStatusCode === 'function') b.setStatusCode(result.statusCode);
    var hs = result.headers || {};
    Object.keys(hs).forEach(function (k) {
      if (typeof b.setHeader === 'function') b.setHeader(k, hs[k]);
    });
    b.send(result.body);
    return;
  }
  // 事件函数：a = event
  return handle(a);
};

exports.main_handler = exports.handler;
