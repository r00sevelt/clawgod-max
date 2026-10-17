# CLAWGOD-MAX FUSION LEDGER（融合账本）

创建：2026-10-17 ｜ 公开壳：r00sevelt/clawgod-max ｜ 本地工作树：`Documents\Development\Projects\clawgod-max`

## 基座

- **基座 = clawgod-plus @ 82d7a73（v2026.10.16-claude.2.1.301）**——已含上游 v2.2.0 完整语义 parity（plus `docs/superpowers/plans/2026-10-15-upstream-v2.2.0-parity.md`，6 任务全勾）。
- remotes：
  - `origin` → https://github.com/r00sevelt/clawgod-max.git（发布壳，暂为空仓）
  - `upstream-plus` → https://github.com/A6083450/clawgod-plus.git
  - `upstream-clawgod` → https://github.com/0Chencc/clawgod.git（已抓取，含 v2.2.0 标签）

## 融合原则（plus 10-15 parity 的实证结论）

1. 语义移植进 plus 架构，**不硬合并**上游生成安装器；
2. **不搬**：global standalone=true / native execPath / 第二套 renderer shim（架构冲突，双渲染器=负资产）；
3. 上游每次发版 → 六类对账 → 移植 → 测试矩阵 → 发布。

## 六类对账基线（每次上游发版 tick 一遍）

1. AST 语义补丁（上游 `src/shared/ast-patches.mjs` ↔ 本仓 `src/generic/patcher/semantic*.mjs`）
2. OpenAI Chat Completions 协议翻译（openai-proxy）
3. 文本资源源字符串加载（post-processor）
4. 升级选项/完整备份/回滚（lifecycle + self-update + repatcher）
5. Wrapper 协议选择、离线版本、启动超时（wrapper + startup-check）
6. remote-settings 归属 privacy

## 明确不吸收（记录理由，勿反复重开）

- 上游根级 `install.ps1/sh`（旧安装器路径；本仓由 `build.mjs` 生成 `dist/`）
- `web/` 官网、issue 自动关闭脚本（非产品物 / 明确否决自动关 issue）
- bun-ant shim / standalone / native execPath（架构冲突）

## 工程事实记录（10-17 基座检查发现）

- `bun build.mjs --check` 依赖 **Bun canary**：plus 的 release/compat 工作流均以 `bun-version: canary` 生成 dist；本机 mise bun 1.3.14 生成的 dist 与仓库内产物字节不同（差异在内嵌 patcher 的 base64），判定为**版本差异**而非源过期。
- 处置：本地不重新生成 dist（保持发布期产物为准）；dist 视为 CI（canary）生成物。
- 复现风险备注：canary 为浮动版本 → dist 未来可复现性可能漂移（改进候选：钉定构建用 bun 版本，或记录每次发布所用 bun 版本）。

## 测试验收基线（10-17 本机实测，Bun 1.3.14 / Windows x64）

- **上游自家的 Windows 标准 = 定向子集**（compat-daily `windows-smoke` 作业）：`wrapper-provider-lean`、`openai-proxy`、`patcher-terminal-replies`、`patcher-voice-input`、`runtime-cell-segmenter`、`installer-windows-patch-fallback`（+ 隔离安装生命周期 E2E，暂未跑）→ **本基座 6/6 定向测试全部通过 ✓**
- 完整 60 项矩阵按上游设计仅跑 Linux/macOS（Bun canary）；**原生 Windows 非受支持目标**。本机全量复跑 = **42/60 通过**，18 项失败归类：
  - ① **POSIX 专属夹具/语义**（非法 Windows 文件名 `?`/`"`、ENOTDIR、SIGTERM）：installer-plugin-dependencies、patcher-enhancement-selection、patcher-install-no-upgrade-control-flow、patcher-repatch-enhancement-selection、patch-fallback-state、wrapper-self-update
  - ② **Windows spawn/退出码语义差异**（部分可能随 Bun 版本变化）：helpers-bun-only、installer-bun-runtime、installer-e2e-contract、installer-enhancement-selection、installer-herdr-agent、installer-smoke-status、patcher-claude-mem、patcher-worker-launch、self-update
  - ③ **待人工复核**（可能真实/环境相关）：enhancement-config（438 ≠ 384）、installer-registry-download（archive missing package/claude.exe）
- 版本归因实验（10-17 完成）：上述 18 项用 **Bun 1.4.2** 复跑 → **0/18 翻绿，全部照旧失败** → 判定为**平台/测试设计差异，与 Bun 版本无关**；③类两项（enhancement-config 438≠384、installer-registry-download 缺 `package/claude.exe`）留待人工复核。

## 里程碑

- [x] v0.1-a 基座搬运（2026-10-17：clone plus → 工作树、三 remote 就位）
- [ ] v0.1-b 全量测试矩阵跑通（`tests/*.mjs`，bun 1.3.14）
- [ ] v0.1-c 首次推送 r00sevelt/clawgod-max
