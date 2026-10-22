# Human3.0人生评估

基于 HUMAN 3.0 框架的中文互动自我探索静态网站。纯前端、无后端、无外部依赖，可直接部署到 GitHub Pages。

> 当前版本为免费原型，仅用于流程测试：不收款、不接入 AI、不上传也不保存任何回答。

## 在线地址

| 入口 | 链接 |
| --- | --- |
| 首页（选择版本） | https://3209709618-alt.github.io/human30/ |
| 快速版 · 约 5 分钟 | https://3209709618-alt.github.io/human30/?plan=quick |
| 标准版 · 约 15 分钟 | https://3209709618-alt.github.io/human30/?plan=standard |
| 完整版 · 约 30 分钟 | https://3209709618-alt.github.io/human30/?plan=complete |

访问码：`han0220`（在 `assets/config.js` 中修改，三个入口共用）。

---

## 1. 文件结构

```
.
├── index.html          页面结构（首页 / 访问码 / 设置 / 答题 / 报告）
├── assets/
│   ├── config.js       ★ 访问码等站点配置（部署前改这里）
│   ├── data.js         版本、维度、题目、阶段文案、元类型与原型
│   ├── logic.js        规则引擎：判定阶段、生成报告、输出纯文本
│   ├── app.js          页面交互：路由、答题、校验、复制、重置
│   └── style.css       深色主题样式（移动端优先）
├── test/
│   ├── run-tests.js    规则引擎自测（Node）
│   ├── e2e.js          浏览器端到端自测（Playwright + 本机 Chrome）
│   └── shots.js        页面截图脚本（开发用，可不部署）
├── .nojekyll           跳过 Jekyll 处理
└── README.md
```

部署时只需要 `index.html`、`assets/`、`.nojekyll`。`test/` 目录可以一并上传，不影响运行。

---

## 2. 本地预览

直接双击 `index.html` 即可打开。若要测试带参数的入口链接，建议起一个本地服务：

```bash
# 任选一种
python -m http.server 8000
npx serve .
```

然后访问 `http://localhost:8000/?plan=quick`。

---

## 3. 发布到 GitHub Pages

1. 新建一个 GitHub 仓库（Public），例如 `human30`。
2. 把本项目**根目录下的所有文件**上传到仓库根目录（`index.html` 必须在根目录，不能多套一层文件夹）。
   ```bash
   git init
   git add .
   git commit -m "Human3.0人生评估 静态原型"
   git branch -M main
   git remote add origin https://github.com/<你的用户名>/<仓库名>.git
   git push -u origin main
   ```
3. 打开仓库 → **Settings** → 左侧 **Pages**。
4. **Build and deployment** → Source 选择 **Deploy from a branch**；
   Branch 选择 `main`，目录选择 `/ (root)`，点击 **Save**。
5. 等待 1–2 分钟，页面顶部会出现访问地址，形如：
   `https://<你的用户名>.github.io/<仓库名>/`
6. 打开该地址确认首页正常，再分别测试三个入口链接。

> 若仓库名就是 `<你的用户名>.github.io`，访问地址会变成 `https://<你的用户名>.github.io/`，链接格式同理替换域名即可。

**更新内容**：修改文件后 `git push`，Pages 会自动重新构建（约 1 分钟）。浏览器可能缓存旧文件，测试时用无痕窗口或强制刷新。

---

## 4. 三个版本入口链接

入口参数决定进入哪个版本，三个链接共用一个访问码：

| 版本 | 时长 | 全部维度题量 | 入口链接格式 |
| --- | --- | --- | --- |
| 快速版 | 约 5 分钟 | 8 题（四维各 2 题） | `https://<用户名>.github.io/<仓库名>/?plan=quick` |
| 标准版 | 约 15 分钟 | 16 题（四维各 4 题） | `https://<用户名>.github.io/<仓库名>/?plan=standard` |
| 完整版 | 约 30 分钟 | 32 题（四维各 8 题） | `https://<用户名>.github.io/<仓库名>/?plan=complete` |

- 不带 `plan` 参数时，首页会显示三个版本供选择，选择后地址栏会自动补上参数。
- 参数值非法（例如 `?plan=abc`）会按“未选择版本”处理。
- 标准版 / 完整版只选部分维度时，题量相应减少，时长也会缩短。

