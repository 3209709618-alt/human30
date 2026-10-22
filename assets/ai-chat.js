/* ==========================================================================
 * Human3.0人生评估 —— AI 深聊版控制器
 * --------------------------------------------------------------------------
 * 设置屏（服务商与 Key）→ 访谈屏（对话循环）→ 报告屏（结构化渲染）。
 * 状态只存 localStorage（docs/adr/0003）；Key 不经服务端（docs/adr/0002）。
 * ========================================================================== */
(function (root) {
  var D = root.H30Data, AI = root.H30AI;
  var LS_KEY = 'h30.ai.v1';
  var CFG = root.HUMAN30_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };

  /* 预设只收「支持浏览器直连」的服务商：CORS 预检必须放行 Authorization 头。
   * 智谱 open.bigmodel.cn 实测预检不返回 Allow-Headers，浏览器会直接拦截，
   * 因此不列入预设；用户在自定义里填了智谱地址时会收到明确提示。 */
  var PROVIDERS = [
    { id: 'siliconflow', name: '硅基流动', tag: '注册送 ¥14 额度 · 推荐',
      desc: '一个 Key 调用多家模型，国内直连。默认 GLM-5.3-Flash，额度用完可换平台上的免费小模型。',
      baseUrl: 'https://api.siliconflow.cn/v1', model: 'zai-org/GLM-5.3-Flash',
      signup: 'https://siliconflow.cn/' },
    { id: 'deepseek', name: 'DeepSeek', tag: '更强 · 需小额充值',
      desc: '官方接口，模型质量高。适合对免费档不满意之后切换。',
      baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat',
      signup: 'https://platform.deepseek.com/' },
    { id: 'tongyi', name: '通义千问', tag: '新用户有免费额度',
      desc: '阿里云百炼的 OpenAI 兼容接口，新用户可领免费额度。',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus',
      signup: 'https://bailian.console.aliyun.com/' },
    { id: 'custom', name: '自定义', tag: '任意 OpenAI 兼容接口',
      desc: '接口地址和模型名自己填，兼容 /chat/completions 协议的服务都可以。',
      baseUrl: '', model: '', signup: '' }
  ];

  var state = { settings: null, messages: [], report: null, finished: false, busy: false };
  var lastCall = null;
  var counterReady = false;

  /* ------------------------------------------------------------ 基础工具 */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function load() {
    try { return JSON.parse(root.localStorage.getItem(LS_KEY)) || {}; } catch (e) { return {}; }
  }

  function save() {
    try { root.localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { /* 隐私模式下忽略 */ }
  }

  function provider(id) {
    for (var i = 0; i < PROVIDERS.length; i++) if (PROVIDERS[i].id === id) return PROVIDERS[i];
    return PROVIDERS[0];
  }

  function turnCount() {
    return state.messages.filter(function (m) { return m.role === 'user'; }).length;
  }

  /* ------------------------------------------------------------ 设置屏 */

  function renderSetup() {
    var saved = load();
    var cur = (saved.settings && saved.settings.provider) || 'zhipu';
    var p = provider(cur);

    $('aiProviderList').innerHTML = PROVIDERS.map(function (x) {
      var on = x.id === cur;
      return '<button class="ai-provider' + (on ? ' is-active' : '') + '" type="button" data-pv="' + x.id + '" aria-pressed="' + on + '">' +
        '<span class="ap-top"><span class="ap-name">' + esc(x.name) + '</span><span class="ap-tag">' + esc(x.tag) + '</span></span>' +
        '<span class="ap-desc">' + esc(x.desc) + '</span>' +
        (x.signup ? '<span class="ap-link">注册 / 获取 Key：' + esc(x.signup.replace(/^https?:\/\//, '')) + '</span>' : '') +
        '</button>';
    }).join('');

    $('aiBaseUrl').value = (saved.settings && saved.settings.baseUrl) || p.baseUrl;
    $('aiModel').value = (saved.settings && saved.settings.model) || p.model;
    $('aiKey').value = (saved.settings && saved.settings.key) || '';
    renderConsent(p);
    $('aiSetupErr').hidden = true;
    showResume();
  }

  /* 有历史对话时，设置屏提供「继续上次」而不是只能清空重来 */
  function showResume() {
    var saved = load();
    var turns = (saved.messages || []).filter(function (m) { return m.role === 'user'; }).length;
    var row = $('aiResumeRow');
    if (turns > 0) {
      row.hidden = false;
      $('aiResume').textContent = '继续上次访谈（已聊 ' + turns + ' 轮）';
      $('aiSetupStart').textContent = '开始新访谈';
    } else {
      row.hidden = true;
      $('aiSetupStart').textContent = '开始访谈';
    }
    $('aiResumeReport').hidden = !saved.report;
  }

  function resumeInterview() {
    var saved = load();
    if (!saved.settings) return;
    state.settings = saved.settings;
    state.messages = saved.messages || [];
    state.report = saved.report || null;
    state.finished = !!saved.finished;
    state.busy = false;
    lastCall = null;
    mountChat();
    if (root.H30App) root.H30App.go('ai-chat');
  }

  function viewLastReport() {
    var saved = load();
    if (!saved.report) return;
    state.settings = saved.settings;
    state.messages = saved.messages || [];
    state.report = saved.report;
    state.finished = true;
    renderReport();
    if (root.H30App) root.H30App.go('ai-report');
  }

  function renderConsent(p) {
    $('aiConsentText').innerHTML =
      '开始即表示你理解并同意：' +
      '<b>①</b> 你的回答将通过浏览器直接发送到你选择的模型服务商（当前：<b>' + esc(p.name) + '</b>），' +
      '我们不接收、不留存、不转发；' +
      '<b>②</b> 对话记录只保存在你这台设备的浏览器里，清除浏览器数据或更换设备都会永久丢失；' +
      '<b>③</b> 页面包含一个无 Cookie 的访问量计数器，只记录页面流转，不记录任何回答内容。';
  }

  function chooseProvider(id) {
    var p = provider(id);
    $('aiProviderList').querySelectorAll('[data-pv]').forEach(function (btn) {
      var on = btn.getAttribute('data-pv') === id;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', String(on));
    });
    $('aiBaseUrl').value = p.baseUrl;
    $('aiModel').value = p.model;
    renderConsent(p);
    $('aiSetupErr').hidden = true;
  }

  function collectSettings() {
    var pv = $('aiProviderList').querySelector('.ai-provider.is-active');
    var id = pv ? pv.getAttribute('data-pv') : 'zhipu';
    var baseUrl = $('aiBaseUrl').value.trim().replace(/\/+$/, '');
    var model = $('aiModel').value.trim();
    var key = $('aiKey').value.trim();
    var err = '';

    if (/bigmodel\.cn/.test(baseUrl)) {
      err = '智谱的 API 不支持浏览器直连：它的跨域预检不放行 Authorization 头，请求会被浏览器拦下。请改用硅基流动、DeepSeek 或通义千问。';
    } else if (!key) err = '请填写 API Key。没有 Key 请先到服务商官网注册（卡片上有地址）。';
    else if (!/^https?:\/\//.test(baseUrl)) err = '接口地址格式不对，应以 http:// 或 https:// 开头。';
    else if (!model) err = '请填写模型名。';

    if (err) {
      $('aiSetupErr').textContent = err;
      $('aiSetupErr').hidden = false;
      return null;
    }
    return { provider: id, providerName: provider(id).name, baseUrl: baseUrl, model: model, key: key };
  }

  function startInterview() {
    var s = collectSettings();
    if (!s) return;
    state.settings = s;
    state.messages = [];
    state.report = null;
    state.finished = false;
    state.busy = false;
    lastCall = null;
    save();
    mountChat();
    if (root.H30App) root.H30App.go('ai-chat');
  }

  /* ------------------------------------------------------------ 访谈屏 */

  function mountChat() {
    var saved = load();
    if (!state.settings && saved.settings) state.settings = saved.settings;
    if (!state.messages.length && saved.messages) state.messages = saved.messages;
    if (!state.report && saved.report) state.report = saved.report;
    if (saved.finished) state.finished = saved.finished;

    // 首次进入：开场白由本地渲染，不消耗一次 API 调用
    if (!state.messages.length) {
      state.messages.push({ role: 'assistant', content: AI.OPENING });
      save();
    }
    renderMessages();
    $('aiInput').value = '';
    $('aiChatErr').hidden = true;
    updateChatMeta();
  }

  function renderMessages() {
    var html = state.messages.map(function (m) {
      var who = m.role === 'user' ? 'user' : 'ai';
      var body = esc(m.content).replace(/\n/g, '<br>');
      return '<div class="ai-row ' + who + '"><div class="ai-bubble">' + body + '</div></div>';
    }).join('');
    $('aiMsgList').innerHTML = html;
    var box = $('aiMsgList');
    box.scrollTop = box.scrollHeight;
  }

  function updateChatMeta() {
    var info = $('aiChatMeta');
    if (!info) return;
    var t = turnCount();
    info.innerHTML = '已聊 <b>' + t + '</b> 轮 · 上限 16 问' +
      (state.finished ? ' · <span class="ai-done">可以生成报告了</span>' : '');
    var fin = $('aiFinish');
    if (fin) {
      fin.classList.toggle('btn-primary', state.finished);
      fin.classList.toggle('btn-ghost', !state.finished);
      fin.textContent = state.finished ? '生成报告' : '结束访谈并生成报告';
    }
  }

  function friendlyError(status, msg) {
    if (status === 401) return 'Key 无效或已过期（401）。请确认复制完整、没有多余空格。';
    if (status === 402) return '账户余额不足（402）。免费档通常不会出现这个，检查是否选错了服务商。';
    if (status === 429) return '触发限流（429）。免费额度有频率限制，等一两分钟再试。';
    if (status >= 500) return '服务商暂时不可用（' + status + '）。稍后再试，或换一家服务商。';
    return msg || ('请求失败（' + status + '）');
  }

  /* 网络层失败（请求根本没发出去或被浏览器拦截）时说人话 */
  function netErr(e) {
    if (e && e.name === 'TypeError') {
      return '请求没能发出（浏览器层拦截）。常见原因：该服务商不支持网页直连（如智谱）、网络中断、或被浏览器插件拦截。可重试，或换一家服务商。';
    }
    return (e && e.message) || '未知错误，请重试。';
  }

  function callModel() {
    var s = state.settings;
    var body = {
      model: s.model,
      messages: [{ role: 'system', content: AI.buildSystemPrompt() }].concat(state.messages),
      temperature: 0.7,
      max_tokens: 4096
    };
    return fetch(s.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.key },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(friendlyError(r.status, j && j.error && j.error.message));
        var c = j && j.choices && j.choices[0] && j.choices[0].message;
        if (!c || !c.content) throw new Error('服务商返回了空内容，请重试。');
        return c.content;
      });
    });
  }

  function showChatErr(msg, retry) {
    $('aiChatErr').innerHTML = '<span>' + esc(msg) + '</span>' +
      (retry ? '<button class="btn btn-ghost btn-sm" type="button" id="aiRetry">重试</button>' : '');
    $('aiChatErr').hidden = false;
    var btn = $('aiRetry');
    if (btn) btn.addEventListener('click', function () {
      $('aiChatErr').hidden = true;
      if (retry) retry();
    });
  }

  function sendUser(text) {
    text = String(text || '').trim();
    if (!text || state.busy) return;
    state.messages.push({ role: 'user', content: text });
    state.busy = true;
    save();
    renderMessages();
    updateChatMeta();
    $('aiInput').value = '';

    lastCall = function () {
      return callModel().then(function (reply) {
        state.messages.push({ role: 'assistant', content: reply });
        if (reply.indexOf('访谈完成') !== -1) state.finished = true;
        state.busy = false;
        save();
        renderMessages();
        updateChatMeta();
      }).catch(function (e) {
        state.busy = false;
        updateChatMeta();
        showChatErr(netErr(e), lastCall);
      });
    };
    return lastCall();
  }

  function finishInterview() {
    if (state.busy) return;
    if (!state.messages.length) return;
    state.busy = true;
    updateChatMeta();
    var trigger = { role: 'user', content: '请现在输出最终报告的 json。' };
    var before = state.messages.slice();

    lastCall = function () {
      state.messages = before.concat([trigger]);
      return callModel().then(function (reply) {
        var parsed = AI.parseReport(reply);
        if (!parsed.ok) {
          state.busy = false;
          updateChatMeta();
          showChatErr('报告解析失败：' + parsed.error + '。可以再点一次「生成报告」重试。', lastCall);
          return;
        }
        state.report = parsed.data;
        state.busy = false;
        state.finished = true;
        save();
        renderReport();
        if (root.H30App) root.H30App.go('ai-report');
      }).catch(function (e) {
        state.busy = false;
        updateChatMeta();
        showChatErr(netErr(e), lastCall);
      });
    };
    return lastCall();
  }

  function restart() {
    if (!root.confirm('重新开始一轮访谈？当前对话与报告会被清空。')) return;
    state.messages = [];
    state.report = null;
    state.finished = false;
    state.busy = false;
    lastCall = null;
    save();
    mountChat();
  }

  /* ------------------------------------------------------------ 报告屏 */

  var LEVEL_CN = { 1: '1.0 依赖外部规则', 2: '2.0 形成自己的标准', 3: '3.0 整合与创造' };
  var PHASE_CN = { dissonance: '失调', uncertainty: '不确定', discovery: '发现' };
  var CONF_CN = { high: '高', medium: '中', low: '低' };
  var VERDICT_CN = { hold: '暂不建议使用加速器', caution: '可以谨慎探索', assess: '可以进行有明确目标的风险评估' };

  function qName(id) { return (D.DIMENSIONS.filter(function (d) { return d.id === id; })[0] || {}).name || AI.QUADRANT_CN[id] || id; }

  function quadrantCard(q) {
    var strengths = (q.strengths || []).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    var gaps = (q.gaps || []).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    return '<article class="dim-report">' +
      '<div class="dim-report-head"><h3>' + esc(qName(q.id)) + '</h3></div>' +
      '<div class="stage-row">' +
        '<div class="stage-box"><p class="sb-k">发展阶段</p><p class="sb-v">' + esc(LEVEL_CN[q.level] || q.level) + '</p></div>' +
        '<div class="stage-box"><p class="sb-k">转变阶段</p><p class="sb-v">' + esc(PHASE_CN[q.phase] || q.phase) + '</p></div>' +
        '<div class="stage-box"><p class="sb-k">置信度</p><p class="sb-v">' + esc(CONF_CN[q.confidence] || q.confidence) + '</p></div>' +
      '</div>' +
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

    $('aiReportMeta').innerHTML =
      '<span>' + esc(new Date().toLocaleString('zh-CN', { hour12: false })) + '</span>' +
      '<span>AI 深聊版 · ' + turnCount() + ' 轮对话</span>' +
      '<span>' + esc(state.settings.providerName) + ' · ' + esc(state.settings.model) + '</span>';

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

    html += '<div class="note-card" style="margin-top:12px"><h3>关键警告</h3>' +
      '<ul class="r-list watch">' +
      '<li><b>回归触发点：</b>' + esc(r.warnings.regressionTrigger) + '</li>' +
      '<li><b>虚假成长陷阱：</b>' + esc(r.warnings.fakeGrowthTrap) + '</li>' +
      '<li><b>跨象限连锁风险：</b>' + esc(r.warnings.chainRisk) + '</li>' +
      '<li><b>最容易自我欺骗的地方：</b>' + esc(r.warnings.selfDeception) + '</li>' +
      '</ul></div>';

    html += '<div class="ai-feedback"><p class="tc-label">最后的真实反馈</p>' +
      '<p>' + esc(r.finalFeedback).replace(/\n/g, '<br>') + '</p></div>';

    html += '<div class="report-ai"><strong>关于这份报告：</strong>由 AI 访谈官根据 ' + turnCount() +
      ' 轮对话生成，内容出自模型判断，可能出错或不完整；它同样不是心理、医疗或职业诊断。' +
      '<br>你的回答已通过浏览器直接发送至 ' + esc(state.settings.providerName) +
      '，我们未接收、未留存；对话记录只保存在本机浏览器。</div>';

    $('aiReportBody').innerHTML = html;
  }

  function reportToText() {
    var r = state.report;
    if (!r) return '';
    var L = [];
    L.push('HUMAN 3.0 多维发展评估（AI 深聊版）');
    L.push('生成时间：' + new Date().toLocaleString('zh-CN', { hour12: false }) + ' · ' + turnCount() + ' 轮对话');
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
      L.push('—— ' + qName(q.id) + '（' + (LEVEL_CN[q.level] || q.level) + ' / ' + (PHASE_CN[q.phase] || q.phase) +
        ' / 置信度 ' + (CONF_CN[q.confidence] || q.confidence) + '）');
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
    L.push('【关键警告】');
    L.push('回归触发点：' + r.warnings.regressionTrigger);
    L.push('虚假成长陷阱：' + r.warnings.fakeGrowthTrap);
    L.push('跨象限连锁风险：' + r.warnings.chainRisk);
    L.push('最容易自我欺骗的地方：' + r.warnings.selfDeception);
    L.push('');
    L.push('【最后的真实反馈】');
    L.push(r.finalFeedback);
    L.push('');
    L.push('—— 本报告由 AI 根据 ' + turnCount() + ' 轮对话生成，仅供自我探索参考，' +
      '不是心理、医疗或职业诊断，也不是经过验证的客观测评。理论框架参考 Dan Koe 的 HUMAN 3.0。');
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

  /* ---------------------------------------------------- 完成率计数器（ADR-0005） */

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
    $('aiProviderList').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-pv]');
      if (btn) chooseProvider(btn.getAttribute('data-pv'));
    });
    $('aiSetupStart').addEventListener('click', startInterview);
    $('aiSetupBack').addEventListener('click', function () {
      if (root.H30App) root.H30App.go('landing');
    });
    $('aiResume').addEventListener('click', resumeInterview);
    $('aiResumeReport').addEventListener('click', viewLastReport);

    $('aiSend').addEventListener('click', function () {
      sendUser($('aiInput').value);
    });
    $('aiInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendUser($('aiInput').value);
      }
    });
    $('aiFinish').addEventListener('click', function () { finishInterview(); });
    $('aiRestartChat').addEventListener('click', restart);

    $('aiReportCopy').addEventListener('click', copyReport);
    $('aiReportRestart').addEventListener('click', function () {
      restart();
      if (root.H30App) root.H30App.go('ai-chat');
    });
    $('aiReportBack').addEventListener('click', function () {
      if (root.H30App) root.H30App.go('landing');
    });
  }

  /* 由 app.js 的 go() 在切屏时调用 */
  function onScreen(name) {
    if (name.indexOf('ai-') !== 0) return;
    ensureCounter();
    countView(name);
    if (name === 'ai-setup') renderSetup();
    if (name === 'ai-chat') mountChat();
    if (name === 'ai-report') renderReport();
  }

  root.H30Chat = {
    init: init,
    onScreen: onScreen,
    renderSetup: renderSetup,
    startInterview: startInterview,
    restart: restart,
    state: state
  };
})(typeof window !== 'undefined' ? window : globalThis);
