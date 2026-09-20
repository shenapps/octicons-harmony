# AGENTS.md — @isfk/octicons

把 Primer 官方 [octicons](https://github.com/primer/octicons) 的 24px SVG 同步进 HAR 资源，对外提供 `OctIcon` 组件 + 图标名常量。

## 触发词：更新版本

主人说「更新版本」「同步图标」「同步 octicons」，把下面的流程走完一遍。

1. **预检** — `node scripts/sync-octicons.mjs --dry-run`
   完成标准：报出**上游版本 + 新增 / 更新 / 未变 / 本地多余**五个数字，并点名「更新」的图标（这些是上游改版，图形会变，要单独提醒主人）。
   `新增 0 / 更新 0` 即已最新——汇报后停下。
2. **同步** — `node scripts/sync-octicons.mjs`
   完成标准：新增 + 更新的 svg 已落盘，`Index.ets` 与 `octicons/README.md` 的「已同步 vX」都跟着更新。
   走默认参数，保持「原封同步」。
3. **发版号** — `octicons/oh-package.json5` 版本号只递增最后一位（`1.0.4` → `1.0.5`），主人另有指定再按指定。
   完成标准：`octicons/CHANGELOG.md` 顶部新增一条 `# vX.Y.Z Release` + 一行说明（同步的上游版本、新增图标数、改版图标）。
4. **校验** — `node scripts/sync-octicons.mjs --check`
   完成标准：退出码 `0`；且 `ls octicons/src/main/resources/base/media/*.svg | wc -l` 等于 `grep -c '^export const' octicons/Index.ets`。
5. **构建** — `hvigorw --mode module -p module=octicons@default -p product=default -p buildMode=release assembleHar --no-daemon`
   完成标准：`BUILD SUCCESSFUL`，且 `octicons/build/default/outputs/default/octicons.har` 是刚生成的。
   要带 `-p buildMode=release`：否则包内 `debug:true` 且带 `ets/sourceMaps.map`，ohpm 会警告「contains source code」。
6. **验收** — 拆 HAR 核对（HAR 是 **gzip + tar** 的 `package/...` 布局，`unzip` 打不开）
   ```shell
   gunzip -c octicons/build/default/outputs/default/octicons.har > /tmp/o.har.tar
   tar -tf /tmp/o.har.tar | grep -c 'base/media/.*\.svg$'              # == Index.ets 常量数
   tar -tf /tmp/o.har.tar | grep -cE '\.DS_Store|sourceMaps\.map'       # == 0
   tar -xOf /tmp/o.har.tar package/oh-package.json5                    # 版本号是新版、debug:false
   ```
   完成标准：svg 数量与常量数相等、新图标 0 缺失、无 macOS 垃圾与 sourcemap、包内版本号是新版。
7. **发布** — 先自检，**再**发布：
   `node scripts/check-publish-env.mjs`
   完成标准：退出码 `0`（可免交互发布）。退出码 `2` 表示密码未配置，必须到交互式终端发布（agent 代跑会卡死）；退出码 `1` 表示环境有问题，先修。
   ```shell
   ohpm publish octicons/build/default/outputs/default/octicons.har
   ```
   「发布」指把 HAR 推到 ohpm registry，与 git `commit`/`push` 是两件事（后者始终由主人手动）。
   完成标准：命令返回成功即可。**注意：官方要审核，上架很慢** —— 提交后 `latest` 会在相当长时间里仍是上一版，`curl .../@isfk/octicons/<新版本>` 返回 404 也是正常的，**别当成失败去重发**。
   核实用：`curl -s -o /dev/null -w '%{http_code}\n' https://ohpm.openharmony.cn/ohpm/@isfk/octicons/<版本>`（`200` = 已上架）。
   目标版本已在 registry 上时**先改版本号**，ohpm 不能覆盖已发布版本。
8. **汇报** — 列出改了什么、HAR 的 `shasum -a 256`、以及 commit 信息建议（不提交）。

## 约定

- **图标与 `Index.ets` 都归脚本管**：`octicons/src/main/resources/base/media/*.svg` 和 `octicons/Index.ets` 是同步脚本的产物。要加图标、删图标、改图标，就调同步范围或上游版本再跑脚本，手改会在下次同步时被覆盖。
- **手写的只有三处**：`octicons/src/main/ets/components/OctIcon.ets`、`scripts/sync-octicons.mjs`、`scripts/check-publish-env.mjs`。
- **原封同步**：svg 内容与上游 npm 包逐字节一致，脚本只把文件名的 `-` 换成 `_`（鸿蒙 media 资源名限 `[a-z0-9_]` 且字母开头）。所以上游 `alert-fill-24.svg` 落盘为 `alert_fill_24.svg`，导出 `AlertFillIcon`。`--sanitize` 是应急开关，本仓不用。
- **本仓约定不改写 fill**：`flag_24`（根节点 `fill="none"` + 路径 `fill="currentColor"`）和 `vscode_24`（`fill="currentColor"`）按官方原样保留，最终颜色由 ArkUI 解析决定；其余 7 个带 `fill-rule` 的图标官方文档确认支持。
- **删文件先问**：`--prune` 默认关闭，本地多余图标只汇报不删。
- **发布凭据**：`~/.ohpm/.ohpmrc` 里的 `publish_id` + `key_path` + `key_passphrase`，键值都不要打印或写入任何文件/日志。私钥**必须带密码**（PKCS#1 PEM：`ssh-keygen -t rsa -b 4096 -m PEM -f <file>`；无密码的私钥 ohpm 直接报 `NotSupportPrivateKey`）。密码丢了只能重新生成密钥对，并到 ohpm 网站「OHPM公钥」里**新增公钥**（`publish_id` 是账号级的，不用换，见上节）。
- **发布 ≠ 提交**：`ohpm publish` 是本流程的最后一步，由 agent 执行；`git add`/`commit`/`push`/`tag` 始终由主人手动完成（全局规则 1）。
- **`author` 保持对象形态**：`octicons/oh-package.json5` 里 `author` 必须是 `{ "name": ..., "url": ... }`（服务端要求 url 或 email，参照 `@ohos/axios` 只给 url 即可），写成字符串会被 400 拒。改了元数据必须**重新构建** —— 它是打进 HAR 的。
- `entry/` 是演示 App，不参与发布；它依赖的 `@isfk/octicons` 版本号与本地开发不同步属正常。

## 换发布密钥（官方步骤）

ohpm 只支持**加密密钥**认证 —— 生成时必须输入密码；无密码的私钥它直接拒（`NotSupportPrivateKey`）。密码丢失只能重来一遍：

```shell
# 1. 生成公私钥（会提示输入密码，必填）
ssh-keygen -m PEM -t RSA -b 4096 -f ~/.ssh/ohpm_key_v2

# 2. 配置私钥路径
ohpm config set key_path ~/.ssh/ohpm_key_v2

# 3. 配置发布码（个人中心 → OHPM公钥管理 里拿到的 publish_id）
ohpm config set publish_id <your-publishId>
```

**4. 在个人中心 → OHPM公钥管理里添加公钥**，粘贴 `~/.ssh/ohpm_key_v2.pub` 文件的内容（OpenSSH 单行格式，**不是** `openssl rsa -pubout` 的多行 PEM）。入口：`https://ohpm.openharmony.cn/#/cn/personalCenter` → 左侧「OHPM公钥」→ 右上「新增」→ 填「标题」+「将公钥粘贴在这里」→ 提交。

> **`publish_id` 是账号级的，换密钥不用换它**：它在个人中心的个人资料页，按钮叫「**复制发布码**」（点一下入剪贴板），本地就是 `ohpm config get publish_id` 那个值。公钥页面可以登记**多把**公钥（页面会显示「您当前的OHPM公钥数」），所以换钥匙只需新增公钥，`publish_id` 保持不动。

发布时 ohpm 会问 `what is your passphrase of the private key:`；想免交互就 `ohpm config set key_passphrase '<密码>'`（密码明文落在 `~/.ohpm/.ohpmrc`，先 `chmod 600 ~/.ohpm/.ohpmrc`）。

## 排错

| 现象 | 处理 |
| --- | --- |
| 命令"卡住" | hvigor 常驻 daemon 是常见元凶：`hvigorw --stop-daemon`，构建时加 `--no-daemon` |
| 下载超时 / 慢 | `--proxy http://127.0.0.1:7890`；脚本也会读 `https_proxy`/`http_proxy` 并用 curl 兜底 |
| 想快点失败 | `--timeout 10` |
| 想复现历史版本 | `--from-tarball octicons-x.y.z.tgz` 或 `--from-dir <解压目录>` |
| 要重新下载 | `--refresh`（缓存 `.octicons-cache/`，已 gitignore） |
| 发布鉴权失败 | 依次查 `ohpm config get publish_id` / `key_path` / `key_passphrase`。此版 ohpm（26.0.0.630）**没有 `login` 命令**，鉴权只有 publish_id + 加密私钥签名这一条路 |
| 发布刷屏 `The content of private key in the key_path error` 然后 V8 崩溃 | 签名拿不到私钥密码（非交互环境无 TTY 可输入），而 ohpm 在签名失败处是**死循环**，会一直刷到 OOM。修：`ohpm config set key_passphrase '<密码>'`，或到交互式终端里发布 |
| 发布成功后 registry 上查不到新版本 | 官方审核期，上架很慢；`404` + `latest` 停在上一版都属正常。别重发同版本，等审核或看个人中心的「审核中/已上架」 |
| 发布报 `HttpCode 400 The format of the OHPM package no author url or author email` | `author` 写成了字符串。改成对象 `{ "name": "isfk", "url": "https://github.com/isfk" }` 后**重新构建**（元数据打进 HAR）。`ohpm prepublish` **查不出这一条**，别指望它 |
| HAR 里混入 `.DS_Store` | 它躲在 `octicons/src/main/resources/base/`（被全局 gitignore 挡住所以 git 看不到），删掉后重新构建 |

选项的完整清单看 `node scripts/sync-octicons.mjs --help`。
