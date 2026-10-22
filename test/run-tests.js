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

const quickQs = L.questionsFor('quick', D.DIM_ORDER);
eq([...new Set(quickQs.map(q => q.dim))].sort(), [...D.DIM_ORDER].sort(), '快速版必须覆盖四个维度');
eq(L.questionsFor('standard', ['mind']).length, 4, '标准版单维度题量');
eq(L.questionsFor('complete', ['body']).length, 8, '完整版单维度题量');

/* ---------------------------------------------------------- 3. 阶段判定 */
console.log('\n[3] 阶段、转变与建议');

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
        const qs = L.questionsFor(plan, [dim]);
        const row = L.analyzeDimension(dim, a, qs);
        ok(row && row.level === level, plan + '/' + dim + ' 阶段判定错误（期望 ' + level + '）');
        ok(row && row.phase === phase, plan + '/' + dim + ' 转变判定错误（期望 ' + phase + '）');
        ok(row && row.strengths.length === 2, plan + '/' + dim + ' 优势条目数应为 2');
        ok(row && row.watch.length === 2, plan + '/' + dim + ' 关注条目数应为 2');
        ok(row && typeof row.advice === 'string' && row.advice.length > 30, plan + '/' + dim + ' 缺少具体建议');
        ok(row && row.advice.includes(row.advicePhase), plan + '/' + dim + ' 建议应包含阶段提示');
        ok(row && row.basis && row.basis.answer.length > 6, plan + '/' + dim + ' 缺少判断依据');
        ok(row && row.questionCount === qs.length, plan + '/' + dim + ' 题量统计错误');
      });
    });
  });
});

// 建议必须具体：包含时间范围或数量词
{
  const row = L.analyzeDimension('body', answerDim('standard', 'body', 2, 'u'), L.questionsFor('standard', ['body']));
  ok(/(周|天|次|分钟|个月|小时)/.test(row.advice), '建议应包含可执行的时间/数量：' + row.advice.slice(0, 30));
}

/* ---------------------------------------------------------- 4. 报告规则 */
console.log('\n[4] 报告生成规则');

function buildFull(levels, phases, note) {
  const answers = {};
  D.DIM_ORDER.forEach((dim, i) => {
    Object.assign(answers, answerDim('complete', dim, levels[i], phases[i]));
  });
  return L.buildReport({ plan: 'complete', dims: D.DIM_ORDER, answers, note });
}

// 4.1 四维齐全
{
  const r = buildFull([2, 2, 2, 2], ['u', 'u', 'u', 'u']);
  ok(r.allDims === true, '四维齐全时 allDims 应为 true');
  ok(r.metatype !== null, '四维齐全时应生成元类型');
  ok(r.archetype !== null, '四维齐全时应生成生活方式原型');
  ok(r.linkage !== null, '四维齐全时应生成跨维度分析');
  ok(r.crossAdvice !== null, '四维齐全时应生成跨维度建议');
  ok(r.missingNote === null, '四维齐全时不应有信息不足提示');
  ok(r.missingDetail === null, '四维齐全时不应有缺失说明');
  eq(r.metatype.name, '均衡探索型', '四个 2.0 应判定为均衡探索型');
  eq(r.archetype.name, '重新出发的探索者', '均衡 + 不确定期原型');
  eq(r.linkage.key, 'balanced', '四个 2.0 应走均衡联动');
  ok(r.crossAdvice.priority === null, '均衡型不指定优先维度');
  console.log('   · 示例：' + r.metatype.name + ' / ' + r.archetype.name + ' / ' + r.linkage.title);
}

// 4.2 部分维度
{
  const a = {};
  ['mind', 'body'].forEach(dim => Object.assign(a, answerDim('standard', dim, 3, 'f')));
  const r = L.buildReport({ plan: 'standard', dims: ['mind', 'body'], answers: a });
  ok(r.allDims === false, '两维时 allDims 应为 false');
  ok(r.metatype === null, '部分维度不应生成元类型');
  ok(r.archetype === null, '部分维度不应生成原型');
  ok(r.linkage === null, '部分维度不应生成跨维度分析');
  ok(r.crossAdvice === null, '部分维度不应生成跨维度建议');
  ok(r.missingNote.includes('目前信息不足，无法可靠判断'), '部分维度应使用规定措辞');
  ok(!r.missingNote.includes('「心智」'), '缺失说明不应把已完成的维度算作缺失');
  ok(r.missingNote.includes('「关系与意义」'), '缺失说明应列出缺少的维度');
  ok(r.missingDetail && r.missingDetail.includes('不会被补全'), '缺失说明应声明不做补全');
  ok(r.rows.length === 2, '部分维度报告只包含已探索维度');
  ok(r.rows.every(x => x.advice && x.basis), '每个已完成维度都应给出建议与依据');
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
  const r = buildFull(c.levels, ['u', 'u', 'u', 'u']);
  eq(r.metatype.name, c.expect, '元类型规则：' + c.label);
});

