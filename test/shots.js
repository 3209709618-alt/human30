/* 截图检查：node test/shots.js */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('C:/Users/32097/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright-core');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(ROOT, '..', '.preview');
const PORT = 8902;
const BASE = 'http://127.0.0.1:' + PORT + '/index.html';
const CFG_SRC = fs.readFileSync(path.join(ROOT, 'assets/config.js'), 'utf8');
const CODE = (CFG_SRC.match(/ACCESS_CODE:\s*'([^']+)'/) || [])[1] || 'han0220';
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8' };

fs.mkdirSync(OUT, { recursive: true });

const server = http.createServer((req, res) => {
  const p = path.join(ROOT, req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0]);
  fs.readFile(p, (e, d) => {
    if (e) { res.statusCode = 404; res.end(); return; }
    res.setHeader('Content-Type', MIME[path.extname(p)] || 'application/octet-stream');
    res.end(d);
  });
});

(async () => {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true
  });

  const desktop = await browser.newContext({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 1 });
  const page = await desktop.newPage();

  await page.goto(BASE + '?plan=standard', { waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, '01-landing.png') });

  await page.evaluate(() => document.getElementById('plans').scrollIntoView());
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, '02-plans.png') });

  await page.evaluate(() => document.getElementById('framework').scrollIntoView());
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, '03-framework.png') });

  await page.evaluate(() => document.getElementById('ai').scrollIntoView());
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, '04-ai.png') });

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, '05-footer.png') });

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.click('#heroStart');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, '06-gate.png') });

  await page.fill('#gateInput', CODE);
  await page.click('#gateForm button[type="submit"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, '07-setup.png') });

  await page.click('#setupStart');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, '08-quiz-step.png') });

  await page.locator('#stepView .opt').nth(1).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, '09-quiz-selected.png') });

  // 答题卡跳题
  await page.locator('#quizMap .map-num').nth(5).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, '10-quiz-map-jump.png') });
  await page.locator('#stepView .opt').nth(0).click();
  await page.waitForTimeout(200);
  await page.locator('[data-nav="next"]').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, '11-quiz-map-progress.png') });

  // 快速版报告
  const p2 = await desktop.newPage();
  await p2.goto(BASE + '?plan=quick', { waitUntil: 'load' });
  await p2.click('#heroStart');
  await p2.fill('#gateInput', CODE);
  await p2.click('#gateForm button[type="submit"]');
  await p2.click('#setupStart');
  for (let i = 0; i < 8; i++) {
    await p2.locator('#stepView .opt').nth(i % 3).click();
    await p2.locator('[data-nav="next"]').click();
  }
  await p2.waitForTimeout(500);
  await p2.screenshot({ path: path.join(OUT, '12-report-top.png') });
  await p2.evaluate(() => window.scrollBy(0, 780));
  await p2.waitForTimeout(400);
  await p2.screenshot({ path: path.join(OUT, '13-report-dim.png') });
  await p2.evaluate(() => window.scrollBy(0, 780));
  await p2.waitForTimeout(400);
  await p2.screenshot({ path: path.join(OUT, '14-report-actions.png') });

  // 部分维度报告
  const p3 = await desktop.newPage();
  await p3.goto(BASE + '?plan=standard', { waitUntil: 'load' });
  await p3.click('#heroStart');
  await p3.fill('#gateInput', CODE);
  await p3.click('#gateForm button[type="submit"]');
  await p3.click('[data-dim="body"]');
  await p3.click('[data-dim="vocation"]');
  await p3.click('#setupStart');
  for (let i = 0; i < 8; i++) {
    await p3.locator('#stepView .opt').nth(0).click();
    await p3.locator('[data-nav="next"]').click();
  }
  await p3.waitForTimeout(400);
  await p3.screenshot({ path: path.join(OUT, '15-report-partial.png') });

  // 移动端
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const m = await mobile.newPage();
  await m.goto(BASE + '?plan=quick', { waitUntil: 'load' });
  await m.waitForTimeout(300);
  await m.screenshot({ path: path.join(OUT, '20-m-landing.png') });
  await m.evaluate(() => document.getElementById('plans').scrollIntoView());
  await m.waitForTimeout(400);
  await m.screenshot({ path: path.join(OUT, '21-m-plans.png') });
  await m.click('.plan-card[data-plan="quick"]');
  await m.waitForTimeout(300);
  await m.screenshot({ path: path.join(OUT, '22-m-gate.png') });
  await m.fill('#gateInput', CODE);
  await m.click('#gateForm button[type="submit"]');
  await m.waitForTimeout(300);
  await m.screenshot({ path: path.join(OUT, '23-m-setup.png') });
  await m.click('#setupStart');
  await m.waitForTimeout(300);
  await m.screenshot({ path: path.join(OUT, '24-m-quiz.png') });
  await m.locator('#stepView .opt').first().click();
  await m.waitForTimeout(200);
  await m.screenshot({ path: path.join(OUT, '25-m-quiz-selected.png') });

  for (let i = 0; i < 8; i++) {
    await m.locator('#stepView .opt').nth(i % 3).click();
    await m.locator('[data-nav="next"]').click();
  }
  await m.waitForTimeout(500);
  await m.screenshot({ path: path.join(OUT, '26-m-report.png') });
  await m.evaluate(() => window.scrollBy(0, 700));
  await m.waitForTimeout(300);
  await m.screenshot({ path: path.join(OUT, '27-m-report-dim.png') });

  // 手机端答题卡展开
  const g = await mobile.newPage();
  await g.goto(BASE + '?plan=quick', { waitUntil: 'load' });
  await g.click('#heroStart');
  await g.fill('#gateInput', CODE);
  await g.click('#gateForm button[type="submit"]');
  await g.click('#setupStart');
  await g.waitForTimeout(300);
  await g.screenshot({ path: path.join(OUT, '28-m-map-collapsed.png') });
  await g.click('#mapToggle');
  await g.waitForTimeout(300);
  await g.screenshot({ path: path.join(OUT, '29-m-map-open.png') });

  await browser.close();
  server.close();
  console.log('截图完成 → ' + OUT);
})();
