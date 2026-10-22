/* ==========================================================================
 * Human3.0人生评估 —— 规则引擎
 * --------------------------------------------------------------------------
 * 纯函数：输入回答，输出报告。不涉及 DOM，不发起任何网络请求。
 * 规则全部为预设规则，不使用 AI，也不输出数字分数。
 *
 * 报告原则：
 * - 只分析用户实际完成的维度；
 * - 四个维度齐全才生成元类型、生活方式原型与跨维度分析；
 * - 结论措辞保守，只描述“这次回答呈现的倾向”。
 * ========================================================================== */

(function (root) {
  'use strict';

  var D = root.H30Data;

  var DISCLAIMER = '本报告基于 HUMAN 3.0 框架生成，属于自我探索参考：它不是心理、医疗或职业诊断，也不是经过验证的客观测评。结论描述的是这份回答呈现的倾向，不是关于你的定论。理论框架参考 Dan Koe 的 HUMAN 3.0。';

  /* ------------------------------------------------------------ 小工具 */

  function levelLabel(level, name) {
    return level + '.0 ' + name;
  }

  function countBy(list) {
    var map = {};
    list.forEach(function (v) { map[v] = (map[v] || 0) + 1; });
    return map;
  }

  /* 相位判定：票数最多者胜；平票时按“不确定 > 失调 > 发现”取，避免把过渡态误判成结论 */
  function pickPhase(phases) {
    var counts = countBy(phases);
    var max = Math.max(counts.d || 0, counts.u || 0, counts.f || 0);
    var order = ['u', 'd', 'f'];
    for (var i = 0; i < order.length; i++) {
      if ((counts[order[i]] || 0) === max) return order[i];
    }
    return 'u';
  }

  /* 阶段判定：题目取值的平均值 → 1.0 / 2.0 / 3.0 */
  function pickLevel(values) {
    var avg = values.reduce(function (a, b) { return a + b; }, 0) / values.length;
    if (avg < 1.75) return 1;
    if (avg < 2.5) return 2;
    return 3;
  }

  /* ------------------------------------------------------------ 题目集 */

  function questionsFor(plan, dims) {
    return D.QUESTIONS.filter(function (q) {
      return q.tiers.indexOf(plan) !== -1 && dims.indexOf(q.dim) !== -1;
    });
  }

  function missingQuestions(answers, questions) {
    return questions.filter(function (q) {
      return answers[q.id] === undefined || answers[q.id] === null || answers[q.id] === '';
    });
  }

  /* ------------------------------------------------------------ 单维分析 */

  function analyzeDimension(dimId, answers, questions) {
    var dim = null;
    for (var i = 0; i < D.DIMENSIONS.length; i++) {
      if (D.DIMENSIONS[i].id === dimId) dim = D.DIMENSIONS[i];
    }
    if (!dim) return null;

    var pool = (questions || D.QUESTIONS).filter(function (q) { return q.dim === dimId; });
    var levelValues = [];
    var phaseValues = [];
    var basisQ = null;

    pool.forEach(function (q) {
      var v = answers[q.id];
      if (v === undefined || v === null || v === '') return;
      if (q.kind === 'level') {
        levelValues.push(Number(v));
        if (!basisQ) basisQ = q;
      } else {
        phaseValues.push(v);
      }
    });

    if (!levelValues.length && !phaseValues.length) return null;

    var level = levelValues.length ? pickLevel(levelValues) : 2;
    var phase = phaseValues.length ? pickPhase(phaseValues) : 'u';

    var lc = D.LEVEL_CONTENT[dimId][level];
    var pc = D.PHASE_CONTENT[dimId][phase];

    // 判断依据：该维度第一道阶段题 + 用户当时的选项，供报告透明展示
    var basis = null;
    if (basisQ) {
      var chosen = null;
      basisQ.options.forEach(function (o) {
        if (String(o.v) === String(answers[basisQ.id])) chosen = o;
      });
      if (chosen) {
        basis = {
          index: pool.indexOf(basisQ) + 1,
          question: basisQ.text,
          answer: chosen.t
        };
      }
    }

    return {
      id: dimId,
      name: dim.name,
      en: dim.en,
      level: level,
      levelName: lc.name,
      levelLabel: levelLabel(level, lc.name),
      levelSummary: lc.summary,
      phase: phase,
      phaseName: pc.name,
      phaseEn: pc.en,
      phaseLabel: pc.name + ' · ' + pc.en,
      phaseSummary: pc.summary,
      strengths: lc.strengths.slice(),
      watch: [lc.watch[0], pc.watch[0]],
      advice: lc.advice + pc.tip,
      adviceLevel: lc.advice,
      advicePhase: pc.tip,
      basis: basis,
      questionCount: pool.length,
      answeredCount: levelValues.length + phaseValues.length
    };
  }

  /* ------------------------------------------------------------ 整体类型 */

  function pickMetatype(rows) {
    if (rows.length < 4) return null;

    var levels = rows.map(function (r) { return r.level; });
    var max = Math.max.apply(null, levels);
    var min = Math.min.apply(null, levels);
    var avg = levels.reduce(function (a, b) { return a + b; }, 0) / levels.length;
    var key;

    if (max - min >= 2) key = 'offset';
    else if (avg >= 2.6) key = 'integrated';
    else if (avg <= 1.4) key = 'starting';
    else if (max === min) key = 'balanced';
    else {
      // 取发展程度最高的维度；若并列，按 心智 → 身体 → 关系 → 职业 的顺序
      key = rows.filter(function (r) { return r.level === max; })[0].id;
    }

    var meta = D.METATYPES[key];
    return { key: key, name: meta.name, desc: meta.desc };
  }

  function pickArchetype(rows) {
    if (rows.length < 4) return null;

    var levels = rows.map(function (r) { return r.level; });
    var max = Math.max.apply(null, levels);
    var min = Math.min.apply(null, levels);
    var domId;
    var phase;

    if (max === min) {
      domId = 'balanced';
      var counts = countBy(rows.map(function (r) { return r.phase; }));
      var best = Math.max(counts.d || 0, counts.u || 0, counts.f || 0);
      var order = ['u', 'd', 'f'];
      phase = 'u';
      for (var i = 0; i < order.length; i++) {
        if ((counts[order[i]] || 0) === best) { phase = order[i]; break; }
      }
    } else {
      var domRow = rows.filter(function (r) { return r.level === max; })[0];
      domId = domRow.id;
      phase = domRow.phase;
    }

    var arch = D.ARCHETYPES[domId][phase];
    var domName = domId === 'balanced' ? '四个维度整体' : '「' + rows.filter(function (r) { return r.id === domId; })[0].name + '」';
    var phaseName = D.PHASE_CONTENT[domId === 'balanced' ? 'mind' : domId][phase].name;

    return {
      name: arch.name,
      desc: arch.desc,
      basis: '由' + domName + '的发展程度与「' + phaseName + '」组合得到'
    };
  }

  /* 跨维度联动：只取最高与最低两个维度之间的关系 */
  function pickLinkage(rows) {
    if (rows.length < 4) return null;

    var levels = rows.map(function (r) { return r.level; });
    var max = Math.max.apply(null, levels);
    var min = Math.min.apply(null, levels);

    if (max === min) {
      var b = D.LINKAGE.balanced;
      return { key: 'balanced', title: b.title, read: b.read, question: b.question, strong: null, weak: null };
    }

    var strong = rows.filter(function (r) { return r.level === max; })[0];
    var weak = rows.filter(function (r) { return r.level === min; })[0];
    var item = D.LINKAGE[strong.id + '>' + weak.id];
    if (!item) return null;

    return {
      key: strong.id + '>' + weak.id,
      title: item.title,
      read: item.read,
      question: item.question,
      strong: strong.name,
      weak: weak.name,
      strongId: strong.id,
      weakId: weak.id
    };
  }

  function pickCrossAdvice(rows, linkage) {
    if (!linkage) return null;

    if (linkage.key === 'balanced') {
      return {
        priority: null,
        text: '四个维度的发展程度接近，没有明显的短板。建议先选一个你最想改变的维度，给它一个三个月的具体目标；其余三个保持现状，不要同时开战——同时用力通常一个都稳不住。'
      };
    }

    var weak = rows.filter(function (r) { return r.id === linkage.weakId; })[0];
    var strong = rows.filter(function (r) { return r.id === linkage.strongId; })[0];

    return {
      priority: weak.name,
      text: '如果只先动一处，建议从「' + weak.name + '」开始：' + D.LEVERAGE[weak.id] +
        '同时，把「' + strong.name + '」维持在现在的水平就好，不必再加码——四个维度同时用力，通常一个都稳不住。'
    };
  }

  /* ------------------------------------------------------------ 总览文案 */

  function stageSentence(rows) {
    var levels = rows.map(function (r) { return r.level; });
    var max = Math.max.apply(null, levels);
    var min = Math.min.apply(null, levels);

    if (rows.length === 1) {
      return '「' + rows[0].name + '」目前处在' + rows[0].levelLabel + '。';
    }
    if (max === min) {
      var same = rows.filter(function (r) { return r.level === max; })[0];
      return '这些维度的发展阶段相当接近，都落在' + same.levelLabel + '附近。';
    }
    var top = rows.filter(function (r) { return r.level === max; })[0];
    var low = rows.filter(function (r) { return r.level === min; })[0];
    return '其中「' + top.name + '」走得最前（' + top.levelLabel + '），「' + low.name + '」相对靠后（' + low.levelLabel + '）。';
  }

  function phaseSentence(rows) {
    var counts = countBy(rows.map(function (r) { return r.phase; }));
    var best = Math.max(counts.d || 0, counts.u || 0, counts.f || 0);
    var order = ['u', 'd', 'f'];
    var phase = 'u';
    for (var i = 0; i < order.length; i++) {
      if ((counts[order[i]] || 0) === best) { phase = order[i]; break; }
    }
    var map = {
      d: '转变的主线是失调期：你已经感到不对，但还没找到出口。',
      u: '转变的主线是不确定期：旧的方式已经松动，新的还没定型。',
      f: '转变的主线是发现期：方向大致清楚，重点是把它做深。'
    };
    return map[phase];
  }

  function buildOverview(rows, allDims) {
    var names = rows.map(function (r) { return '「' + r.name + '」'; });
    var nameText = names.length > 1
      ? names.slice(0, -1).join('、') + '和' + names[names.length - 1]
      : names[0];
    var parts = [];

    if (allDims) {
      parts.push('你这次完成了全部四个维度。');
      parts.push(stageSentence(rows));
      parts.push(phaseSentence(rows));
      parts.push('以下判断都来自这一次的回答，样本很小，请把它当成一面镜子，而不是一份结论。');
    } else {
      parts.push('你这次只完成了' + nameText + '，所以下面的内容只针对这部分展开。');
      parts.push(stageSentence(rows));
      parts.push('因为缺少其余维度的回答，元类型、生活方式原型和跨维度分析都无法判断——目前信息不足，这里不做推测。');
    }

    return parts.join('');
  }

  /* ------------------------------------------------------------ 生成报告 */

  function buildReport(input) {
    var plan = input.plan;
    var dims = input.dims.slice();
    var answers = input.answers;
    var planMeta = D.PLANS[plan];
    var questions = input.questions || questionsFor(plan, dims);

    var rows = [];
    dims.forEach(function (id) {
      var row = analyzeDimension(id, answers, questions);
      if (row) rows.push(row);
    });

    var allDims = rows.length === 4;
    var metatype = allDims ? pickMetatype(rows) : null;
    var archetype = allDims ? pickArchetype(rows) : null;
    var linkage = allDims ? pickLinkage(rows) : null;
    var crossAdvice = allDims ? pickCrossAdvice(rows, linkage) : null;
    var note = String(input.note || '').trim();
    var missingDetail = allDims ? null :
      '元类型、生活方式原型与跨维度分析需要四个维度全部完成才能生成；你这次完成了 ' +
      rows.length + ' 个维度，缺少' +
      D.DIMENSIONS.filter(function (d) { return dims.indexOf(d.id) === -1; })
        .map(function (d) { return '「' + d.name + '」'; }).join('、') +
      '。未作答的维度不会被补全，也不会被猜测。';

    return {
      plan: plan,
      planName: planMeta.name,
      planMinutes: planMeta.minutes,
      generatedAt: input.now || new Date(),
      dims: dims,
      allDims: allDims,
      overview: buildOverview(rows, allDims),
      rows: rows,
      metatype: metatype,
      archetype: archetype,
      linkage: linkage,
      crossAdvice: crossAdvice,
      missingDetail: missingDetail,
      missingNote: allDims ? null : '目前信息不足，无法可靠判断。' + missingDetail,
      note: note,
      disclaimer: DISCLAIMER,
      aiNote: planMeta.aiNote
    };
  }

  /* ------------------------------------------------------------ 纯文本版 */

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function formatTime(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function toText(report) {
    var lines = [];
    lines.push('Human3.0人生评估 · ' + report.planName);
    lines.push('生成时间：' + formatTime(report.generatedAt));
    lines.push('完成维度：' + report.rows.map(function (r) { return r.name; }).join('、'));
    lines.push('');
    lines.push('【说明】');
    lines.push(report.disclaimer);
    lines.push('');
    lines.push('【总览】');
    lines.push(report.overview);
    lines.push('');

    if (report.metatype) {
      lines.push('【元类型】' + report.metatype.name);
      lines.push(report.metatype.desc);
      lines.push('');
      lines.push('【生活方式原型】' + report.archetype.name);
      lines.push(report.archetype.desc);
      lines.push('（' + report.archetype.basis + '）');
      lines.push('');

      lines.push('【跨维度 · 核心议题】' + (report.linkage.title || ''));
      lines.push(report.linkage.read);
      lines.push('可以带走的问题：' + report.linkage.question);
      lines.push('');

      lines.push('【跨维度建议】');
      lines.push(report.crossAdvice.text);
      lines.push('');
    } else {
      lines.push('【元类型 / 生活方式原型 / 跨维度分析】');
      lines.push(report.missingNote);
      lines.push('');
    }

    report.rows.forEach(function (r) {
      lines.push('【' + r.name + '】（本维度 ' + r.questionCount + ' 题）');
      lines.push('发展阶段：' + r.levelLabel);
      lines.push(r.levelSummary);
      lines.push('转变阶段：' + r.phaseLabel);
      lines.push(r.phaseSummary);
      lines.push('优势：');
      r.strengths.forEach(function (s) { lines.push('- ' + s); });
      lines.push('值得关注：');
      r.watch.forEach(function (s) { lines.push('- ' + s); });
      lines.push('给你的建议：');
      lines.push(r.advice);
      if (r.basis) {
        lines.push('判断依据：第 ' + r.basis.index + ' 题「' + r.basis.question + '」→ 你的选择「' + r.basis.answer + '」');
      }
      lines.push('');
    });

    if (report.note) {
      lines.push('【你补充的背景】');
      lines.push(report.note);
      lines.push('（以上为你自己写下的内容，未参与任何判断）');
      lines.push('');
    }

    lines.push('【关于 AI】');
    lines.push(report.aiNote);
    lines.push('');
    lines.push('理论来源：Dan Koe, HUMAN 3.0 — A Complete Knowledge Base of HUMAN 3.0 / Prompt: HUMAN 3.0 Self-Discovery and ...');

    return lines.join('\n');
  }

  root.H30Logic = {
    questionsFor: questionsFor,
    missingQuestions: missingQuestions,
    analyzeDimension: analyzeDimension,
    buildReport: buildReport,
    toText: toText,
    formatTime: formatTime,
    DISCLAIMER: DISCLAIMER
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.H30Logic;
  }
})(typeof window !== 'undefined' ? window : globalThis);
