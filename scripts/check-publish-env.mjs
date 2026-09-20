#!/usr/bin/env node
/**
 * check-publish-env.mjs —— 发布前自检，专治 ohpm 发布环境坑
 *
 * 为什么需要它：ohpm 签名拿不到私钥密码时会陷入死循环刷 WARN，直到进程 OOM 崩溃
 * （实测刷了一百二十万条 "The content of private key in the key_path error."），
 * 而且它只支持【带密码的 PKCS#1 PEM 私钥】，无密码的私钥直接报 NotSupportPrivateKey。
 * 这些都能提前 1 秒查出来，不必等崩。
 *
 * 退出码：0 = 可以免交互发布 / 2 = 环境没问题但需要交互输入密码 / 1 = 环境有问题
 * 用法：node scripts/check-publish-env.mjs [--har <path>] [--json]
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_HAR = join(ROOT, 'octicons/build/default/outputs/default/octicons.har');

const args = process.argv.slice(2);
const json = args.includes('--json');
const harIdx = args.indexOf('--har');
const HAR = harIdx >= 0 ? resolve(args[harIdx + 1]) : DEFAULT_HAR;

/** 读 ohpm 配置；值一律不打印，只回报「有没有」 */
function ohpmConfig(key) {
  try {
    return execFileSync('ohpm', ['config', 'get', key], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return '';
  }
}

const isEmpty = (v) => !v || /^(undefined|null|not exist.*)$/i.test(v);

const checks = [];
const add = (name, ok, detail, level = ok ? 'ok' : 'bad') => checks.push({ name, ok, detail, level });

// 1. ohpm 本体
let ohpmVersion = '';
try {
  ohpmVersion = execFileSync('ohpm', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  add('ohpm', true, ohpmVersion);
} catch {
  add('ohpm', false, '执行 ohpm 失败，确认它在 PATH 里（或未安装 command-line-tools）');
}

// 2. registry 连通性
try {
  execFileSync('ohpm', ['ping'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20_000 });
  add('registry', true, ohpmConfig('registry') || 'https://ohpm.openharmony.cn/ohpm/');
} catch {
  add('registry', false, 'ohpm ping 失败：网络不通或 registry 配置有误（可试 --proxy / 检查 ~/.ohpm/.ohpmrc）');
}

// 3. publish_id
const publishId = ohpmConfig('publish_id');
add('publish_id', !isEmpty(publishId), isEmpty(publishId) ? '未配置 → ohpm config set publish_id <id>' : '已配置（值隐去）');

// 4. key_path：存在 + 是文件 + 含 ENCRYPTED（ohpm 的硬性判定：无密码私钥它不收）
const keyPath = ohpmConfig('key_path');
const key = keyPath.replace(/^~/, process.env.HOME || '~');
if (isEmpty(keyPath)) {
  add('key_path', false, '未配置 → ohpm config set key_path <私钥路径>');
} else if (!existsSync(key)) {
  add('key_path', false, `${key} 不存在`);
} else if (statSync(key).isDirectory()) {
  add('key_path', false, `${key} 是目录，ohpm 要的是私钥文件路径`);
} else {
  const content = readFileSync(key, 'utf8');
  const mode = (statSync(key).mode & 0o777).toString(8);
  const privateKeyOk = content.includes('ENCRYPTED'); // ohpm 源码里的判定条件
  add(
    'key_path',
    privateKeyOk,
    `${key}  权限 ${mode}` + (privateKeyOk ? '' : '  ✗ 不含 ENCRYPTED：ohpm 只收【带密码】的 PKCS#1 PEM 私钥，无密码会报 NotSupportPrivateKey'),
  );

  // 公钥 .pub：去个人中心「OHPM公钥管理」登记时要粘贴它的内容，缺失只提醒、不影响退出码
  const pub = `${key}.pub`;
  add('公钥 .pub', existsSync(pub), existsSync(pub) ? pub : `找不到 ${pub}（换/登记公钥时网站要粘贴它的内容）`, existsSync(pub) ? 'ok' : 'info');
}

// 5. key_passphrase：决定能不能免交互发布
const passphrase = ohpmConfig('key_passphrase');
const canUnattended = !isEmpty(passphrase);
add(
  'key_passphrase',
  canUnattended,
  isEmpty(passphrase)
    ? '未配置 → 发布会交互提示 "what is your passphrase of the private key:"，非交互环境会被 ohpm 的死循环刷到 OOM'
    : '已配置（值隐去）→ 可免交互发布',
  canUnattended ? 'ok' : 'warn',
);

// 6. 待发布产物
if (existsSync(HAR)) {
  add('产物', true, `${HAR.replace(`${ROOT}/`, '')}  ${statSync(HAR).size.toLocaleString()} 字节`);
} else {
  add('产物', false, `找不到 ${HAR}，先跑一次 assembleHar`);
}

const bad = checks.filter((c) => c.level === 'bad');
const warn = checks.filter((c) => c.level === 'warn');
const ready = bad.length === 0 && warn.length === 0;

if (json) {
  console.log(JSON.stringify({ ready, unattended: canUnattended, checks }, null, 2));
} else {
  const icon = (c) => (c.level === 'ok' ? '✓' : c.level === 'warn' ? '!' : c.level === 'info' ? '·' : '✗');
  console.log('\n  发布环境自检\n');
  for (const c of checks) console.log(`  ${icon(c)} ${c.name.padEnd(14)} ${c.detail}`);
  console.log('');
  if (ready) {
    console.log('  ✓ 可以免交互发布：ohpm publish ' + HAR.replace(`${ROOT}/`, ''));
  } else if (bad.length > 0) {
    console.log(`  ✗ 有 ${bad.length} 项必须先修好，否则发布会失败（甚至死循环刷日志到 OOM）`);
  } else {
    console.log('  ! 环境没问题，但密码未配置 → 只能到交互式终端里发布，agent 代跑会卡死：');
    console.log(`      ohpm publish ${HAR.replace(`${ROOT}/`, '')}`);
  }
  console.log('');
}

process.exitCode = ready ? 0 : bad.length > 0 ? 1 : 2;
