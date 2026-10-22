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
