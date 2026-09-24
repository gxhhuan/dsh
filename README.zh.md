# DeepSeek Harness · Windows 安装器构建仓库

把 npm 上发布的 [`@deepseek-ai/dsh`](https://www.npmjs.com/package/@deepseek-ai/dsh)（DeepSeek Harness）打成一个
Windows x64 安装器：**双击安装、免管理员、key 由每个使用者自己配**。

- 产物：`dist/DeepSeek-Harness-Setup-<version>-x64.exe` + `dist/SHA256SUMS.txt`。
- 安装后只写两个位置：`%LOCALAPPDATA%\Programs\DeepSeek Harness`（程序）和
  `%USERPROFILE%\.dsh`（API Key、设置、会话）。**不写 Program Files，不写 HKLM，不弹 UAC。**
- **构建和分发都在 GitHub**：推送到 GitHub 后，Actions 在 `windows-latest` 上自动构建，
  打 tag 就自动发 Release 挂上安装器。**你不需要任何 Windows 机器。**
  公开仓库用 GitHub 托管 runner 是免费的（见 [Actions 计费说明](https://docs.github.com/en/billing/concepts/product-billing/github-actions)）；
  私有仓库走账号额度（Free 账号 2000 分钟/月，Windows runner 按 2 倍计费，一次构建约 15~20 分钟）。
- 国内网络慢的话在仓库 Settings → Variables 里加一个 `NPM_REGISTRY=https://registry.npmmirror.com`
  即可，工作流会自动用它装 npm 包。

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
| `.github/workflows/build-windows.yml` | **主流程**：`windows-latest` 上 staging → 冒烟 → 编安装器 → 上传 Artifact / 发 Release |
| `scripts/build-local.ps1` | 本地 Windows 一键构建（与 CI 完全相同的步骤，用于推之前先验证） |
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

## 三、发布流程（GitHub）

### 1. 推到 GitHub

```sh
cd dsh-windows-installer
# 先用 gh（推荐），或网页建库后手动加 remote
gh repo create dsh-windows-installer --private --source . --push
# 手动方式：
# git remote add origin https://github.com/<你的用户名>/dsh-windows-installer.git
# git push -u origin main
```

仓库里**不含任何密钥**，所以公开也无所谓——公开仓库的 Actions 反而完全免费（私有仓库走额度）。

### 2. 跑一次构建

Actions → `build-windows` → **Run workflow**。两个输入框留空就用 `package.json` 里的默认版本。
跑完在本页底部 Artifacts 里下载 `DeepSeek-Harness-Setup-x64-attempt-1`。

工作流会依次做：装 Node → `prepare-portable.mjs`（下载校验 Node、`npm install` dsh、平台包校验、瘦身、密钥断言）
→ `smoke-test.mjs`（真的把 `--profile web` 启起来、抓带 token 的 URL、断言 200 + 页面标题）
→ 装 Inno Setup 6.5.0 → 编安装器 → 生成 `SHA256SUMS.txt` → 上传 Artifact。

### 3. 发版本

```sh
git tag v0.1.5-rc.3
git push origin v0.1.5-rc.3
```

推送 `v*` tag 会自动构建并把 `*.exe` 和 `SHA256SUMS.txt` 挂到同名 **GitHub Release** 上。
Release 附件的大小上限远高于安装器体积，不用操心。用户直接把 Release 页链接发出去即可。

### 4. 升级 dsh 版本

改 `package.json` 的 `dsh.dist.dshVersion`（工作流顶部 `DSH_VERSION` 也同步改，或在手动触发时填输入），
重新打 tag 即可。当前：dsh `latest = 0.1.5-rc.3`（`0.1.6`/`0.1.7` 目前只有 alpha/next），Node 默认 `24.21.0`。

### 5. 构建号

`AppVerName` 会带上 Actions 的 run number（例如 `DeepSeek Harness 0.1.5-rc.3.17`），
所以在用户机器的「应用和功能」里能区分同一版 dsh 的多次构建。安装器文件名不含构建号，Release 资产名保持稳定。

---

## 四、本地/脚本构建细节（可选，用于推之前先验证）

```powershell
# 需要 Node >= 22；Inno Setup 6 可以先装好，脚本找不到时会尝试 winget/choco 安装
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-local.ps1

# 常用参数
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-local.ps1 `
  -DshVersion 0.1.5-rc.3 -NodeVersion 24.21.0 `
  -Registry https://registry.npmmirror.com
```

只想验证 staging、不编安装器：加 `-SkipInno`；跳过启动冒烟：加 `-SkipSmoke`（不推荐）。

在 macOS 上可以单独跑冒烟测试的逻辑自检——把一份已有的 dsh 安装摆成 staging 布局后：

```sh
node scripts/prepare-portable.mjs   # 预期失败：明确提示必须用 Windows
node scripts/smoke-test.mjs         # 用宿主 Node 跑 staging 里的 bin.js，验证脚本逻辑
```

---

## 五、构建期做了什么（可审计）

1. 下载 `node-v<NODE_VERSION>-win-x64.zip`，并与官方 `SHASUMS256.txt` 做 **SHA256 校验**。
   镜像地址可用 `NODE_MIRROR` 覆盖（`https://npmmirror.com/mirrors/node`）。
2. 解压 Node 到 `build/portable`（自带 inflate，不依赖 tar/Expand-Archive）。
3. `npm install @deepseek-ai/dsh@<ver> --prefix build/portable/app --omit=dev --ignore-scripts`
   （失败自动重试 3 次；`NPM_REGISTRY` 可换镜像）。
4. **平台包校验**：`sharp`、`@img/sharp-win32-x64`、`node-addon-require-builtin`、
   `node-addon-require-builtin-win32-x64-msvc` 必须存在，否则直接失败。
5. 瘦身：删掉 `node_modules` 里的 `*.md` / `*.map` / `*.d.ts` / LICENSE 副本
   （在开发机的完整依赖树上量到 **76MB** 量级，占已打包体积的约 1/4），
   以及**能被证明不会在运行时被加载**的包内 `src/` 目录（见下）。
6. 生成 `build/build-info.json`（dsh 版本、Node 版本、commit、构建时间）与 `VERSION.txt`。
7. **密钥断言**：staging 里出现 `.credentials.yaml`、`.env` 或 `sk-` 形态字符串就失败——安装包永不携带 key。
8. **冒烟门禁**（Windows）：用打包好的 `node.exe` 跑 `--dump-default-config`，再真启动
   `--profile web --port 0`，抓带 token 的启动 URL、跟随跳转断言 `200` + `<title>DeepSeek Harness</title>`，
   并确认全新 home 会初始化 `profiles/web`，且没有写入任何 provider key。

### 关于删 `src/`（一次真实事故的教训）

第一次真机构建（Run #1）**就是死在这里**：`koffi` 包的 `index.js` 正文只有一行
`export { default } from "./src/koffi/index.js"` —— **入口在包根、真正代码在 `src/`**。
我原来的判断只看 package.json 的 `main`/`exports` 字段，于是把 `src/` 删了，用户装完会直接起不来。

现在 `prunePackageSources` 的默认答案是**保留**，只有同时满足三条才删：

1. `main`/`module`/`exports`/`bin` 都不指向 `src/`；
2. 包内所有 `.js`/`.cjs`/`.mjs`（`src/` 之外）都没有相对导入 `src/`；
3. `src/` 里没有 Node 能加载的文件——**无扩展名文件也算**（Node 会当 JS 解析）。

在真实依赖树上实测：19 个包被保留（含 `koffi`、`protobufjs`、`debug`），只有 9 个可安全删除，
**总共只省 332 KiB**。也就是说这项优化收益极小、风险却不小——它保留只是为了那点体积，
判断逻辑有回归测试兜底。

---

## 六、已知边界

- **代码签名**：本仓库不带证书，首次运行可能出现 SmartScreen「仍要运行」提示。
  要接签名就在编译步骤后加 `signtool`，证书放仓库 Secrets（如 `WINDOWS_CERT_PFX` / `WINDOWS_CERT_PASSWORD`）。
- **只出 x64**：覆盖绝大多数 Windows 机器；arm64 机器可由系统模拟运行 x64。
- **不做便携 zip**、不做自动更新器、不做 Electron 桌面壳。
- **`dsh plugin` 插件管理在装好的环境里不可用**：该命令把参数转发给 `pnpm`，而安装包不打包 pnpm。
  需要插件的人请装 Node + pnpm 后走标准 `dsh` CLI 流程。
- **卸载不会删数据**：`%USERPROFILE%\.dsh` 默认保留，卸载时会问是否删除。
- **安装器体积未在真机确认**：按 mac 上完整依赖树的量级推算可能落在 100~180MB，
  但 GitHub Release 附件上限远高于此，不影响发布；`build-local.ps1` 跑完会打印实际体积。
- 安装目录里没有前端构建步骤：Web 前端产物随 `@deepseek-ai/dsh` 包发布，目标机不需要 pnpm/build。
- **安装器 exe 只对 x64 Windows 有效**：`ArchitecturesAllowed=x64compatible`，在 32 位系统上会直接拒绝安装。

## 七、许可

本仓库的脚本与安装器配置按 MIT 使用。`@deepseek-ai/dsh` 经由 npm 安装，遵循其自身许可；
`installer/languages/ChineseSimplified.isl` 来自上游社区翻译项目，署名信息保留在文件头。
