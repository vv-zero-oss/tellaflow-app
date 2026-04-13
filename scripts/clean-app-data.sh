#!/bin/bash
# Clean Tellaflow app data while preserving downloaded models

APP_SUPPORT="$HOME/Library/Application Support/Tellaflow"
PLIST="$HOME/Library/Preferences/com.tellaflow.app.plist"

if [ -d "$APP_SUPPORT" ]; then
  find "$APP_SUPPORT" -maxdepth 1 ! -name '.' ! -name 'models' -exec rm -rf {} +
  echo "Cleaned $APP_SUPPORT (models preserved)"
else
  echo "No app data found at $APP_SUPPORT"
fi

if [ -f "$PLIST" ]; then
  rm -f "$PLIST"
  echo "Removed $PLIST"
fi

echo "Done. Ready for fresh install."
