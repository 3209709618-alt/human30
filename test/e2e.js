/* 端到端流程自测：node test/e2e.js
 * 使用本机 Chrome + playwright-core 驱动真实浏览器。
 * 覆盖：单一入口、访问码、自动跳题、改答案不跳、答题卡、必答校验、
 *      报告结构、复制、重置、手机端布局、可选笔记。
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('C:/Users/32097/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8901;
const BASE = 'http://127.0.0.1:' + PORT + '/index.html';
const CFG_SRC = fs.readFileSync(path.join(ROOT, 'assets/config.js'), 'utf8');
const CODE = (CFG_SRC.match(/ACCESS_CODE:\s*'([^']+)'/) || [])[1] || 'han0220';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.md': 'text/markdown; charset=utf-8'
};

let pass = 0;
const failures = [];

function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { failures.push(msg); console.log('  ✗ ' + msg); }
}

function eq(actual, expected, msg) {
  const good = actual === expected;
  if (!good) msg += '（期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual) + '）';
  ok(good, msg);
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  let filePath = path.join(ROOT, urlPath === '/' ? '/index.html' : urlPath);
  if (!filePath.startsWith(ROOT)) { res.statusCode = 403; res.end('forbidden'); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.statusCode = 404; res.end('not found'); return; }
    res.setHeader('Content-Type', MIME[path.extname(filePath)] || 'application/octet-stream');
    res.end(data);
  });
});

async function newPage(browser, query) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const external = [];
  page.on('request', r => {
    const u = r.url();
    if (!u.startsWith('http://127.0.0.1:' + PORT) && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u);
  });
  page.on('pageerror', e => failures.push('页面脚本错误：' + e.message));
  await page.goto(BASE + (query || ''), { waitUntil: 'load' });
  return { ctx, page, external };
}

async function enterCode(page, code) {
  await page.fill('#gateInput', code);
  await page.click('#gateForm button[type="submit"]');
}

(async () => {
  await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true
  });

  try {
    /* ------------------------------------------------ 单一入口与访问码 */
    console.log('\n[入口] ?plan=complete');
    {
      const { ctx, page, external } = await newPage(browser, '?plan=complete');

      eq((await page.textContent('#planPill')).trim(), '完整版 · 约 30 分钟', '顶栏显示完整版');
      eq((await page.textContent('#heroStart')).trim(), '开始评估', '主按钮为开始评估');
      ok(await page.locator('#planGrid').count() === 0, '首页不再有版本卡片');
      ok(!(await page.textContent('#screen-landing')).includes('快速版'), '首页不出现快速版');
      ok(!(await page.textContent('#screen-landing')).includes('标准版'), '首页不出现标准版');
      ok((await page.textContent('#screen-landing')).includes('32 个问题'), '首页说明题量');
      ok((await page.textContent('#screen-landing')).includes('报告片段 · 示例'), '首页展示报告样例');

      await page.click('#heroStart');
      ok(await page.isVisible('#screen-gate'), '进入访问码页');
      ok((await page.textContent('#gatePlanLabel')).includes('32 道题'), '访问码页标明题量');

      await enterCode(page, 'wrong-code');
      ok(await page.isVisible('#gateError'), '错误访问码显示提示');
      ok(await page.isVisible('#screen-gate'), '错误访问码停留在验证页');

      await enterCode(page, CODE);
      ok(await page.isVisible('#screen-setup'), '正确访问码进入设置页');
      ok(await page.locator('#dimBlock').count() === 0, '设置页不再有维度选择');
      ok((await page.textContent('#setupSummary')).includes('32 题'), '摘要显示 32 题');
      ok((await page.textContent('#setupSummary')).includes('4 个'), '摘要显示四个维度');
      ok((await page.textContent('.setup-points')).includes('自动进入下一题'), '设置页说明自动跳题');

      await page.click('#setupStart');
      ok(await page.isVisible('#screen-quiz'), '进入答题页');
      eq((await page.textContent('#quizCount')).trim(), '第 1 / 32 题', '从第 1 题开始');
      eq(await page.locator('#quizMap .map-num').count(), 32, '答题卡显示 32 个题号');
      eq(await page.locator('#quizMap .map-group').count(), 4, '答题卡按四个维度分组');
      ok(await page.locator('#stepView .opt').count() === 3, '每题 3 个选项');

      /* ------------------------------------------------ 自动跳题 */
      await page.locator('#stepView .opt').first().click();
      await page.waitForTimeout(180);
      eq((await page.textContent('#quizCount')).trim(), '第 1 / 32 题', '刚选中时还没跳');
      await page.waitForTimeout(400);
      eq((await page.textContent('#quizCount')).trim(), '第 2 / 32 题', '选中后自动进入下一题');

      /* ------------------------------------------------ 改答案不跳 */
      await page.locator('#quizMap .map-num').nth(0).click();
      eq((await page.textContent('#quizCount')).trim(), '第 1 / 32 题', '可点题号跳回第 1 题');
      await page.locator('#stepView .opt').nth(2).click();
      await page.waitForTimeout(500);
      eq((await page.textContent('#quizCount')).trim(), '第 1 / 32 题', '改答案后不自动跳走');
      ok((await page.locator('#quizMap .map-num').nth(0).getAttribute('class')).includes('is-done'), '题号标记为已答');

      /* ------------------------------------------------ 最后一题与必答 */
      await page.locator('#quizMap .map-num').nth(31).click();
      eq((await page.textContent('#quizCount')).trim(), '第 32 / 32 题', '可跳到最后一题');
      await page.locator('#stepView .opt').first().click();
      await page.waitForTimeout(500);
      eq((await page.textContent('#quizCount')).trim(), '第 32 / 32 题', '最后一题不自动跳');
      ok(await page.isVisible('.note-box'), '最后一题提供可选笔记');

      await page.locator('[data-nav="next"]').click();
      ok(await page.isVisible('#missingBanner'), '有漏题时提示必答');
      ok((await page.textContent('#missingBanner')).includes('30 题'), '提示未答数量');
      ok(await page.isVisible('#screen-quiz'), '未答完不生成报告');
      eq((await page.textContent('#quizCount')).trim(), '第 2 / 32 题', '自动跳到第一道未答题');

      /* ------------------------------------------------ 答完并出报告 */
      for (let i = 0; i < 40; i++) {
        if (await page.isVisible('#screen-report')) break;
        await page.locator('#stepView .opt').nth(i % 3).click();
        await page.locator('[data-nav="next"]').click();
      }

      ok(await page.isVisible('#screen-report'), '答完后生成报告');
      eq(await page.locator('#reportBody .dim-report').count(), 4, '报告覆盖四个维度');
      eq(await page.locator('#reportBody .type-grid').count(), 1, '生成元类型与原型');
      eq(await page.locator('#reportBody .advice-box').count(), 4, '每个维度一条建议');
      eq(await page.locator('#reportBody .basis').count(), 4, '每个维度给出判断依据');
      eq(await page.locator('#reportBody .linkage-card').count(), 1, '生成跨维度议题');
      eq(await page.locator('#reportBody .actions-card').count(), 1, '生成跨维度建议');
      eq(await page.locator('#reportBody .insufficient').count(), 0, '不再有信息不足提示');
      ok((await page.textContent('#reportBody')).includes('可以带走的问题'), '跨维度议题含核心问题');
      ok((await page.textContent('.report-head .disclaimer')).includes('心理、医疗或职业诊断'), '声明覆盖三类诊断');
      ok((await page.textContent('.report-head .disclaimer')).includes('Dan Koe'), '声明标注理论来源');

      const bodyText = await page.textContent('#reportBody');
      ok(!/(得分|评分|分数)\s*[:：]\s*\d/.test(bodyText), '报告不显示数字分数');

      await page.locator('#reportBody .basis summary').first().click();
      ok(await page.locator('#reportBody .basis-a').first().isVisible(), '依据可展开');

      await page.click('#btnCopy');
      await page.waitForTimeout(300);
      const toastText = (await page.textContent('#toast')).trim();
      ok(toastText.includes('已复制') || toastText.includes('复制失败'), '复制按钮有反馈：' + toastText);

      await page.click('#btnEdit');
      ok(await page.isVisible('#screen-quiz'), '可从报告返回修改');

      await page.click('#btnRestartTop');
      ok(await page.isVisible('#modal'), '重新开始弹出确认');
      await page.click('#modalOk');
      ok(await page.isVisible('#screen-setup'), '确认后回到设置页');
      ok(!(await page.textContent('#setupSummary')).includes('已答'), '重新开始清空回答');

      ok(external.length === 0, '全程无外部网络请求');
      await ctx.close();
    }

    /* ------------------------------------------------ 旧链接兼容 */
    console.log('\n[入口] 旧链接 ?plan=quick / ?plan=standard');
    {
      const { ctx, page } = await newPage(browser, '?plan=quick');
      eq((await page.textContent('#planPill')).trim(), '完整版 · 约 30 分钟', '旧链接落到完整版');
      ok(page.url().includes('plan=complete'), 'URL 自动规范为 plan=complete');
      await page.goto(BASE + '?plan=standard', { waitUntil: 'load' });
      eq((await page.textContent('#planPill')).trim(), '完整版 · 约 30 分钟', '标准版旧链接也落到完整版');
      await page.goto(BASE, { waitUntil: 'load' });
      eq((await page.textContent('#planPill')).trim(), '完整版 · 约 30 分钟', '无参数同样进入完整版');
      ok(page.url().includes('plan=complete'), '无参数时补上 plan=complete');
      await ctx.close();
    }

    /* ------------------------------------------------ 手机端 */
    console.log('\n[移动端] 390px');
    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const page = await ctx.newPage();
      await page.goto(BASE + '?plan=complete', { waitUntil: 'load' });

      const overflowLanding = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      ok(overflowLanding <= 1, '首页无横向溢出（' + overflowLanding + 'px）');
      ok(await page.isVisible('#heroStart'), '首页主按钮可见');

      await page.click('#heroStart');
      await enterCode(page, CODE);
      await page.click('#setupStart');

      ok(await page.isVisible('#mapToggle'), '手机端显示答题卡折叠按钮');
      ok(!(await page.isVisible('#mapBody')), '答题卡默认收起');
      await page.click('#mapToggle');
      ok(await page.isVisible('#mapBody'), '点击后展开');
      const box = await page.locator('#quizMap .map-num').first().boundingBox();
      ok(box && box.width >= 38 && box.height >= 38, '题号触控目标 ≥ 38px（' + Math.round(box.width) + '×' + Math.round(box.height) + '）');
      await page.locator('#quizMap .map-num').nth(2).click();
      ok(await page.isHidden('#mapBody'), '跳题后自动收起');
      eq((await page.textContent('#quizCount')).trim(), '第 3 / 32 题', '手机端可跳题');

      await page.locator('#stepView .opt').first().click();
      await page.waitForTimeout(500);
      eq((await page.textContent('#quizCount')).trim(), '第 4 / 32 题', '手机端选中后自动跳题');

      const overflowQuiz = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      ok(overflowQuiz <= 1, '答题页无横向溢出（' + overflowQuiz + 'px）');
      const btn = await page.locator('[data-nav="prev"]').boundingBox();
      ok(btn && btn.height >= 40, '按钮高度适合触控（' + Math.round(btn.height) + 'px）');
      await ctx.close();
    }

    /* ------------------------------------------------ 笔记 */
    console.log('\n[笔记] 可选补充背景');
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await ctx.newPage();
      await page.goto(BASE + '?plan=complete', { waitUntil: 'load' });
      await page.click('#heroStart');
      await enterCode(page, CODE);
      await page.click('#setupStart');

      for (let i = 0; i < 31; i++) {
        await page.locator('#stepView .opt').first().click();
        await page.locator('[data-nav="next"]').click();
      }
      eq((await page.textContent('#quizCount')).trim(), '第 32 / 32 题', '到达最后一题');
      ok(!(await page.isVisible('#noteInput')), '笔记默认收起');
      await page.click('.note-box summary');
      await page.fill('#noteInput', '最近刚换工作，同时在照顾家人。');
      ok((await page.textContent('#noteCount')).trim() !== '0', '字数统计更新');

      await page.locator('#stepView .opt').first().click();
      await page.locator('[data-nav="next"]').click();
      ok(await page.isVisible('#screen-report'), '填写笔记后仍能生成报告');
      ok(await page.isVisible('#reportBody .note-report'), '报告展示补充背景');
      ok((await page.textContent('#reportBody .note-report')).includes('最近刚换工作'), '笔记原样展示');
      ok((await page.textContent('#reportBody .note-report')).includes('未参与'), '注明笔记不参与判断');
      await ctx.close();
    }


    /* ------------------------------------------------ AI 深聊版（mocked API） */
    {
      console.log('\n[AI 深聊版] mocked 模型接口');
      const { ctx, page } = await newPage(browser);
      const reportJson = {
        metatype: { name: '错位成长型', why: '四个象限不在同一水平线上。', strongest: 'mind', weakest: 'body', unique: '想法多、行动少。', basis: '第 1、3 轮回答' },
        archetype: { name: '拆解问题的探索者', driver: '被问题驱动', mostEnergy: 'mind', sacrificed: 'body', problem: '身体被牺牲', fit: '基本符合' },
        quadrants: ['mind', 'body', 'spirit', 'vocation'].map((id, i) => ({
          id, level: i + 1, phase: 'uncertainty', evidence: '最近一个月还在调整。',
          strengths: ['能反思'], gaps: ['缺重复行为'], fakeGrowth: '无',
          crossImpact: '影响其他象限', priority: '先解决节奏', confidence: 'medium', uncertain: '压力下的表现未知'
        })),
        crossDynamics: { blocker: '身体', lever: '心智', rootCause: '身体', chainRisk: '全面下滑', hiddenPattern: '用思考代替行动' },
        coreProblem: { quadrant: 'body', what: '没有稳定节奏', whyRoot: '其他问题都是它的症状', impact: '解决后精力回升', whyNow: '成本最低' },
        roadmap: {
          day1: '今晚十一点前放下手机。',
          month1: { goal: '固定作息', daily: '十一点睡', weekly: '三次运动', crossSupport: '找人监督', successSignal: '连续七天', avoid: '一次全改' },
          month3: { change: '生活有了底座', skill: '听身体说话', relapseGuard: '设最低线', support: '用心智规划身体', signal: '精力稳定' },
          year1: { nextStage: '2.0', newProblem: '方向选择', interlock: '互相供给', lifestyle: '建造者' }
        },
        accelerator: { verdict: 'caution', missingBase: '稳定节奏', aiUse: '辅助不代劳', outsourcingRisk: '先自己写再对比', dependencySignals: '不思考就问' },
        warnings: { regressionTrigger: '连续加班', fakeGrowthTrap: '囤课', chainRisk: '身体拖垮全部', selfDeception: '我在准备' },
        finalFeedback: '你真正卡住的地方不是想不清楚，是身体撑不住你想的事。'
      };
      let calls = 0;
      let failMode = false;
      await page.route('**/v1/chat/completions', route => {
        calls++;
        if (failMode) {
          route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { message: 'invalid key' } }) });
          return;
        }
        const body = route.request().postDataJSON();
        const last = body.messages[body.messages.length - 1].content || '';
        const isReport = last.includes('json');
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            choices: [{
              message: {
                role: 'assistant',
                content: isReport
                  ? '访谈完成，我现在整理报告。\n```json\n' + JSON.stringify(reportJson) + '\n```'
                  : '能说说最近一次让你改变看法的事吗？'
              }
            }]
          })
        });
      });

      await page.click('[data-track="ai"]');
      await enterCode(page, CODE);
      ok(await page.isVisible('#screen-ai-setup'), 'AI 轨过访问码后进入设置屏');
      eq(await page.locator('.ai-provider.is-active').count(), 1, '默认有一个服务商被选中');
      ok((await page.textContent('.ai-provider.is-active .ap-name')).includes('硅基流动'), '默认服务商是硅基流动');
      ok((await page.inputValue('#aiModel')).includes('GLM-5.3-Flash'), '默认模型是 GLM-5.3-Flash');
      // 旧版智谱设置应回落新默认，而不是留下发不出去的接口
      await page.evaluate(() => localStorage.setItem('h30.ai.v1', JSON.stringify({ settings: { provider: 'zhipu', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', key: 'sk-old' }, messages: [], report: null, finished: false })));
      await page.reload({ waitUntil: 'load' });
      await page.click('[data-track="ai"]');
      await enterCode(page, CODE);
      ok((await page.textContent('.ai-provider.is-active .ap-name')).includes('硅基流动'), '旧智谱设置回落到新默认');
      ok((await page.inputValue('#aiBaseUrl')).includes('siliconflow'), '旧智谱接口地址被替换');
      await page.click('[data-pv="custom"]');
      await page.fill('#aiBaseUrl', 'https://mock.test/v1');
      await page.fill('#aiModel', 'mock-model');
      await page.fill('#aiKey', 'sk-test-key-123');
      ok((await page.textContent('#aiConsentText')).includes('自定义'), '同意书随服务商切换');
      await page.click('#aiSetupStart');
      ok(await page.isVisible('#screen-ai-chat'), '进入访谈屏');
      ok((await page.textContent('#aiMsgList')).includes('欢迎开始'), '开场白本地渲染');
      eq(calls, 0, '开场白不消耗接口调用');

      await page.fill('#aiInput', '最近一次改变看法是开始跑步。');
      await page.click('#aiSend');
      await page.waitForFunction(() => document.querySelectorAll('.ai-row.ai').length >= 2, null, { timeout: 8000 });
      eq(calls, 1, '发送后调用一次模型接口');
      ok((await page.textContent('#aiMsgList')).includes('能说说最近一次'), '接口回复上屏');

      // 刷新后能从设置屏继续上次访谈
      await page.reload({ waitUntil: 'load' });
      await page.click('[data-track="ai"]');
      await enterCode(page, CODE);
      ok(await page.isVisible('#screen-ai-setup'), '重新进入设置屏');
      ok((await page.textContent('#aiResume')).includes('已聊 1 轮'), '显示继续上次入口');
      await page.click('#aiResume');
      ok((await page.textContent('#aiMsgList')).includes('开始跑步'), '刷新后对话恢复');

      // 401 错误路径
      failMode = true;
      await page.fill('#aiInput', '继续说。');
      await page.click('#aiSend');
      await page.waitForSelector('#aiChatErr:not([hidden])', { timeout: 8000 });
      ok((await page.textContent('#aiChatErr')).includes('401'), 'Key 失效有友好提示');
      ok(await page.isVisible('#aiRetry'), '提供重试按钮');
      failMode = false;

      // 生成报告
      await page.click('#aiFinish');
      await page.waitForSelector('#screen-ai-report:not([hidden])', { timeout: 8000 });
      eq(await page.locator('#aiReportBody .dim-report').count(), 4, 'AI 报告含四个象限卡');
      ok((await page.textContent('#aiReportBody')).includes('错位成长型'), 'AI 报告含元类型');
      ok((await page.textContent('#aiReportBody')).includes('行动路线'), 'AI 报告含行动路线');
      ok((await page.textContent('#aiReportBody')).includes('关键警告'), 'AI 报告含关键警告');
      ok((await page.textContent('#screen-ai-report')).includes('不是心理、医疗或职业诊断'), 'AI 报告带声明');
      ok((await page.textContent('#screen-ai-report')).includes('Dan Koe'), 'AI 报告标注理论来源');

      // 本地状态与再次查看
      const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('h30.ai.v1') || '{}'));
      ok(stored.report && stored.messages.length > 2, '访谈状态写入 localStorage');
      await page.click('#aiReportBack');
      await page.click('[data-track="ai"]');
      await page.click('#aiResumeReport');
      ok(await page.isVisible('#screen-ai-report'), '可从设置屏查看上次报告');
      await ctx.close();
    }

  } finally {
    await browser.close();
    server.close();
  }

  console.log('\n----------------------------------------');
  console.log('通过 ' + pass + ' 项，失败 ' + failures.length + ' 项');
  if (failures.length) {
    console.log('\n失败明细：');
    failures.forEach(f => console.log(' - ' + f));
    process.exit(1);
  } else {
    console.log('全部端到端流程通过。');
  }
})().catch(err => {
  console.error(err);
  server.close();
  process.exit(1);
});
