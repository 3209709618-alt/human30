# 阿里云函数计算 FC 代理（AI 深聊）

腾讯云 SCF 的免费额度只覆盖开通前三个月；阿里云 FC 提供**每月长期免费额度**（当前公示：每月 100 万次调用 + 40 万 CU-秒），更适合长期挂着。这个目录是同一套代理的阿里云版本。

## 1. 新建函数

1. 打开阿里云控制台 → **函数计算 FC** → 创建函数。
2. 选择 **事件函数**（不要选「HTTP 函数」，两者的入口签名不同）。
3. 运行环境选 **Node.js 18**，函数入口填 `index.handler`。
4. 把本目录的 `index.js` 内容粘贴进去（无第三方依赖）。

## 2. 配置

- **执行超时**：改成 **60 秒**（默认 3 秒会掐断模型回复）。
- **内存**：128MB 即可。
- **环境变量**：

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `API_KEY` | 是 | 你的模型服务商 Key，**只填这里** |
| `BASE_URL` | 否 | 默认 `https://api.deepseek.com/v1` |
| `MODEL` | 否 | 默认 `deepseek-chat`（当前部署即此值） |
| `ALLOW_ORIGIN` | 否 | 建议 `https://3209709618-alt.github.io` |
| `MAX_TOKENS` | 否 | 默认 4096 |
| `RATE_LIMIT` | 否 | 每 IP 每小时请求上限，默认 30 |

## 3. 创建 HTTP 触发器

在函数详情里创建 **HTTP 触发器**：

- 认证方式：**匿名**（否则浏览器调不通）。
- 请求方法：勾选 **GET、POST、OPTIONS**（OPTIONS 用于跨域预检）。
- 保存后复制控制台给出的**公网访问地址**。

默认域名一般不需要备案；绑定自定义域名才需要。

## 4. 自测

浏览器直接打开公网地址（GET），应返回：

```json
{"ok":true,"configured":true,"model":"deepseek-chat","requireCode":false}
```

`configured:false` 说明 `API_KEY` 没填或没保存。

## 5. 填到站点

把公网地址填进 `assets/config.js`：

```js
window.HUMAN30_CONFIG = {
  AI_PROXY_URL: 'https://你的阿里云函数地址',
  // ...
};
```

## 6. 换模型 / 换服务商

只改环境变量，前端不用动：

| 服务商 | `BASE_URL` | `MODEL` |
| --- | --- | --- |
| 硅基流动 | `https://api.siliconflow.cn/v1` | `zai-org/GLM-5.3-Flash` |
| DeepSeek | `https://api.deepseek.com` | `deepseek-chat` |
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |

## 7. 注意

- 不要把 `API_KEY` 写进 `index.js` 或任何提交到仓库的文件。
- 阿里云 FC 的免费额度是「限额内免费」，超出按量计费；模型 token 另计，去服务商后台设额度上限。
- 严格「每 IP 每天 1 次」需要数据库/Redis；当前是内存尽力限流 + 服务商额度上限。
