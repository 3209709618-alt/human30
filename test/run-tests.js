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

  ok(text.includes('Human3.0人生评估 · 完整版'), '包含标题与版本');
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

  ok(p.includes('不超过 16 个问题'), '提示词含时间盒（≤16 问）');
  ok(p.includes('角色锁定'), '提示词含角色锁定（防注入）');
  ok(p.includes('无证据'), '提示词含「未知=无证据」汇总规则');
  ok(p.includes('\`\`\`json'), '提示词含结构化契约标记');
  ok(p.includes('访谈完成，我现在整理报告'), '提示词含结束语');
  ok(p.includes('错位成长型'), '提示词注入 canonical 元类型词表');
  ok(p.includes('反复回放的观察者'), '提示词注入 canonical 原型词表');
  ok(p.length > 3000 && p.length < 8000, '提示词长度受控（' + p.length + ' 字）');
  ok(AI.OPENING.indexOf('我们先从心智象限开始') > 0, '开场白固定且完整');

  // 解析：拒收坏输入
  ok(!AI.parseReport('这是一段普通回复').ok, '无 json 的回复被拒绝');
  ok(!AI.parseReport('\`\`\`json\n{坏了\n\`\`\`').ok, '坏 json 被拒绝');
  const partial = AI.parseReport('\`\`\`json\n' + JSON.stringify({ metatype: {} }) + '\n\`\`\`');
  ok(!partial.ok, '缺字段的报告被拒绝');

  // 解析：接受并规范化好输入
  const raw = {
    metatype: { name: '错位成长型' }, archetype: { name: '清醒的设计者' },
    quadrants: [{ id: 'vocation' }, { id: 'mind' }, { id: 'body' }, { id: 'spirit' }],
    crossDynamics: {}, coreProblem: {}, roadmap: {}, accelerator: {}, warnings: {}, finalFeedback: '反馈'
  };
  const r = AI.parseReport('访谈完成，我现在整理报告。\n\`\`\`json\n' + JSON.stringify(raw) + '\n\`\`\`');
  ok(r.ok, '完整报告被接受');
  ok(r.data.quadrants.map(q => q.id).join(',') === 'mind,body,spirit,vocation', '四象限被排序规范化');
  ok(r.data.quadrants.every(q => q.level === 1 && q.phase === 'uncertainty'), '缺失字段有默认值');
  ok(Array.isArray(r.data.quadrants[0].strengths), '数组成员被补齐');
})();

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
