# 📈 晨报 App（PWA 壳）

手机网页版晨报 App，**纯静态壳，不含任何数据**——所有报告、持仓、观察名单、问答记录都保存在你的私有仓库 `daily-briefing`，由本 App 用你浏览器本地保存的受限令牌实时读写。

## 首次使用（1 分钟）

1. 创建**受限访问令牌**：
   - 打开 https://github.com/settings/tokens?type=beta → **Generate new token**
   - Token name：`briefing-web`；Expiration：90 天
   - Repository access：**Only select repositories** → 只选 `daily-briefing`
   - Permissions：**Actions → Read and write**、**Contents → Read and write**、Metadata（Read，自动）
2. 打开 App → 输入 `QwQ-1025/daily-briefing` 和令牌 → 保存
3. 建议在浏览器菜单里选"添加到主屏幕"，以后点图标即开

## 功能

| Tab | 能力 |
|---|---|
| 📄 今日 | 渲染当日 HTML 报告（‹ › 翻历史）+ 运行状态 + **⚡立即生成**一键触发（3-5 分钟后自动推微信） |
| 💬 问答 | **AI 问答**：对报告/持仓/计划提问（如"NVDA 第三批现在该买吗"），答案约 1-2 分钟生成并**同步推微信**，历史可翻 |
| 💰 持仓 | 持仓看板（价格/盈亏/占比）+ **✏️编辑**股数/成本/触发线 + **💼记录模拟盘买卖**（自动算新持仓均价、更新现金、写交易台账，次日晨报 AI 会结合最近交易给建议） |
| 👁 观察 | **➕加股自动调研**：输代码 → 云端采集行情/新闻/SEC → DeepSeek 生成调研卡片（业务/产业链/催化剂/风险/建议入场触发线）→ 一键加入；已有条目可 ✏️改触发线/关键词或 🗑删除 |

## 隐私与安全

- 令牌只存你浏览器 localStorage，权限仅限 `daily-briefing` 一个仓库（Contents+Actions）
- 随时可在 GitHub 撤销；本壳仓库不含任何密钥或私人数据
- 交易记录等功能直接写回你的私有仓库，所有历史都有 git 记录可追溯

## 维护

- 数据仓库：`daily-briefing`（私有）；壳仓库：`daily-briefing-web`（公开）
- 改壳代码 push 到 main，Pages 约 1 分钟自动重建
