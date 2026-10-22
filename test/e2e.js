/* 端到端流程自测：node test/e2e.js
 * 使用本机 Chrome + playwright-core 驱动真实浏览器，
 * 覆盖三个入口、访问码、两种答题界面、必答校验、报告规则、复制与重置。
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('C:/Users/32097/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8901;
const BASE = 'http://127.0.0.1:' + PORT + '/index.html';
// 从 config.js 读取当前访问码，避免改码后测试失效
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

async function newPage(browser, plan) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const external = [];
  page.on('request', r => {
    const u = r.url();
    if (!u.startsWith('http://127.0.0.1:' + PORT) && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u);
  });
  page.on('pageerror', e => failures.push('页面脚本错误：' + e.message));
  await page.goto(BASE + '?plan=' + plan, { waitUntil: 'load' });
  return { ctx, page, external };
}

async function enterCode(page, code) {
  await page.fill('#gateInput', code);
  await page.click('#gateForm button[type="submit"]');
}

async function answerStepAll(page, max) {
  for (let i = 0; i < max; i++) {
    if (await page.isVisible('#screen-report')) return i;
    const opts = page.locator('#stepView .opt');
    await opts.first().click();
    await page.locator('[data-nav="next"]').click();
    await page.waitForTimeout(30);
  }
  return max;
}

(async () => {
  await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true
  });

  try {
    /* ---------------------------------------------------- 入口 1：快速版 */
    console.log('\n[入口] ?plan=quick');
    {
      const { ctx, page, external } = await newPage(browser, 'quick');

      eq((await page.textContent('#planPill')).trim(), '快速版 · 约 5 分钟', '顶栏显示快速版');
      eq(await page.getAttribute('.plan-card.is-active', 'data-plan'), 'quick', '快速版卡片为当前入口');
      ok((await page.textContent('#heroPlanHint')).includes('?plan=quick'), '首页提示包含入口参数');
      ok((await page.textContent('#heroStart')).includes('快速版'), '主按钮显示当前版本');

      await page.click('#heroStart');
      ok(await page.isVisible('#screen-gate'), '进入访问码页');
      ok((await page.textContent('#gatePlanLabel')).includes('快速版'), '访问码页标明当前版本');

      await enterCode(page, 'wrong-code');
      ok(await page.isVisible('#gateError'), '错误访问码显示提示');
      ok(await page.isVisible('#screen-gate'), '错误访问码停留在验证页');

      await enterCode(page, CODE);
      ok(await page.isVisible('#screen-setup'), '正确访问码进入设置页');
      ok(!(await page.isVisible('#dimBlock')), '快速版不显示维度选择');
      ok((await page.textContent('#setupSummary')).includes('8 题'), '快速版题量为 8');
      ok((await page.textContent('#setupSummary')).includes('逐题模式'), '设置页标明逐题模式');
      ok((await page.textContent('#setupTitle')).includes('准备好'), '快速版无需选择，标题相应调整');
      ok(await page.locator('#modeChoices').count() === 0, '已移除答题方式选择');

      await page.click('#setupStart');
      ok(await page.isVisible('#screen-quiz'), '进入答题页');
      eq((await page.textContent('#quizCount')).trim(), '第 1 / 8 题', '逐题模式题号显示');
      ok(await page.locator('#stepView .opt').count() === 3, '每题 3 个选项');
      ok(await page.locator('[data-nav="next"]').isDisabled(), '未作答时“下一题”不可用');

      // 右侧答题卡
      eq(await page.locator('#quizMap .map-num').count(), 8, '答题卡显示 8 个题号');
      eq(await page.locator('#quizMap .map-group').count(), 4, '答题卡按四个维度分组');
      ok((await page.locator('#quizMap .map-num').nth(0).getAttribute('class')).includes('is-current'), '第 1 题标为当前题');
      ok((await page.textContent('#mapStat')).includes('已答 0 / 8'), '答题卡初始进度');

      await page.locator('#quizMap .map-num').nth(2).click();
      eq((await page.textContent('#quizCount')).trim(), '第 3 / 8 题', '点题号可跳到第 3 题');
      ok((await page.locator('#quizMap .map-num').nth(2).getAttribute('class')).includes('is-current'), '跳转后当前题高亮');

      await page.locator('#stepView .opt').first().click();
      ok(!(await page.locator('[data-nav="next"]').isDisabled()), '作答后“下一题”可用');
      ok((await page.locator('#quizMap .map-num').nth(2).getAttribute('class')).includes('is-done'), '作答后题号标记为已答');
      ok((await page.textContent('#mapStat')).includes('已答 1 / 8'), '答题卡进度随之更新');

      await page.locator('#quizMap .map-num').nth(0).click();
      eq((await page.textContent('#quizCount')).trim(), '第 1 / 8 题', '可跳回第 1 题修改');

      const answered = await answerStepAll(page, 20);
      ok(await page.isVisible('#screen-report'), '答完全部题目后生成报告');
      eq(await page.locator('#reportBody .dim-report').count(), 4, '快速版报告覆盖四个维度');
      eq(await page.locator('#reportBody .type-grid').count(), 1, '四维齐全时生成元类型与原型');
      eq(await page.locator('#reportBody .insufficient').count(), 0, '四维齐全时不显示信息不足');
      ok((await page.textContent('#reportBody')).includes('元类型'), '报告含元类型标题');
      ok((await page.textContent('#reportBody')).includes('生活方式原型'), '报告含生活方式原型');
      ok((await page.textContent('#reportBody')).includes('发展阶段'), '报告含发展阶段');
      ok((await page.textContent('#reportBody')).includes('转变阶段'), '报告含转变阶段');
      ok((await page.textContent('#reportBody')).includes('未来两周可以先做的三件事'), '报告含行动建议');
      ok((await page.textContent('#reportMeta')).includes('8 道题'), '报告标明题量');

      // 数字分数检查：报告中不应出现“得分/分数：数字”这类表述
      const bodyText = await page.textContent('#reportBody');
      ok(!/(得分|评分|分数)\s*[:：]\s*\d/.test(bodyText), '报告不显示数字分数');

      await page.click('#btnCopy');
      await page.waitForTimeout(300);
      const toastText = (await page.textContent('#toast')).trim();
      ok(toastText.includes('已复制') || toastText.includes('复制失败'), '复制按钮有明确反馈：' + toastText);

      await page.click('#btnEdit');
      ok(await page.isVisible('#screen-quiz'), '可从报告返回修改回答');

      await page.click('#btnRestartTop');
      ok(await page.isVisible('#modal'), '重新开始弹出确认框');
      await page.click('#modalOk');
      ok(await page.isVisible('#screen-setup'), '确认后回到设置页');
      ok(!(await page.textContent('#setupSummary')).includes('已答'), '重新开始已清空回答');
      ok(await page.locator('#modal').isHidden(), '确认后关闭弹窗');

      ok(external.length === 0, '全程无外部网络请求' + (external.length ? '：' + external.join(',') : ''));

      await ctx.close();
    }

    /* ------------------------------------------- 入口 2：标准版 + 重点维度 */
    console.log('\n[入口] ?plan=standard（只选两个维度）');
    {
      const { ctx, page, external } = await newPage(browser, 'standard');
      eq((await page.textContent('#planPill')).trim(), '标准版 · 约 15 分钟', '顶栏显示标准版');
      eq(await page.getAttribute('.plan-card.is-active', 'data-plan'), 'standard', '标准版卡片为当前入口');

      await page.click('#heroStart');
      await enterCode(page, CODE);
      ok(await page.isVisible('#dimBlock'), '标准版显示维度选择');
      ok((await page.textContent('#setupTitle')).includes('先选'), '标准版标题提示先选择');

      await page.click('[data-dim="body"]');
      await page.click('[data-dim="vocation"]');
      const summary = await page.textContent('#setupSummary');
      ok(summary.includes('2 个'), '可只选两个维度');
      ok(summary.includes('8 题'), '两维共 8 题');

      await page.click('#setupStart');
      ok(await page.isVisible('#screen-quiz'), '进入答题');
      eq(await page.locator('#quizMap .map-num').count(), 8, '答题卡只显示所选维度的 8 题');
      eq(await page.locator('#quizMap .map-group').count(), 2, '答题卡只显示两个维度');

      // 跳到最后一题作答，前面留空，验证必答校验
      await page.locator('#quizMap .map-num').nth(7).click();
      eq((await page.textContent('#quizCount')).trim(), '第 8 / 8 题', '可跳到最后一题');
      await page.locator('#stepView .opt').first().click();
      await page.locator('[data-nav="next"]').click();
      ok(await page.isVisible('#missingBanner'), '未答完时提示必答');
      ok((await page.textContent('#missingBanner')).includes('7 题'), '提示未答数量');
      ok(await page.isVisible('#screen-quiz'), '未答完不生成报告');
      eq((await page.textContent('#quizCount')).trim(), '第 1 / 8 题', '自动跳到第一道未答题');

      // 补完剩余题目
      for (let i = 0; i < 8; i++) {
        if (await page.isVisible('#screen-report')) break;
        await page.locator('#stepView .opt').nth(1).click();
        await page.locator('[data-nav="next"]').click();
      }

      ok(await page.isVisible('#screen-report'), '答完后生成报告');
      eq(await page.locator('#reportBody .dim-report').count(), 2, '部分维度只总结已探索维度');
      eq(await page.locator('#reportBody .type-grid').count(), 0, '部分维度不生成元类型');
      ok(await page.isVisible('#reportBody .insufficient'), '部分维度显示信息不足');
      ok((await page.textContent('#reportBody .insufficient')).includes('信息不足'), '信息不足文案明确');
      ok(!(await page.textContent('#reportBody')).includes('思考先行型'), '部分维度不猜测整体类型');
      ok(!(await page.textContent('#reportBody')).includes('均衡探索型'), '部分维度不猜测整体类型');

      ok(external.length === 0, '全程无外部网络请求');
      await ctx.close();
    }

    /* ---------------------------------------- 入口 3：完整版 + 单维度深入 */
    console.log('\n[入口] ?plan=complete（只选心智维度）');
    {
      const { ctx, page, external } = await newPage(browser, 'complete');
      eq((await page.textContent('#planPill')).trim(), '完整版 · 约 30 分钟', '顶栏显示完整版');
      eq(await page.getAttribute('.plan-card.is-active', 'data-plan'), 'complete', '完整版卡片为当前入口');

      await page.click('#heroStart');
      await enterCode(page, CODE);
      await page.click('[data-dim="body"]');
      await page.click('[data-dim="relationships"]');
      await page.click('[data-dim="vocation"]');
      ok((await page.textContent('#setupSummary')).includes('1 个'), '可只选一个维度');
      ok((await page.textContent('#setupSummary')).includes('8 题'), '单维度 8 题');

      await page.click('#setupStart');
      eq((await page.textContent('#quizCount')).trim(), '第 1 / 8 题', '完整版单维度从第 1 题开始');
      await answerStepAll(page, 12);
      ok(await page.isVisible('#screen-report'), '单维度也能生成报告');
      eq(await page.locator('#reportBody .dim-report').count(), 1, '报告只含一个维度');
      ok((await page.textContent('#reportBody')).includes('心智'), '报告含已探索维度');
      const heads = await page.locator('#reportBody .dim-report h3').allTextContents();
      ok(!heads.join('|').includes('职业与贡献'), '报告维度卡片不含未探索维度');
      ok(!heads.join('|').includes('身体'), '报告维度卡片不含未探索维度');
      ok(external.length === 0, '全程无外部网络请求');
      await ctx.close();
    }

    /* --------------------------------------------- 完整版全维度 + 进度条 */
    console.log('\n[入口] ?plan=complete（全部四个维度）');
    {
      const { ctx, page } = await newPage(browser, 'complete');
      await page.click('#heroStart');
      await enterCode(page, CODE);
      ok((await page.textContent('#setupSummary')).includes('32 题'), '完整版全维度 32 题');
      await page.click('#setupStart');
      await page.locator('#stepView .opt').nth(1).click();
      const width = await page.evaluate(() => document.getElementById('progressBar').style.width);
      ok(parseFloat(width) > 0, '进度条随作答推进：' + width);

      // 逐题模式回退修改
      await page.locator('[data-nav="next"]').click();
      await page.locator('[data-nav="prev"]').click();
      ok((await page.textContent('#quizCount')).includes('第 1 / 32 题'), '可返回上一题');

      await page.locator('#stepView .opt').nth(2).click();
      ok(await page.getAttribute('#stepView .opt >> nth=2', 'aria-pressed') === 'true', '修改后新选项被选中');
      ok(await page.getAttribute('#stepView .opt >> nth=1', 'aria-pressed') === 'false', '旧选项取消选中');
      await ctx.close();
    }

    /* ------------------------------------------------------ 无参数访问 */
    console.log('\n[入口] 不带 plan 参数');
    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await ctx.newPage();
      await page.goto(BASE, { waitUntil: 'load' });
      ok(await page.isVisible('#planGrid'), '无参数时显示版本选择');
      eq((await page.textContent('#heroStart')).trim(), '选择版本', '无参数时主按钮为“选择版本”');
      await page.click('.plan-card[data-plan="quick"]');
      ok(await page.isVisible('#screen-gate'), '选择版本后进入访问码页');
      ok(page.url().includes('plan=quick'), '选择版本后 URL 带上参数');
      // 移动端不出现横向滚动
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      ok(overflow <= 1, '移动端无横向溢出（' + overflow + 'px）');
      await ctx.close();
    }

    /* ------------------------------------------------ 手机端答题卡折叠 */
    console.log('\n[移动端] 答题卡展开与跳题');
    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const page = await ctx.newPage();
      await page.goto(BASE + '?plan=quick', { waitUntil: 'load' });
      await page.click('#heroStart');
      await enterCode(page, CODE);
      await page.click('#setupStart');

      ok(await page.isVisible('#mapToggle'), '手机端显示答题卡折叠按钮');
      ok(!(await page.isVisible('#mapBody')), '手机端答题卡默认收起');
      ok((await page.textContent('#mapToggleInfo')).includes('已答 0 / 8'), '折叠按钮显示进度');

      await page.click('#mapToggle');
      ok(await page.isVisible('#mapBody'), '点击后展开答题卡');
      eq(await page.locator('#quizMap .map-num').count(), 8, '展开后可见 8 个题号');

      await page.locator('#quizMap .map-num').nth(4).click();
      ok(await page.isHidden('#mapBody'), '跳题后自动收起');
      eq((await page.textContent('#quizCount')).trim(), '第 5 / 8 题', '手机端也能点题号跳转');

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      ok(overflow <= 1, '答题页无横向溢出（' + overflow + 'px）');
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
