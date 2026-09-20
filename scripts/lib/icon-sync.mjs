#!/usr/bin/env node
/**
 * icon-sync.mjs —— 图标集同步引擎（零依赖，Node >= 18）
 *
 * 干的事：
 *   1. 拉 npm registry 上某个图标包的 tarball（带 sha512 校验）
 *   2. 按 profile 挑出需要的 svg、换算成鸿蒙资源名，写进模块的 media 目录
 *   3. 按文件名重新生成模块 Index.ets 的导出常量、更新 README 的「已同步 vX」
 *
 * 与具体图标集的差异全部收在 profile 里（见 profiles.mjs），本文件只管流程。
 * 入口：scripts/sync-<id>.mjs → runIconSync(profile, argv)
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const LIB_DIR = dirname(fileURLToPath(import.meta.url));
/** 项目根：scripts/lib/ 往上两级 */
const ROOT = resolve(LIB_DIR, '..', '..');

const REGISTRY = 'https://registry.npmjs.org';

/** 当前生效的图标集配置，由 runIconSync 注入 */
let P = null;

function helpText() {
  const sizeLine = P.sizes
    ? `      --size <n>          图标尺寸，默认 ${P.paths.size}（可选 ${P.sizes.join(' / ')}）\n`
    : '';
  const sanitizeLine = P.sanitize
    ? '      --sanitize          去掉 fill="currentColor" 与根节点 fill="none"。应急用，本仓约定不使用（保持与上游逐字节一致）\n'
    : '';
  return `
把 ${P.label} 图标同步到本仓库的 ${P.id} 模块

用法:
  node scripts/sync-${P.id}.mjs [选项]

选项:
  -v, --version <x.y.z>   指定 ${P.packageName} 版本，默认取 registry 上 latest
${sizeLine}      --media-dir <path>  svg 输出目录，默认 ${P.relPaths.mediaDir}
      --index <path>      Index.ets 路径，默认 ${P.relPaths.indexFile}
      --readme <path>     README 路径（用于更新「已同步 vX」），默认 ${P.relPaths.readmeFile}
      --cache-dir <path>  tarball 缓存目录，默认 ${P.relPaths.cacheDir}
      --from-dir <path>   离线模式：直接读本地已解压的包目录（内含 ${P.fromDirSub}）
      --from-tarball <p>  离线模式：读本地 .tgz
      --refresh           忽略缓存，强制重新下载
      --proxy <url>       下载代理，如 http://127.0.0.1:7890（默认读 HTTPS_PROXY/http_proxy）
      --downloader <m>    auto（默认）/ curl：curl 会天然尊重 http_proxy、socks5 等环境变量
      --timeout <sec>     单次网络超时，默认 30 秒
${sanitizeLine}      --prune             删掉本地多余（上游已移除）的图标文件
      --no-index          不重新生成 Index.ets
      --no-readme         不改 README
      --dry-run           只汇报差异，不改动项目文件（仅写 tarball 缓存）
      --check             CI 用：有差异时退出码 2，无差异 0
      --json              以 JSON 输出结果
  -q, --quiet             只输出错误
  -h, --help              显示本帮助

退出码: 0 正常 / 1 出错 / 2 --check 发现差异
`;
}

/* ------------------------------------------------------------------ 参数解析 */

