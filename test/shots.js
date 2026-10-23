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
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript' };

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

  await page.goto(BASE + '?plan=complete', { waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, '01-landing.png') });

  await page.evaluate(() => document.getElementById('signals').scrollIntoView());
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, '02-signals.png') });

  await page.evaluate(() => document.getElementById('sample').scrollIntoView());
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, '03-sample.png') });

  await page.evaluate(() => document.getElementById('framework').scrollIntoView());
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, '04-framework.png') });

  await page.evaluate(() => document.getElementById('faq').scrollIntoView());
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, '05-faq.png') });

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.click('#heroStart');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, '06-setup.png') });

  await page.click('#setupStart');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, '08-quiz.png') });

  await page.locator('#stepView .opt').nth(1).click();
  await page.waitForTimeout(120);
  await page.screenshot({ path: path.join(OUT, '09-quiz-selected.png') });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, '10-quiz-next.png') });

  // 答题卡跳题
  await page.locator('#quizMap .map-num').nth(20).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, '11-map-jump.png') });

  // 报告
  for (let i = 0; i < 40; i++) {
    if (await page.isVisible('#screen-report')) break;
    const before = (await page.textContent('#quizCount')).trim();
    await page.locator('#stepView .opt').nth(i % 3).click();
    await page.waitForTimeout(380);
    if ((await page.textContent('#quizCount')).trim() === before) {
      await page.locator('[data-nav="next"]').click();
    }
  }
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, '12-report-top.png') });
  await page.evaluate(() => window.scrollBy(0, 780));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, '13-report-dim.png') });

  // 手机端
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const m = await mobile.newPage();
  await m.goto(BASE + '?plan=complete', { waitUntil: 'load' });
  await m.waitForTimeout(300);
  await m.screenshot({ path: path.join(OUT, '20-m-landing.png') });
  await m.evaluate(() => document.getElementById('sample').scrollIntoView());
  await m.waitForTimeout(400);
  await m.screenshot({ path: path.join(OUT, '21-m-sample.png') });

  await m.evaluate(() => window.scrollTo(0, 0));
  await m.click('#heroStart');
  await m.waitForTimeout(300);
  await m.screenshot({ path: path.join(OUT, '22-m-setup.png') });
  await m.click('#setupStart');
  await m.waitForTimeout(300);
  await m.screenshot({ path: path.join(OUT, '23-m-quiz.png') });
  await m.click('#mapToggle');
  await m.waitForTimeout(300);
  await m.screenshot({ path: path.join(OUT, '24-m-map.png') });
  await m.locator('#quizMap .map-num').nth(3).click();
  await m.waitForTimeout(300);
  await m.locator('#stepView .opt').first().click();
  await m.waitForTimeout(500);
  await m.screenshot({ path: path.join(OUT, '25-m-next.png') });

  // 手机端报告
  for (let i = 0; i < 40; i++) {
    if (await m.isVisible('#screen-report')) break;
    const before = (await m.textContent('#quizCount')).trim();
    await m.locator('#stepView .opt').nth(i % 3).click();
    await m.waitForTimeout(380);
    if ((await m.textContent('#quizCount')).trim() === before) {
      await m.locator('[data-nav="next"]').click();
    }
  }
  await m.waitForTimeout(500);
  await m.screenshot({ path: path.join(OUT, '26-m-report.png') });

  await browser.close();
  server.close();
  console.log('截图完成 → ' + OUT);
})();
