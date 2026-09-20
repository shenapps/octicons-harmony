#!/usr/bin/env node
/**
 * sync-lucide.mjs —— 同步 lucide 图标（lucide-static，2112 个 24×24 线框图标）
 * 配置在 lib/profiles.mjs，引擎在 lib/icon-sync.mjs。
 * 用法：node scripts/sync-lucide.mjs --help
 */

import { runIconSync } from './lib/icon-sync.mjs';
import { lucide } from './lib/profiles.mjs';

process.exitCode = await runIconSync(lucide, process.argv.slice(2));