function parseArgs(argv) {
  const opts = {
    ...P.paths,
    flags: new Set(),
    version: null,
    fromDir: null,
    fromTarball: null,
    proxy: null,
    downloader: 'auto',
    timeoutMs: 30_000,
  };
  const need = (i, key) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`${key} 需要一个值`);
    return v;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [key, inline] = arg.startsWith('--') && arg.includes('=') ? arg.split(/=(.*)/s, 2) : [arg, null];
    const value = (k) => (inline !== null ? inline : need(i++, k));

    switch (key) {
      case '-h': case '--help': opts.flags.add('help'); break;
      case '-v': case '--version': opts.version = value(key); break;
      case '--size': opts.size = Number(value(key)); break;
      case '--media-dir': opts.mediaDir = resolve(value(key)); break;
      case '--index': opts.indexFile = resolve(value(key)); break;
      case '--readme': opts.readmeFile = resolve(value(key)); break;
      case '--cache-dir': opts.cacheDir = resolve(value(key)); break;
      case '--from-dir': opts.fromDir = resolve(value(key)); break;
      case '--from-tarball': opts.fromTarball = resolve(value(key)); break;
      case '--proxy': opts.proxy = value(key); break;
      case '--downloader': opts.downloader = value(key); break;
      case '--timeout': opts.timeoutMs = Math.max(500, Number(value(key)) * 1000); break;
      case '--refresh': opts.flags.add('refresh'); break;
      case '--sanitize': opts.flags.add('sanitize'); break;
      case '--prune': opts.flags.add('prune'); break;
      case '--no-index': opts.flags.add('no-index'); break;
      case '--no-readme': opts.flags.add('no-readme'); break;
      case '--dry-run': opts.flags.add('dry-run'); break;
      case '--check': opts.flags.add('check'); opts.flags.add('dry-run'); break;
      case '--json': opts.flags.add('json'); break;
      case '-q': case '--quiet': opts.flags.add('quiet'); break;
      default: throw new Error(`未知参数 ${arg}`);
    }
  }

  if (P.sizes) {
    if (!P.sizes.includes(opts.size)) throw new Error(`--size 只支持 ${P.sizes.join(' / ')}，收到 ${opts.size}`);
  } else if (opts.size !== P.paths.size) {
    throw new Error(`${P.packageName} 只有 ${P.paths.size}px 图标`);
  }
  if (!['auto', 'curl'].includes(opts.downloader)) throw new Error(`--downloader 只支持 auto / curl，收到 ${opts.downloader}`);
  if (!Number.isFinite(opts.timeoutMs)) throw new Error('--timeout 需要一个秒数');
  if (opts.fromDir && opts.fromTarball) throw new Error('--from-dir 与 --from-tarball 不能同时使用');
  return opts;
}

/* ------------------------------------------------------------------ 下载 */

/** 环境里的代理，优先 https_proxy，其次 http_proxy */
function envProxy() {
  return process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || null;
}

/**
 * 下载到文件。
 * 顺序：fetch（带超时）→ 失败且存在代理则回退 curl（curl 天然支持 http_proxy / socks5）。
 * 好处：直连被黑洞时不会无限期干等，也不会忽略主人已经 export 的代理变量。
 */
