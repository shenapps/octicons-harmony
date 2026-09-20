#!/usr/bin/env node
/**
 * sync-octicons.mjs —— 同步官方 Octicons（@primer/octicons）
 * 配置在 lib/profiles.mjs，引擎在 lib/icon-sync.mjs。
 * 用法：node scripts/sync-octicons.mjs --help
 */

import { runIconSync } from './lib/icon-sync.mjs';
import { octicons } from './lib/profiles.mjs';

process.exitCode = await runIconSync(octicons, process.argv.slice(2));
