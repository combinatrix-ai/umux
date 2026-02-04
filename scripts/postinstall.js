#!/usr/bin/env node
/**
 * Post-install script to handle platform-specific setup
 *
 * macOS: Signs the node-pty spawn-helper binary (required for Apple Silicon)
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

function main() {
  if (process.platform !== 'darwin') {
    // Only needed on macOS
    return;
  }

  const arch = process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
  const spawnHelper = join(rootDir, 'node_modules', 'node-pty', 'prebuilds', arch, 'spawn-helper');

  if (!existsSync(spawnHelper)) {
    console.log('node-pty spawn-helper not found, skipping codesign');
    return;
  }

  try {
    try {
      execSync(`chmod +x "${spawnHelper}"`);
    } catch {
      console.warn('Warning: Failed to chmod spawn-helper, continuing...');
    }

    // Check if already signed
    try {
      execSync(`codesign -v "${spawnHelper}"`, { stdio: 'ignore' });
      console.log('node-pty spawn-helper already signed');
      return;
    } catch {
      // Not signed, continue to sign
    }

    console.log('Signing node-pty spawn-helper for macOS...');
    execSync(`codesign -s - --force "${spawnHelper}"`, { stdio: 'inherit' });
    console.log('Successfully signed node-pty spawn-helper');
  } catch (error) {
    console.warn('Warning: Failed to sign node-pty spawn-helper:', error.message);
    console.warn('You may need to run: codesign -s - --force', spawnHelper);
  }
}

main();
