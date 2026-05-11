const { execFile } = require('child_process');
const config = require('./config');
const { IS_MAC, IS_WIN, playSystemSound, pauseMediaApps, resumeMediaApps } = require('./platform-shell');

function playStart() {
  if (!config.getSoundsEnabled()) return;
  playSystemSound('start');
}

function playStop() {
  if (!config.getSoundsEnabled()) return;
  playSystemSound('stop');
}

// Track which apps we actually paused so we only resume those (mac only).
let pausedApps = { music: false, spotify: false };
let pausedWin = null;

function muteMusic() {
  if (!config.getMuteWhileDictating()) return;

  if (IS_WIN) {
    pausedWin = pauseMediaApps();
    return;
  }

  if (!IS_MAC) return;

  // Pause Apple Music and Spotify via AppleScript
  pausedApps = { music: false, spotify: false };
  const script = `
    set pausedList to ""
    tell application "System Events"
      if (name of processes) contains "Music" then
        tell application "Music"
          if player state is playing then
            pause
            set pausedList to pausedList & "music,"
          end if
        end tell
      end if
      if (name of processes) contains "Spotify" then
        tell application "Spotify"
          if player state is playing then
            pause
            set pausedList to pausedList & "spotify,"
          end if
        end tell
      end if
    end tell
    return pausedList
  `;
  execFile('osascript', ['-e', script], (err, stdout) => {
    if (err) { console.warn('muteMusic osascript failed:', err.message); return; }
    const result = (stdout || '').trim();
    pausedApps.music = result.includes('music');
    pausedApps.spotify = result.includes('spotify');
  });
}

function unmuteMusic() {
  if (!config.getMuteWhileDictating()) return;

  if (IS_WIN) {
    if (pausedWin) {
      resumeMediaApps(pausedWin);
      pausedWin = null;
    }
    return;
  }

  if (!IS_MAC) return;

  if (!pausedApps.music && !pausedApps.spotify) return;

  const parts = [];
  if (pausedApps.music) {
    parts.push('tell application "Music" to play');
  }
  if (pausedApps.spotify) {
    parts.push('tell application "Spotify" to play');
  }
  pausedApps = { music: false, spotify: false };

  const script = parts.join('\n');
  execFile('osascript', ['-e', script], (err) => {
    if (err) console.warn('unmuteMusic osascript failed:', err.message);
  });
}

module.exports = { playStart, playStop, muteMusic, unmuteMusic };
