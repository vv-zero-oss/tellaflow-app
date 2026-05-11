// Cross-platform shell helpers — abstracts macOS osascript / Windows PowerShell
// invocations so the rest of the codebase doesn't need to branch on platform.

const { execFile, execFileSync, spawn } = require('child_process');

const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';

// PowerShell invocation used on Windows. `-NoProfile` skips the user's profile
// (faster, more deterministic). `-NonInteractive` prevents prompts that would
// hang in a background process. We avoid `powershell.exe` and prefer the path
// resolution from PATH so this works regardless of install location.
const PS_ARGS_PREFIX = ['-NoProfile', '-NonInteractive', '-NoLogo', '-Command'];
const PS_EXE = 'powershell.exe';

// ── Frontmost application ─────────────────────────────────────────────────
// Returns the friendly name of the foreground window's owning process, or
// null if it can't be determined or it's our own Electron app.

const PS_GET_FOREGROUND = `
$ErrorActionPreference='SilentlyContinue';
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinApi {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@;
$hWnd = [WinApi]::GetForegroundWindow();
$procId = 0;
[void][WinApi]::GetWindowThreadProcessId($hWnd, [ref]$procId);
$proc = Get-Process -Id $procId -ErrorAction SilentlyContinue;
if ($proc) {
  if ($proc.MainWindowTitle) { Write-Output $proc.ProcessName }
  else { Write-Output $proc.ProcessName }
}
`.trim();

const OSA_GET_FRONTMOST =
  'tell application "System Events" to get name of first process whose frontmost is true';

