/* ==========================================================================
 * Human3.0人生评估 —— AI 深聊控制器（合并后的单流程）
 * --------------------------------------------------------------------------
 * 32 题 → 初步画像 → AI 深聊（4–8 问）→ 最终报告。
 * Key 不在前端：页面只调用站点维护者的云函数代理，代理持有 Key。
 * 对话只存在内存里，刷新即清空（不写浏览器存储）。
 * ========================================================================== */
(function (root) {
  var D = root.H30Data, AI = root.H30AI;
  var CFG = root.HUMAN30_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };

  var MAX_TURNS = (AI && AI.MAX_TURNS) || 8;

  var state = {
    messages: [],      // 展示/接口共用：以 assistant 的第一问开始
    report: null,      // AI 最终报告
    ruleReport: null,  // 规则引擎初步报告
    payload: null,     // { answers, questions, note, report }
    code: '',          // 兑换码：只存内存，刷新即失效
    busy: false,
    finished: false
  };

  var pendingRetry = null;   // 兑换码通过后要重试的动作

  var counterReady = false;

  /* ------------------------------------------------------------ 基础工具 */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function turnCount() {
    return state.messages.filter(function (m) { return m.role === 'assistant'; }).length;
  }

  function proxyUrl() {
    return String(CFG.AI_PROXY_URL || '').trim();
  }

  function apiMessages() {
    var context = AI.buildContext(state.payload || {});
    return [{ role: 'user', content: context }].concat(state.messages);
  }

  /* ------------------------------------------------------------ 网络层 */

  function friendlyError(status, msg) {
    if (status === 401) return 'AI 服务的 Key 无效（401）。请联系站点维护者。';
    if (status === 402) return 'AI 服务的额度不足（402）。请联系站点维护者。';
    if (status === 403) return '当前来源不被允许（403）。请联系站点维护者。';
    if (status === 429) return '现在使用的人有点多（429），请稍等一两分钟再试。';
    if (status >= 500) return 'AI 服务暂时不可用（' + status + '）。稍后再试。';
    return msg || ('请求失败（' + status + '）');
  }

  function netErr(e) {
    if (e && e.name === 'TypeError') {
      return '请求没能发出：网络中断，或 AI 代理还没配置。';
    }
    return (e && e.message) || '未知错误，请重试。';
  }

  /* 规则引擎的权威判定：AI 只解释不改判，报告里这些字段以此为准 */
  function ruleExpected() {
    var r = state.ruleReport || {};
    return {
      metatype: r.metatype && r.metatype.name,
      archetype: r.archetype && r.archetype.name,
      accelerator: r.accelerator,
      coreQuadrant: r.coreQuadrant
    };
  }

  function callModel(messages, isRetry) {
    var url = proxyUrl();
    if (!url) {
      return Promise.reject(new Error('AI 深聊还没有配置代理地址（AI_PROXY_URL 为空）。'));
    }
    var body = {
      messages: [{ role: 'system', content: AI.buildSystemPrompt() }].concat(messages),
      temperature: 0.25,
      max_tokens: 4096
    };
    var headers = { 'Content-Type': 'application/json' };
    if (state.code) headers['X-Access-Code'] = state.code;

    // 25 秒超时，超时自动重试一次；重试仍失败才把可读错误抛给上层
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 25000) : null;

    return fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      if (timer) clearTimeout(timer);
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) {
          var m = j && j.error && (j.error.message || j.error);
          if (j && j.error && j.error.code === 'ACCESS_CODE') {
            var codeErr = new Error(m || '兑换码无效或未填写，请检查后重试');
            codeErr.needCode = true;
            throw codeErr;
          }
          throw new Error(friendlyError(r.status, m));
        }
        if (j && typeof j.content === 'string' && j.content) return j.content;
        var c = j && j.choices && j.choices[0] && j.choices[0].message;
        if (c && c.content) return c.content;
        throw new Error('AI 返回了空内容，请重试。');
      });
    }).catch(function (e) {
      if (timer) clearTimeout(timer);
      if (e && e.name === 'AbortError' && !isRetry) return callModel(messages, true);
      if (e && e.name === 'AbortError') {
        throw new Error('AI 响应超过 25 秒未返回，自动重试后仍未返回。请检查网络，稍后再试。');
      }
      throw e;
    });
  }

  /* ------------------------------------------------------------ 访谈屏 */

  function renderMessages() {
    var html = '<div class="ai-row ai"><div class="ai-bubble">' + esc(AI.OPENING).replace(/\n/g, '<br>') + '</div></div>';
    html += state.messages.map(function (m) {
      var who = m.role === 'user' ? 'user' : 'ai';
      return '<div class="ai-row ' + who + '"><div class="ai-bubble">' + esc(m.content).replace(/\n/g, '<br>') + '</div></div>';
    }).join('');
    if (state.busy) {
      html += '<div class="ai-row ai"><div class="ai-bubble ai-thinking">正在思考…</div></div>';
    }
    $('aiMsgList').innerHTML = html;
    var box = $('aiMsgList');
    box.scrollTop = box.scrollHeight;
  }

  function updateChatMeta() {
    var t = turnCount();
    var maxed = t >= MAX_TURNS;
    var info = $('aiChatMeta');
    if (info) {
      info.innerHTML = '已追问 <b>' + t + '</b> / ' + MAX_TURNS + ' 轮' +
        (maxed ? ' · <span class="ai-done">已达上限，请生成报告</span>' :
          (state.finished ? ' · <span class="ai-done">可以生成报告了</span>' : ''));
    }
    var send = $('aiSend');
    if (send) send.disabled = state.busy || maxed;
    var input = $('aiInput');
    if (input) {
      input.disabled = state.busy || maxed;
      input.placeholder = maxed
        ? '已达 ' + MAX_TURNS + ' 轮上限，请点击下方「生成最终报告」'
        : '用真实经历回答，不用理想中的自己回答……';
    }
    var fin = $('aiFinish');
    if (fin) {
      var done = state.finished || maxed;
      fin.disabled = state.busy || !state.messages.length;
      fin.classList.toggle('btn-primary', done);
      fin.classList.toggle('btn-ghost', !done);
      fin.textContent = done ? '生成最终报告' : '结束深聊并生成报告';
    }
  }

  function showChatErr(msg, retry) {
    var el = $('aiChatErr');
    el.innerHTML = '<span>' + esc(msg) + '</span>' +
      (retry ? '<button class="btn btn-ghost btn-sm" type="button" id="aiRetry">重试</button>' : '') +
      '<button class="btn btn-ghost btn-sm" type="button" id="aiBackPrelim">返回初步画像</button>';
    el.hidden = false;
    var btn = $('aiRetry');
    if (btn) btn.addEventListener('click', function () { el.hidden = true; if (retry) retry(); });
    var back = $('aiBackPrelim');
    if (back) back.addEventListener('click', function () { if (root.H30App) root.H30App.go('prelim'); });
  }

  /* 兑换码门禁：云函数返回 ACCESS_CODE 时弹出输入框，并记住待重试的动作。
   * 码只写进内存（state.code），不使用任何浏览器存储。 */
  function showCodeBox(retry, msg) {
    pendingRetry = retry || null;
    var err = $('aiCodeErr');
    if (msg) { err.textContent = msg; err.hidden = false; } else { err.textContent = ''; err.hidden = true; }
    $('aiCodeBox').hidden = false;
    $('aiInputBar').hidden = true;
    $('aiFinishRow').hidden = true;
    $('aiCodeInput').value = '';
    $('aiCodeInput').focus();
  }

  function hideCodeBox() {
    $('aiCodeBox').hidden = true;
    $('aiInputBar').hidden = false;
    $('aiFinishRow').hidden = false;
  }

  function submitCode() {
    var v = String($('aiCodeInput').value || '').trim();
    var err = $('aiCodeErr');
    if (!v) { err.textContent = '请输入兑换码'; err.hidden = false; return; }
    state.code = v;
    hideCodeBox();
    var retry = pendingRetry;
    pendingRetry = null;
    if (retry) retry();
  }

  function mountChat() {
    renderMessages();
    $('aiInput').value = '';
    $('aiChatErr').hidden = true;
    updateChatMeta();
  }

  /* 第一问：把 32 题上下文作为一条 user 消息发出去，让模型直接问第一个问题 */
  function askFirst() {
    if (state.busy) return;
    state.busy = true;
    state.finished = false;
    updateChatMeta();
    renderMessages();
    callModel(apiMessages()).then(function (reply) {
      state.messages.push({ role: 'assistant', content: reply });
      state.busy = false;
      updateChatMeta();
      renderMessages();
    }).catch(function (e) {
      state.busy = false;
      updateChatMeta();
      renderMessages();
      if (e && e.needCode) { showCodeBox(askFirst, e.message); return; }
      showChatErr(netErr(e), askFirst);
    });
  }

  function sendUser(text) {
    text = String(text || '').trim();
    if (!text || state.busy || turnCount() >= MAX_TURNS) return;
    state.messages.push({ role: 'user', content: text });
    state.busy = true;
    updateChatMeta();
    renderMessages();
    $('aiInput').value = '';

    callModel(apiMessages()).then(function (reply) {
      state.messages.push({ role: 'assistant', content: reply });
      state.busy = false;
      updateChatMeta();
      renderMessages();

      // 模型若已输出报告 json，直接进入最终报告
      var parsed = AI.parseReport(reply, ruleExpected());
      if (parsed.ok) {
        state.report = parsed.data;
        state.finished = true;
        renderReport();
        if (root.H30App) root.H30App.go('ai-report');
        return;
      }
      if (reply.indexOf('访谈完成') !== -1) state.finished = true;
      updateChatMeta();
    }).catch(function (e) {
      state.busy = false;
      updateChatMeta();
      renderMessages();
      if (e && e.needCode) {
        state.messages.pop(); // 移除未成功发送的用户消息，避免重复
        showCodeBox(function () { sendUser(text); }, e.message);
        return;
      }
      showChatErr(netErr(e), function () {
        state.messages.pop(); // 移除未成功发送的用户消息，避免重复
        sendUser(text);
      });
    });
  }

  function finishInterview(isRetry) {
    if (state.busy || !state.messages.length) return;
    state.busy = true;
    updateChatMeta();
    renderMessages();
    var trigger = { role: 'user', content: '请现在输出最终报告的 json。' };

    callModel(apiMessages().concat([trigger])).then(function (reply) {
      var parsed = AI.parseReport(reply, ruleExpected());
      state.busy = false;
      if (!parsed.ok && !isRetry) {
        // 枚举校验失败：自动重试一次，仍失败才提示用户手动重试
        updateChatMeta();
        renderMessages();
        finishInterview(true);
        return;
      }
      state.messages.push(trigger);
      state.messages.push({ role: 'assistant', content: reply });
      if (!parsed.ok) {
        state.finished = true;
        updateChatMeta();
        renderMessages();
        showChatErr('报告解析失败：' + parsed.error + '。可以再点一次「生成最终报告」重试。', finishInterview);
        return;
      }
      state.report = parsed.data;
      state.finished = true;
      updateChatMeta();
      renderReport();
      if (root.H30App) root.H30App.go('ai-report');
    }).catch(function (e) {
      state.busy = false;
      updateChatMeta();
      renderMessages();
      if (e && e.needCode) { showCodeBox(finishInterview, e.message); return; }
      showChatErr(netErr(e), finishInterview);
    });
  }

  function startInterview(payload) {
    state.payload = payload || {};
    state.ruleReport = state.payload.report || null;
    state.messages = [];
    state.report = null;
    state.busy = false;
    state.finished = false;
    mountChat();
    if (root.H30App) root.H30App.go('ai-chat');
    askFirst();
  }

  function restart() {
    if (!root.confirm('重新开始这一轮深聊？当前对话与最终报告会被清空。')) return;
    state.messages = [];
    state.report = null;
    state.finished = false;
    state.busy = false;
    mountChat();
    askFirst();
  }

  /* ------------------------------------------------------------ 报告屏 */

  var LEVEL_CN = { 1: '1.0 依赖外部规则', 2: '2.0 形成自己的标准', 3: '3.0 整合与创造' };
  var PHASE_CN = { dissonance: '失调', uncertainty: '不确定', discovery: '发现' };
  var CONF_CN = { high: '高', medium: '中', low: '低' };
  var VERDICT_CN = { hold: '暂不建议使用加速器', caution: '可以谨慎探索', assess: '可以进行有明确目标的风险评估' };

  function qName(id) {
    return (D.DIMENSIONS.filter(function (d) { return d.id === id; })[0] || {}).name || AI.QUADRANT_CN[id] || id;
  }

  function ruleRow(id) {
    if (!state.ruleReport || !state.ruleReport.rows) return null;
    return state.ruleReport.rows.filter(function (r) { return r.id === id; })[0] || null;
  }

  function quadrantCard(q) {
    var strengths = (q.strengths || []).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    var gaps = (q.gaps || []).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    var base = ruleRow(q.id);
    return '<article class="dim-report">' +
      '<div class="dim-report-head"><h3>' + esc(qName(q.id)) + '</h3></div>' +
      '<div class="stage-row">' +
        '<div class="stage-box"><p class="sb-k">发展阶段 · 深聊判断</p><p class="sb-v">' + esc(LEVEL_CN[q.level] || q.level) + '</p></div>' +
        '<div class="stage-box"><p class="sb-k">转变阶段 · 深聊判断</p><p class="sb-v">' + esc(PHASE_CN[q.phase] || q.phase) + '</p></div>' +
        '<div class="stage-box"><p class="sb-k">置信度</p><p class="sb-v">' + esc(CONF_CN[q.confidence] || q.confidence) + '</p></div>' +
      '</div>' +
      (base ? '<p class="summary"><b>规则基线：</b>' + esc(base.levelLabel + ' / ' + base.phaseLabel) + '</p>' : '') +
      '<p class="summary"><b>证据：</b>' + esc(q.evidence) + '</p>' +
      '<p class="r-label">已经形成的优势</p><ul class="r-list">' + (strengths || '<li>（未提及）</li>') + '</ul>' +
      '<p class="r-label">真实缺口</p><ul class="r-list watch">' + (gaps || '<li>（未提及）</li>') + '</ul>' +
      '<p class="summary"><b>可能的虚假成长：</b>' + esc(q.fakeGrowth) + '</p>' +
      '<p class="summary"><b>对其他象限的影响：</b>' + esc(q.crossImpact) + '</p>' +
      '<p class="summary"><b>最值得解决的问题：</b>' + esc(q.priority) + '</p>' +
      (q.uncertain ? '<p class="tc-basis">仍然不确定：' + esc(q.uncertain) + '</p>' : '') +
      '</article>';
  }

  function roadmapBlock(title, rows) {
    return '<div class="rm-block"><h4>' + esc(title) + '</h4><dl class="rm-list">' +
      rows.map(function (r) { return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>'; }).join('') +
      '</dl></div>';
  }

  function renderReport() {
    var r = state.report;
    if (!r) return;
    var m1 = r.roadmap.month1 || {}, m3 = r.roadmap.month3 || {}, y1 = r.roadmap.year1 || {};

    var shapeCn = (root.H30Logic && root.H30Logic.SHAPE_CN) || {};
    var shapeTxt = state.ruleReport && state.ruleReport.shape
      ? (shapeCn[state.ruleReport.shape] || state.ruleReport.shape)
      : null;

    $('aiReportMeta').innerHTML =
      '<span>' + esc(new Date().toLocaleString('zh-CN', { hour12: false })) + '</span>' +
      '<span>32 题 + ' + turnCount() + ' 轮深聊</span>' +
      (shapeTxt ? '<span>四维形态：' + esc(shapeTxt) + '</span>' : '') +
      '<span>HUMAN 3.0 深度报告</span>';

    var html = '<p class="report-overview">' + esc(r.metatype.why) + '</p>';

    html += '<div class="type-grid">' +
      '<div class="type-card"><p class="tc-label">元类型</p><h3>' + esc(r.metatype.name) + '</h3>' +
        '<p>' + esc(r.metatype.unique) + '</p>' +
        '<p class="tc-basis">最强：' + esc(qName(r.metatype.strongest)) + ' · 最弱：' + esc(qName(r.metatype.weakest)) + '<br>依据：' + esc(r.metatype.basis) + '</p></div>' +
      '<div class="type-card"><p class="tc-label">生活方式原型</p><h3>' + esc(r.archetype.name) + '</h3>' +
        '<p>' + esc(r.archetype.driver) + '</p>' +
        '<p class="tc-basis">精力最多：' + esc(qName(r.archetype.mostEnergy)) + ' · 被牺牲：' + esc(qName(r.archetype.sacrificed)) + '<br>' + esc(r.archetype.fit) + '</p></div>' +
      '</div>';

    html += '<div class="linkage-card">' +
      '<p class="tc-label">跨象限 · 动态</p>' +
      '<p class="linkage-read"><b>阻塞点：</b>' + esc(r.crossDynamics.blocker) + '</p>' +
      '<p class="linkage-read"><b>杠杆：</b>' + esc(r.crossDynamics.lever) + '</p>' +
      '<p class="linkage-read"><b>根因：</b>' + esc(r.crossDynamics.rootCause) + '</p>' +
      '<p class="linkage-read"><b>连锁后果：</b>' + esc(r.crossDynamics.chainRisk) + '</p>' +
      '<p class="linkage-q">隐藏模式：' + esc(r.crossDynamics.hiddenPattern) + '</p>' +
      '</div>';

    html += '<div class="core-card">' +
      '<p class="tc-label">核心问题 · 只选一个</p>' +
      '<h3>' + esc(r.coreProblem.what) + '</h3>' +
      '<p class="priority">属于：<b>' + esc(qName(r.coreProblem.quadrant)) + '</b></p>' +
      '<p class="cross-text">' + esc(r.coreProblem.whyRoot) + '</p>' +
      '<p class="cross-text">' + esc(r.coreProblem.impact) + '</p>' +
      '<p class="cross-text">' + esc(r.coreProblem.whyNow) + '</p>' +
      '</div>';

    r.quadrants.forEach(function (q) { html += quadrantCard(q); });

    html += '<div class="actions-card"><h3>行动路线</h3>' +
      roadmapBlock('接下来 24 小时', [['行动', r.roadmap.day1]]) +
      roadmapBlock('接下来 30 天', [['核心目标', m1.goal], ['每日练习', m1.daily], ['每周挑战', m1.weekly],
        ['跨象限支持', m1.crossSupport], ['成功标准', m1.successSignal], ['需要避免', m1.avoid]]) +
      roadmapBlock('接下来 90 天', [['生活方式的变化', m3.change], ['要培养的能力', m3.skill],
        ['防退回旧模式', m3.relapseGuard], ['强项支持弱项', m3.support], ['可观察的变化', m3.signal]]) +
      roadmapBlock('接下来 6-12 个月', [['下一个发展阶段', y1.nextStage], ['新问题', y1.newProblem],
        ['互相支持', y1.interlock], ['未来的生活方式', y1.lifestyle]]) +
      '</div>';

    html += '<div class="note-card"><h3><span class="badge">' + esc(VERDICT_CN[r.accelerator.verdict] || r.accelerator.verdict) + '</span>AI 与加速器</h3>' +
      '<p class="summary"><b>当前最缺少的基础：</b>' + esc(r.accelerator.missingBase) + '</p>' +
      '<p class="summary"><b>AI 应该如何被使用：</b>' + esc(r.accelerator.aiUse) + '</p>' +
      '<p class="summary"><b>避免思考外包：</b>' + esc(r.accelerator.outsourcingRisk) + '</p>' +
      '<p class="summary"><b>依赖信号：</b>' + esc(r.accelerator.dependencySignals) + '</p></div>';

    if (r.comparable && r.comparable.length) {
      html += '<div class="note-card" style="margin-top:12px"><h3>可比的类型</h3><ul class="r-list">' +
        r.comparable.map(function (x) {
          return '<li><b>' + esc(x.name) + '</b>：' + esc(x.similar) + '；' + esc(x.difference) + '</li>';
        }).join('') + '</ul></div>';
    }

    html += '<div class="note-card" style="margin-top:12px"><h3>关键警告</h3>' +
      '<ul class="r-list watch">' +
      '<li><b>回归触发点：</b>' + esc(r.warnings.regressionTrigger) + '</li>' +
      '<li><b>虚假成长陷阱：</b>' + esc(r.warnings.fakeGrowthTrap) + '</li>' +
      '<li><b>跨象限连锁风险：</b>' + esc(r.warnings.chainRisk) + '</li>' +
      '<li><b>最容易自我欺骗的地方：</b>' + esc(r.warnings.selfDeception) + '</li>' +
      '</ul></div>';

    html += '<div class="ai-feedback"><p class="tc-label">最后的真实反馈</p>' +
      '<p>' + esc(r.finalFeedback).replace(/\n/g, '<br>') + '</p></div>';

    html += '<div class="report-ai"><strong>关于这份报告：</strong>它由 AI 访谈官基于你的 32 题答案和 ' + turnCount() +
      ' 轮深聊生成，内容出自模型判断，可能出错或不完整；它不是心理、医疗或职业诊断。' +
      '<br>你的回答和对话只发送给本站配置的模型服务商，用于生成本次报告；本站不额外留存。</div>';

    $('aiReportBody').innerHTML = html;
  }

  function reportToText() {
    var r = state.report;
    if (!r) return '';
    var L = [];
    L.push('HUMAN 3.0 深度报告');
    L.push('生成时间：' + new Date().toLocaleString('zh-CN', { hour12: false }) + ' · 32 题 + ' + turnCount() + ' 轮深聊');
    L.push('');
    L.push('【元类型】' + r.metatype.name);
    L.push(r.metatype.why);
    L.push('独特之处：' + r.metatype.unique);
    L.push('最强：' + qName(r.metatype.strongest) + ' · 最弱：' + qName(r.metatype.weakest));
    L.push('依据：' + r.metatype.basis);
    L.push('');
    L.push('【生活方式原型】' + r.archetype.name);
    L.push('驱动：' + r.archetype.driver);
    L.push('精力最多：' + qName(r.archetype.mostEnergy) + ' · 被牺牲：' + qName(r.archetype.sacrificed));
    L.push('生活方式问题：' + r.archetype.problem);
    L.push('');
    L.push('【四个象限】');
    r.quadrants.forEach(function (q) {
      var base = ruleRow(q.id);
      L.push('—— ' + qName(q.id) + '（' + (LEVEL_CN[q.level] || q.level) + ' / ' + (PHASE_CN[q.phase] || q.phase) +
        ' / 置信度 ' + (CONF_CN[q.confidence] || q.confidence) + '）');
      if (base) L.push('规则基线：' + base.levelLabel + ' / ' + base.phaseLabel);
      L.push('证据：' + q.evidence);
      L.push('优势：' + (q.strengths || []).join('；'));
      L.push('缺口：' + (q.gaps || []).join('；'));
      L.push('可能的虚假成长：' + q.fakeGrowth);
      L.push('对其他象限的影响：' + q.crossImpact);
      L.push('最值得解决：' + q.priority);
      if (q.uncertain) L.push('仍不确定：' + q.uncertain);
      L.push('');
    });
    L.push('【跨象限动态】');
    L.push('阻塞点：' + r.crossDynamics.blocker);
    L.push('杠杆：' + r.crossDynamics.lever);
    L.push('根因：' + r.crossDynamics.rootCause);
    L.push('连锁后果：' + r.crossDynamics.chainRisk);
    L.push('隐藏模式：' + r.crossDynamics.hiddenPattern);
    L.push('');
    L.push('【核心问题】' + r.coreProblem.what);
    L.push('属于：' + qName(r.coreProblem.quadrant));
    L.push(r.coreProblem.whyRoot);
    L.push(r.coreProblem.impact);
    L.push(r.coreProblem.whyNow);
    L.push('');
    L.push('【行动路线】');
    L.push('24 小时：' + r.roadmap.day1);
    L.push('30 天 · 目标：' + (r.roadmap.month1 || {}).goal);
    L.push('30 天 · 每日：' + (r.roadmap.month1 || {}).daily);
    L.push('30 天 · 每周：' + (r.roadmap.month1 || {}).weekly);
    L.push('30 天 · 跨象限支持：' + (r.roadmap.month1 || {}).crossSupport);
    L.push('30 天 · 成功标准：' + (r.roadmap.month1 || {}).successSignal);
    L.push('30 天 · 需要避免：' + (r.roadmap.month1 || {}).avoid);
    L.push('90 天 · 变化：' + (r.roadmap.month3 || {}).change);
    L.push('90 天 · 能力：' + (r.roadmap.month3 || {}).skill);
    L.push('90 天 · 防退回：' + (r.roadmap.month3 || {}).relapseGuard);
    L.push('90 天 · 支持关系：' + (r.roadmap.month3 || {}).support);
    L.push('90 天 · 可观察变化：' + (r.roadmap.month3 || {}).signal);
    L.push('6-12 个月 · 下一阶段：' + (r.roadmap.year1 || {}).nextStage);
    L.push('6-12 个月 · 新问题：' + (r.roadmap.year1 || {}).newProblem);
    L.push('6-12 个月 · 互相支持：' + (r.roadmap.year1 || {}).interlock);
    L.push('6-12 个月 · 生活方式：' + (r.roadmap.year1 || {}).lifestyle);
    L.push('');
    L.push('【AI 与加速器】' + (VERDICT_CN[r.accelerator.verdict] || r.accelerator.verdict));
    L.push('最缺少的基础：' + r.accelerator.missingBase);
    L.push('AI 的使用方式：' + r.accelerator.aiUse);
    L.push('避免思考外包：' + r.accelerator.outsourcingRisk);
    L.push('依赖信号：' + r.accelerator.dependencySignals);
    L.push('');
    if (r.comparable && r.comparable.length) {
      L.push('【可比的类型】');
      r.comparable.forEach(function (x) {
        L.push('- ' + x.name + '：' + x.similar + '；' + x.difference);
      });
      L.push('');
    }
    L.push('【关键警告】');
    L.push('回归触发点：' + r.warnings.regressionTrigger);
    L.push('虚假成长陷阱：' + r.warnings.fakeGrowthTrap);
    L.push('跨象限连锁风险：' + r.warnings.chainRisk);
    L.push('最容易自我欺骗的地方：' + r.warnings.selfDeception);
    L.push('');
    L.push('【最后的真实反馈】');
    L.push(r.finalFeedback);
    L.push('');
    L.push('—— 本报告由 AI 基于 32 题答案与 ' + turnCount() + ' 轮深聊生成，仅供自我探索参考，' +
      '不是心理、医疗或职业诊断。理论框架参考 Dan Koe 的 HUMAN 3.0。');
    return L.join('\n');
  }

  function copyReport() {
    var text = reportToText();
    var done = function () {
      var btn = $('aiReportCopy');
      if (!btn) return;
      var old = btn.textContent;
      btn.textContent = '已复制';
      setTimeout(function () { btn.textContent = old; }, 1600);
    };
    if (root.navigator.clipboard && root.navigator.clipboard.writeText) {
      root.navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    } else {
      fallbackCopy(text); done();
    }
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* 忽略 */ }
    document.body.removeChild(ta);
  }

  /* ---------------------------------------------------- 完成率计数器 */

  function ensureCounter() {
    var url = CFG.GOATCOUNTER_URL;
    if (!url || counterReady) return;
    counterReady = true;
    var s = document.createElement('script');
    s.src = url.replace(/\/$/, '') + '/count.js';
    s.async = true;
    s.dataset.goatcounter = 'https://' + url.replace(/^https?:\/\//, '').replace(/\/$/, '') + '/count';
    document.head.appendChild(s);
  }

  function countView(name) {
    if (!CFG.GOATCOUNTER_URL || !root.goatcounter || !root.goatcounter.count) return;
    try {
      root.goatcounter.count({ path: root.location.pathname + '#' + name, no_events: true });
    } catch (e) { /* 计数器不可用时静默 */ }
  }

  /* ------------------------------------------------------------ 初始化 */

  function init() {
    $('aiSend').addEventListener('click', function () { sendUser($('aiInput').value); });
    $('aiInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendUser($('aiInput').value);
      }
    });
    $('aiFinish').addEventListener('click', finishInterview);
    $('aiRestartChat').addEventListener('click', restart);

    $('aiCodeBtn').addEventListener('click', submitCode);
    $('aiCodeInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submitCode(); }
    });

    $('aiReportCopy').addEventListener('click', copyReport);
    $('aiReportRestart').addEventListener('click', function () {
      restart();
      if (root.H30App) root.H30App.go('ai-chat');
    });
    $('aiReportBack').addEventListener('click', function () {
      if (root.H30App) root.H30App.go('landing');
    });
  }

  function onScreen(name) {
    if (name !== 'ai-chat' && name !== 'ai-report') return;
    ensureCounter();
    countView(name);
    if (name === 'ai-chat') mountChat();
    if (name === 'ai-report') renderReport();
  }

  root.H30Chat = {
    init: init,
    onScreen: onScreen,
    startInterview: startInterview,
    restart: restart,
    state: state
  };
})(typeof window !== 'undefined' ? window : globalThis);
