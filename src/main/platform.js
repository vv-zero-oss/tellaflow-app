'use strict';

const { execFile, execFileSync } = require('child_process');

const isMac = process.platform === 'darwin';
const isWindows = process.platform === 'win32';
const WIN_FOREGROUND_PROCESS_SCRIPT = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win32 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
"@
$hwnd = [Win32]::GetForegroundWindow()
if ($hwnd -eq [IntPtr]::Zero) { return }
$pid = 0
[Win32]::GetWindowThreadProcessId($hwnd, [ref]$pid) | Out-Null
if ($pid -ne 0) {
  $p = Get-Process -Id $pid -ErrorAction SilentlyContinue
  if ($p) { $p.ProcessName }
}
`;

function getPlatformName() {
  if (isMac) return 'macos';
  if (isWindows) return 'windows';
  return process.platform;
}

function getFrontmostApp() {
  if (isWindows) return Promise.resolve(getFrontmostAppSync());
  if (!isMac) return Promise.resolve(null);

  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 800);
    execFile('osascript', [
      '-e',
      'tell application "System Events" to get name of first process whose frontmost is true',
    ], (err, stdout) => {
      clearTimeout(timer);
      resolve(err ? null : (stdout.trim() || null));
    });
  });
}

function getFrontmostAppSync() {
  if (isWindows) {
    try {
      return execFileSync(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-Command', WIN_FOREGROUND_PROCESS_SCRIPT],
        { timeout: 1000 }
      ).toString().trim() || null;
    } catch {
      return null;
    }
  }
  if (!isMac) return null;
  try {
    return execFileSync('osascript', [
      '-e',
      'tell application "System Events" to get name of first process whose frontmost is true',
    ], { timeout: 500 }).toString().trim() || null;
  } catch {
    return null;
  }
}

function pasteViaSystem(targetApp) {
  if (isMac) {
    const safeTarget = targetApp ? targetApp.replace(/[\\"'\n\r]/g, '') : null;
    const pasteScript = 'tell application "System Events" to keystroke "v" using command down';
    const script = safeTarget
      ? `tell application "${safeTarget}" to activate\ndelay 0.15\n${pasteScript}`
      : pasteScript;

    execFile('osascript', ['-e', script], (err) => {
      if (err) console.error('Failed to simulate paste:', err.message);
    });
    return;
  }

  if (isWindows) {
    const safeTarget = targetApp ? targetApp.replace(/['"\n\r]/g, '').trim() : '';
    const safeProcessName = safeTarget.toLowerCase().endsWith('.exe')
      ? safeTarget.slice(0, -4)
      : safeTarget;
    const targets = [safeTarget, safeProcessName].filter(Boolean);
    const targetArray = targets.length
      ? `@('${targets.join("','")}')`
      : '@()';

    // Try activation by exact title/process name first, then fallback to plain Ctrl+V.
    const ps = `
      $ws = New-Object -ComObject WScript.Shell
      $activated = $false
      $targets = ${targetArray}
      foreach ($t in $targets) {
        if ([string]::IsNullOrWhiteSpace($t)) { continue }
        if ($ws.AppActivate($t)) { $activated = $true; break }
      }
      if ($activated) { Start-Sleep -Milliseconds 120 }
      $ws.SendKeys('^v')
    `;
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], (err) => {
      if (err) console.error('Failed to simulate paste on Windows:', err.message);
    });
    return;
  }

  console.warn('Paste keystroke is not implemented for this platform.');
}

module.exports = {
  isMac,
  isWindows,
  getPlatformName,
  getFrontmostApp,
  getFrontmostAppSync,
  pasteViaSystem,
};
