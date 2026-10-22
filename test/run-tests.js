/* 规则引擎自测：node test/run-tests.js */
'use strict';

require('../assets/data.js');
require('../assets/logic.js');

const D = globalThis.H30Data;
const L = globalThis.H30Logic;

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
  q.tiers.forEach(t => ok(D.PLANS[t], q.id + ' tier 非法：' + t));
  ok(q.options.length === 3, q.id + ' 选项数量不是 3');
  ok(typeof q.text === 'string' && q.text.length > 8, q.id + ' 题干过短');

  const vals = q.options.map(o => String(o.v)).sort();
  if (q.kind === 'level') eq(vals, ['1', '2', '3'], q.id + ' level 选项取值应为 1/2/3 各一次');
  else eq(vals, ['d', 'f', 'u'], q.id + ' phase 选项取值应为 d/u/f 各一次');

  q.options.forEach((o, i) => {
    ok(typeof o.t === 'string' && o.t.length > 6, q.id + ' 第 ' + (i + 1) + ' 个选项文本过短');
  });
});

/* ---------------------------------------------------------- 2. 版本覆盖 */
console.log('\n[2] 三个版本的题量与维度覆盖');

const counts = {
  quick: { total: 8, perDim: 2 },
  standard: { total: 16, perDim: 4 },
  complete: { total: 32, perDim: 8 }
};

D.PLAN_ORDER.forEach(plan => {
  const qs = L.questionsFor(plan, D.DIM_ORDER);
  eq(qs.length, counts[plan].total, plan + ' 全部维度题量');
  D.DIM_ORDER.forEach(dim => {
    const list = qs.filter(q => q.dim === dim);
    eq(list.length, counts[plan].perDim, plan + ' / ' + dim + ' 题量');
    ok(list.some(q => q.kind === 'level'), plan + ' / ' + dim + ' 缺少阶段题');
    ok(list.some(q => q.kind === 'phase'), plan + ' / ' + dim + ' 缺少转变题');
  });
});

// 快速版必须覆盖全部四个维度
const quickQs = L.questionsFor('quick', D.DIM_ORDER);
eq([...new Set(quickQs.map(q => q.dim))].sort(), [...D.DIM_ORDER].sort(), '快速版必须覆盖四个维度');

// 重点维度：只选一个维度时题目数量正确
eq(L.questionsFor('standard', ['mind']).length, 4, '标准版单维度题量');
eq(L.questionsFor('complete', ['body']).length, 8, '完整版单维度题量');

/* ---------------------------------------------------------- 3. 阶段判定 */
console.log('\n[3] 阶段与转变判定');

function answerDim(plan, dim, level, phase) {
  const out = {};
  L.questionsFor(plan, [dim]).forEach(q => {
    out[q.id] = q.kind === 'level' ? level : phase;
  });
  return out;
}

D.PLAN_ORDER.forEach(plan => {
  D.DIM_ORDER.forEach(dim => {
    [1, 2, 3].forEach(level => {
      ['d', 'u', 'f'].forEach(phase => {
        const a = answerDim(plan, dim, level, phase);
        const row = L.analyzeDimension(dim, a);
        ok(row && row.level === level, plan + '/' + dim + ' 阶段判定错误（期望 ' + level + '）');
        ok(row && row.phase === phase, plan + '/' + dim + ' 转变判定错误（期望 ' + phase + '）');
        ok(row && row.strengths.length === 2, plan + '/' + dim + ' 优势条目数应为 2');
        ok(row && row.watch.length === 2, plan + '/' + dim + ' 关注条目数应为 2');
        ok(row && row.next.length === 3, plan + '/' + dim + ' 下一步条目数应为 3');
      });
    });
  });
});

/* ---------------------------------------------------------- 4. 报告规则 */
console.log('\n[4] 报告生成规则');

function buildFull(levels, phases) {
  const answers = {};
  D.DIM_ORDER.forEach((dim, i) => {
    Object.assign(answers, answerDim('complete', dim, levels[i], phases[i]));
  });
  return answers;
}

// 4.1 四维齐全 → 有元类型与原型
{
  const a = buildFull([2, 2, 2, 2], ['u', 'u', 'u', 'u']);
  const r = L.buildReport({ plan: 'complete', dims: D.DIM_ORDER, answers: a });
  ok(r.allDims === true, '四维齐全时 allDims 应为 true');
  ok(r.metatype !== null, '四维齐全时应生成元类型');
  ok(r.archetype !== null, '四维齐全时应生成生活方式原型');
  ok(r.missingNote === null, '四维齐全时不应有信息不足提示');
  eq(r.metatype.name, '均衡探索型', '四个 2.0 应判定为均衡探索型');
  eq(r.archetype.name, '重新出发的探索者', '均衡 + 不确定期原型');
  ok(r.actions.length === 3, '行动建议应为 3 条');
  console.log('   · 示例元类型：' + r.metatype.name + ' / ' + r.archetype.name);
}

