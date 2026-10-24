/* 规则引擎自测：node test/run-tests.js */
'use strict';

require('../assets/data.js');
require('../assets/logic.js');
require('../assets/ai-prompt.js');

const D = globalThis.H30Data;
const L = globalThis.H30Logic;
const AI = globalThis.H30AI;

let pass = 0;
let fail = 0;
const failures = [];

function ok(cond, msg) {
  if (cond) { pass++; }
  else { fail++; failures.push(msg); console.log('  ✗ ' + msg); }
}

function eq(a, b, msg) {
  ok(JSON.stringify(a) === JSON.stringify(b), msg + '（实际：' + JSON.stringify(a) + '）');
}

/* ---------------------------------------------------------- 1. 题目完整性 */
console.log('\n[1] 题目与选项完整性');

const ids = new Set();
D.QUESTIONS.forEach(q => {
  ok(!ids.has(q.id), '题目 id 重复：' + q.id);
  ids.add(q.id);
  ok(D.DIM_ORDER.includes(q.dim), q.id + ' 维度非法');
  ok(q.kind === 'level' || q.kind === 'phase', q.id + ' kind 非法');
  ok(Array.isArray(q.tiers) && q.tiers.length > 0, q.id + ' 缺少 tiers');
  ok(q.options.length === 3, q.id + ' 选项数量不是 3');
  ok(typeof q.text === 'string' && q.text.length > 8, q.id + ' 题干过短');

  const vals = q.options.map(o => String(o.v)).sort();
  if (q.kind === 'level') eq(vals, ['1', '2', '3'], q.id + ' level 选项取值应为 1/2/3 各一次');
  else eq(vals, ['d', 'f', 'u'], q.id + ' phase 选项取值应为 d/u/f 各一次');

  q.options.forEach((o, i) => {
    ok(typeof o.t === 'string' && o.t.length > 6, q.id + ' 第 ' + (i + 1) + ' 个选项文本过短');
  });
});

/* ---------------------------------------------------------- 2. 单一版本 */
console.log('\n[2] 只保留完整版');

eq(D.PLAN_ORDER, ['complete'], '只剩完整版一个版本');
eq(Object.keys(D.PLANS), ['complete'], 'PLANS 只有 complete');
eq(D.PLANS.complete.allowsDimensionChoice, false, '完整版不再提供维度选择');

const qs = L.questionsFor('complete', D.DIM_ORDER);
eq(qs.length, 32, '完整版题量 32');
D.DIM_ORDER.forEach(dim => {
  const list = qs.filter(q => q.dim === dim);
  eq(list.length, 8, dim + ' 题量 8');
  ok(list.some(q => q.kind === 'level'), dim + ' 缺少阶段题');
  ok(list.some(q => q.kind === 'phase'), dim + ' 缺少转变题');
});

/* ---------------------------------------------------------- 3. 阶段判定 */
console.log('\n[3] 阶段、转变与建议');

function answerDim(dim, level, phase) {
  const out = {};
  L.questionsFor('complete', [dim]).forEach(q => {
    out[q.id] = q.kind === 'level' ? level : phase;
  });
  return out;
}

D.DIM_ORDER.forEach(dim => {
  [1, 2, 3].forEach(level => {
    ['d', 'u', 'f'].forEach(phase => {
      const a = answerDim(dim, level, phase);
      const pool = L.questionsFor('complete', [dim]);
      const row = L.analyzeDimension(dim, a, pool);
      ok(row && row.level === level, dim + ' 阶段判定错误（期望 ' + level + '）');
      ok(row && row.phase === phase, dim + ' 转变判定错误（期望 ' + phase + '）');
      ok(row && row.strengths.length === 2, dim + ' 优势条目数应为 2');
      ok(row && row.watch.length === 2, dim + ' 关注条目数应为 2');
      ok(row && typeof row.advice === 'string' && row.advice.length > 30, dim + ' 缺少具体建议');
      ok(row && row.advice.includes(row.advicePhase), dim + ' 建议应包含阶段提示');
      ok(row && row.basis && row.basis.answer.length > 6, dim + ' 缺少判断依据');
      ok(row && row.questionCount === 8, dim + ' 题量统计错误');
    });
  });
});

