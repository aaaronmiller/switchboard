#!/bin/bash
set -e

echo "Installing Switchboard..."

DEST="$HOME/Applications/Switchboard.AppImage"
mkdir -p "$HOME/Applications"

cp Switchboard-0.0.17-fixed.AppImage "$DEST"
chmod +x "$DEST"

echo "Done! Double-click $DEST to run, or find 'Switchboard' in your app menu."
