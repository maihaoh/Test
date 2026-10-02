# MZPlay -> Choice D051-D058 Dashboard

自动流程：MZPlay 登录 -> AG_Video/Choice 授权入口 -> Choice 官方 WebSocket -> D051-D058 Result -> `data.json` -> Dashboard。

## GitHub

请先阅读 **[GITHUB_SETUP.md](GITHUB_SETUP.md)**。

敏感资料只放 GitHub **Secrets and variables**，不要写入仓库。

## 本机

第一次运行：

1. `INSTALL_CHOICE_BROWSER.cmd`
2. 设置 `MZPLAY_USERNAME` / `MZPLAY_PASSWORD` / `MZPLAY_DEVICE_ID`，或建立本地 `mzplay_config.json`
3. `START_DASHBOARD.cmd`
