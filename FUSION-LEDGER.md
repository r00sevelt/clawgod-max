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

## 云端验收结果（10-17 · run 39025786306 · workflow_dispatch）

- 三 job（Linux/macOS/windows-smoke）全红，**共同根因**：CC **2.1.302** 的 CellSegmenter 渲染器形态未被识别 → **fail-closed 拒绝安装**（原文：`error: 此 Claude Code 依赖私有 Bun.ant.CellSegmenter，且渲染器形态未被 ClawGod 识别；已拒绝安装，避免产生无法进入交互界面的运行时`）。E2E 抓取 `@latest`=2.1.302；基座适配停在 301。
- 先通过项：Linux/macOS「Run Bun regression suite」✓；Windows「5 项 parity 回归 + PowerShell patch fallback」✓——倒在安装生命周期（同一 302 根因）。
- **定性：这就是触发线事件本身**——"2.1.302 渲染器适配"成为 clawgod-max 首个任务（**v0.1-d**）；上游 plus 同样未适配（其最新 release 停在 301）。
- **工作流定调（用户令）：云优先**——本地只做提取/对比/改源码；一切安装与 E2E 验证经 push + `workflow_dispatch` 在 Actions 跑。

## 里程碑

- [x] v0.1-a 基座搬运（2026-10-17：clone plus → 工作树、三 remote 就位）
- [ ] v0.1-b 全量测试矩阵跑通（`tests/*.mjs`，bun 1.3.14）
- [ ] v0.1-c 首次推送 r00sevelt/clawgod-max

## v0.1-d：Claude Code 2.1.302 适配（10-17 完成，待云端验收）

- **根因**：302 改变了渲染器模块结构（共享 CellSegmenter 工厂块与 299-301 参考结构一致，但渲染器与名称校验模块结构改变），结构识别与 301 冻结档案均不匹配 → fail-closed 拒绝安装。
- **方法**（"新版本冻结档案"流程，本次已固化）：
  1. 从 npm 拉取目标版本三平台包 → 仓库提取器提取（win32 2683 / linux 2686 / darwin 2705 模块，全部 0 dropped）；
  2. 角色扫描：ps-like 工厂调用 / class+stylePool 标记 / sanitize / 4 参数 setCell / 7 参数 writeLine / widthMask·emptyCharIndex·spacerCharIndex·emptyWord·chalkGeneration·charPool/hyperlink intern·styleId 链 / tabWidth / 切片器；
  3. 依赖块=渲染器导入且含 tokenizer(`t=Number.POSITIVE_INFINITY`)+normalizer 签名的分块；文本块=含共享 specifier+工厂调用的非渲染器分块；**切片器必须是被渲染器导入的核心函数**（win32=sjo / linux=ejo / darwin=Ijo；注意 wrapper（pde/ide/fde）未被导入，勿选）；
  4. shape 摘要=声明切片（findDeclarationEnd）sha256，与 301 档案格式逐字段对齐（已用 301 真实提取物复现全部字段验证方法）。
- **实现**：`src/generic/runtime/post-processor.mjs` 新增 3 条 2.1.302 冻结档案；dist 由 bun canary（1.4.4）重建、`build.mjs --check` 自检一致。
- **本机验证**：三平台真实模块图沙盒模拟（post-process 全流程）→ 适配成功、0 个 `Bun.ant.CellSegmenter` 残留、cli.original.cjs 产出；runtime-cell-segmenter 94 项契约 + runtime-cell-structure + bun-only-policy 全绿。
- **云端验收（10-17 完成）**：GitHub Actions run `39036324713` 三 job 全绿（Linux x64 / macOS ARM64 隔离安装 E2E + windows-smoke）。Linux 日志 `Optional plugins: 3 ready, 0 disabled, 0 warnings`，每次 `plugin marketplace add` 退出码 0。
- **中途根因与修复（重要教训）**：首版档案在 linux/darwin 上把行格类（`Dd`）锚到了无关的 `class Gd{`（错误堆栈过滤器，含 ignoredPackages/nodeInternals），真正的行格类是 `class rf{stylePool;charPool;native=...}`。适配器因此替换了错误堆栈类、保留真行格类 → 完整启动路径（`plugin marketplace add` / `plugin list`）在 Unix 上干完活却永不退出（strace 证据：空闲 epoll + 每秒一次 `statx ~/.claude.json` 的配置轮询器；`--version` 早退路径不受影响）；Windows 档案锚点正确故全绿。修复 = 改用上游官方 `v2026.10.17-claude.2.1.302` 冻结值（`class rf` + digest `dc68497d…`/`8043a742…`，与我方提取物用 findDeclarationEnd 逐字节核验一致）。
- **教训（v0.1-d.1 必须落实）**：行格类识别必须以 `stylePool;charPool;native=` 结构标记为准，禁止仅凭 class 关键字/启发式；补上游同款 302 夹具（`cell-renderer-2.1.302-*.txt` 四件套）并加"锚点类必须含 stylePool"断言。
- **待办**：302 夹具与单测矩阵（v0.1-d.1，可选）。