{
  const row = L.analyzeDimension('body', answerDim('body', 2, 'u'), L.questionsFor('complete', ['body']));
  ok(/(周|天|次|分钟|个月|小时)/.test(row.advice), '建议应包含可执行的时间/数量');
}

/* ---------------------------------------------------------- 4. 报告规则 */
console.log('\n[4] 报告生成规则');

function buildFull(levels, phases, note) {
  const answers = {};
  D.DIM_ORDER.forEach((dim, i) => {
    Object.assign(answers, answerDim(dim, levels[i], phases[i]));
  });
  return L.buildReport({ answers, note });
}

{
  const r = buildFull([2, 2, 2, 2], ['u', 'u', 'u', 'u']);
  ok(r.allDims === true, '四维齐全时 allDims 为 true');
  ok(r.metatype !== null, '生成元类型');
  ok(r.archetype !== null, '生成生活方式原型');
  ok(r.linkage !== null, '生成跨维度分析');
  ok(r.crossAdvice !== null, '生成跨维度建议');
  eq(r.rows.length, 4, '报告包含四个维度');
  ok(!('missingNote' in r), '不再有部分维度的缺失提示字段');
  eq(r.metatype.name, '均衡探索型', '四个 2.0 判定为均衡探索型');
  eq(r.linkage.key, 'balanced', '四个 2.0 走均衡联动');
  ok(r.crossAdvice.priority === null, '均衡型不指定优先维度');
}

const metaCases = [
  { levels: [1, 1, 1, 1], expect: '起步整合型', label: '全部 1.0' },
  { levels: [3, 3, 3, 3], expect: '整合推进型', label: '全部 3.0' },
  { levels: [3, 2, 2, 2], expect: '思考先行型', label: '心智领先' },
  { levels: [2, 3, 2, 2], expect: '行动先行型', label: '身体领先' },
  { levels: [2, 2, 3, 2], expect: '连接先行型', label: '关系领先' },
  { levels: [2, 2, 2, 3], expect: '建造先行型', label: '职业领先' },
  { levels: [3, 1, 2, 2], expect: '错位成长型', label: '跨度 ≥ 2' }
];
metaCases.forEach(c => {
  const r = buildFull(c.levels, ['u', 'u', 'u', 'u']);
  eq(r.metatype.name, c.expect, '元类型规则：' + c.label);
});

{
  const r = buildFull([3, 1, 2, 2], ['f', 'd', 'u', 'u']);
  eq(r.archetype.name, '清醒的设计者', '原型规则：心智最高 + 发现期');
  ok(r.archetype.basis.includes('心智'), '原型说明推导依据');
  eq(r.linkage.key, 'mind>body', '联动取最高 → 最低');
  ok(r.linkage.question.includes('？'), '联动给出一个可带走的问题');
  ok(r.crossAdvice.priority === '身体', '跨维度建议指向最落后维度');
  ok(r.crossAdvice.text.includes('身体') && r.crossAdvice.text.includes('心智'), '跨维度建议说明两者关系');
}

/* ---------------------------------------------------------- 5. 文本输出 */
console.log('\n[5] 复制报告文本');