// 4.2 部分维度 → 不生成类型
{
  const a = {};
  ['mind', 'body'].forEach(dim => Object.assign(a, answerDim('standard', dim, 3, 'f')));
  const r = L.buildReport({ plan: 'standard', dims: ['mind', 'body'], answers: a });
  ok(r.allDims === false, '两维时 allDims 应为 false');
  ok(r.metatype === null, '部分维度不应生成元类型');
  ok(r.archetype === null, '部分维度不应生成原型');
  ok(typeof r.missingNote === 'string' && r.missingNote.includes('四个维度'), '部分维度应提示信息不足');
  ok(r.rows.length === 2, '部分维度报告只包含已探索维度');
  ok(r.overview.includes('心智') && r.overview.includes('身体'), '总览应提及已探索维度');
  ok(!r.overview.includes('职业'), '总览不应提及未探索维度');
}

// 4.3 元类型分支
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
  const a = buildFull(c.levels, ['u', 'u', 'u', 'u']);
  const r = L.buildReport({ plan: 'complete', dims: D.DIM_ORDER, answers: a });
  eq(r.metatype.name, c.expect, '元类型规则：' + c.label);
});

// 4.4 原型分支
{
  const a = buildFull([3, 1, 1, 1], ['f', 'd', 'd', 'd']);
  const r = L.buildReport({ plan: 'complete', dims: D.DIM_ORDER, answers: a });
  eq(r.archetype.name, '清醒的设计者', '原型规则：心智最高 + 发现期');
  ok(r.archetype.basis.includes('心智'), '原型应说明推导依据');
}

/* ---------------------------------------------------------- 5. 文本输出 */
console.log('\n[5] 复制报告文本');

{
  const a = buildFull([2, 3, 2, 3], ['u', 'f', 'u', 'f']);
  const r = L.buildReport({ plan: 'complete', dims: D.DIM_ORDER, answers: a });
  const text = L.toText(r);

  ok(text.includes('Human3.0人生评估 · 完整版'), '文本应包含标题与版本');
  ok(text.includes('【元类型】'), '文本应包含元类型');
  ok(text.includes('【生活方式原型】'), '文本应包含原型');
  ok(text.includes('【心智】') && text.includes('【身体】') && text.includes('【关系与意义】') && text.includes('【职业与贡献】'), '文本应包含四个维度');
  ok(text.includes('发展阶段：') && text.includes('转变阶段：'), '文本应包含阶段信息');
  ok(text.includes('优势：') && text.includes('值得关注：') && text.includes('下一步：'), '文本应包含三组建议');
  ok(text.includes('不是心理诊断'), '文本应包含免责声明');
  ok(!/undefined|null|NaN/.test(text), '文本中不应出现 undefined / null / NaN');
  ok(text.split('\n').length > 40, '文本内容应足够完整');

  // 部分维度文本
  const a2 = {};
  Object.assign(a2, answerDim('standard', 'vocation', 2, 'd'));
  const r2 = L.buildReport({ plan: 'standard', dims: ['vocation'], answers: a2 });
  const t2 = L.toText(r2);
  ok(t2.includes('【元类型 / 生活方式原型】'), '部分维度文本应显示类型信息不足');
  ok(!t2.includes('【心智】'), '部分维度文本不应包含未探索维度');
  ok(t2.includes('【职业与贡献】'), '部分维度文本应包含已探索维度');
  ok(!/undefined|null|NaN/.test(t2), '部分维度文本不应出现 undefined');
}

/* ---------------------------------------------------------- 6. 完整性校验 */
console.log('\n[6] 必答校验');

{
  const qs = L.questionsFor('quick', D.DIM_ORDER);
  const partial = { [qs[0].id]: 1 };
  const missing = L.missingQuestions(partial, qs);
  eq(missing.length, qs.length - 1, '未答题数量统计');
  eq(L.missingQuestions({}, qs).length, qs.length, '空回答时全部为未答');
}

/* ---------------------------------------------------------- 7. 时间格式 */
console.log('\n[7] 文本工具');

{
  const t = L.formatTime(new Date(2026, 9, 22, 9, 5));
  eq(t, '2026-10-22 09:05', '时间格式化补零');
}

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
