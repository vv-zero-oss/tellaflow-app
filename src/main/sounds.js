const { execFile } = require('child_process');
const config = require('./config');

// macOS system sounds — built-in, no bundling needed
const SOUND_START = '/System/Library/Sounds/Tink.aiff';
const SOUND_STOP  = '/System/Library/Sounds/Glass.aiff';

function play(file) {
  if (!config.getSoundsEnabled()) return;
  execFile('afplay', ['-v', '0.4', file], (err) => {
    if (err) console.warn('Sound playback failed:', err.message);
  });
}

function playStart() { play(SOUND_START); }
function playStop()  { play(SOUND_STOP);  }

// Track which apps we actually paused so we only resume those
let pausedApps = { music: false, spotify: false };

// Pause Apple Music and Spotify via AppleScript
function muteMusic() {
  if (!config.getMuteWhileDictating()) return;
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

// Resume only the apps that we actually paused
function unmuteMusic() {
  if (!config.getMuteWhileDictating()) return;
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
