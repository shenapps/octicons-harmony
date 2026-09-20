/**
 * profiles.mjs —— 各图标集的配置（引擎 icon-sync.mjs 只管流程，差异全在这里）
 *
 * 每个 profile：
 *   id/label            标识与展示名（决定 node scripts/sync-<id>.mjs）
 *   packageName         npm 包名
 *   tarballSvgDir       tarball 内 svg 所在目录
 *   fromDirSub          --from-dir 时读取的子目录
 *   sizes              允许的尺寸（null = 只有固定尺寸）
 *   indexHeader        模块 Index.ets 顶部那行组件导出
 *   readmeVersionRe    更新 README「已同步 vX」用的正则（须有 3 个捕获组）
 *   paths/relPaths     默认目录（relPaths 仅用于 --help 展示）
 *   select(file,size)  上游文件名 → { resourceName, exportName }；返回 null 表示不要
 *   normalize(text)    每次同步都会执行的内容归一化（可选）
 *   sanitize(text)     仅 --sanitize 时执行（可选）
 *   reportNotes(icons,opts)  报告里追加的提示行（可选）
 */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pascalIconName } from './icon-sync.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** paths → { paths, relPaths }，relPaths 只给 --help 显示用 */
function withRel(paths) {
  const relPaths = {};
  for (const [k, v] of Object.entries(paths)) {
    relPaths[k] = typeof v === 'string' && v.startsWith(ROOT) ? v.slice(ROOT.length + 1) : v;
  }
  return { paths, relPaths };
}

/* ------------------------------------------------------------------ octicons */

export const octicons = {
  id: 'octicons',
  label: 'Octicons',
  packageName: '@primer/octicons',
  tarballSvgDir: 'package/build/svg',
  fromDirSub: 'build/svg',
  sizes: [12, 16, 24],
  indexHeader: `export { OctIcon } from './src/main/ets/components/OctIcon'`,
  readmeVersionRe: /(已同步\s*`v)([\d.]+)(`\s*版本)/,

  ...withRel({
    size: 24,
    mediaDir: join(ROOT, 'octicons/src/main/resources/base/media'),
    indexFile: join(ROOT, 'octicons/Index.ets'),
    readmeFile: join(ROOT, 'octicons/README.md'),
    cacheDir: join(ROOT, '.octicons-cache'),
  }),

  /** `alert-fill-24.svg` → 资源名 `alert_fill_24`、常量 `AlertFillIcon` */
  select(file, size) {
    const m = /^(.+)-(\d+)\.svg$/.exec(file);
    if (!m || Number(m[2]) !== size) return null;
    const base = m[1].replace(/-/g, '_');
    const resourceName = `${base}_${size}`;
    return { resourceName, exportName: pascalIconName(base) };
  },

  normalize: (text) => text,

  /** ArkUI 对 fill="currentColor" / 根节点 fill="none" 的解析不太稳，应急可用（本仓约定不用） */
  sanitize: (text) => text
    .replace(/(<svg\b[^>]*?)\s+fill="(?:none|currentColor)"/, '$1')
    .replace(/\s+fill="currentColor"/g, ''),

  reportNotes(icons, opts) {
    if (opts.flags.has('sanitize')) return [];
    const hits = [...icons.entries()]
      .filter(([, rec]) => /fill="(?:currentColor|none)"/.test(rec.buf.toString('utf8')))
      .map(([name]) => name);
    if (hits.length === 0) return [];
    return [
      `  ℹ ${hits.length} 个图标带 fill="currentColor" / 根节点 fill="none"（官方原样保留，不做改写）：`,
      `    ${hits.slice(0, 12).join(', ')}${hits.length > 12 ? ' …' : ''}`,
      '    这两个图标最终颜色由 ArkUI 解析决定。真机显示异常时可先确认是否出在 fillColor 上',
    ];
  },
};

/* ------------------------------------------------------------------ lucide */

export const lucide = {
  id: 'lucide',
  label: 'lucide',
  packageName: 'lucide-static',
  tarballSvgDir: 'package/icons',
  fromDirSub: 'icons',
  sizes: null, // lucide 只有 24×24
  indexHeader: `export { LucideIcon } from './src/main/ets/components/LucideIcon'`,
  readmeVersionRe: /(已同步\s*`v)([\d.]+)(`\s*版本)/,

  ...withRel({
    size: 24,
    mediaDir: join(ROOT, 'lucide/src/main/resources/base/media'),
    indexFile: join(ROOT, 'lucide/Index.ets'),
    readmeFile: join(ROOT, 'lucide/README.md'),
    cacheDir: join(ROOT, '.lucide-cache'),
  }),

  /**
   * `arrow-down.svg` → 资源名 `lucide_arrow_down`、常量 `ArrowDownIcon`
   *
   * lucide 里 `arrow-down-01` 与 `arrow-down-0-1` 是**两张不同的图标**，
   * 直接 PascalCase 会双变成 `ArrowDown01Icon` 而撞名，所以相邻的纯数字段之间保留一个下划线：
   *   arrow_down_01 → ArrowDown01Icon
   *   arrow_down_0_1 → ArrowDown0_1Icon
   */
  select(file) {
    const m = /^(.+)\.svg$/.exec(file);
    if (!m) return null;
    const segs = m[1].split('-');
    let name = '';
    for (let i = 0; i < segs.length; i++) {
      const numeric = /^[0-9]+$/.test(segs[i]);
      const prevNumeric = i > 0 && /^[0-9]+$/.test(segs[i - 1]);
      const glue = i > 0 && numeric && prevNumeric ? '_' : '';
      name += `${glue}${segs[i].charAt(0).toUpperCase()}${segs[i].slice(1)}`;
    }
    return {
      resourceName: `lucide_${m[1].replace(/-/g, '_')}`,
      exportName: `${name}Icon`,
    };
  },

  /**
   * lucide 是 stroke="currentColor" + fill="none" 的线框图标，需要两处最小归一化：
   *   1. 去掉 <svg> 前的 HTML 许可注释（许可信息在 LICENSE 与 README 里，注释留在 svg 里只是让解析器多担风险）
   *   2. stroke="currentColor" → "#000000"（currentColor 的初始值就是黑，等价；避免渲染器不认 currentColor 时图标全透明）
   * 颜色最终由 LucideIcon 的 colorFilter(SRC_IN) 统一控制，与 stroke 字面值无关。
   */
  normalize: (text) => text
    .replace(/^\s*<!--[\s\S]*?-->\s*/, '')
    .replace(/stroke="currentColor"/g, 'stroke="#000000"'),

  reportNotes() {
    return [
      '  ℹ lucide 适配（两处最小归一化，其余原样）：',
      '    ① 去掉文件头 HTML 许可注释（许可见 LICENSE/README）；② stroke="currentColor" → "#000000"（初始值即黑）',
      '    颜色由 LucideIcon 的 colorFilter(SRC_IN) 控制；真机上若发现描边不显示，先查 colorFilter 是否生效',
    ];
  },
};
