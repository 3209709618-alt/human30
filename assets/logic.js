/* ==========================================================================
 * Human3.0人生评估 —— 规则引擎
 * --------------------------------------------------------------------------
 * 纯函数：输入回答，输出报告。不涉及 DOM，不发起任何网络请求。
 * 规则全部为预设规则，不使用 AI，也不输出数字分数。
 * ========================================================================== */

(function (root) {
  'use strict';

  var D = root.H30Data;

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

  function analyzeDimension(dimId, answers) {
    var dim = null;
    for (var i = 0; i < D.DIMENSIONS.length; i++) {
      if (D.DIMENSIONS[i].id === dimId) dim = D.DIMENSIONS[i];
    }
    if (!dim) return null;

    var levelValues = [];
    var phaseValues = [];

    D.QUESTIONS.forEach(function (q) {
      if (q.dim !== dimId) return;
      var v = answers[q.id];
      if (v === undefined || v === null || v === '') return;
      if (q.kind === 'level') levelValues.push(Number(v));
      else phaseValues.push(v);
    });

    if (!levelValues.length && !phaseValues.length) return null;

    var level = levelValues.length ? pickLevel(levelValues) : 2;
    var phase = phaseValues.length ? pickPhase(phaseValues) : 'u';

    var lc = D.LEVEL_CONTENT[dimId][level];
    var pc = D.PHASE_CONTENT[dimId][phase];

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
      next: [lc.next[0]].concat(pc.next),
      levelNext: lc.next[0],
      phaseNext: pc.next.slice()
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
      parts.push('你这次探索了全部四个维度。');
      parts.push(stageSentence(rows));
      parts.push(phaseSentence(rows));
    } else {
      parts.push('你这次只探索了' + nameText + '，所以下面的内容只针对这部分展开。');
      parts.push(stageSentence(rows));
      parts.push('因为缺少其余维度的回答，整体类型与生活方式原型无法判断——这不是你的问题，只是信息不足，报告不会替你猜测。');
    }

    return parts.join('');
  }

  /* ------------------------------------------------------------ 生成报告 */

  function buildReport(input) {
    var plan = input.plan;
    var dims = input.dims.slice();
    var answers = input.answers;
    var planMeta = D.PLANS[plan];

    var rows = [];
    dims.forEach(function (id) {
      var row = analyzeDimension(id, answers);
      if (row) rows.push(row);
    });

    var allDims = rows.length === 4;
    var metatype = pickMetatype(rows);
    var archetype = pickArchetype(rows);

    // 近期行动：优先取发展程度较低维度的“阶段建议”，不足三条时用相位建议补齐
    var actions = [];
    rows.slice().sort(function (a, b) { return a.level - b.level; })
      .forEach(function (r) { actions.push(r.levelNext); });
    if (actions.length < 3) {
      rows.forEach(function (r) {
        r.phaseNext.forEach(function (n) {
          if (actions.length < 3) actions.push(n);
        });
      });
    }
    actions = actions.slice(0, 3);

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
      missingNote: allDims
        ? null
        : '元类型与生活方式原型需要四个维度的回答才能生成。你这次探索了 ' +
          rows.length + ' 个维度，缺少' +
          D.DIMENSIONS.filter(function (d) { return dims.indexOf(d.id) === -1; })
            .map(function (d) { return '「' + d.name + '」'; }).join('、') +
          '，因此这里不做推断。',
      actions: actions,
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
    lines.push('探索维度：' + report.rows.map(function (r) { return r.name; }).join('、'));
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
    } else {
      lines.push('【元类型 / 生活方式原型】');
      lines.push(report.missingNote);
      lines.push('');
    }

    report.rows.forEach(function (r) {
      lines.push('【' + r.name + '】');
      lines.push('发展阶段：' + r.levelLabel);
      lines.push(r.levelSummary);
      lines.push('转变阶段：' + r.phaseLabel);
      lines.push(r.phaseSummary);
      lines.push('优势：');
      r.strengths.forEach(function (s) { lines.push('- ' + s); });
      lines.push('值得关注：');
      r.watch.forEach(function (s) { lines.push('- ' + s); });
      lines.push('下一步：');
      r.next.forEach(function (s, i) { lines.push((i + 1) + '. ' + s); });
      lines.push('');
    });

    lines.push('【未来两周可以先做的三件事】');
    report.actions.forEach(function (s, i) { lines.push((i + 1) + '. ' + s); });
    lines.push('');
    lines.push('说明：本报告由预设规则生成，仅供自我探索参考，不是心理诊断，也不是经过验证的客观测评。');
    lines.push('回答仅在当前页面流程中使用，不上传、不保存。');
    lines.push('AI 提示：' + report.aiNote);

    return lines.join('\n');
  }

  root.H30Logic = {
    questionsFor: questionsFor,
    missingQuestions: missingQuestions,
    analyzeDimension: analyzeDimension,
    buildReport: buildReport,
    toText: toText,
    formatTime: formatTime
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.H30Logic;
  }
})(typeof window !== 'undefined' ? window : globalThis);