{
  const r = buildFull([2, 3, 2, 3], ['u', 'f', 'u', 'f']);
  const text = L.toText(r);

  ok(text.includes('Human3.0人生评估 · 体验版'), '包含标题与版本');
  ok(text.includes('【说明】'), '包含报告说明');
  ok(text.includes('不是心理、医疗或职业诊断'), '说明覆盖三类诊断');
  ok(text.includes('不是经过验证的客观测评'), '说明声明非验证测评');
  ok(text.includes('【元类型】'), '包含元类型');
  ok(text.includes('【生活方式原型】'), '包含原型');
  ok(text.includes('【跨维度 · 核心议题】'), '包含跨维度议题');
  ok(text.includes('【跨维度建议】'), '包含跨维度建议');
  ok(text.includes('【心智】') && text.includes('【身体】') && text.includes('【关系与意义】') && text.includes('【职业与贡献】'), '包含四个维度');
  ok(text.includes('给你的建议：'), '包含建议');
  ok(text.includes('判断依据：'), '包含判断依据');
  ok(text.includes('理论来源：Dan Koe'), '标注理论来源');
  ok(!/undefined|null|NaN/.test(text), '无 undefined / null / NaN');
}

/* ---------------------------------------------------------- 6. 笔记 */
console.log('\n[6] 可选笔记');

{
  const withNote = buildFull([2, 2, 2, 2], ['u', 'u', 'u', 'u'], '  最近刚换工作，同时在照顾家人。  ');
  eq(withNote.note, '最近刚换工作，同时在照顾家人。', '笔记去除首尾空格');
  ok(L.toText(withNote).includes('【你补充的背景】'), '有笔记时包含笔记区块');
  ok(L.toText(withNote).includes('未参与任何判断'), '笔记标注不参与判断');

  const without = buildFull([2, 2, 2, 2], ['u', 'u', 'u', 'u']);
  eq(without.note, '', '未填写时为空');
  ok(!L.toText(without).includes('【你补充的背景】'), '未填写时无笔记区块');

  const a = buildFull([1, 3, 2, 2], ['d', 'f', 'u', 'd']).rows.map(x => x.level + x.phase).join(',');
  const b = buildFull([1, 3, 2, 2], ['d', 'f', 'u', 'd'], '这是一段完全无关的补充说明').rows.map(x => x.level + x.phase).join(',');
  eq(a, b, '笔记不得影响阶段/类型判断');
}

/* ---------------------------------------------------------- 7. 完整性校验 */
console.log('\n[7] 必答校验');

{
  const partial = { [qs[0].id]: 1 };
  eq(L.missingQuestions(partial, qs).length, qs.length - 1, '未答题数量统计');
  eq(L.missingQuestions({}, qs).length, qs.length, '空回答时全部为未答');
}

/* ---------------------------------------------------------- 8. 时间格式 */
console.log('\n[8] 文本工具');

{
  eq(L.formatTime(new Date(2026, 9, 22, 9, 5)), '2026-10-22 09:05', '时间格式化补零');
}


/* ------------------------------------------- AI 访谈官提示词与报告解析（v4） */
(function aiPromptTests() {
  const p = AI.buildSystemPrompt();

  ok(p.includes('4–8'), '提示词含时间盒（4–8 问）');
  ok(p.includes('角色锁定'), '提示词含角色锁定（防注入）');
  ok(p.includes('无证据'), '提示词含「未知=无证据」汇总规则');
  ok(p.includes('\`\`\`json'), '提示词含结构化契约标记');
  ok(p.includes('访谈完成，我现在整理报告'), '提示词含结束语');
  ok(p.includes('错位成长型'), '提示词注入 canonical 元类型词表');
  ok(p.includes('反复回放的观察者'), '提示词注入 canonical 原型词表');
  ok(p.length > 3000 && p.length < 8000, '提示词长度受控（' + p.length + ' 字）');
  ok(AI.OPENING.indexOf('32 道题') > 0, '开场白固定且完整');

  // 解析：拒收坏输入
  ok(!AI.parseReport('这是一段普通回复').ok, '无 json 的回复被拒绝');
  ok(!AI.parseReport('\`\`\`json\n{坏了\n\`\`\`').ok, '坏 json 被拒绝');
  const partial = AI.parseReport('\`\`\`json\n' + JSON.stringify({ metatype: {} }) + '\n\`\`\`');
  ok(!partial.ok, '缺字段的报告被拒绝');

  // 解析：接受并规范化好输入
  const raw = {
    metatype: { name: '错位成长型' }, archetype: { name: '清醒的设计者' },
    quadrants: [{ id: 'vocation' }, { id: 'mind' }, { id: 'body' }, { id: 'relationships' }],
    crossDynamics: {}, coreProblem: {}, roadmap: {}, accelerator: {}, warnings: {}, finalFeedback: '反馈'
  };
  const r = AI.parseReport('访谈完成，我现在整理报告。\n\`\`\`json\n' + JSON.stringify(raw) + '\n\`\`\`');
  ok(r.ok, '完整报告被接受');
  ok(r.data.quadrants.map(q => q.id).join(',') === 'mind,body,relationships,vocation', '四象限被排序规范化');
  ok(r.data.quadrants.every(q => q.level === 1 && q.phase === 'uncertainty'), '缺失字段有默认值');
  ok(Array.isArray(r.data.quadrants[0].strengths), '数组成员被补齐');
})();

