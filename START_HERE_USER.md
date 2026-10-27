# Career Radar 使用指南

## 安装

- **安装版**：双击 `CareerRadar-Setup-<版本>.exe`，装好后从桌面或开始菜单打开。
- **便携版**：把 `CareerRadar-Portable-<版本>.exe` 放进一个自己的文件夹再双击。旁边会生成 `CareerRadarData`，里面是你的记录，不要删。

适用于 64 位 Windows 10/11，不需要另外安装 Node.js。安装包没有数字签名，Windows 可能提示"未知发布者"；
可以用同目录的 `SHA256SUMS.txt` 核对文件是否完整。

## 第一次搜索

1. **导入简历**，看一眼去掉联系方式后的预览，补上想去的行业、技能和不想做的工作。
2. **确认岗位**：从推荐的岗位名称里勾选，选好地区和实习/正式。
3. **选渠道**：默认勾选的是验证过能读取的网站，你的选择会被记住。
4. 点 **Find / Continue Jobs**。勾选"自动继续"时会连续跑最多 10 批，每批 40 个任务；没跑完的会留着，下次接着跑。
5. **需要登录时**，程序会弹出该网站的窗口，在里面登录或完成验证码，最多等两分钟，登录后自动继续。
   部分网站不支持在这种窗口里用 Google 等第三方账号登录，请用网站自己的登录方式。

## 看结果

- 职位按匹配程度分为 Strong、Adjacent、Broad。读不到标题或链接等关键信息的职位放在 Needs review。
- 每个职位都可以标记投递状态。读取到职位不代表你符合要求，程序也不会替你投递。
- 导出的 Excel 分为 Internships、Full-time、Needs review、Search coverage、Type to confirm 几页。
  先看 Search coverage，它列出哪些搜索已经完整、哪些还没搜完。
- 再次搜索会和已有记录合并去重，投递状态保留。已经下载的 Excel 不会自动更新，需要时重新导出。
- 换电脑时，用 **Import Previous CSV** 导入以前导出的 CSV。

## 窗口和登录

- 网站窗口点 × 只是隐藏，不会退出登录；点 **Disconnect / 断开** 才会清除这个网站在本机的登录。
- 搜索期间请保持主程序打开。程序不会在后台定时搜索，也不会自动更新。

## 本地 AI

安装 [Ollama](https://ollama.com/) 和一个支持工具调用的模型（例如 `ollama pull qwen3.5:9b`）后，
AI 区块会显示"READY / 可用"。Ollama 没开时程序会自动启动它；启动失败时，AI 任务留在队列里，下次搜索再补上。

目前 AI 只搜索 MyCareersFuture。模型第一次加载可能要几分钟。程序不会要你输入任何 AI 账号或 API 密钥，
招聘网站的密码只填在网站自己的窗口里。

## 数据在哪里

- 安装版：`%APPDATA%\Career Radar\data`
- 便携版：exe 旁边的 `CareerRadarData`

分享给别人时，只发安装包和 `SHA256SUMS.txt`，不要发自己的数据文件夹。
