# GitHub 上传与 Secrets 设置

这个仓库已经处理成 **GitHub 安全版**：账号、密码、Token、Cookie、HAR、Choice launch URL 都不应提交到仓库。

## 1. GitHub 要设置什么

进入：

`Repository -> Settings -> Secrets and variables -> Actions`

### Secrets
新增：

- `MZPLAY_USERNAME`：你的 MZPlay 登录账号
- `MZPLAY_PASSWORD`：你的 MZPlay 登录密码

### Variables（推荐）
新增：

- `MZPLAY_DEVICE_ID`：稳定的 deviceId

如果你想把 deviceId 也当敏感资料，也可以把它放在 **Secrets** 里；workflow 同时支持 Variable 或 Secret。

> 不要把 Choice token / refresh token / Cookie / launch URL 手动写进 Secrets。程序会在运行时自己取得短期 session。

## 2. 哪些文件要上传 GitHub

直接上传这个 ZIP 解压后的项目内容即可，包括：

- `.github/workflows/auto_update.yml`
- `.gitignore`
- `.env.example`
- `bot.py`
- `mzplay_multi.py`
- `choice_collector.py`
- `choice_result_decoder.py`
- `run_once.py`
- `requirements.txt`
- `index.html`
- `script.js`
- `style.css`
- `data.json`
- `CHOICE_README.txt`
- `GITHUB_SETUP.md`
- 其他 `.cmd` 本机辅助脚本（上传也没问题）

## 3. 哪些绝对不要上传

这些已经被 `.gitignore` 排除：

- `mzplay_config.json`
- `.env` / `.env.*`（`.env.example` 除外）
- 任何 `.har`
- Token / Cookie / refreshToken 导出文件
- Choice launch URL 抓包
- `__pycache__/`
- `*.log`
- `auth_state.json`

如果某个敏感文件以前已经 commit 过，仅加入 `.gitignore` 不会把历史版本删除；应先从 Git 历史/索引中移除，并立即轮换已泄露的密码或 token。

## 4. GitHub Actions

上传后打开：

`Actions -> Auto Update Dashboard -> Run workflow`

第一次建议手动运行一次。成功后 workflow 会读取 GitHub Secrets，自动：

`MZPlay login -> GetGameUrl(AG_Video) -> Choice -> D051-D058 -> data.json`

workflow 会周期性运行并在 `data.json` 有变化时 commit 回当前分支。

## 5. GitHub Pages（要网站才设置）

进入：

`Settings -> Pages`

选择：

- Source: `Deploy from a branch`
- Branch: `main`
- Folder: `/ (root)`

保存后，`index.html` 会作为 Dashboard 首页，页面读取同目录的 `data.json`。

## 6. 关于 24/7

GitHub Actions 是定时 CI Runner，不是永久 VPS。此仓库已设置成约 4 小时一轮并自动续跑，但 GitHub 的调度可能延迟或中断，因此不能保证零间断 24/7。

如果你要求真正持续不间断，建议同一份代码部署到 VPS；GitHub Secrets 版仍然可以作为源码仓库和 Dashboard 发布方式。