/* --------------------------------- [10] 判定确定化与「均衡」误判修复 */
console.log('\n[9] 判定确定化与均衡误判修复');

function answersWithLevel(lv) {
  const a = {};
  D.QUESTIONS.forEach(q => {
    if (q.kind === 'level') {
      a[q.id] = (q.options.filter(o => Number(o.v) === lv)[0] || q.options[0]).v;
    } else {
      a[q.id] = q.options[0].v;
    }
  });
  return a;
}
function answersByDim(map) {
  const a = {};
  D.QUESTIONS.forEach(q => {
    if (q.kind === 'level') {
      a[q.id] = (q.options.filter(o => Number(o.v) === map[q.dim])[0] || q.options[0]).v;
    } else {
      a[q.id] = q.options[0].v;
    }
  });
  return a;
}

/* P0-2：四维全为最低档，不能再被告知「均衡」 */
const low = L.buildReport({ answers: answersWithLevel(1) });
eq(low.shape, 'starting', '四维全为 1 → shape = starting');
eq(low.dominant, 'none', '四维全为 1 → dominant = none');
eq(low.accelerator, 'hold', '四维全为 1 → 加速器判定 = hold');
eq(low.linkage.key, 'starting', '四维全为 1 → 联动议题用 starting');
ok(!/没有明显的短板/.test(JSON.stringify(low)), '全最低档不再出现「没有明显的短板」');
ok(low.overview.indexOf('这不是均衡') !== -1, '总览明说「不是均衡，是都还没开始」');
ok(low.crossAdvice.text.indexOf('四个维度都还在起步') !== -1, '跨维度建议按 starting 分支');

eq(L.buildReport({ answers: answersWithLevel(2) }).shape, 'balanced', '四维全为 2 → balanced');
eq(L.buildReport({ answers: answersWithLevel(3) }).shape, 'integrated', '四维全为 3 → integrated');

/* 形态与主导维度 */
const off = L.buildReport({ answers: answersByDim({ mind: 3, body: 1, relationships: 2, vocation: 2 }) });
eq(off.shape, 'offset', 'spread = 2 → offset');
eq(off.dominant, 'mind', '最高维唯一 → dominant = mind');
eq(off.coreQuadrant, 'body', '核心问题象限 = 最弱维度');
eq(L.buildReport({ answers: answersByDim({ mind: 3, body: 3, relationships: 2, vocation: 2 }) }).dominant, 'none', '最高维并列 → dominant = none');

/* 穷举 81 种四维 level 组合，形态与主导维度必须唯一确定 */
const seen = {};
let combos = 0;
for (let a1 = 1; a1 <= 3; a1++) for (let a2 = 1; a2 <= 3; a2++) for (let a3 = 1; a3 <= 3; a3++) for (let a4 = 1; a4 <= 3; a4++) {
  const rr = L.buildReport({ answers: answersByDim({ mind: a1, body: a2, relationships: a3, vocation: a4 }) });
  seen[rr.shape + '|' + rr.dominant] = true;
  combos++;
}
eq(combos, 81, '穷举 81 种四维组合');
console.log('  出现的 形态|主导 组合：' + Object.keys(seen).sort().join('  '));

