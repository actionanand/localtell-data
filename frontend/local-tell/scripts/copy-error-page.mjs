#!/usr/bin/env node
import { copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const browser = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'local-tell', 'browser');
copyFileSync(join(browser, 'index.html'), join(browser, '404.html'));