async function downloadToFile(url, dest, opts) {
  mkdirSync(dirname(dest), { recursive: true });

  const proxy = opts.proxy || envProxy();
  const log = (...args) => { if (!opts.flags.has('quiet')) console.log(...args); };

  if (opts.downloader === 'auto' && !opts.proxy) {
    try {
      const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(opts.timeoutMs) });
      if (!res.ok) throw new HttpError(res.status, url);
      writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
      return 'fetch 直连';
    } catch (err) {
      if (err instanceof HttpError) throw err;
      if (!proxy) {
        throw new Error(
          `直连下载失败（${opts.timeoutMs / 1000}s 超时）：${err.message}\n` +
          '网络不通时可以指定代理： --proxy http://127.0.0.1:7890',
        );
      }
      log(`  ↳ 直连失败（${err.message}），改用 curl + 代理重试`);
    }
  }

  try {
    execFileSync('curl', [
      '-fsSL',
      '--connect-timeout', String(Math.min(20, opts.timeoutMs / 1000)),
      '--max-time', String(Math.max(60, opts.timeoutMs / 1000)),
      ...(proxy ? ['-x', proxy] : []),
      '-o', dest, url,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (err) {
    if (err.code === 'ENOENT') throw new Error('没找到 curl，请换回直连（去掉 --downloader curl）或安装 curl');
    const detail = err.stderr ? err.stderr.toString().trim() : '';
    const where = proxy ? `通过代理 ${proxy} ` : '直连 ';
    throw new Error(`${where}下载失败（curl 退出码 ${err.status ?? err.code}）${detail ? `：${detail}` : ''}`);
  }
  return proxy ? `curl(${proxy})` : 'curl 直连';
}

/** 取版本清单（含 dist.tarball / dist.integrity），小体积接口 */
async function fetchManifest(opts) {
  const spec = opts.version ? opts.version : 'latest';
  const url = `${REGISTRY}/${P.packageName.replace('/', '%2f')}/${spec}`;
  const cacheFile = join(opts.cacheDir, `manifest-${spec}.json`);
  let raw;
  try {
    await downloadToFile(url, cacheFile, opts);
    raw = readFileSync(cacheFile, 'utf8');
  } catch (err) {
    if (existsSync(cacheFile)) {
      console.warn(`⚠ 读取 registry 失败，改用缓存清单：${err.message.split('\n')[0]}`);
      raw = readFileSync(cacheFile, 'utf8');
    } else if (err.status === 404) {
      throw new Error(`${P.packageName}@${spec} 在 registry 上不存在，检查一下版本号（默认取 latest）`);
    } else {
      throw err;
    }
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`registry 返回的版本清单不是合法 JSON：${spec}`);
  }
}

function readPackageVersion(pkgJsonPath) {
  try {
    return JSON.parse(readFileSync(pkgJsonPath, 'utf8')).version;
  } catch {
    return null;
  }
}

/** 直接从 tarball 里读 package/package.json 的版本号 */
function readTarballVersion(tarball) {
  try {
    const entry = readTar(gunzipSync(tarball)).get('package/package.json');
    return entry ? JSON.parse(entry.toString('utf8')).version : null;
  } catch {
    return null;
  }
}

class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status} ${url}`);
    this.status = status;
  }
}

function sha512Base64(buf) {
  return createHash('sha512').update(buf).digest('base64');
}

/* ------------------------------------------------------------------ tar 解包（纯 Node，零依赖） */

function isZeroBlock(buf, off) {
  for (let i = 0; i < 512; i++) if (buf[off + i] !== 0) return false;
  return true;
}

function readCString(buf, start, len) {
  const slice = buf.subarray(start, start + len);
  const end = slice.indexOf(0);
  return (end === -1 ? slice : slice.subarray(0, end)).toString('utf8').trim();
}

function readSize(buf, start, len) {
  if (buf[start] & 0x80) {
    let v = 0; // base-256（大文件才会用，这里只是保险）
    for (let i = start; i < start + len; i++) v = v * 256 + buf[i];
    return v;
  }
  const s = readCString(buf, start, len);
  return s ? parseInt(s, 8) || 0 : 0;
}

/** pax 扩展头：`"<长度> key=value\n"` 重复 */
function parsePax(buf) {
  const out = {};
  let i = 0;
  while (i < buf.length) {
    const sp = buf.indexOf(0x20, i);
    if (sp < 0) break;
    const len = Number.parseInt(buf.subarray(i, sp).toString('utf8'), 10);
    if (!Number.isFinite(len) || len <= 0) break;
    const record = buf.subarray(sp + 1, i + len).toString('utf8');
    const eq = record.indexOf('=');
    if (eq > 0) out[record.slice(0, eq)] = record.slice(eq + 1).replace(/\n$/, '');
    i += len;
  }
  return out;
}

/** 解出 tar 里的普通文件 → Map<path, Buffer> */
function readTar(buf) {
  const files = new Map();
  let off = 0;
  let longName = null;
  let pendingPax = null;

  while (off + 512 <= buf.length) {
    if (isZeroBlock(buf, off)) break;

    const header = buf.subarray(off, off + 512);
    const name = readCString(header, 0, 100);
    const prefix = readCString(header, 345, 155);
    const size = readSize(header, 124, 12);
    const typeByte = header[156];
    const type = typeByte === 0 ? '0' : String.fromCharCode(typeByte);

    const dataStart = off + 512;
    const data = buf.subarray(dataStart, dataStart + size);
    off = dataStart + Math.ceil(size / 512) * 512;

    if (type === 'L') { longName = data.toString('utf8').replace(/\0+$/, ''); continue; }
    if (type === 'x') { pendingPax = { ...(pendingPax || {}), ...parsePax(data) }; continue; }
    if (type === 'g' || type === '5' || type === 'K' || type === 'V') { longName = null; pendingPax = null; continue; }

    const finalName = longName || (pendingPax && pendingPax.path) || (prefix ? `${prefix}/${name}` : name);
    if (type === '0') files.set(finalName, Buffer.from(data));

    longName = null;
    pendingPax = null;
  }
  return files;
}

/* ------------------------------------------------------------------ 上游 → 本地命名 */

/** 资源名 → 导出常量名：`alert_fill_24` → `AlertFillIcon`、`arrow_down` → `ArrowDownIcon` */
export function pascalIconName(resourceName) {
  return `${resourceName.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('')}Icon`;
}

function assertHarmonyResourceName(resourceName) {
  if (!/^[a-z][a-z0-9_]*$/.test(resourceName)) {
    throw new Error(`资源名不合法：${resourceName}（鸿蒙要求小写字母开头，仅含 [a-z0-9_]）`);
  }
  if (resourceName.length > 100) throw new Error(`资源名过长：${resourceName}`);
}

/* ------------------------------------------------------------------ Index.ets */

function buildIndexEts(items) {
  const lines = [P.indexHeader];
  for (const it of items) {
    lines.push(`export const ${it.exportName} = '${it.resourceName}'`);
  }
  return `${lines.join('\n')}\n`;
}

/* ------------------------------------------------------------------ 主流程 */

async function collectUpstream(opts) {
  let tarball = null;
  let version = opts.version || '（本地目录）';

  if (opts.fromDir) {
    const svgDir = join(opts.fromDir, P.fromDirSub);
    if (!existsSync(svgDir)) throw new Error(`--from-dir 下找不到 ${P.fromDirSub}：${svgDir}`);
    const pkgJson = join(opts.fromDir, 'package.json');
    if (existsSync(pkgJson)) version = readPackageVersion(pkgJson) || version;
    return { version, source: `目录 ${opts.fromDir}`, svgDir, fromDir: true };
  }

  if (opts.fromTarball) {
    tarball = readFileSync(opts.fromTarball);
    version = opts.version || readTarballVersion(tarball) || '（本地 tarball）';
  } else {
    const manifest = await fetchManifest(opts);
    version = manifest.version;
    const integrity = manifest.dist && manifest.dist.integrity;
    const tarballUrl = (manifest.dist && manifest.dist.tarball) ||
      `${REGISTRY}/${P.packageName.replace('/', '%2f')}/-/${P.packageName.split('/')[1]}-${version}.tgz`;
    const cached = join(opts.cacheDir, `${P.packageName.split('/')[1]}-${version}.tgz`);

    if (opts.flags.has('refresh') || !existsSync(cached)) {
      if (!opts.flags.has('quiet')) console.log(`⬇ 下载 ${P.packageName}@${version} …`);
      const via = await downloadToFile(tarballUrl, cached, opts);
      if (!opts.flags.has('quiet')) console.log(`  ✓ 完成（${via}）`);
    } else if (!opts.flags.has('quiet')) {
      console.log(`⇢ 命中缓存 ${relPath(cached)}（要重新下载加 --refresh）`);
    }

    tarball = readFileSync(cached);
    if (integrity && integrity.startsWith('sha512-')) {
      const actual = `sha512-${sha512Base64(tarball)}`;
      if (actual !== integrity) {
        rmSync(cached, { force: true });
        throw new Error(`tarball 校验失败，已删除缓存，请重试。\n  期望 ${integrity}\n  实际 ${actual}`);
      }
    }
    return { version, source: 'registry 下载 / 缓存', tarball, fromDir: false };
  }

  return { version, source: `本地 tarball ${opts.fromTarball}`, tarball, fromDir: false };
}

function extractIcons({ tarball, svgDir, fromDir }, size) {
  const icons = new Map(); // resourceName -> { buf, exportName }
  const exportNames = new Map(); // exportName -> resourceName（防 Index.ets 出现重名常量）
  const entries = fromDir
    ? readdirSync(svgDir).map((f) => [`${P.tarballSvgDir}/${f}`, readFileSync(join(svgDir, f))])
    : [...readTar(gunzipSync(tarball)).entries()].filter(([p]) => p.startsWith(`${P.tarballSvgDir}/`));

  for (const [path, buf] of entries) {
    const file = path.slice(path.lastIndexOf('/') + 1);
    const sel = P.select(file, size);
    if (!sel) continue;
    assertHarmonyResourceName(sel.resourceName);
    if (icons.has(sel.resourceName)) throw new Error(`上游出现重名图标：${sel.resourceName}`);
    const clash = exportNames.get(sel.exportName);
    if (clash) {
      throw new Error(
        `导出常量名冲突：${sel.exportName} 同时来自 ${clash} 与 ${sel.resourceName}\n` +
        '  → 在 profiles.mjs 的 select() 里补上消歧规则',
      );
    }
    exportNames.set(sel.exportName, sel.resourceName);
    icons.set(sel.resourceName, { buf, exportName: sel.exportName });
  }

  if (icons.size === 0) throw new Error(`上游包里没找到需要的图标（${P.fromDirSub}），包结构可能变了`);
  return icons;
}

function planChanges(opts, icons) {
  const mediaDir = opts.mediaDir;
  const existing = existsSync(mediaDir)
    ? readdirSync(mediaDir).filter((f) => f.endsWith('.svg'))
    : [];
  const existingSet = new Set(existing);

  const items = [];
  for (const [resourceName, rec] of [...icons.entries()].sort()) {
    let text = rec.buf.toString('utf8');
    if (P.normalize) text = P.normalize(text);
    if (opts.flags.has('sanitize') && P.sanitize) text = P.sanitize(text);
    const next = Buffer.from(text, 'utf8');
    const file = join(mediaDir, `${resourceName}.svg`);
    let status = 'added';
    if (existingSet.has(`${resourceName}.svg`)) {
      const prev = readFileSync(file);
      status = prev.equals(next) ? 'unchanged' : 'changed';
    }
    items.push({ resourceName, exportName: rec.exportName, file, next, status });
  }

  const upstreamSet = new Set(icons.keys());
  const stale = existing.filter((f) => !upstreamSet.has(f.replace(/\.svg$/, ''))).sort();

  return {
    items,
    added: items.filter((i) => i.status === 'added'),
    changed: items.filter((i) => i.status === 'changed'),
    unchanged: items.filter((i) => i.status === 'unchanged'),
    stale,
  };
}

function planIndex(opts, items) {
  if (opts.flags.has('no-index')) return null;
  const next = buildIndexEts(items);
  const prev = existsSync(opts.indexFile) ? readFileSync(opts.indexFile, 'utf8') : null;
  return { path: opts.indexFile, next, changed: prev !== next, lines: next.trimEnd().split('\n').length };
}

function planReadme(opts, version) {
  if (opts.flags.has('no-readme') || !existsSync(opts.readmeFile)) return null;
  const prev = readFileSync(opts.readmeFile, 'utf8');
  const re = P.readmeVersionRe;
  if (!re.test(prev)) return { path: opts.readmeFile, matched: false };
  const next = prev.replace(re, `$1${version}$3`);
  return { path: opts.readmeFile, next, changed: prev !== next, from: prev.match(re)[2], to: version, matched: true };
}

function writeAll(opts, plan, index, readme) {
  mkdirSync(opts.mediaDir, { recursive: true });
  let written = 0;
  for (const item of [...plan.added, ...plan.changed]) {
    writeFileSync(item.file, item.next);
    written++;
  }
  if (opts.flags.has('prune') && plan.stale.length > 0) {
    for (const f of plan.stale) rmSync(join(opts.mediaDir, f), { force: true });
  }
  if (index && index.changed) writeFileSync(index.path, index.next);
  if (readme && readme.changed && readme.next) writeFileSync(readme.path, readme.next);
  return written;
}

function relPath(p) {
  return p.startsWith(ROOT) ? p.slice(ROOT.length + 1) : p;
}

function report(opts, ctx) {
  const { version, source, plan, index, readme, wrote, notes } = ctx;

  if (opts.flags.has('json')) {
    console.log(JSON.stringify({
      version,
      source,
      set: P.id,
      size: opts.size,
      total: plan.items.length,
      added: plan.added.map((i) => i.resourceName),
      changed: plan.changed.map((i) => i.resourceName),
      unchanged: plan.unchanged.length,
      stale: plan.stale,
      index: index ? { path: index.path, changed: index.changed, lines: index.lines } : null,
      readme: readme && readme.matched ? { from: readme.from, to: readme.to, changed: readme.changed } : null,
      notes: notes || [],
      wrote,
      dryRun: opts.flags.has('dry-run'),
    }, null, 2));
    return;
  }

  const dry = opts.flags.has('dry-run');
  const L = [];
  L.push('');
  L.push(`  ${P.packageName} 同步${dry ? '（dry-run，未改动项目文件）' : ''}`);
  L.push('');
  L.push(`  上游版本   v${version}   ${source}`);
  L.push(`  图标尺寸   ${opts.size}px`);
  L.push(`  图标数量   ${plan.items.length}   新增 ${plan.added.length} / 更新 ${plan.changed.length} / 未变 ${plan.unchanged.length}`);
  L.push(`  目标目录   ${relPath(opts.mediaDir)}`);

  if (index) L.push(`  Index.ets  ${index.lines} 行   ${index.changed ? (dry ? '需要重写' : '已重写') : '无变化'}`);
  if (readme && readme.matched) L.push(`  README     已同步 v${readme.from} → v${readme.to}   ${readme.changed ? (dry ? '需要更新' : '已更新') : '无变化'}`);

  const list = (title, arr, max = 12) => {
    if (arr.length === 0) return;
    const names = arr.map((x) => (typeof x === 'string' ? x : x.resourceName));
    const shown = names.slice(0, max).join(', ') + (names.length > max ? ` … 等 ${names.length} 个` : '');
    L.push('');
    L.push(`  ${title} (${names.length})`);
    L.push(`    ${shown}`);
  };
  list('新增图标', plan.added);
  list('更新图标', plan.changed);
  list(opts.flags.has('prune') ? '删除图标' : '本地多余（加 --prune 才会删除）', plan.stale);

  if (notes && notes.length > 0) {
    L.push('');
    L.push(...notes);
  }
  if (!dry && wrote > 0) {
    L.push('');
    L.push(`  ↔ 写入 ${wrote} 个 svg`);
    if (plan.stale.length > 0 && opts.flags.has('prune')) L.push(`  ↔ 删除 ${plan.stale.length} 个 svg`);
  }
  L.push('');
  L.push('  搞定~');
  L.push('');
  console.log(L.join('\n'));
}

/**
 * 引擎入口。
 * @param profile 图标集配置（见 profiles.mjs）
 * @param argv 命令行参数（不含 node/脚本路径）
 * @returns 退出码：0 正常 / 1 出错 / 2 --check 发现差异
 */
export async function runIconSync(profile, argv) {
  P = profile;
  try {
    const opts = parseArgs(argv);
    if (opts.flags.has('help')) { console.log(helpText()); return 0; }

    const upstream = await collectUpstream(opts);
    const icons = extractIcons(upstream, opts.size);
    const plan = planChanges(opts, icons);
    const index = planIndex(opts, plan.items);
    const readme = planReadme(opts, upstream.version);
    const notes = P.reportNotes ? P.reportNotes(icons, opts) : [];

    const drift = plan.added.length + plan.changed.length + plan.stale.length +
      (index && index.changed ? 1 : 0) + (readme && readme.changed ? 1 : 0);
    const ctx = { ...upstream, plan, index, readme, notes };

    if (opts.flags.has('dry-run')) {
      if (!opts.flags.has('quiet')) report(opts, { ...ctx, wrote: 0 });
      return opts.flags.has('check') && drift > 0 ? 2 : 0;
    }

    const wrote = writeAll(opts, plan, index, readme);
    if (!opts.flags.has('quiet')) report(opts, { ...ctx, wrote });
    return 0;
  } catch (err) {
    console.error(`\n✖ ${err.message}\n`);
    return 1;
  }
}