## v0.1-d.1 + v0.2.0：首批发版（10-18 完成）

- **v0.1-d.1**：从上游 `ebed315` 精确移植 12 个 302 夹具（`cell-renderer-2.1.302-*.txt`）与测试表项；新增行格类锚点守卫（`spans[1]` 必须含 `stylePool;charPool;native=`，fail-closed）与独立测试；`runtime-cell-segmenter` 扩至 100 项契约全绿。
- **writeLine 对齐**：302 档案原冻结源以 `dg(n,f,m,p)` 结尾（生产环境 `dg` 存在于真实分块，云端一直绿；但夹具是切片无 `dg`），已改为上游 `paintCells(n,p.cells,f,m)`，与官方适配完全一致。教训：冻结 profile 的 writeLine 也应指向注入的公开实现，而非原分块内部函数。
- **品牌化**：ClawGod Plus → **ClawGod Max**（46 文件：README×3、AGENTS、模板、自更新端点、测试断言、文档）；仓库 URL 切至 `r00sevelt/clawgod-max`；历史署名保留 3 处 "ClawGod Plus"（A6083450 原维护者）。
- **提交**：`37710d1`（main）；云端 Compat Daily run `39062348739` 三 job 全绿。
- **首发**：tag **`v0.2.0`**（仅推此 tag，本地 96 个上游 tag 一律未推）；Release run `39062966739` success；4 个核心资产已上传（install.sh / install.ps1 / 两个 chrome-fix），版本注入 `0.2.0` 校验通过；release notes 已替换为中文手写版；Build clawgod-import（run `39062966635`）并行构建 5 平台导入工具。


## 2026-10-19：fail-open 全覆盖（第 1 项：AST 源解析）

- **缺口**：patcher 初次 AST 扫描遇到上游源码解析失败（acorn SyntaxError）时直接 `exit 1`，即使带 `--allow-compatibility-fallback` 也不返回 42；上游形状漂移会回滚而不是安装 clean runtime。
- **实现**：`semantic-runner.mjs` 新增 `SourceCompatibilityError`；初次 `scanAstPatches` 的 SyntaxError 归类为兼容失败；编辑后 `parsePatchSource(patched)` 的 SyntaxError 仍为 fatal。`entry.mjs` 捕获该错误 → `failed++`、跳过后续 regex/custom patch 循环；带 `--allow-compatibility-fallback` 返回 42，否则 1；不写 bundle、不建 `.bak`。
- **测试**：`tests/patcher-compatibility-fallback.mjs` 新增 unparseable source 三用例（strict=1 / fallback=42 / dry-run+fallback=1），断言目标与 chunks 不变、无 `.bak`。
- **验证**：`patcher-compatibility-fallback`、`patcher-semantic-failures`、`patcher-semantic-scanner`、`patcher-semantic` 全绿；`bun build.mjs` 重建 dist 且 `--check` 通过。Windows 全量 `tests/*.mjs` 的 18 项失败均为既有 POSIX/环境限制（0600 模式、/bin/bash、shell launcher、mkdtemp 引号、ENOTDIR、信号传播），与本改动无关；云端 CI 待跑。
- **状态**：已推送；云端 Compat Daily run `39149515638` 三 job 全绿（Linux/macOS/Windows）。

## 2026-10-19：补丁分级（standard / all，绕过类 opt-in）

