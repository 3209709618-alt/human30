# AI 版采用用户自带 API Key、浏览器直连，不设服务端代理

Key 由用户自备、只存本人浏览器，请求从浏览器直连模型服务商；项目不提供代理、不经手 Key。项目是纯静态托管，没有服务端可藏 Key；代理模式下一个重度用户就能耗光额度，且项目会变成数据中转方。代价是注册摩擦——这是完成率验证要测量的变量，不是要消除的缺陷。

**Considered Options**：
- Cloudflare Workers 代理——留到出现「有人愿意为省事付钱」的信号后再评估。
- 公共演示 Key——等同于代理，且额度会被瞬间烧光。

**Consequences**：
- 并非所有服务商都支持浏览器直连：实测智谱 `open.bigmodel.cn` 的 CORS 预检不返回 `Access-Control-Allow-Headers`，带 `Authorization` 的请求会被浏览器直接拦截（表现为 "Failed to fetch"）。预设列表只收预检通过的服务商（硅基流动 / DeepSeek / 通义千问），自定义里填智谱地址时设置屏给出提示。
