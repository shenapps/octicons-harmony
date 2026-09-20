# ohpm 包

本仓产出 **两个独立 ohpm 包**：

| 包 | 模块 | 图标 |
| --- | --- | --- |
| `@isfk/octicons` | `octicons/` | Primer [octicons](https://github.com/primer/octicons) 的 24px 图标（填充型） |
| `@isfk/lucide` | `lucide/` | [lucide](https://lucide.dev) 的 24×24 图标（描边型） |

## publish

```shell
ohpm publish /Users/shen/DevecostudioProjects/octicons-harmony/octicons/build/default/outputs/default/octicons.har
ohpm publish /Users/shen/DevecostudioProjects/octicons-harmony/lucide/build/default/outputs/default/lucide.har
```

## 同步官方图标

两套图标集**流程相同，只换脚本**：`sync-octicons.mjs` / `sync-lucide.mjs`（引擎在 `scripts/lib/`，新图标集加一个 profile 就行）。

```shell
# 同步 registry 上的最新版（会重写 <模块>/src/main/resources/base/media 与 <模块>/Index.ets）
node scripts/sync-octicons.mjs
node scripts/sync-lucide.mjs

# 指定版本 / 先看差异不落盘
node scripts/sync-octicons.mjs --version 19.38.0
node scripts/sync-lucide.mjs --dry-run

# 直连不通时走代理
node scripts/sync-octicons.mjs --proxy http://127.0.0.1:7890
```

脚本做的事：下载图标包的 npm tarball → 挑出要的 svg、把文件名换成合法的鸿蒙资源名后写入 media 目录 → 按文件名重新生成 `Index.ets` 的导出常量 → 更新 README 里的「已同步 vX」版本号。

> **约定：Octicons 原封同步。** SVG 内容与上游 npm 包逐字节一致（只有文件名要 `-` → `_`）。
> `node scripts/sync-octicons.mjs --check` 可以校验：本地若被动过，退出码为 2。
>
> **lucide 有两处最小归一化**：去掉文件头 HTML 许可注释、`stroke="currentColor"` → `"#000000"`（± 等价）。原因：lucide 是 `fill="none"` 的描边图标，ArkUI 的 `fillColor` 对它不生效，颜色改由 `LucideIcon` 的 `colorFilter(SRC_IN)` 统一控制。

零依赖（Node >= 18），全部选项见 `node scripts/sync-octicons.mjs --help`。常用：

| 选项 | 说明 |
| --- | --- |
| `--version <x.y.z>` | 指定上游版本，默认 latest |
| `--dry-run` | 只汇报差异，不改动文件 |
| `--check` | CI 用，有差异时退出码 2 |
| `--proxy <url>` / `--downloader curl` | 直连不通时走代理；`curl` 会自动尊重 `http_proxy`、`socks5` 等环境变量 |
| `--prune` | 删除上游已移除的本地图标（默认只提示不删） |
| `--from-dir` / `--from-tarball` | 离线：用本地已解压目录或 .tgz |
| `--sanitize` | 应急备用，本项目不用：去掉 `fill="currentColor"` / 根节点 `fill="none"` |