// 4.4 原型与联动分支
{
  const r = buildFull([3, 1, 2, 2], ['f', 'd', 'u', 'u']);
  eq(r.archetype.name, '清醒的设计者', '原型规则：心智最高 + 发现期');
  ok(r.archetype.basis.includes('心智'), '原型应说明推导依据');
  eq(r.linkage.key, 'mind>body', '联动应取最高维度 → 最低维度');
  ok(r.linkage.title.length > 2, '联动应有标题');
  ok(r.linkage.question.includes('？'), '联动应给出一个可带走的问题');
  ok(r.crossAdvice.priority === '身体', '跨维度建议应指向最落后的维度');
  ok(r.crossAdvice.text.includes('身体') && r.crossAdvice.text.includes('心智'), '跨维度建议应说明两者关系');
}

/* ---------------------------------------------------------- 5. 文本输出 */
console.log('\n[5] 复制报告文本');

{
  const r = buildFull([2, 3, 2, 3], ['u', 'f', 'u', 'f']);
  const text = L.toText(r);

  ok(text.includes('Human3.0人生评估 · 完整版'), '文本应包含标题与版本');
  ok(text.includes('【说明】'), '文本应包含报告说明');
  ok(text.includes('不是心理、医疗或职业诊断'), '说明应覆盖心理/医疗/职业三类诊断');
  ok(text.includes('不是经过验证的客观测评'), '说明应声明非验证测评');
  ok(text.includes('【元类型】'), '文本应包含元类型');
  ok(text.includes('【生活方式原型】'), '文本应包含原型');
  ok(text.includes('【跨维度 · 核心议题】'), '文本应包含跨维度议题');
  ok(text.includes('【跨维度建议】'), '文本应包含跨维度建议');
  ok(text.includes('【心智】') && text.includes('【身体】') && text.includes('【关系与意义】') && text.includes('【职业与贡献】'), '文本应包含四个维度');
  ok(text.includes('发展阶段：') && text.includes('转变阶段：'), '文本应包含阶段信息');
  ok(text.includes('优势：') && text.includes('值得关注：') && text.includes('给你的建议：'), '文本应包含建议结构');
  ok(text.includes('判断依据：'), '文本应包含判断依据');
  ok(text.includes('理论来源：Dan Koe'), '文本应标注理论来源');
  ok(!/undefined|null|NaN/.test(text), '文本中不应出现 undefined / null / NaN');
  ok(!text.includes('未来两周可以先做的三件事'), '旧的行动清单应已移除');

  const a2 = {};
  Object.assign(a2, answerDim('standard', 'vocation', 2, 'd'));
  const r2 = L.buildReport({ plan: 'standard', dims: ['vocation'], answers: a2 });
  const t2 = L.toText(r2);
  ok(t2.includes('【元类型 / 生活方式原型 / 跨维度分析】'), '部分维度文本应显示类型信息不足');
  ok(t2.includes('目前信息不足，无法可靠判断'), '部分维度文本应使用规定措辞');
  ok(!t2.includes('【心智】'), '部分维度文本不应包含未探索维度');
  ok(t2.includes('【职业与贡献】'), '部分维度文本应包含已探索维度');
  ok(!t2.includes('【跨维度建议】'), '部分维度不应出现跨维度建议');
  ok(!/undefined|null|NaN/.test(t2), '部分维度文本不应出现 undefined');
}

/* ---------------------------------------------------------- 6. 笔记 */
console.log('\n[6] 可选笔记');

{
  const withNote = buildFull([2, 2, 2, 2], ['u', 'u', 'u', 'u'], '  最近刚换工作，同时在照顾家人。  ');
  eq(withNote.note, '最近刚换工作，同时在照顾家人。', '笔记应去除首尾空格');
  ok(L.toText(withNote).includes('【你补充的背景】'), '有笔记时文本应包含笔记区块');
  ok(L.toText(withNote).includes('未参与任何判断'), '笔记应标注不参与判断');

  const without = buildFull([2, 2, 2, 2], ['u', 'u', 'u', 'u']);
  eq(without.note, '', '未填写时笔记为空');
  ok(!L.toText(without).includes('【你补充的背景】'), '未填写时不应出现笔记区块');

  // 笔记不改变任何判断结果
  const a = buildFull([1, 3, 2, 2], ['d', 'f', 'u', 'd']).rows.map(x => x.level + x.phase).join(',');
  const b = buildFull([1, 3, 2, 2], ['d', 'f', 'u', 'd'], '这是一段完全无关的补充说明').rows.map(x => x.level + x.phase).join(',');
  eq(a, b, '笔记不得影响阶段/类型判断');
}

/* ---------------------------------------------------------- 7. 完整性校验 */
console.log('\n[7] 必答校验');

{
  const qs = L.questionsFor('quick', D.DIM_ORDER);
  const partial = { [qs[0].id]: 1 };
  const missing = L.missingQuestions(partial, qs);
  eq(missing.length, qs.length - 1, '未答题数量统计');
  eq(L.missingQuestions({}, qs).length, qs.length, '空回答时全部为未答');
}

/* ---------------------------------------------------------- 8. 时间格式 */
console.log('\n[8] 文本工具');

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
