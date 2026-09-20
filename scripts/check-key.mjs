#!/usr/bin/env node
/**
 * check-key.mjs —— 本地验签：判断「私钥 + 密码」能不能用，以及与 .pub 是否配对
 *
 * 用途：ohpm 发布报 "The content of private key in the key_path error." 时，
 * 分不清是【密码不对】还是【公钥没登记到网站】。这个脚本只做本地计算，不联网：
 *   1. 私钥文件是否符合 ohpm 要求（必须含 ENCRYPTED）
 *   2. 密码能否解开私钥
 *   3. 能否按 ohpm 的两种方式签名（RSA-SHA256 与 SHA256withRSA/PSS）
 *   4. 私钥派生出的公钥指纹，与 <key>.pub 是否一致（对不上 = 网站登记的公钥很可能不是这把）
 *
 * 用法：
 *   node scripts/check-key.mjs [--key <私钥路径>]        # 推荐在交互式终端里跑，会隐藏回显地要密码
 *   OHPM_KEY_PASSPHRASE='密码' node scripts/check-key.mjs  # 非交互（密码会进环境变量）
 *
 * 安全：只打印指纹与长度，绝不打印密码、私钥或签名内容。
 */

import { createHash, createPrivateKey, createPublicKey, createSign, constants as cryptoConstants } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/* ---------------------------------------------------------------- 取参数 */

const argv = process.argv.slice(2);
const keyIdx = argv.indexOf('--key');
const resolveKeyPath = () => {
  if (keyIdx >= 0) return resolve(argv[keyIdx + 1]);
  try {
    const p = execFileSync('ohpm', ['config', 'get', 'key_path'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    return p ? resolve(p.replace(/^~/, process.env.HOME || '~')) : '';
  } catch {
    return '';
  }
};

const keyPath = resolveKeyPath();
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => console.log(`  ✗ ${m}`);
const info = (m) => console.log(`  · ${m}`);

/** 隐藏回显地读一行输入（TTY）；非 TTY 时读一行 stdin */
function askHidden(prompt) {
  return new Promise((done) => {
    process.stdout.write(prompt);
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      let buf = '';
      stdin.setEncoding('utf8');
      stdin.on('data', (chunk) => {
        buf += chunk;
        const nl = buf.indexOf('\n');
        if (nl >= 0) { process.stdout.write('\n'); stdin.pause(); done(buf.slice(0, nl)); }
      });
      stdin.on('end', () => { process.stdout.write('\n'); done(buf.replace(/\n$/, '')); });
      stdin.resume();
      return;
    }
    let buf = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    stdin.on('data', function onData(ch) {
      if (ch === '\r' || ch === '\n') {
        stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData);
        process.stdout.write('\n'); done(buf);
      } else if (ch === '\u0003') { // Ctrl-C
        stdin.setRawMode(false); process.stdout.write('\n'); process.exit(130);
      } else if (ch === '\u007f' || ch === '\b') {
        buf = buf.slice(0, -1);
      } else {
        buf += ch;
      }
    });
  });
}

/** SSH 公钥指纹（与 ssh-keygen -l 一致）：SHA256:<base64 去掉 = > */
function sshFingerprint(blob) {
  return `SHA256:${createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')}`;
}

/** 按 SSH wire 格式拼出 ssh-rsa 公钥 blob */
function rsaSshBlob(jwk) {
  const mpint = (b64url) => {
    let b = Buffer.from(b64url, 'base64url');
    if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
    const len = Buffer.alloc(4); len.writeUInt32BE(b.length);
    return Buffer.concat([len, b]);
  };
  const type = Buffer.from('ssh-rsa');
  const tlen = Buffer.alloc(4); tlen.writeUInt32BE(type.length);
  return Buffer.concat([tlen, type, mpint(jwk.e), mpint(jwk.n)]);
}

/* ---------------------------------------------------------------- 主流程 */

console.log('\n  私钥自检（本地计算，不联网）\n');

if (!keyPath) { bad('拿不到 key_path（ohpm config get key_path 为空）'); process.exit(1); }
info(`私钥: ${keyPath}`);

// 1. 文件与 ohpm 的格式要求
if (!existsSync(keyPath)) { bad('私钥文件不存在'); process.exit(1); }
const pem = readFileSync(keyPath, 'utf8');
if (!pem.includes('ENCRYPTED')) {
  bad('私钥不含 ENCRYPTED → ohpm 直接报 NotSupportPrivateKey。它只收【带密码】的 PKCS#1 PEM');
  process.exit(1);
}
ok('格式符合 ohpm 要求（PKCS#1 PEM + 密码保护）');

// 2. 取密码
const passphrase = process.env.OHPM_KEY_PASSPHRASE || (await askHidden('  请输入这把私钥的密码（不回显）: '));
if (!passphrase) { bad('没拿到密码'); process.exit(1); }

// 3. 密码能否解开私钥
let privateKey;
try {
  privateKey = createPrivateKey({ key: pem, passphrase });
  ok('密码正确，私钥已解开');
} catch (err) {
  bad(`密码不对或私钥损坏：${err.message}`);
  console.log('\n  → 本地就过不去，不用怀疑网站；先确认密码（试试同一个密码的其它大小写/输入法）\n');
  process.exit(1);
}

// 4. 按 ohpm 的两种签名方式各签一次（消息格式与 ohpm 源码一致：v1-<publishId>-<timestamp>-<nonce>）
const msg = `v1-${'YOURPUBID'.padEnd(10, '0')}-${Date.now()}-${'0'.repeat(32)}`;
for (const [label, opts] of [
  ['RSA-SHA256（默认模式）', undefined],
  ['SHA256withRSA/PSS（首选模式）', { padding: cryptoConstants.RSA_PKCS1_PSS_PADDING, saltLength: cryptoConstants.RSA_PSS_SALTLEN_DIGEST }],
]) {
  try {
    const signer = createSign('RSA-SHA256');
    signer.update(msg);
    const sig = signer.sign({ key: pem, passphrase, ...(opts || {}) }, 'base64');
    ok(`${label} 签名成功（${sig.length} 字符）`);
  } catch (err) {
    bad(`${label} 签名失败：${err.message}`);
  }
}

// 5. 与 .pub 是否配对
const pubPath = `${keyPath}.pub`;
if (!existsSync(pubPath)) {
  info(`没有 ${pubPath}，跳过公钥比对（网站登记公钥时要粘贴它的内容）`);
} else {
  try {
    const fields = readFileSync(pubPath, 'utf8').trim().split(/\s+/);
    const pubBlob = Buffer.from(fields[1], 'base64');
    const derived = rsaSshBlob(createPublicKey(privateKey).export({ format: 'jwk' }));
    const a = sshFingerprint(pubBlob);
    const b = sshFingerprint(derived);
    info(`${pubPath} 指纹      ${a}`);
    info('由私钥推出的公钥指纹     ' + b);
    if (a === b) ok('两者配对 ✓（网站登记这个 .pub 就对了）');
    else bad('两者不配对 ✗！网站登记的公钥很可能不是这把私钥 → 服务端验签一定失败');
  } catch (err) {
    bad(`公钥比对失败：${err.message}`);
  }
}

console.log('\n  本地都过了还发不出去 → 问题在服务端：去「个人中心 → OHPM公钥」确认这把 .pub 已登记，\n  并确认 ohpm config get publish_id 是本人账号的发布码（个人中心个人资料页「复制发布码」）。\n');