/* P1-6：作答时长 */
eq(L.buildReport({ answers: answersWithLevel(2), answerSeconds: 1800 }).fastAnswer, false, '作答 30 分钟不标记过快');
eq(L.buildReport({ answers: answersWithLevel(2), answerSeconds: 90 }).fastAnswer, true, '作答 90 秒标记过快');
eq(L.buildReport({ answers: answersWithLevel(2), answerSeconds: 240 }).fastAnswer, false, '刚好 4 分钟不标记过快');
eq(L.buildReport({ answers: answersWithLevel(2) }).fastAnswer, false, '未记录时长不标记过快');

/* P1-6：单维作答张力 */
const mixedA = {};
D.QUESTIONS.forEach((q, i) => {
  if (q.kind !== 'level') { mixedA[q.id] = q.options[0].v; return; }
  const lv = (i % 2 === 0) ? 1 : 3;
  mixedA[q.id] = (q.options.filter(o => Number(o.v) === lv)[0] || q.options[0]).v;
});
D.DIM_ORDER.forEach(id => {
  eq(L.analyzeDimension(id, mixedA, D.QUESTIONS).mixed, true, id + ' 1 与 3 并存 → mixed = true');
});
D.DIM_ORDER.forEach(id => {
  eq(L.analyzeDimension(id, answersWithLevel(2), D.QUESTIONS).mixed, false, id + '答案一致 → mixed = false');
});

/* P0-1：parseReport 枚举白名单 */
const META_NAMES = Object.keys(D.METATYPES).map(k => D.METATYPES[k].name);
const ARCH_NAMES = [];
Object.keys(D.ARCHETYPES).forEach(d => Object.keys(D.ARCHETYPES[d]).forEach(p => ARCH_NAMES.push(D.ARCHETYPES[d][p].name)));

function validReport() {
  return {
    metatype: { name: META_NAMES[0], why: 'w', strongest: 'mind', weakest: 'body', unique: 'u', basis: 'b' },
    archetype: { name: ARCH_NAMES[0], driver: 'd', mostEnergy: 'mind', sacrificed: 'body', problem: 'p', fit: 'f' },
    quadrants: ['mind', 'body', 'relationships', 'vocation'].map((id, i) => ({
      id, level: i + 1, phase: 'uncertainty', evidence: 'e', strengths: ['s'], gaps: ['g'],
      fakeGrowth: '无', crossImpact: 'c', priority: 'p', confidence: 'medium', uncertain: 'u'
    })),
    crossDynamics: { blocker: 'body', lever: 'mind', rootCause: 'body', chainRisk: 'r', hiddenPattern: 'h' },
    coreProblem: { quadrant: 'body', what: 'w', whyRoot: 'r', impact: 'i', whyNow: 'n' },
    roadmap: {
      day1: 'd',
      month1: { goal: 'g', daily: 'd', weekly: 'w', crossSupport: 'c', successSignal: 's', avoid: 'a' },
      month3: { change: 'c', skill: 's', relapseGuard: 'r', support: 's', signal: 's' },
      year1: { nextStage: 'n', newProblem: 'p', interlock: 'i', lifestyle: 'l' }
    },
    accelerator: { verdict: 'caution', missingBase: 'm', aiUse: 'a', outsourcingRisk: 'o', dependencySignals: 'd' },
    warnings: { regressionTrigger: 'r', fakeGrowthTrap: 'f', chainRisk: 'c', selfDeception: 's' },
    comparable: [{ name: 'n', similar: 's', difference: 'd' }],
    finalFeedback: 'f'
  };
}
function wrapReport(obj) { return '访谈完成，我现在整理报告。\n\`\`\`json\n' + JSON.stringify(obj) + '\n\`\`\`'; }