- **问题**：非交互安装默认 `mode:"all"`，21 项全开；`USER_TYPE → ant` 是 core 语义补丁，即使 `--enhancements none` 也会把账号伪装成 ant；`unrestricted-tools` 自带的安全/内容绕过（remove-cyber-risk、remove-url-restriction、remove-cautious-actions、remove-not-logged-in、attachment/message filter）随全开默认生效。
- **实现**：新增 `mode:"standard"` 作为默认档，21 项中排除显式 opt-in `unrestricted-tools`（20 项）；`all` 仍是显式全开；`custom` 不变。`USER_TYPE → ant` 从 core 移入 `unrestricted-tools`，与其余绕过同档。`--enhancements standard|all|none` 与 PowerShell `-Enhancements` 同步支持；交互菜单默认标准档，新增选项 4 为全部。
- **兼容**：已保存 `mode:"all"` 的旧配置继续全开；缺失配置的新装/更新走 standard；`custom` 选择不受影响。
- **测试**：增强配置引擎、安装器选择、E2E 期望、patcher 注册表断言同步更新；本地不跑测试，全部交云端 CI。
- **状态**：已推送；云端 Compat Daily run `39150901066` 三 job 全绿（Linux/macOS/Windows）。真实安装器 E2E 确认 `mode=standard`、20 enabled/1 disabled、0 failed；subset/core-only 契约不变。期间修正 4 处测试侧旧断言（README_JP 标记、E2E 契约、PowerShell 菜单头、patcher-semantic 显式 all 配置）。

## 2026-10-19：锚点 AST 化（第 1 批：agents / planning / auto-mode）

- **基础设施**：新增 `src/generic/patcher/ast-anchors.mjs`（`ANCHOR_PATCH_IDS` + `scanAstAnchors`）；`semantic.mjs` 导出 walk/helper 并接受预解析 tree；`semantic-runner.mjs` 每模块只 parse 一次，按已选锚点 ID 只跑对应 matcher；`entry.mjs` 语义批按 order 排序，`stale + optional` 沿用 regex 的 skip 语义。
- **第一批转换**：`agents#5`（Agent Teams：env/member + `tengu_amber_flint` 结构）、`planning#22`（Ultrareview：按 `tengu_review_bughunter_config` 字面量绑定 getter，去掉 `var ulu=` 压缩名 sentinel）、`auto-mode#26/#27`（firstParty/anthropicAws 与模型 ID 结构，去掉 300 字 lookahead 与 `claude-*-4-6` 写死）。描述符保留原 regex 字段，供 Task 5 快照和 runtime-features 直测；运行时由 AST matcher 接管。
- **测试**：新增 `tests/patcher-ast-anchors.mjs`（正/负样本、字符串诱饵、漂移 present、幂等）；`installer-build` 源文件清单加入 `ast-anchors.mjs`；2.1.215 字节 hash、registry、runtime-features 作为回归。
- **状态**：已推送；云端 Compat Daily run `39153612223` 三平台全绿。2.1.215 字节 hash 保持；真实 2.1.302 安装器 E2E 断言 `OK Agent Teams always enabled` 与 `OK Ultrareview enable (v2.1.215+ gate)` 均实际 apply；新单测 `patcher-ast-anchors` 通过。转换后 2.1.215 计数由 24/59 变为 23/60（v2.1.215+ 语义门取代 rQt 替代门，输出字节不变）。提交 `e60b538`（第 1 批）+ `b11db22`（左结合）/`0ef9c6b`（gate 键）/`a20bf8c`（计数）/`4fb43c0`（E2E 断言）。

## 2026-10-19：锚点 AST 化（第 2 批：core / chrome / agents）

