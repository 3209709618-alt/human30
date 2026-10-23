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
    SITE_NAME: 'Human3.0人生评估'
  }, window.HUMAN30_CONFIG || {});

  /* ------------------------------------------------------------- 状态 */

  var state = {
    dims: D.DIM_ORDER.slice(),
    answers: {},
    note: '',
    questions: [],
    idx: 0,
    report: null,
    screen: 'landing'
  };

  var advanceTimer = null;

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

  var SCREENS = ['landing', 'setup', 'quiz', 'report', 'ai-setup', 'ai-chat', 'ai-report'];

  function go(name) {
    state.screen = name;
    SCREENS.forEach(function (s) {
      var el = $('screen-' + s);
      if (el) el.hidden = (s !== name);
    });
    document.body.classList.toggle('is-quiz', name === 'quiz');
    window.scrollTo(0, 0);
    updateChrome();
    if (window.H30Chat) window.H30Chat.onScreen(name);
  }

  function updateChrome() {
    var p = D.PLANS.complete;
    var pill = $('planPill');
    pill.hidden = (state.screen === 'landing');
    pill.textContent = p.name + ' · ' + p.minutes;
    $('btnRestartTop').hidden = !(state.screen === 'setup' || state.screen === 'quiz' || state.screen === 'report');
  }

  /* ------------------------------------------------------- 入口与版本 */

  // 只保留完整版：任何 plan 参数都落到完整版，旧链接不会报错
  function canonicalizeUrl() {
    try {
      var url = new URL(window.location.href);
      if (url.searchParams.get('plan') !== 'complete') {
        url.searchParams.set('plan', 'complete');
        window.history.replaceState({}, '', url.toString());
      }
    } catch (e) { /* file:// 等环境下忽略 */ }
  }

  function updateLanding() {
    var p = D.PLANS.complete;
    $('heroStart').textContent = '开始评估';
    $('heroPlanHint').textContent = '32 道题 · 四个维度 · ' + p.minutes + ' · 不上传、不保存';
  }

  /* ------------------------------------------------------------- 设置 */

  function renderSetup() {
    var p = D.PLANS.complete;
    $('setupPlanLabel').textContent = p.name + ' · ' + p.minutes;
    $('setupIntro').textContent = p.desc;
    updateSetupSummary();
  }

  function updateSetupSummary() {
    var qs = L.questionsFor('complete', D.DIM_ORDER);
    var answered = qs.filter(function (q) { return state.answers[q.id] !== undefined; }).length;

    $('setupSummary').innerHTML =
      '<span>维度：<b>4 个</b></span>' +
      '<span>题量：<b>' + qs.length + ' 题</b></span>' +
      '<span>方式：<b>逐题模式</b></span>' +
      '<span>预计：<b>' + D.PLANS.complete.minutes + '</b></span>' +
      (answered > 0 ? '<span>已答：<b>' + answered + ' 题</b></span>' : '');

    $('setupStart').textContent = answered > 0 ? '继续答题' : '开始答题';
    $('setupAiNote').textContent = D.PLANS.complete.aiNote;
  }

  function startQuiz() {
    state.dims = D.DIM_ORDER.slice();
    state.questions = L.questionsFor('complete', D.DIM_ORDER);
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
    clearAdvance();
    $('missingBanner').hidden = true;
    $('quizMap').classList.remove('is-open');
    $('mapToggle').setAttribute('aria-expanded', 'false');
    renderStep();
    renderQuizMeta();
  }

  function renderQuizMeta() {
    var total = state.questions.length;
    var done = answeredCount();
    var pct = total ? Math.round((done / total) * 100) : 0;
    var q = state.questions[state.idx];
    var dim = q ? dimById(q.dim) : null;

    $('quizDim').textContent = dim ? dim.name : '';
    $('quizCount').textContent = '第 ' + (state.idx + 1) + ' / ' + total + ' 题';

    $('progressBar').style.width = pct + '%';
    var bar = document.querySelector('.progress');
    if (bar) bar.setAttribute('aria-valuenow', String(pct));

    var stat = '已答 ' + done + ' / ' + total;
    $('mapStat').textContent = stat;
    $('mapToggleInfo').textContent = stat;
    renderMap();
  }

  /* 右侧答题卡：按维度分组，标出已答 / 未答 / 当前题，可点击跳转 */
  function renderMap() {
    var html = '';
    D.DIM_ORDER.forEach(function (dimId) {
      var items = [];
      state.questions.forEach(function (q, i) {
        if (q.dim === dimId) items.push({ q: q, i: i });
      });
      if (!items.length) return;

      var dim = dimById(dimId);
      var done = items.filter(function (x) { return state.answers[x.q.id] !== undefined; }).length;

      html += '<div class="map-group">' +
        '<p class="map-group-name">' + esc(dim.name) + '<span>' + done + '/' + items.length + '</span></p>' +
        '<div class="map-nums">' +
        items.map(function (x) {
          var answered = state.answers[x.q.id] !== undefined;
          var cls = 'map-num' + (answered ? ' is-done' : '') + (x.i === state.idx ? ' is-current' : '');
          return '<button class="' + cls + '" type="button" data-jump="' + x.i + '" ' +
            'aria-label="第 ' + (x.i + 1) + ' 题，' + (answered ? '已答' : '未答') + '"' +
            (x.i === state.idx ? ' aria-current="true"' : '') + '>' + (x.i + 1) + '</button>';
        }).join('') +
        '</div></div>';
    });
    $('mapGroups').innerHTML = html;
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
        '<p class="q-hint">' + (isLast
          ? '选完后可以补充背景，再生成报告。'
          : '选中后自动进入下一题；想改可以点题号回去。') + '</p>' +
        noteHtml(isLast) +
      '</div>' +
      '<div class="quiz-nav">' +
        '<button class="btn btn-ghost btn-sm" type="button" data-nav="prev"' + (state.idx === 0 ? ' disabled' : '') + '>上一题</button>' +
        '<button class="btn btn-primary" type="button" data-nav="next"' + (answered ? '' : ' disabled') + '>' +
          (isLast ? '生成报告' : '下一题') +
        '</button>' +
      '</div>';

    $('quizFoot').innerHTML = '<span class="qf-info">已答 <b>' +
      answeredCount() + '</b> / ' + state.questions.length + '</span>' +
      '<button class="btn btn-ghost btn-sm" type="button" data-nav="back">返回设置</button>';
  }

  /* 最后一道题下方提供可选笔记；笔记不参与任何判断 */
  function noteHtml(isLast) {
    if (!isLast) return '';
    return '<details class="note-box">' +
      '<summary>补充背景（可选）</summary>' +
      '<p class="note-hint">可以写下你的处境或想补充的信息。笔记不参与阶段判断、类型判断或报告计算，只会在报告里原样附上。</p>' +
      '<textarea id="noteInput" maxlength="600" placeholder="例如：最近刚换了工作，同时在照顾家人，所以时间一直不够用……">' +
        esc(state.note) +
      '</textarea>' +
      '<p class="note-count"><span id="noteCount">' + state.note.length + '</span> / 600</p>' +
      '</details>';
  }

  function clearAdvance() {
    if (advanceTimer) {
      clearTimeout(advanceTimer);
      advanceTimer = null;
    }
  }

  function selectOption(btn) {
    var q = state.questions[state.idx];
    var opt = q.options[Number(btn.getAttribute('data-opt'))];
    if (!opt) return;

    var wasAnswered = state.answers[q.id] !== undefined;
    clearAdvance();

    state.answers[q.id] = q.kind === 'level' ? Number(opt.v) : opt.v;

    btn.parentNode.querySelectorAll('[data-opt]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b === btn));
    });

    var info = $('quizFoot').querySelector('.qf-info');
    if (info) {
      info.innerHTML = '已答 <b>' + answeredCount() + '</b> / ' + state.questions.length;
    }

    var next = document.querySelector('[data-nav="next"]');
    if (next) next.disabled = false;
    renderQuizMeta();

    // 首次作答且不是最后一题：留出选中反馈的时间后自动进入下一题
    var isLast = state.idx === state.questions.length - 1;
    if (!wasAnswered && !isLast) {
      var from = state.idx;
      advanceTimer = setTimeout(function () {
        advanceTimer = null;
        if (state.screen === 'quiz' && state.idx === from) goStep(1);
      }, 320);
    }
  }

  function goStep(delta) {
    jumpTo(state.idx + delta);
  }

  function jumpTo(i) {
    if (i < 0 || i >= state.questions.length) return;
    clearAdvance();
    state.idx = i;
    $('missingBanner').hidden = true;
    $('quizMap').classList.remove('is-open');
    $('mapToggle').setAttribute('aria-expanded', 'false');
    renderStep();
    renderQuizMeta();
    window.scrollTo(0, 0);
  }

  function showMissing(missing) {
    var first = missing[0];
    var idx = state.questions.indexOf(first);
    jumpTo(idx);
    var banner = $('missingBanner');
    banner.textContent = '还有 ' + missing.length + ' 题没有回答，已跳到第 ' + (idx + 1) + ' 题。全部答完后才能生成报告。';
    banner.hidden = false;
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
    if (!state.questions.length) return;
    clearAdvance();
    state.report = L.buildReport({
      answers: state.answers,
      questions: state.questions,
      note: state.note,
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
    var html = '<article class="dim-report">' +
      '<div class="dim-report-head">' +
        '<h3>' + esc(row.name) + '<span>' + esc(row.en) + '</span></h3>' +
        '<span class="dim-qcount">' + row.questionCount + ' 题</span>' +
      '</div>' +
      '<div class="stage-row">' +
        '<div class="stage-box"><p class="sb-k">发展阶段 · 粗略定位</p><p class="sb-v">' + esc(row.levelLabel) + '</p></div>' +
        '<div class="stage-box"><p class="sb-k">转变阶段 · 本次判断</p><p class="sb-v">' + esc(row.phaseLabel) + '</p></div>' +
      '</div>' +
      '<p class="summary">' + esc(row.levelSummary) + '</p>' +
      '<p class="summary">' + esc(row.phaseSummary) + '</p>' +
      '<p class="r-label">优势</p>' +
      '<ul class="r-list">' + row.strengths.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>' +
      '<p class="r-label">值得关注</p>' +
      '<ul class="r-list watch">' + row.watch.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>' +
      '<div class="advice-box">' +
        '<p class="r-label">给你的建议</p>' +
        '<p class="advice-text">' + esc(row.advice) + '</p>' +
      '</div>';

    if (row.basis) {
      html += '<details class="basis">' +
        '<summary>这条判断依据哪道题</summary>' +
        '<p class="basis-q">第 ' + row.basis.index + ' 题：' + esc(row.basis.question) + '</p>' +
        '<p class="basis-a">你的选择：<b>' + esc(row.basis.answer) + '</b></p>' +
        '</details>';
    }

    return html + '</article>';
  }

  function linkageCard(l) {
    return '<div class="linkage-card">' +
      '<p class="tc-label">跨维度 · 核心议题</p>' +
      '<h3>' + esc(l.title) + '</h3>' +
      '<p class="linkage-pair">' +
        (l.strong ? esc(l.strong) + ' 领先 · ' + esc(l.weak) + ' 靠后' : '四个维度发展接近') +
      '</p>' +
      '<p class="linkage-read">' + esc(l.read) + '</p>' +
      '<p class="linkage-q">可以带走的问题：' + esc(l.question) + '</p>' +
      '</div>';
  }

  function renderReport() {
    var r = state.report;
    if (!r) return;

    $('reportTitle').textContent = '你的探索报告';
    $('reportMeta').innerHTML =
      '<span>' + esc(L.formatTime(r.generatedAt)) + '</span>' +
      '<span>四个维度 · ' + state.questions.length + ' 道题</span>';

    var html = '<p class="report-overview">' + esc(r.overview) + '</p>';

    if (r.metatype) {
      html += '<div class="type-grid">' +
        typeCard('元类型', r.metatype.name, r.metatype.desc, '由四个维度的发展阶段组合得到，不涉及分数') +
        typeCard('生活方式原型', r.archetype.name, r.archetype.desc, r.archetype.basis) +
        '</div>';
      html += linkageCard(r.linkage);
      html += '<div class="actions-card">' +
        '<h3>跨维度建议</h3>' +
        (r.crossAdvice.priority ? '<p class="priority">优先处理：<b>' + esc(r.crossAdvice.priority) + '</b></p>' : '') +
        '<p class="cross-text">' + esc(r.crossAdvice.text) + '</p>' +
        '</div>';
    }

    r.rows.forEach(function (row) { html += dimCardHtml(row); });

    if (r.note) {
      html += '<div class="note-report">' +
        '<h3>你补充的背景</h3>' +
        '<p class="note-text">' + esc(r.note) + '</p>' +
        '<p class="tiny">以上是你自己写下的内容，未参与阶段判断、类型判断或报告计算。</p>' +
        '</div>';
    }

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
      clearAdvance();
      state.answers = {};
      state.note = '';
      state.report = null;
      state.questions = [];
      state.idx = 0;
      state.dims = D.DIM_ORDER.slice();
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
      renderSetup();
      go('setup');
    });

    document.querySelectorAll('[data-track]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.getAttribute('data-track') === 'ai') go('ai-setup');
        else { renderSetup(); go('setup'); }
      });
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

    // 可选笔记：只存内存，不参与任何判断
    $('stepView').addEventListener('input', function (e) {
      if (e.target && e.target.id === 'noteInput') {
        state.note = e.target.value;
        var count = $('noteCount');
        if (count) count.textContent = String(state.note.length);
      }
    });

    // 答题卡：点题号跳转
    $('quizMap').addEventListener('click', function (e) {
      var num = e.target.closest('[data-jump]');
      if (num) jumpTo(Number(num.getAttribute('data-jump')));
    });

    // 手机端展开 / 收起答题卡
    $('mapToggle').addEventListener('click', function () {
      var open = $('quizMap').classList.toggle('is-open');
      $('mapToggle').setAttribute('aria-expanded', String(open));
    });

    $('quizFoot').addEventListener('click', function (e) {
      var nav = e.target.closest('[data-nav]');
      if (!nav) return;
      if (nav.getAttribute('data-nav') === 'back') { renderSetup(); go('setup'); }
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

    if (window.H30Chat) window.H30Chat.init();
    canonicalizeUrl();
    bind();
    updateLanding();
    go('landing');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // 供 ai-chat.js 调用的最小接口（切屏）
  window.H30App = { go: go };
})();