ok(AI.parseReport(wrapReport(validReport())).ok, '枚举全部合法的报告被接受');

const badMeta = validReport(); badMeta.metatype.name = '自创的元类型';
const rBadMeta = AI.parseReport(wrapReport(badMeta));
ok(!rBadMeta.ok && /枚举字段越界/.test(rBadMeta.error), '元类型名越界 → 判 FAIL');

const badVerdict = validReport(); badVerdict.accelerator.verdict = 'maybe';
ok(!AI.parseReport(wrapReport(badVerdict)).ok, 'accelerator.verdict 越界 → 判 FAIL');

const badQuad = validReport(); badQuad.coreProblem.quadrant = 'spirit';
ok(!AI.parseReport(wrapReport(badQuad)).ok, '已废弃的 spirit 维度 id → 判 FAIL');

const badConf = validReport(); badConf.quadrants[0].confidence = 'very-high';
ok(!AI.parseReport(wrapReport(badConf)).ok, 'confidence 越界 → 判 FAIL');

/* 缺失的枚举字段补默认值，不判 FAIL */
const sparse = validReport();
delete sparse.metatype.strongest; delete sparse.archetype.mostEnergy;
delete sparse.accelerator.verdict; delete sparse.coreProblem.quadrant;
sparse.quadrants.forEach(q => { delete q.confidence; });
const rSparse = AI.parseReport(wrapReport(sparse));
ok(rSparse.ok, '枚举字段缺失时补默认值，不判 FAIL');
eq(rSparse.data.accelerator.verdict, 'caution', '缺失 verdict 默认 caution');

/* 规则引擎权威判定覆盖 AI 的改判 */
const wrong = validReport();
wrong.metatype.name = META_NAMES[1];
wrong.archetype.name = ARCH_NAMES[1];
wrong.accelerator.verdict = 'assess';
wrong.coreProblem.quadrant = 'vocation';
const over = AI.parseReport(wrapReport(wrong), {
  metatype: META_NAMES[0], archetype: ARCH_NAMES[0], accelerator: 'hold', coreQuadrant: 'mind'
});
ok(over.ok, '传入规则引擎判定后仍能解析');
eq(over.data.metatype.name, META_NAMES[0], 'AI 改判元类型被规则引擎覆盖');
eq(over.data.archetype.name, ARCH_NAMES[0], 'AI 改判原型被规则引擎覆盖');
eq(over.data.accelerator.verdict, 'hold', 'AI 改判加速器被规则引擎覆盖');
eq(over.data.coreProblem.quadrant, 'mind', 'AI 改判核心象限被规则引擎覆盖');

/* 维度 id 与 data.js 对齐 */
eq(AI.QUADRANTS.join(','), 'mind,body,relationships,vocation', 'QUADRANTS 与 data.js 维度 id 一致');
eq(AI.QUADRANT_CN.relationships, '关系与意义', 'QUADRANT_CN 覆盖 relationships');