- **基础设施**：新增 `src/generic/patcher/ast-anchors2/index.mjs`（`BATCH2_ANCHOR_IDS` + `scanBatch2Anchors`，单次 walk 分发多个 visitor）；`semantic-runner.mjs` 每模块只 parse 一次，合并 batch-1/batch-2 scanner；`terminal-reply-delay.mjs` 抽出共享 `terminalReplyDelay`，避免 core ↔ terminal-reply matcher 循环依赖；`installer-build` 源清单同步。
- **第二批转换**：`core#61`（context limit：AST 定位 4/5 连声明与 `return X?Y(X)>200000:!1`，保留 ESM refresh 注册）、`core#90`（terminal reply：定位 `flushIncomplete` 四语句体，插入与 regex replacer 完全相同的文本，含 `terminalReplyDelay.toString()`）、`chrome#13`（Chrome agents config：按六键集合定位，键序无关，拒绝 spread/重复键）、`agents#6`（session metadata：按单参 parser 循环、六 debug 旗标、`--debug-file` 跳对定位，插入 `--session-id` 分支）。描述符保留原 regex 字段，运行时由 AST matcher 接管。
- **测试**：新增 `tests/patcher-ast-anchors2-core.mjs`、`tests/patcher-ast-anchors2-enhancements.mjs`；覆盖正/负样本、字符串诱饵、漂移 present、幂等、字节比对；`installer-build` 源清单加入 batch-2 文件。
- **关键修正**：初版 context-limit 解构多了一个前导空位，导致 `1e6` 丢失、真实 2.1.302 chunk 首个导出名被删（Windows E2E `Export 'tJe' is not defined`）；修 `8ab47b7`。随后把“源码含 200000 即 stale”的旧 custom patch 兜底错误下放到单模块，导致 decoy 和真实多 chunk 匹配被误判；最终把兜底放到 `semantic-runner` 整包聚合层，并让真实 matches 优先（`1517061`），同时保留 `patcher-semantic` 的旧契约。
- **状态**：已推送；云端 Compat Daily run `39158502296` 三 job 全绿（Linux x64 / macOS ARM64 / windows-smoke）。Windows 真实 2.1.302 安装生命周期绿；同路径日志（8ab47b7）为 context-limit 9 replacements、整体 51 applied / 23 skipped / 0 failed。提交 `6b2d795`（第 2 批）+ `8ab47b7`（解构修正）/`f9da101`（中间尝试，已被取代）/`1517061`（整包 stale 兜底）。
- **教训**：AST matcher 的 `present` 是“单模块”信号，旧 regex/custom patch 的 stale 语义可能是“整包”信号；两者不能直接下放。跨模块聚合必须在 `semantic-runner` 层做，且真实 matches 优先于其他模块的 present。

## 2026-10-19：302 行格渲染器 AST fallback（定位改 AST、校验留字节）

- **目标与边界**：冻结档案与 2.1.299 结构档案保持快路径；只有全部失配且不属已知版本时，才用 acorn 定位行格类。
- **实现**：`post-processor.mjs` 新增 `astCellProfile` / `adaptCellRendererAst` / `frozenCellFamily`；`adaptCellRenderer` 顺序为冻结档案 → 2.1.299 结构档案 → family guard → AST fallback。AST 只负责定位，替换仍复用 `adaptCellRendererShape` 的 header/digest/span 与 `stylePool;charPool;native=` 守卫；替换后重新 parse，校验注入标记、`writeCell`/`paintCells`、原行格类标记消失、无私有 `Bun.ant.CellSegmenter` 残留。共享安装路径同步支持 AST 发现的 shared profile，并对“冻结分块名命中但渲染器漂移”的情况重试结构档案。
- **测试**：新增 `tests/runtime-cell-ast-fallback.mjs`，覆盖 302 三平台真实夹具、错误堆栈类诱饵、候选歧义、替换后守卫失败、冻结快路径优先、已知版本依赖漂移拒绝、合成新版本 fallback。
- **关键修正**：首版 fallback 门禁只比 `structuralModule` digest，2.1.299 的 `widthMask:vn → widthMask:unknown` 漂移被误判为新版本；`c02fb5f` 在 `CELL_STRUCTURAL_SHAPES` 三个 renderer 加 `topBindings` 指纹，digest 或顶层绑定指纹任一命中即拒绝 fallback。
- **状态**：已推送；云端 Compat Daily run `39161778236` 三 job 全绿（Linux x64 / macOS ARM64 / windows-smoke）。提交 `8ec8660`（fallback）+ `c02fb5f`（2.1.299 家族指纹）。
- **教训**：`structuralModule.digest` 对绑定改名不敏感，但对“把绑定换成自由全局”敏感；已知版本的 family guard 不能只看 digest，需要加一个顶层绑定指纹。