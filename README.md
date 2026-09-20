# ohpm 包

## publish

```
ohpm publish /Users/shen/DevecostudioProjects/octicons-harmony/octicons/build/default/outputs/default/octicons.har
```

## 同步官方图标

```shell
# 同步 registry 上的最新版（会重写 octicons/src/main/resources/base/media 与 octicons/Index.ets）
node scripts/sync-octicons.mjs

# 指定版本 / 先看差异不落盘
node scripts/sync-octicons.mjs --version 19.38.0
node scripts/sync-octicons.mjs --dry-run

# 直连不通时走代理
node scripts/sync-octicons.mjs --proxy http://127.0.0.1:7890
```

脚本做的事：下载 `@primer/octicons` 的 npm tarball → 取出 `build/svg/*-24.svg` → 文件名里的 `-` 换成 `_` 后写入 media 目录 → 按文件名重新生成 `Index.ets` 的导出常量 → 更新 README 里的「已同步 vX」版本号。

> **约定：原封同步。** SVG 内容不做任何改写，与上游 npm 包逐字节一致（只有文件名要 `-` → `_`）。
> `node scripts/sync-octicons.mjs --check` 可以校验这一点：本地若被动过，退出码为 2。

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