function getFrontmostAppSync(timeoutMs = 800) {
  try {
    if (IS_MAC) {
      const out = execFileSync('osascript', ['-e', OSA_GET_FRONTMOST], {
        timeout: timeoutMs,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).toString().trim();
      return out || null;
    }
    if (IS_WIN) {
      const out = execFileSync(PS_EXE, [...PS_ARGS_PREFIX, PS_GET_FOREGROUND], {
        timeout: timeoutMs,
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      }).toString().trim();
      return out || null;
    }
  } catch {
    return null;
  }
  return null;
}

function getFrontmostAppAsync(timeoutMs = 800) {
  return new Promise((resolve) => {
    if (IS_MAC) {
      const t = setTimeout(() => resolve(null), timeoutMs);
      execFile('osascript', ['-e', OSA_GET_FRONTMOST], (err, stdout) => {
        clearTimeout(t);
        resolve(err ? null : (stdout.trim() || null));
      });
      return;
    }
    if (IS_WIN) {
      const t = setTimeout(() => resolve(null), timeoutMs);
      execFile(PS_EXE, [...PS_ARGS_PREFIX, PS_GET_FOREGROUND], { windowsHide: true }, (err, stdout) => {
        clearTimeout(t);
        resolve(err ? null : (stdout.trim() || null));
      });
      return;
    }
    resolve(null);
  });
}

// ── Activate target app + paste ───────────────────────────────────────────
// On macOS this re-activates the named app and sends Cmd+V via System Events.
// On Windows we find the most recent top-level window whose owning process name
// matches `targetApp`, restore it with ShowWindowAsync, bring it to the
// foreground with SetForegroundWindow, then send Ctrl+V via SendKeys.

function buildPsPasteScript(targetApp) {
  // Sanitize: only allow alnum, dot, dash, underscore in the target process
  // name so it can't escape the single-quoted PowerShell string literal.
  const safe = (targetApp || '').replace(/[^A-Za-z0-9._-]/g, '');

  return `
$ErrorActionPreference='SilentlyContinue';
Add-Type -AssemblyName System.Windows.Forms;
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinFocus {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@;
${safe ? `
$target = Get-Process -Name '${safe}' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Sort-Object StartTime -Descending | Select-Object -First 1;
if ($target) {
  $hWnd = $target.MainWindowHandle;
  if ([WinFocus]::IsIconic($hWnd)) { [void][WinFocus]::ShowWindowAsync($hWnd, 9) }
  $fg = [WinFocus]::GetForegroundWindow();
  $fgPid = 0;
  $fgThread = [WinFocus]::GetWindowThreadProcessId($fg, [ref]$fgPid);
  $myThread = [WinFocus]::GetCurrentThreadId();
  [void][WinFocus]::AttachThreadInput($myThread, $fgThread, $true);
  [void][WinFocus]::SetForegroundWindow($hWnd);
  [void][WinFocus]::AttachThreadInput($myThread, $fgThread, $false);
  Start-Sleep -Milliseconds 80;
}
` : ''}
[System.Windows.Forms.SendKeys]::SendWait('^v');
`.trim();
}

function pasteViaShell(targetApp) {
  if (IS_MAC) {
    const safeTarget = targetApp ? targetApp.replace(/[\\"'\n\r]/g, '') : null;
    const pasteScript = 'tell application "System Events" to keystroke "v" using command down';
    const script = safeTarget
      ? `tell application "${safeTarget}" to activate\ndelay 0.15\n${pasteScript}`
      : pasteScript;
    return new Promise((resolve) => {
      execFile('osascript', ['-e', script], (err) => {
        if (err) console.error('Failed to simulate paste (osascript):', err.message);
        resolve();
      });
    });
  }
  if (IS_WIN) {
    const script = buildPsPasteScript(targetApp);
    return new Promise((resolve) => {
      const child = spawn(PS_EXE, [...PS_ARGS_PREFIX, script], { windowsHide: true });
      child.on('error', (err) => {
        console.error('Failed to simulate paste (powershell):', err.message);
        resolve();
      });
      child.on('exit', () => resolve());
    });
  }
  return Promise.resolve();
}

// ── System sounds ─────────────────────────────────────────────────────────

function playSystemSound(kind) {
  if (IS_MAC) {
    const file = kind === 'start'
      ? '/System/Library/Sounds/Tink.aiff'
      : '/System/Library/Sounds/Glass.aiff';
    execFile('afplay', ['-v', '0.4', file], (err) => {
      if (err) console.warn('Sound playback failed:', err.message);
    });
    return;
  }
  if (IS_WIN) {
    // Use Windows built-in system sounds. SystemSounds.Asterisk is a short
    // "ping" used for notifications — friendlier than the harsher Beep.
    const sound = kind === 'start' ? 'Asterisk' : 'Exclamation';
    const script = `[System.Media.SystemSounds]::${sound}.Play();`;
    execFile(PS_EXE, [...PS_ARGS_PREFIX, script], { windowsHide: true }, (err) => {
      if (err) console.warn('Sound playback failed:', err.message);
    });
  }
}

// ── Media controls (mute/unmute music apps) ───────────────────────────────
// On macOS we drive Apple Music + Spotify via AppleScript. On Windows we
// send the global media play/pause virtual key — works with Spotify, Groove,
// browser-based YouTube/Spotify Web, etc.

function pauseMediaApps() {
  if (IS_MAC) {
    return null; // caller handles mac path via existing osascript flow
  }
  if (IS_WIN) {
    const script = `
$ErrorActionPreference='SilentlyContinue';
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Kb {
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
}
"@;
[Kb]::keybd_event(0xB3, 0, 0, [UIntPtr]::Zero);
[Kb]::keybd_event(0xB3, 0, 2, [UIntPtr]::Zero);
`.trim();
    execFile(PS_EXE, [...PS_ARGS_PREFIX, script], { windowsHide: true }, (err) => {
      if (err) console.warn('pauseMediaApps failed:', err.message);
    });
    return { mediaKeySent: true };
  }
  return null;
}

function resumeMediaApps(_state) {
  if (IS_MAC) return;
  if (IS_WIN) {
    // VK_MEDIA_PLAY_PAUSE toggles, so we send it again to resume.
    const script = `
$ErrorActionPreference='SilentlyContinue';
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Kb {
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
}
"@;
[Kb]::keybd_event(0xB3, 0, 0, [UIntPtr]::Zero);
[Kb]::keybd_event(0xB3, 0, 2, [UIntPtr]::Zero);
`.trim();
    execFile(PS_EXE, [...PS_ARGS_PREFIX, script], { windowsHide: true }, (err) => {
      if (err) console.warn('resumeMediaApps failed:', err.message);
    });
  }
}

module.exports = {
  IS_MAC,
  IS_WIN,
  getFrontmostAppSync,
  getFrontmostAppAsync,
  pasteViaShell,
  playSystemSound,
  pauseMediaApps,
  resumeMediaApps,
};
