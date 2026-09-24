# DeepSeek Harness · Windows 安装器构建仓库

把 npm 上发布的 [`@deepseek-ai/dsh`](https://www.npmjs.com/package/@deepseek-ai/dsh)（DeepSeek Harness）打成一个
Windows x64 安装器：**双击安装、免管理员、key 由每个使用者自己配**。

- 构建在 GitHub Actions 的 `windows-latest` 上完成，**不需要 Windows 机器**。
- 产物：`dist/DeepSeek-Harness-Setup-<version>-x64.exe` + `dist/SHA256SUMS.txt`。
- 安装后只写两个位置：`%LOCALAPPDATA%\Programs\DeepSeek Harness`（程序）和
  `%USERPROFILE%\.dsh`（API Key、设置、会话）。**不写 Program Files，不写 HKLM，不弹 UAC。**

> 为什么必须在 Windows 上构建：`@deepseek-ai/dsh` 的原生依赖是按平台拆包的
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
| `.github/workflows/build-windows.yml` | CI：装 Node → 打 staging → 冒烟 → 编安装器 → 上传 artifact / 发 Release |
| `scripts/prepare-portable.mjs` | staging 主脚本：下载并校验 Node、`npm install` dsh、校验平台包、瘦身、产物断言 |
| `scripts/smoke-test.mjs` | **强制门禁**：用打好的 `node.exe` 真启动 `--profile web`，抓取带 token 的启动 URL 并断言 HTTP 200 + 页面标题 |
| `scripts/build-local.ps1` | 本地 Windows 一键构建（与 CI 完全相同的步骤） |
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

## 三、发布流程

### 1. 推到 GitHub

```sh
cd dsh-windows-installer
git add -A
git commit -m "DeepSeek Harness Windows installer"
gh repo create dsh-windows-installer --private --source . --push
```

（也可以用 GitHub 网页手动建仓库再 `git remote add origin ...` + `git push`。）

### 2. 触发构建

**方式 A：手动跑一次，拿 artifact**

Actions → `build-windows` → Run workflow。可以临时改 `dsh_version` / `node_version` 试版本。
产物在本次 run 的 Artifacts 里（`DeepSeek-Harness-Setup-x64`）。

**方式 B：打 tag 发 Release**

```sh
git tag v0.1.5-rc.3
git push origin v0.1.5-rc.3
```

会创建同名 Release，附上 `*.exe` 和 `SHA256SUMS.txt`。

### 3. 升级 dsh 版本

只改 `.github/workflows/build-windows.yml` 顶部的 `DSH_VERSION`（和 `package.json` 的
`dsh.dist.dshVersion` 保持一致即可，两者都可被手动触发的输入覆盖），然后打新 tag。
当前已发布版本：`latest = 0.1.5-rc.3`；`0.1.6`/`0.1.7` 目前只有 alpha/next 标签。
`node_version` 默认 `24.21.0`（Node 24 LTS 线，与开发机一致）。

---

## 四、本地构建（Windows 机器 / Windows 虚拟机）

```powershell
# 需要 Node >= 22；Inno Setup 6 可以先装好，脚本找不到时会尝试 winget/choco 安装
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-local.ps1

# 常用参数
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-local.ps1 `
  -DshVersion 0.1.5-rc.3 -NodeVersion 24.21.0 `
  -Registry https://registry.npmmirror.com      # 国内网络可用镜像
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
   镜像地址可用 `NODE_MIRROR` 覆盖。
2. 解压 Node 到 `build/portable`（自带 inflate，不依赖 tar/Expand-Archive）。
3. `npm install @deepseek-ai/dsh@<ver> --prefix build/portable/app --omit=dev --ignore-scripts`
   （失败自动重试 3 次；`NPM_REGISTRY` 可换镜像）。
4. **平台包校验**：`sharp`、`@img/sharp-win32-x64`、`node-addon-require-builtin`、
   `node-addon-require-builtin-win32-x64-msvc` 必须存在，否则直接失败。
5. 瘦身：删掉 `node_modules` 里的 `*.md` / `*.map` / `*.d.ts` / LICENSE 副本（只影响体积）。
6. 生成 `build/build-info.json`（dsh 版本、Node 版本、commit、构建时间）与 `VERSION.txt`。
7. **密钥断言**：staging 里出现 `.credentials.yaml`、`.env` 或 `sk-` 形态字符串就失败——安装包永不携带 key。
8. **冒烟门禁**（Windows）：用打包好的 `node.exe` 跑 `--dump-default-config`，再真启动
   `--profile web --port 0`，抓带 token 的启动 URL、跟随跳转断言 `200` + `<title>DeepSeek Harness</title>`，
   并确认全新 home 会初始化 `profiles/web`，且没有写入任何 provider key。

---

## 六、已知边界

- **不做代码签名**：无证书，首次运行可能出现 SmartScreen「仍要运行」提示。要接签名就在
  `build-windows.yml` 的编译步骤后加 `signtool`（需要仓库 secrets 里的证书）。
- **只出 x64**：覆盖绝大多数 Windows 机器；arm64 机器可由系统模拟运行 x64。
- **不做便携 zip**、不做自动更新器、不做 Electron 桌面壳。
- **`dsh plugin` 插件管理在装好的环境里不可用**：该命令把参数转发给 `pnpm`，而安装包不打包 pnpm。
  需要插件的人请装 Node + pnpm 后走标准 `dsh` CLI 流程。
- **卸载不会删数据**：`%USERPROFILE%\.dsh` 默认保留，卸载时会问是否删除。
- 安装目录里没有前端构建步骤：Web 前端产物随 `@deepseek-ai/dsh` 包发布，目标机不需要 pnpm/build。

## 七、许可

本仓库的脚本与安装器配置按 MIT 使用。`@deepseek-ai/dsh` 经由 npm 安装，遵循其自身许可；
`installer/languages/ChineseSimplified.isl` 来自上游社区翻译项目，署名信息保留在文件头。
