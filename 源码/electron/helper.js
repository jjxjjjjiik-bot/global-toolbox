'use strict';

const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const { app } = require('electron');

const execFileAsync = promisify(execFile);
const HELPER = app.isPackaged
  ? path.join(process.resourcesPath, 'native', 'ToolboxHelper.exe')
  : path.join(__dirname, '..', 'native', 'ToolboxHelper.exe');

let missingWarned = false;

function hasHelper() {
  return fs.existsSync(HELPER);
}

async function run(args, timeout) {
  if (!hasHelper()) {
    if (!missingWarned) {
      missingWarned = true;
      console.warn('未找到 native/ToolboxHelper.exe，自动粘贴和划词会退回 PowerShell 或不可用');
    }
    throw new Error('helper missing');
  }
  const result = await execFileAsync(HELPER, args, {
    timeout: timeout || 4000,
    windowsHide: true,
    encoding: 'utf8'
  });
  return String(result.stdout || '').trim();
}

async function foreground() {
  try {
    const out = await run(['foreground']);
    const value = Number(out);
    return Number.isFinite(value) ? value : 0;
  } catch (err) {
    return 0;
  }
}

async function foregroundInfo() {
  try {
    const out = await run(['fg']);
    const parts = String(out).split('|');
    const hwnd = Number(parts[0]);
    if (!Number.isFinite(hwnd) || hwnd <= 0) return null;
    return { hwnd: hwnd, className: parts[1] || '' };
  } catch (err) {
    return null;
  }
}

async function activate(hwnd) {
  if (!hwnd) return false;
  try {
    return (await run(['activate', String(hwnd)])) === 'ok';
  } catch (err) {
    return false;
  }
}

async function pasteTo(hwnd, ownPid) {
  try {
    const out = await run(['paste', String(hwnd || 0), String(ownPid || 0)], 5000);
    if (out === 'self' || out === 'nofocus') return out;
    return out === 'ok';
  } catch (err) {
    return powerShellPaste();
  }
}

async function powerShellPaste() {
  try {
    await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-WindowStyle', 'Hidden',
      '-Command',
      "$wshell = New-Object -ComObject WScript.Shell; Start-Sleep -Milliseconds 60; $wshell.SendKeys('^v')"
    ], { timeout: 5000, windowsHide: true });
    return true;
  } catch (err) {
    return false;
  }
}

async function selection() {
  try {
    const out = await run(['selection'], 6000);
    if (out.indexOf('b64:') === 0) {
      return Buffer.from(out.slice(4), 'base64').toString('utf8').trim();
    }
    return '';
  } catch (err) {
    return '';
  }
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function watchForeground(onChange) {
  if (!hasHelper()) return null;
  let child = null;
  let stopped = false;
  let buffer = '';

  function start() {
    if (stopped) return;
    child = spawn(HELPER, ['watch'], { windowsHide: true });
    child.stdout.on('data', function (chunk) {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      lines.forEach(function (line) {
        const parts = line.trim().split('|');
        const value = Number(parts[0]);
        if (Number.isFinite(value) && value > 0) onChange(value, parts[1] || '');
      });
    });
    child.on('exit', function () {
      child = null;
      if (!stopped) setTimeout(start, 2000);
    });
    child.on('error', function () {
      child = null;
      if (!stopped) setTimeout(start, 3000);
    });
  }

  start();

  return {
    stop: function () {
      stopped = true;
      if (child) {
        try { child.kill(); } catch (e) { /* ignore */ }
        child = null;
      }
    }
  };
}

module.exports = { hasHelper, foreground, foregroundInfo, activate, pasteTo, selection, watchForeground, sleep, HELPER };
