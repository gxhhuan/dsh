# DeepSeek Harness · Windows 安装器构建仓库

把 npm 上发布的 [`@deepseek-ai/dsh`](https://www.npmjs.com/package/@deepseek-ai/dsh)（DeepSeek Harness）打成一个
Windows x64 安装器：**双击安装、免管理员、key 由每个使用者自己配**。

- 产物：`dist/DeepSeek-Harness-Setup-<version>-x64.exe` + `dist/SHA256SUMS.txt`。
- 安装后只写两个位置：`%LOCALAPPDATA%\Programs\DeepSeek Harness`（程序）和
  `%USERPROFILE%\.dsh`（API Key、设置、会话）。**不写 Program Files，不写 HKLM，不弹 UAC。**
- 两条发布路线，按你的托管平台选一条：
  - **Gitee 托管**（推荐给你当前的情况）：在一台 Windows 机器/虚拟机上跑 `scripts/build-local.ps1`，
    再用 `scripts/upload-to-gitee.mjs` 传到 Gitee 发行版。**Gitee 没有可用的 Windows 云构建**，详见第五节。
  - **GitHub 托管**：推上去，`.github/workflows/build-windows.yml` 会在 `windows-latest` 上自动出包并挂 Release，
    连 Windows 机器都不需要。

> 为什么构建必须在 Windows 上：`@deepseek-ai/dsh` 的原生依赖是按平台拆包的
> （`sharp-win32-x64`、`node-addon-require-builtin-win32-x64-msvc` 等）。npm 只会装
> 与"执行安装的机器"匹配的那一份，所以在 macOS 上 `npm install` 出来的是 macOS 二进制。
> `scripts/prepare-portable.mjs` 会主动拒绝在非 Windows 主机上运行，并在 Windows 上校验这些包确实存在。

---

## 一、给使用者的说明（可以直接转发这段）

1. 双击 `DeepSeek-Harness-Setup-<version>-x64.exe` 安装（装到自己的用户目录，不用管理员密码）。
2. 开始菜单/桌面点「**DeepSeek Harness**」→ 浏览器自动打开本地界面。
3. 按界面提示在「**设置 → 模型**」里填入**你自己的 DeepSeek API Key**（`sk-...`）。
   它会保存到 `%USERPROFILE%\.dsh\.credentials.yaml`，立即生效，界面上不会回显。
4. 装完就能用。安装包里不含任何 key，每个人的 key 互相独立。

细节、数据位置、卸载说明见安装目录下的 `docs\API-KEY.txt`（安装器里也有对应的开始菜单项）。

---

## 二、仓库内容

| 路径 | 作用 |
|---|---|
| `scripts/build-local.ps1` | **Windows 一键构建**：staging → 冒烟 → 编安装器 → 校验和 + Release 说明 |
| `scripts/upload-to-gitee.mjs` | 把产物传到 Gitee 发行版（含 100MB 附件上限预检查、`--dry-run`） |
| `.github/workflows/build-windows.yml` | 可选：GitHub Actions `windows-latest` 自动构建 + 发 Release |
| `scripts/prepare-portable.mjs` | staging 主脚本：下载并校验 Node、`npm install` dsh、校验平台包、瘦身、产物断言 |
| `scripts/smoke-test.mjs` | **强制门禁**：用打好的 `node.exe` 真启动 `--profile web`，抓取带 token 的启动 URL 并断言 HTTP 200 + 页面标题 |
| `scripts/lib/modules.mjs` | 共享常量与工具（路径契约、下载、校验、瘦身） |
| `launchers/dsh.cmd` | 控制台启动器，转发全部 `dsh` 参数 |
| `launchers/dsh-web-hidden.vbs` | 快捷方式目标：静默启动 GUI，失败时弹框并指向日志 |
| `launchers/dsh-diagnose.ps1` | 诊断脚本：版本、路径、端口占用、最近日志（不读取 key 明文） |
| `installer/DeepSeekHarness.iss` | Inno Setup 6 脚本（per-user、快捷方式、卸载保留数据） |
| `installer/languages/` | 内置的 Inno Setup 简体中文语言文件 |
| `docs/API-KEY.txt` | 随安装包分发的使用者说明 |
| `docs/install-layout.md` | 磁盘布局、环境变量、数据目录契约 |
| `docs/E2E-CHECKLIST.md` | 真机验收清单（发版前人工过一遍） |
| `assets/` | 可选图标（放 `app.ico` / `wizard-image.bmp` 即自动启用） |

---

## 三、Gitee 托管：构建 + 发布（推荐）

### 0. 先明确一件事：Gitee 上没有可用的 Windows 云构建

查过 Gitee 官方文档，结论很硬：

- Gitee Go 的云端执行器全是 Linux：Node.js 构建插件的基础镜像是 **CentOS 7.6**，且只提供
  Node 8~15（[云端编译插件](https://help.gitee.com/gitee-go/plugin/ci-build)）；Shell 插件默认在
  主机组 `gitee-go` 上跑 Linux 命令（[Shell 脚本执行](https://help.gitee.com/gitee-go/plugin/shell)）。
  **没有 Windows 执行器**，而我们的 staging 必须在 Windows 上做。
- 自定义主机组（`hostGroupID`）要你自备一台常开的机器，那还不如直接在那台 Windows 上跑构建脚本。
- 免费额度只有 500 分钟/月（[产品定价](https://help.gitee.com/gitee-go/price)），Windows 构建一次就吃掉可观的额度。
- **Gitee 发行版单个附件上限 100MB**（社区版，单仓库附件总量 1G），GVP 项目才 200MB
  （[创建 Release](https://help.gitee.com/repository/release/create/)）。

所以 Gitee 这条路是：**Gitee 只做代码托管 + 发行版分发，构建在 Windows 上本地做。**
`prepare-portable.mjs` 已经为此做了瘦身（删 `src/`、`*.map`、`*.d.ts`、Markdown，量级 76MB），
但仍需在真机上量一次最终 exe 是否低于 100MB——**如果超了，`upload-to-gitee.mjs` 会在上传前直接拒绝并给出处理建议**。

### 1. 推到 Gitee

```sh
cd dsh-windows-installer
git remote add origin https://gitee.com/<你的用户名>/dsh-windows-installer.git
git push -u origin master
```

（Gitee 上先建好同名空仓库即可；私有仓库同样支持发行版附件。）

### 2. 在 Windows 机器上构建

```powershell
# 需要 Node >= 22；国内网络建议走镜像
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-local.ps1 `
  -Registry https://registry.npmmirror.com `
  -GiteeRepo <你的用户名>/dsh-windows-installer
```

跑完 `dist\` 里有安装器、`SHA256SUMS.txt`、`RELEASE-NOTES.md`，屏幕上会直接打印下一步的 Gitee 上传命令。
（Node 二进制下载慢可加 `-` 环境变量 `NODE_MIRROR=https://npmmirror.com/mirrors/node`。）

### 3. 发到 Gitee 发行版

```powershell
$env:GITEE_TOKEN = '<你的 Gitee 私人令牌>'   # 需要 projects 权限
node scripts/upload-to-gitee.mjs --repo <你的用户名>/dsh-windows-installer --tag v0.1.5-rc.3
```

脚本按 Gitee v5 官方接口创建发行版并上传附件（`POST /repos/{owner}/{repo}/releases`，
再 `POST /repos/{owner}/{repo}/releases/{id}/attach_files`），完成后回读发行版确认附件已挂上。
参数 `-rc/-alpha/-beta` 的 tag 会自动标为「预览版本」；加 `--dry-run` 只打印不请求；
加 `--no-upload` 只建发行版。**不想用 API 也行**：在 Gitee 网页「发行版 → 创建」里把
`dist\*.exe` 拖进去即可，效果一样。

### 4. 升级 dsh 版本

改 `package.json` 的 `dsh.dist.dshVersion`（或构建时 `-DshVersion`），重新构建 + 重新上传即可。
当前已发布版本：`latest = 0.1.5-rc.3`；`0.1.6`/`0.1.7` 目前只有 alpha/next 标签。
`Node` 默认 `24.21.0`（Node 24 LTS 线）。

---

## 四、GitHub 托管（可选，全自动）

如果你也愿意放一份到 GitHub，`.github/workflows/build-windows.yml` 会自动在 `windows-latest` 上构建，
连 Windows 机器都不用。

```sh
git remote add gh https://github.com/<你的用户名>/dsh-windows-installer.git
git push gh master
```

- 手动跑：Actions → `build-windows` → Run workflow（可临时改 `dsh_version` / `node_version`），产物在 Artifacts。
- 发版：`git tag v0.1.5-rc.3 && git push gh v0.1.5-rc.3` → 自动建 Release，附 `*.exe` + `SHA256SUMS.txt`。
- 走这条路时，升级版本改 `.github/workflows/build-windows.yml` 顶部的 `DSH_VERSION`（或手动触发时填输入）即可。

---

## 五、本地/脚本构建细节

```powershell
# 需要 Node >= 22；Inno Setup 6 可以先装好，脚本找不到时会尝试 winget/choco 安装
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-local.ps1

# 常用参数
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-local.ps1 `
  -DshVersion 0.1.5-rc.3 -NodeVersion 24.21.0 `
  -Registry https://registry.npmmirror.com `
  -GiteeRepo 你的用户名/dsh-windows-installer
```

只想验证 staging、不编安装器：加 `-SkipInno`；跳过启动冒烟：加 `-SkipSmoke`（不推荐）。

在 macOS 上可以单独跑冒烟测试的逻辑自检——把一份已有的 dsh 安装摆成 staging 布局后：

```sh
node scripts/prepare-portable.mjs   # 预期失败：明确提示必须用 Windows
node scripts/smoke-test.mjs         # 用宿主 Node 跑 staging 里的 bin.js，验证脚本逻辑
```

---

## 六、构建期做了什么（可审计）

1. 下载 `node-v<NODE_VERSION>-win-x64.zip`，并与官方 `SHASUMS256.txt` 做 **SHA256 校验**。
   镜像地址可用 `NODE_MIRROR` 覆盖（`https://npmmirror.com/mirrors/node`）。
2. 解压 Node 到 `build/portable`（自带 inflate，不依赖 tar/Expand-Archive）。
3. `npm install @deepseek-ai/dsh@<ver> --prefix build/portable/app --omit=dev --ignore-scripts`
   （失败自动重试 3 次；`NPM_REGISTRY` 可换镜像）。
4. **平台包校验**：`sharp`、`@img/sharp-win32-x64`、`node-addon-require-builtin`、
   `node-addon-require-builtin-win32-x64-msvc` 必须存在，否则直接失败。
5. 瘦身：删掉 `node_modules` 里的 `*.md` / `*.map` / `*.d.ts` / LICENSE 副本
   （在开发机的完整依赖树上量到 **76MB** 量级，占已打包体积的约 1/4），以及各包的 `src/` 源码目录
   （入口指向 `src/` 的包会被跳过）。这一步对 Gitee 的 100MB 附件上限很关键。
6. 生成 `build/build-info.json`（dsh 版本、Node 版本、commit、构建时间）与 `VERSION.txt`。
7. **密钥断言**：staging 里出现 `.credentials.yaml`、`.env` 或 `sk-` 形态字符串就失败——安装包永不携带 key。
8. **冒烟门禁**（Windows）：用打包好的 `node.exe` 跑 `--dump-default-config`，再真启动
   `--profile web --port 0`，抓带 token 的启动 URL、跟随跳转断言 `200` + `<title>DeepSeek Harness</title>`，
   并确认全新 home 会初始化 `profiles/web`，且没有写入任何 provider key。

---

## 七、已知边界

- **代码签名**：本仓库不带证书，首次运行可能出现 SmartScreen「仍要运行」提示。
  要接签名就在编译步骤后加 `signtool`（GitHub 路线需要仓库 secrets 里的证书）。
- **Gitee 附件上限 100MB/文件**：安装器一般小于这个数，但没在真机上量过之前不要假定。
  `upload-to-gitee.mjs` 会在上传前检查并拒绝超限文件；确实超了就按它的提示处理
  （进一步瘦身、改平台分发，或手工在 Gitee 网页上传）。
- **Gitee Go 不适合本任务**：云端只有 Linux 执行器、Node 只到 15，且无 Windows 执行器。
  想在 Gitee 全套自动化，只能自备一台常开的 Windows 机器做自定义主机组——那和直接跑
  `build-local.ps1` 等价，没有必要。
- **只出 x64**：覆盖绝大多数 Windows 机器；arm64 机器可由系统模拟运行 x64。
- **不做便携 zip**、不做自动更新器、不做 Electron 桌面壳。
- **`dsh plugin` 插件管理在装好的环境里不可用**：该命令把参数转发给 `pnpm`，而安装包不打包 pnpm。
  需要插件的人请装 Node + pnpm 后走标准 `dsh` CLI 流程。
- **卸载不会删数据**：`%USERPROFILE%\.dsh` 默认保留，卸载时会问是否删除。
- 安装目录里没有前端构建步骤：Web 前端产物随 `@deepseek-ai/dsh` 包发布，目标机不需要 pnpm/build。

## 八、许可

本仓库的脚本与安装器配置按 MIT 使用。`@deepseek-ai/dsh` 经由 npm 安装，遵循其自身许可；
`installer/languages/ChineseSimplified.isl` 来自上游社区翻译项目，署名信息保留在文件头。