/* --------------------------------------- [9] 云函数代理：兑换码校验与转发 */
async function proxyTests() {
  console.log('\n[10] 云函数代理：兑换码校验');
  const nodePath = require('path');
  const file = nodePath.resolve(__dirname, '..', 'server', 'tencent-scf', 'index.js');
  const ENV_KEYS = ['ACCESS_CODES', 'CODE_SECRET', 'ALLOW_ORIGIN', 'API_KEY', 'BASE_URL', 'MODEL', 'RATE_LIMIT'];

  function loadProxy(env) {
    const saved = {};
    ENV_KEYS.forEach(k => {
      saved[k] = process.env[k];
      if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k];
    });
    delete require.cache[require.resolve(file)];
    const mod = require(file);
    ENV_KEYS.forEach(k => {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    });
    return mod;
  }

  function ev(method, body, headers) {
    return {
      httpMethod: method,
      headers: headers || {},
      body: body === undefined ? undefined : JSON.stringify(body),
      isBase64Encoded: false,
      requestContext: { sourceIp: '1.2.3.4' }
    };
  }

  const realFetch = globalThis.fetch;
  let upstream = 0;
  globalThis.fetch = async function () {
    upstream++;
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: '模型回复' } }] }) };
  };

  const MSGS = [{ role: 'user', content: 'hi' }];

  try {
    /* --- 未配置兑换码：不校验，保持旧行为 --- */
    const open = loadProxy({ API_KEY: 'k', ACCESS_CODES: '', ALLOW_ORIGIN: 'https://3209709618-alt.github.io' });
    let r = await open.main_handler(ev('POST', { messages: MSGS }));
    eq(r.statusCode, 200, '未配置 ACCESS_CODES 时不校验，直接放行');
    eq(upstream, 1, '放行时会转发到模型');
    r = await open.main_handler(ev('GET'));
    ok(JSON.parse(r.body).requireCode === false, '未配置时 GET 返回 requireCode=false');
    r = await open.main_handler(ev('OPTIONS', undefined, { origin: 'https://a.com' }));
    eq(r.statusCode, 204, 'OPTIONS 预检返回 204');
    eq(r.headers['Access-Control-Allow-Origin'], 'https://a.com', 'CORS 回显请求来源');

    /* 预检必须放行 X-Access-Code，否则带兑换码的请求会被浏览器直接拦截 */
    r = await open.main_handler(ev('OPTIONS', undefined, {
      origin: 'https://3209709618-alt.github.io',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type, x-access-code'
    }));
    eq(r.statusCode, 204, '带兑换码头的预检也返回 204');
    ok(/x-access-code/i.test(r.headers['Access-Control-Allow-Headers']),
      '预检放行 X-Access-Code（漏了它浏览器会拦截带码请求，用户卡死在输不了码）');

    /* --- 配置兑换码：校验生效 --- */
    const gated = loadProxy({ API_KEY: 'k', ACCESS_CODES: 'H30-AAAA-1111, H30-BBBB-2222' });
    r = await gated.main_handler(ev('GET'));
    ok(JSON.parse(r.body).requireCode === true, '配置后 GET 返回 requireCode=true');

    const before = upstream;
    r = await gated.main_handler(ev('POST', { messages: MSGS }));
    eq(r.statusCode, 403, '未带兑换码返回 403');
    eq(JSON.parse(r.body).error.code, 'ACCESS_CODE', '403 带 ACCESS_CODE 标识');
    eq(upstream, before, '403 不转发到模型，不消耗额度');

    r = await gated.main_handler(ev('POST', { messages: MSGS }, { 'X-Access-Code': 'WRONG-CODE' }));
    eq(r.statusCode, 403, '错误兑换码返回 403');
    eq(upstream, before, '错误码同样不转发到模型');

    r = await gated.main_handler(ev('POST', { messages: MSGS }, { 'x-access-code': 'H30-BBBB-2222' }));
    eq(r.statusCode, 200, '正确兑换码（请求头，大小写不敏感）放行');
    ok(upstream > before, '正确兑换码会转发到模型');

    r = await gated.main_handler(ev('POST', { messages: MSGS, code: 'H30-AAAA-1111' }));
    eq(r.statusCode, 200, '正确兑换码（body.code）也放行');
    r = await gated.main_handler(ev('POST', { messages: MSGS, accessCode: '  H30-AAAA-1111  ' }));
    eq(r.statusCode, 200, '兑换码首尾空格被容忍');

    /* --- 中文逗号 / 换行分隔 --- */
    const gated2 = loadProxy({ API_KEY: 'k', ACCESS_CODES: 'H30-CCCC-3333，H30-DDDD-4444\nH30-EEEE-5555' });
    r = await gated2.main_handler(ev('POST', { messages: MSGS }, { 'X-Access-Code': 'H30-EEEE-5555' }));
    eq(r.statusCode, 200, '中文逗号/换行分隔的码表可解析');

    /* --- 签名码（CODE_SECRET）：不存码表，可无限发放 --- */
    const SECRET = 'test-secret-abc123';
    const ALPHA = 'ACDEFGHJKMNPQRTUVWXY34679';
    const sign = seq => {
      const h = require('crypto').createHmac('sha256', SECRET).update(String(seq)).digest();
      let out = '';
      for (let i = 0; i < 6; i++) out += ALPHA[h[i] % ALPHA.length];
      return out;
    };
    const signed = loadProxy({ API_KEY: 'k', ACCESS_CODES: '', CODE_SECRET: SECRET });
    r = await signed.main_handler(ev('GET'));
    ok(JSON.parse(r.body).requireCode === true, '只配 CODE_SECRET 时门禁也启用');
    r = await signed.main_handler(ev('POST', { messages: MSGS }));
    eq(r.statusCode, 403, '只配 CODE_SECRET 时无码仍 403');
    r = await signed.main_handler(ev('POST', { messages: MSGS }, { 'X-Access-Code': 'H30-0001-' + sign(1) }));
    eq(r.statusCode, 200, '正确的签名码放行');
    r = await signed.main_handler(ev('POST', { messages: MSGS }, { 'X-Access-Code': 'H30-0042-' + sign(42) }));
    eq(r.statusCode, 200, '另一个序号的签名码也放行');
    r = await signed.main_handler(ev('POST', { messages: MSGS }, { 'X-Access-Code': 'H30-0001-AAAAAA' }));
    eq(r.statusCode, 403, '校验位被篡改 → 拒绝');
    r = await signed.main_handler(ev('POST', { messages: MSGS }, { 'X-Access-Code': 'H30-9999-' + sign(1) }));
    eq(r.statusCode, 403, '序号与校验位不匹配 → 拒绝');
    r = await signed.main_handler(ev('POST', { messages: MSGS }, { 'X-Access-Code': 'H30-1-' + sign(1) }));
    eq(r.statusCode, 200, '序号不补零也认（1 与 0001 等价）');
    r = await signed.main_handler(ev('POST', { messages: MSGS }, { 'X-Access-Code': 'H30-0001-' + sign(1).toLowerCase() }));
    eq(r.statusCode, 403, '校验位大小写敏感，小写不认');

    /* --- 白名单与签名码同时生效 --- */
    const both = loadProxy({ API_KEY: 'k', ACCESS_CODES: 'H30-AAAA-1111', CODE_SECRET: SECRET });
    r = await both.main_handler(ev('POST', { messages: MSGS }, { 'X-Access-Code': 'H30-AAAA-1111' }));
    eq(r.statusCode, 200, '同时配置时白名单码仍有效');
    r = await both.main_handler(ev('POST', { messages: MSGS }, { 'X-Access-Code': 'H30-0007-' + sign(7) }));
    eq(r.statusCode, 200, '同时配置时签名码也有效');
    r = await both.main_handler(ev('POST', { messages: MSGS }, { 'X-Access-Code': 'H30-0008-BBBBBB' }));
    eq(r.statusCode, 403, '同时配置时假签名码仍拒绝');

    /* --- 原有校验不被绕过 --- */
    r = await gated.main_handler(ev('POST', { messages: [] }, { 'X-Access-Code': 'H30-AAAA-1111' }));
    eq(r.statusCode, 400, '带对码但缺 messages 仍返回 400');
  } finally {
    globalThis.fetch = realFetch;
  }
}

proxyTests().then(function () {
  /* ---------------------------------------------------------- 汇总 */
  console.log('\n----------------------------------------');
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  if (fail) {
    console.log('\n失败明细：');
    failures.slice(0, 40).forEach(f => console.log(' - ' + f));
    process.exit(1);
  } else {
    console.log('全部规则测试通过。');
  }
});