---

## 5. 访问码配置

打开 `assets/config.js`：

```js
window.HUMAN30_CONFIG = {
  ACCESS_CODE: 'han0220',   // ← 改成你自己的访问码
  SITE_NAME: 'Human3.0人生评估',
  SHOW_CODE_HINT: false     // 改成 true 会在页面上显示演示访问码
};
```

- 当前访问码是 `han0220`（不区分大小写，首尾空格会被忽略）。
- 三个版本共用这一个访问码。
- **这只是前端演示**：访问码写在公开的 JS 文件里，任何人查看源码都能看到，不能当作真实的付费权限、会员校验或安全保护。真正收费需要后端校验。

---

## 6. 题目与报告规则

- 四个维度：心智、身体、关系与意义、职业与贡献。
- 每个维度有两类题目：
  - **阶段题**（`kind: 'level'`）：选项对应 1.0 / 2.0 / 3.0；
  - **转变题**（`kind: 'phase'`）：选项对应 失调 / 不确定 / 发现。
- 判定方式：阶段题取平均值分档（< 1.75 → 1.0，< 2.5 → 2.0，其余 3.0）；转变题取出现次数最多的一项，平票时按「不确定 → 失调 → 发现」取值。
- 报告**不显示任何数字分数**，只给阶段名称、说明、优势、值得关注的地方与下一步建议。
- 元类型规则（需要四个维度都有回答）：
  1. 最高与最低阶段相差 ≥ 2 → 错位成长型
  2. 平均 ≥ 2.6 → 整合推进型
  3. 平均 ≤ 1.4 → 起步整合型
  4. 四个维度相同 → 均衡探索型
  5. 其余情况取阶段最高的维度 → 思考 / 行动 / 连接 / 建造先行型
- 生活方式原型 = 主导维度 × 该维度的转变阶段（四个维度持平时按整体转变阶段取值）。
- **只探索部分维度时，不生成元类型与生活方式原型**，报告会明确写出“整体类型信息不足”，不做猜测。

题目、选项与全部文案均为本项目自行编写，仅在概念层面参考 HUMAN 3.0，未复制来源文章或提示词原文。

---

## 7. 自测

```bash
# 规则引擎（题目完整性、题量、判定、报告规则、文本输出）
node test/run-tests.js

# 端到端（三个入口、访问码、两种答题界面、必答校验、复制、重置）
node test/e2e.js
```

`test/e2e.js` 使用本机 Chrome，通过 `playwright-core` 驱动；脚本里的浏览器路径和模块路径按本机环境写死，换机器时需要调整。

---

## 8. 关于数据、AI 与支付

- 回答只保存在页面内存里，**不使用 localStorage / sessionStorage / Cookie**，刷新或关闭页面即清空。
- 页面**没有任何网络请求**（除加载自身的 HTML / CSS / JS），也没有埋点、统计或第三方脚本。
- 不包含任何 API Key、密钥或后端地址。
- 不包含任何支付、下单、会员开通逻辑。
- 标准版与完整版的 AI 能力目前只是**流程占位**：页面上明确标注“未接入 / 规划中”，不会伪装成 AI 已工作。

未来接入 AI 时：

1. API Key 只放在后端（例如 Cloudflare Workers、Vercel Function、自建服务），通过环境变量注入；
2. 前端只把回答 POST 给自家后端，由后端转发给模型；
3. 不要把 Key 写进任何会被提交到仓库的文件（包括 `.env`，应加入 `.gitignore`）；
4. 若涉及真实用户数据，需要补充隐私说明与删除机制。

---

## 9. 理论来源

- [A Complete Knowledge Base of HUMAN 3.0](https://letters.thedankoe.com/p/a-complete-knowledge-base-of-human)
- [Prompt: HUMAN 3.0 Self-Discovery and ...](https://letters.thedankoe.com/p/prompt-human-30-self-discovery-and)

框架参考 Dan Koe 的 HUMAN 3.0。本站是独立的自我探索工具，与原作者无隶属关系。

---

## 10. 免责声明

本站结果由预设规则生成，仅供自我探索参考，**不是心理诊断，也不是经过验证的客观测评**，不能用于医疗、招聘、教育分流或任何正式决策。
