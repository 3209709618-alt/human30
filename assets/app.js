/* ==========================================================================
 * Human3.0人生评估 —— 页面逻辑
 * --------------------------------------------------------------------------
 * 说明：
 * - 全部计算在浏览器本地完成，没有任何 fetch / XHR / WebSocket 请求。
 * - 回答只保存在内存变量里，不写入任何浏览器存储（本地存储、会话存储、Cookie），
 *   刷新或关闭页面即清空。
 * - 不接入支付，不接入 AI，不包含任何密钥。
 * ========================================================================== */

(function () {
  'use strict';

  var D = window.H30Data;
  var L = window.H30Logic;

  var CFG = Object.assign({
    ACCESS_CODE: 'han0220',
    SITE_NAME: 'Human3.0人生评估',
    SHOW_CODE_HINT: false
  }, window.HUMAN30_CONFIG || {});

  /* ------------------------------------------------------------- 状态 */

  var state = {
    plan: null,
    unlocked: false,
    dims: D.DIM_ORDER.slice(),
    mode: 'step',
    answers: {},
    questions: [],
    idx: 0,
    report: null,
    screen: 'landing'
  };

  /* ------------------------------------------------------------- 工具 */

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function dimById(id) {
    for (var i = 0; i < D.DIMENSIONS.length; i++) {
      if (D.DIMENSIONS[i].id === id) return D.DIMENSIONS[i];
    }
    return null;
  }

  function answeredCount() {
    return state.questions.filter(function (q) {
      return state.answers[q.id] !== undefined;
    }).length;
  }

  var toastTimer = null;
  function toast(msg) {
    var el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2200);
  }

  var modalHandler = null;
  function openModal(title, text, onOk) {
    $('modalTitle').textContent = title;
    $('modalText').textContent = text;
    $('modal').hidden = false;
    modalHandler = onOk;
    $('modalOk').focus();
  }
  function closeModal() {
    $('modal').hidden = true;
    modalHandler = null;
  }

  /* ------------------------------------------------------------- 路由 */

  var SCREENS = ['landing', 'gate', 'setup', 'quiz', 'report'];

  function go(name) {
    state.screen = name;
    SCREENS.forEach(function (s) {
      var el = $('screen-' + s);
      if (el) el.hidden = (s !== name);
    });
    document.body.classList.toggle('is-quiz', name === 'quiz');
    window.scrollTo(0, 0);
    updateChrome();
  }

  function updateChrome() {
    var pill = $('planPill');
    if (state.plan) {
      var p = D.PLANS[state.plan];
      pill.hidden = false;
      pill.textContent = p.name + ' · ' + p.minutes;
    } else {
      pill.hidden = true;
    }
    $('btnRestartTop').hidden = !(state.plan && state.screen !== 'landing' && state.screen !== 'gate');
  }

  /* ------------------------------------------------------- 版本与入口 */

  function readPlanFromUrl() {
    var p = null;
    try {
      p = new URLSearchParams(window.location.search).get('plan');
    } catch (e) { p = null; }
    return (p && D.PLANS[p]) ? p : null;
  }

  function writePlanToUrl(plan) {
    try {
      var url = new URL(window.location.href);
      url.searchParams.set('plan', plan);
      window.history.replaceState({}, '', url.toString());
    } catch (e) { /* file:// 等环境下忽略 */ }
  }

  function renderPlans() {
    var wrap = $('planGrid');
    wrap.innerHTML = D.PLAN_ORDER.map(function (id) {
      var p = D.PLANS[id];
      var active = state.plan === id;
      return '' +
        '<button class="plan-card' + (active ? ' is-active' : '') + '" type="button" data-plan="' + id + '"' +
        ' aria-label="选择' + esc(p.name) + '">' +
        (active ? '<span class="pc-badge">当前入口</span>' : '') +
        '<span class="pc-top"><span class="pc-name">' + esc(p.name) + '</span><span class="pc-time">' + esc(p.minutes) + '</span></span>' +
        '<span class="pc-tag">' + esc(p.tagline) + '</span>' +
        '<span class="pc-desc">' + esc(p.desc) + '</span>' +
        '<span class="pc-link">?plan=' + id + '</span>' +
        '</button>';
    }).join('');
  }

  function updateLanding() {
    var hint = $('heroPlanHint');
    var start = $('heroStart');
    if (state.plan) {
      var p = D.PLANS[state.plan];
      hint.textContent = '当前入口：' + p.name + ' · ' + p.minutes + '（链接参数 ?plan=' + state.plan + '）';
      start.textContent = '开始' + p.name;
    } else {
      hint.textContent = '还没有选择版本。三个版本题目数量和时长不同，可以在下面挑一个。';
      start.textContent = '选择版本';
    }
    renderPlans();
  }

  function choosePlan(id) {
    if (!D.PLANS[id]) return;
    if (state.plan !== id) {
      // 换版本时清空旧回答，避免不同版本之间串题
      state.answers = {};
      state.report = null;
      state.idx = 0;
    }
    state.plan = id;
    writePlanToUrl(id);
    updateLanding();
    go(state.unlocked ? 'setup' : 'gate');
    if (state.unlocked) renderSetup();
    else renderGate();
  }

  /* ------------------------------------------------------------- 访问码 */

  function renderGate() {
    var p = D.PLANS[state.plan];
    $('gatePlanLabel').textContent = '你正在进入：' + p.name + '（' + p.minutes + '）。三个版本共用同一个访问码。';
    $('gateHint').textContent = CFG.SHOW_CODE_HINT
      ? '演示用访问码：' + CFG.ACCESS_CODE + '。这是纯前端演示，只能用于流程测试，不构成真实的付费权限或安全保护。'
      : '这是纯前端演示，访问码写在前端配置里，只能用于流程演示，不构成真实的付费权限或安全保护。';
    $('gateInput').value = '';
    $('gateError').hidden = true;
    $('gateField').classList.remove('has-error');
  }

  function submitGate(e) {
    e.preventDefault();
    var val = $('gateInput').value.trim();
    if (!val) {
      showGateError('请输入访问码。');
      return;
    }
    if (val.toLowerCase() === String(CFG.ACCESS_CODE).trim().toLowerCase()) {
      state.unlocked = true;
      $('gateError').hidden = true;
      $('gateField').classList.remove('has-error');
      renderSetup();
      go('setup');
    } else {
      showGateError('访问码不正确，请向站点维护者确认。');
      $('gateInput').select();
    }
  }

  function showGateError(msg) {
    var err = $('gateError');
    err.textContent = msg;
    err.hidden = false;
    $('gateField').classList.add('has-error');
  }

  /* ------------------------------------------------------------- 设置 */

  function renderSetup() {
    var p = D.PLANS[state.plan];
    $('setupPlanLabel').textContent = p.name + ' · ' + p.minutes;
    $('setupIntro').textContent = p.desc;
    $('dimBlock').hidden = !p.allowsDimensionChoice;

    var wrap = $('dimChoices');
    wrap.innerHTML = D.DIMENSIONS.map(function (d) {
      var on = state.dims.indexOf(d.id) !== -1;
      return '<button class="dim-choice" type="button" data-dim="' + d.id + '" aria-pressed="' + on + '">' +
        '<span class="box" aria-hidden="true"></span>' +
        '<span><span class="dc-t">' + esc(d.name) + '</span><span class="dc-s">' + esc(d.short) + '</span></span>' +
        '</button>';
    }).join('');

    $('modeChoices').querySelectorAll('[data-mode]').forEach(function (btn) {
      btn.setAttribute('aria-pressed', String(btn.getAttribute('data-mode') === state.mode));
    });

    $('dimError').hidden = true;
    $('modeStepNum').textContent = p.allowsDimensionChoice ? '2' : '1';
    updateSetupSummary();
  }

  function updateSetupSummary() {
    var p = D.PLANS[state.plan];
    var dims = p.allowsDimensionChoice ? state.dims : D.DIM_ORDER.slice();
    var qs = L.questionsFor(state.plan, dims);
    var answered = qs.filter(function (q) { return state.answers[q.id] !== undefined; }).length;
    var modeText = state.mode === 'step' ? '逐题模式' : '分组填写';

    $('setupSummary').innerHTML =
      '<span>版本：<b>' + esc(p.name) + '</b></span>' +
      '<span>维度：<b>' + dims.length + ' 个</b></span>' +
      '<span>题量：<b>' + qs.length + ' 题</b></span>' +
      '<span>方式：<b>' + modeText + '</b></span>' +
      (answered > 0 ? '<span>已答：<b>' + answered + ' 题</b></span>' : '');

    $('setupStart').textContent = answered > 0 ? '继续答题' : '开始答题';
    $('setupAiNote').textContent = p.aiNote;
  }

  function toggleDim(id) {
    var i = state.dims.indexOf(id);
    if (i === -1) state.dims.push(id);
    else state.dims.splice(i, 1);
    // 保持维度顺序稳定
    state.dims.sort(function (a, b) { return D.DIM_ORDER.indexOf(a) - D.DIM_ORDER.indexOf(b); });
    $('dimError').hidden = true;
    renderSetupDimsOnly();
    updateSetupSummary();
  }

  function renderSetupDimsOnly() {
    $('dimChoices').querySelectorAll('[data-dim]').forEach(function (btn) {
      btn.setAttribute('aria-pressed', String(state.dims.indexOf(btn.getAttribute('data-dim')) !== -1));
    });
  }

  function startQuiz() {
    var p = D.PLANS[state.plan];
    var dims = p.allowsDimensionChoice ? state.dims.slice() : D.DIM_ORDER.slice();

    if (!dims.length) {
      $('dimError').hidden = false;
      return;
    }

    // 报告只统计本次实际作答的维度
    state.dims = dims.slice();
    state.questions = L.questionsFor(state.plan, dims);
    if (!state.questions.length) return;

    // 只保留本次题目范围内的回答
    var keep = {};
    state.questions.forEach(function (q) { keep[q.id] = true; });
    Object.keys(state.answers).forEach(function (k) {
      if (!keep[k]) delete state.answers[k];
    });

    state.idx = 0;
    for (var i = 0; i < state.questions.length; i++) {
      if (state.answers[state.questions[i].id] === undefined) { state.idx = i; break; }
    }

    renderQuiz();
    go('quiz');
  }

  /* ------------------------------------------------------------- 答题 */

  function renderQuiz() {
    $('missingBanner').hidden = true;
    $('stepView').hidden = state.mode !== 'step';
    $('groupView').hidden = state.mode !== 'group';

    if (state.mode === 'step') {
      $('groupView').innerHTML = '';
      renderStep();
    } else {
      $('stepView').innerHTML = '';
      renderGroup();
    }
    renderQuizMeta();
  }

  function renderQuizMeta() {
    var total = state.questions.length;
    var done = answeredCount();
    var pct = total ? Math.round((done / total) * 100) : 0;

    if (state.mode === 'step') {
      var q = state.questions[state.idx];
      var dim = q ? dimById(q.dim) : null;
      $('quizDim').textContent = dim ? dim.name : '';
      $('quizCount').textContent = '第 ' + (state.idx + 1) + ' / ' + total + ' 题';
    } else {
      $('quizDim').textContent = '分组填写';
      $('quizCount').textContent = '已答 ' + done + ' / ' + total;
    }

    $('progressBar').style.width = pct + '%';
    var bar = document.querySelector('.progress');
    if (bar) bar.setAttribute('aria-valuenow', String(pct));
  }

  function optionsHtml(q) {
    var current = state.answers[q.id];
    return q.options.map(function (o, i) {
      var on = String(current) === String(o.v);
      return '<button class="opt" type="button" data-opt="' + i + '" aria-pressed="' + on + '">' +
        '<span class="mark" aria-hidden="true"></span>' +
        '<span>' + esc(o.t) + '</span>' +
        '</button>';
    }).join('');
  }

  function renderStep() {
    var q = state.questions[state.idx];
    if (!q) return;
    var isLast = state.idx === state.questions.length - 1;
    var answered = state.answers[q.id] !== undefined;

    $('stepView').innerHTML = '' +
      '<div class="q-block">' +
        '<h3 class="q-text">' + esc(q.text) + '</h3>' +
        '<div class="opts" role="group" aria-label="选项">' + optionsHtml(q) + '</div>' +
        '<p class="q-hint">选择最接近你现在状态的一项，不用想太久。</p>' +
      '</div>' +
      '<div class="quiz-nav">' +
        '<button class="btn btn-ghost btn-sm" type="button" data-nav="prev"' + (state.idx === 0 ? ' disabled' : '') + '>上一题</button>' +
        '<button class="btn btn-primary" type="button" data-nav="next"' + (answered ? '' : ' disabled') + '>' +
          (isLast ? '生成报告' : '下一题') +
        '</button>' +
      '</div>';

    $('quizFoot').innerHTML = '<span class="qf-info">' + esc(D.PLANS[state.plan].name) + ' · 已答 <b>' +
      answeredCount() + '</b> / ' + state.questions.length + '</span>' +
      '<button class="btn btn-ghost btn-sm" type="button" data-nav="back">返回设置</button>';
  }

  function renderGroup() {
    var indexMap = {};
    state.questions.forEach(function (q, i) { indexMap[q.id] = i; });

    var html = '';
    D.DIM_ORDER.forEach(function (dimId) {
      var qs = state.questions.filter(function (q) { return q.dim === dimId; });
      if (!qs.length) return;
      var dim = dimById(dimId);
      html += '<div class="group-dim-head"><h3>' + esc(dim.name) + '</h3><span>' + qs.length + ' 题</span></div>';
      qs.forEach(function (q) {
        html += '<div class="q-card" data-qid="' + q.id + '">' +
          '<p class="q-index">' + (indexMap[q.id] + 1) + ' / ' + state.questions.length + '</p>' +
          '<h4 class="q-text">' + esc(q.text) + '</h4>' +
          '<div class="opts" role="group" aria-label="选项">' + optionsHtml(q) + '</div>' +
          '</div>';
      });
    });

    $('groupView').innerHTML = html;
    renderGroupFoot();
  }

  function renderGroupFoot() {
    var total = state.questions.length;
    var done = answeredCount();
    $('quizFoot').innerHTML =
      '<span class="qf-info">已答 <b>' + done + '</b> / ' + total + ' 题' +
        (done < total ? '，还有 ' + (total - done) + ' 题' : '，可以生成报告了') + '</span>' +
      '<span class="qf-btns">' +
        '<button class="btn btn-ghost btn-sm" type="button" data-nav="back">返回设置</button>' +
        '<button class="btn btn-primary" type="button" data-nav="submit">生成报告</button>' +
      '</span>';
  }

  function selectOption(btn) {
    var q = state.questions[state.idx];
    var opt = q.options[Number(btn.getAttribute('data-opt'))];
    if (!opt) return;
    state.answers[q.id] = q.kind === 'level' ? Number(opt.v) : opt.v;

    var group = btn.parentNode;
    group.querySelectorAll('[data-opt]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b === btn));
    });

    $('quizFoot').querySelector('.qf-info').innerHTML = esc(D.PLANS[state.plan].name) +
      ' · 已答 <b>' + answeredCount() + '</b> / ' + state.questions.length;

    var next = document.querySelector('[data-nav="next"]');
    if (next) next.disabled = false;
    renderQuizMeta();
  }

  function selectOptionInGroup(btn) {
    var card = btn.closest('.q-card');
    var qid = card.getAttribute('data-qid');
    var q = null;
    state.questions.forEach(function (item) { if (item.id === qid) q = item; });
    if (!q) return;
    var opt = q.options[Number(btn.getAttribute('data-opt'))];
    if (!opt) return;

    state.answers[q.id] = q.kind === 'level' ? Number(opt.v) : opt.v;
    card.querySelectorAll('[data-opt]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b === btn));
    });
    card.classList.remove('is-missing');
    $('missingBanner').hidden = true;
    renderGroupFoot();
    renderQuizMeta();
  }

  function goStep(delta) {
    var next = state.idx + delta;
    if (next < 0 || next >= state.questions.length) return;
    state.idx = next;
    $('missingBanner').hidden = true;
    renderStep();
    renderQuizMeta();
    window.scrollTo(0, 0);
  }

  function showMissing(missing) {
    var banner = $('missingBanner');
    var first = missing[0];
    var idx = state.questions.indexOf(first);

    if (state.mode === 'step') {
      state.idx = idx;
      renderStep();
      renderQuizMeta();
      banner.textContent = '请先回答这一题，再生成报告。';
      banner.hidden = false;
      window.scrollTo(0, 0);
      return;
    }

    banner.textContent = '还有 ' + missing.length + ' 道题没有回答，已标出位置。全部答完后才能生成报告。';
    banner.hidden = false;

    document.querySelectorAll('.q-card').forEach(function (c) { c.classList.remove('is-missing'); });
    missing.forEach(function (q) {
      var card = document.querySelector('.q-card[data-qid="' + q.id + '"]');
      if (card) card.classList.add('is-missing');
    });

    var target = document.querySelector('.q-card[data-qid="' + first.id + '"]');
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function tryGenerate() {
    var missing = L.missingQuestions(state.answers, state.questions);
    if (missing.length) {
      showMissing(missing);
      return;
    }
    generateReport();
  }

  /* ------------------------------------------------------------- 报告 */

  function generateReport() {
    if (!state.plan || !state.questions.length) return;
    state.report = L.buildReport({
      plan: state.plan,
      dims: state.dims,
      answers: state.answers,
      now: new Date()
    });
    renderReport();
    go('report');
  }

  function typeCard(label, name, desc, basis) {
    return '<div class="type-card">' +
      '<p class="tc-label">' + esc(label) + '</p>' +
      '<h3>' + esc(name) + '</h3>' +
      '<p>' + esc(desc) + '</p>' +
      (basis ? '<p class="tc-basis">' + esc(basis) + '</p>' : '') +
      '</div>';
  }

  function dimCardHtml(row) {
    return '<article class="dim-report">' +
      '<div class="dim-report-head">' +
        '<h3>' + esc(row.name) + '<span>' + esc(row.en) + '</span></h3>' +
      '</div>' +
      '<div class="stage-row">' +
        '<div class="stage-box"><p class="sb-k">发展阶段</p><p class="sb-v">' + esc(row.levelLabel) + '</p></div>' +
        '<div class="stage-box"><p class="sb-k">转变阶段</p><p class="sb-v">' + esc(row.phaseLabel) + '</p></div>' +
      '</div>' +
      '<p class="summary">' + esc(row.levelSummary) + '</p>' +
      '<p class="summary">' + esc(row.phaseSummary) + '</p>' +
      '<p class="r-label">优势</p>' +
      '<ul class="r-list">' + row.strengths.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>' +
      '<p class="r-label">值得关注</p>' +
      '<ul class="r-list watch">' + row.watch.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>' +
      '<p class="r-label">下一步</p>' +
      '<ol class="r-list next">' + row.next.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
      '</article>';
  }

  function renderReport() {
    var r = state.report;
    if (!r) return;

    $('reportTitle').textContent = r.planName + ' · 探索报告';
    $('reportMeta').innerHTML =
      '<span>' + esc(L.formatTime(r.generatedAt)) + '</span>' +
      '<span>探索维度：' + r.rows.map(function (x) { return esc(x.name); }).join('、') + '</span>' +
      '<span>' + r.rows.length + ' 个维度 · ' + state.questions.length + ' 道题</span>';

    var html = '<p class="report-overview">' + esc(r.overview) + '</p>';

    if (r.metatype) {
      html += '<div class="type-grid">' +
        typeCard('元类型', r.metatype.name, r.metatype.desc, '由四个维度的发展阶段组合得到，不涉及分数') +
        typeCard('生活方式原型', r.archetype.name, r.archetype.desc, r.archetype.basis) +
        '</div>';
    } else {
      html += '<div class="insufficient">' +
        '<h3>整体类型信息不足</h3>' +
        '<p>' + esc(r.missingNote) + '</p>' +
        '<p style="margin-top:8px">补齐其余维度后重新答题，才会生成元类型与生活方式原型。</p>' +
        '</div>';
    }

    r.rows.forEach(function (row) { html += dimCardHtml(row); });

    html += '<div class="actions-card">' +
      '<h3>未来两周可以先做的三件事</h3>' +
      '<ol class="r-list next">' + r.actions.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
      '</div>';

    html += '<div class="report-ai"><strong>关于 AI：</strong>' + esc(r.aiNote) +
      '<br>当前版本不会发送任何网络请求，回答也没有离开这台设备。</div>';

    $('reportBody').innerHTML = html;
  }

  /* ------------------------------------------------------------- 复制 */

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    toast(ok ? '已复制报告' : '复制失败，请手动选择文本');
  }

  function copyReport() {
    if (!state.report) return;
    var text = L.toText(state.report);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast('已复制报告');
      }).catch(function () {
        fallbackCopy(text);
      });
    } else {
      fallbackCopy(text);
    }
  }

  /* ------------------------------------------------------------- 重置 */

  function askRestart() {
    openModal('重新开始？', '当前所有回答会被清空，且无法恢复。', function () {
      state.answers = {};
      state.report = null;
      state.questions = [];
      state.idx = 0;
      state.dims = D.DIM_ORDER.slice();
      state.mode = 'step';
      closeModal();
      renderSetup();
      go('setup');
      toast('已清空所有回答');
    });
  }

  /* ------------------------------------------------------------- 绑定 */

  function bind() {
    $('brandHome').addEventListener('click', function (e) {
      e.preventDefault();
      go('landing');
    });

    $('heroStart').addEventListener('click', function () {
      if (!state.plan) {
        var plans = $('plans');
        if (plans) plans.scrollIntoView({ behavior: 'smooth', block: 'start' });
        toast('先选一个版本');
        return;
      }
      if (state.unlocked) {
        renderSetup();
        go('setup');
      } else {
        renderGate();
        go('gate');
      }
    });

    $('planGrid').addEventListener('click', function (e) {
      var card = e.target.closest('[data-plan]');
      if (card) choosePlan(card.getAttribute('data-plan'));
    });

    $('gateForm').addEventListener('submit', submitGate);
    $('gateBack').addEventListener('click', function () { go('landing'); });

    $('dimChoices').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-dim]');
      if (btn) toggleDim(btn.getAttribute('data-dim'));
    });
    $('dimAll').addEventListener('click', function () {
      state.dims = D.DIM_ORDER.slice();
      renderSetupDimsOnly();
      $('dimError').hidden = true;
      updateSetupSummary();
    });

    $('modeChoices').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-mode]');
      if (!btn) return;
      state.mode = btn.getAttribute('data-mode');
      $('modeChoices').querySelectorAll('[data-mode]').forEach(function (b) {
        b.setAttribute('aria-pressed', String(b === btn));
      });
      updateSetupSummary();
    });

    $('setupBack').addEventListener('click', function () { go('landing'); });
    $('setupStart').addEventListener('click', startQuiz);

    $('stepView').addEventListener('click', function (e) {
      var opt = e.target.closest('[data-opt]');
      if (opt) { selectOption(opt); return; }
      var nav = e.target.closest('[data-nav]');
      if (!nav) return;
      var action = nav.getAttribute('data-nav');
      if (action === 'prev') goStep(-1);
      if (action === 'next') {
        if (state.idx === state.questions.length - 1) tryGenerate();
        else goStep(1);
      }
    });

    $('groupView').addEventListener('click', function (e) {
      var opt = e.target.closest('[data-opt]');
      if (opt) selectOptionInGroup(opt);
    });

    $('quizFoot').addEventListener('click', function (e) {
      var nav = e.target.closest('[data-nav]');
      if (!nav) return;
      var action = nav.getAttribute('data-nav');
      if (action === 'back') { renderSetup(); go('setup'); }
      if (action === 'submit') tryGenerate();
    });

    $('btnRestartTop').addEventListener('click', askRestart);
    $('btnRestart').addEventListener('click', askRestart);

    $('btnEdit').addEventListener('click', function () {
      if (!state.questions.length) return;
      renderQuiz();
      go('quiz');
    });

    $('btnCopy').addEventListener('click', copyReport);

    $('modalCancel').addEventListener('click', closeModal);
    $('modalOk').addEventListener('click', function () {
      if (typeof modalHandler === 'function') modalHandler();
      else closeModal();
    });
    $('modal').addEventListener('click', function (e) {
      if (e.target === $('modal')) closeModal();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('modal').hidden) closeModal();
    });
  }

  /* ------------------------------------------------------------- 启动 */

  function init() {
    var y = $('year');
    if (y) y.textContent = String(new Date().getFullYear());

    state.plan = readPlanFromUrl();
    bind();
    updateLanding();
    go('landing');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
