#!/usr/bin/env bash
# install-linux.sh — Install Switchboard desktop integration on Linux
# Installs icons into the hicolor theme, creates a .desktop entry,
# and (optionally) copies the binary to ~/.local/bin.
#
# Usage:
#   ./scripts/install-linux.sh                  # desktop entry only (binary already in PATH)
#   ./scripts/install-linux.sh --binary <path>  # also install binary from <path>
#   ./scripts/install-linux.sh --uninstall       # remove everything
#
# Run from the project root or with PROJECT_ROOT set.

set -euo pipefail

PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
ICON_SRC="${PROJECT_ROOT}/build/icon.png"
PUBLIC_ICON="${PROJECT_ROOT}/public/icon.png"
APP_ID="switchboard"
APP_NAME="Switchboard"
INSTALL_BIN=""
UNINSTALL=false

# ── Arg parsing ──────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --binary) INSTALL_BIN="$2"; shift 2 ;;
        --uninstall) UNINSTALL=true; shift ;;
        *) echo "Unknown arg: $1"; exit 1 ;;
    esac
done

# ── Uninstall path ────────────────────────────────────────────────────────────
if $UNINSTALL; then
    echo "Removing Switchboard desktop integration..."
    rm -f "${HOME}/.local/share/applications/${APP_ID}.desktop"
    for size in 16 24 32 48 64 96 128 256 512; do
        rm -f "${HOME}/.local/share/icons/hicolor/${size}x${size}/apps/${APP_ID}.png"
    done
    rm -f "${HOME}/.local/share/icons/hicolor/scalable/apps/${APP_ID}.svg" 2>/dev/null || true
    command -v update-desktop-database &>/dev/null && update-desktop-database "${HOME}/.local/share/applications" 2>/dev/null || true
    command -v gtk-update-icon-cache &>/dev/null && gtk-update-icon-cache -f -t "${HOME}/.local/share/icons/hicolor" 2>/dev/null || true
    echo "Done. (Binary at ~/.local/bin/${APP_NAME} not removed — do that manually if needed.)"
    exit 0
fi

# ── Source icon ───────────────────────────────────────────────────────────────
if [[ -f "$ICON_SRC" ]]; then
    SOURCE_ICON="$ICON_SRC"
elif [[ -f "$PUBLIC_ICON" ]]; then
    SOURCE_ICON="$PUBLIC_ICON"
else
    echo "Error: no icon found at build/icon.png or public/icon.png" >&2
    exit 1
fi

# ── Binary install (optional) ─────────────────────────────────────────────────
BIN_TARGET=""
if [[ -n "$INSTALL_BIN" ]]; then
    if [[ ! -f "$INSTALL_BIN" ]]; then
        echo "Error: binary not found at $INSTALL_BIN" >&2
        exit 1
    fi
    mkdir -p "${HOME}/.local/bin"
    INSTALL_BIN_REAL="$(realpath "$INSTALL_BIN")"
    BIN_DEST_REAL="$(realpath "${HOME}/.local/bin/${APP_NAME}" 2>/dev/null || true)"
    if [[ "$INSTALL_BIN_REAL" != "$BIN_DEST_REAL" ]]; then
        cp "$INSTALL_BIN" "${HOME}/.local/bin/${APP_NAME}"
    fi
    chmod +x "${HOME}/.local/bin/${APP_NAME}"
    BIN_TARGET="${HOME}/.local/bin/${APP_NAME}"
    echo "Installed binary → ${BIN_TARGET}"
fi

# ── Resolve Exec path ─────────────────────────────────────────────────────────
if [[ -n "$BIN_TARGET" ]]; then
    EXEC_PATH="$BIN_TARGET"
elif [[ -x "${HOME}/.local/bin/${APP_NAME}" ]]; then
    EXEC_PATH="${HOME}/.local/bin/${APP_NAME}"
elif command -v "$APP_NAME" &>/dev/null; then
    EXEC_PATH="$(command -v "$APP_NAME")"
else
    # Fallback to project dev mode
    EXEC_PATH="${PROJECT_ROOT}/node_modules/.bin/electron ${PROJECT_ROOT}/main.js"
    echo "Warning: no installed binary found; .desktop will launch in dev mode"
fi

# ── Icon installation ─────────────────────────────────────────────────────────
echo "Installing icons from ${SOURCE_ICON}..."

# Check resize tool
if command -v magick &>/dev/null; then
    resize_cmd() { magick "$1" -resize "${2}x${2}" "$3"; }
elif command -v convert &>/dev/null; then
    resize_cmd() { convert "$1" -resize "${2}x${2}" "$3"; }
elif python3 -c "from PIL import Image" &>/dev/null 2>&1; then
    resize_cmd() {
        python3 - "$1" "$2" "$3" <<'PYEOF'
import sys
from PIL import Image
img = Image.open(sys.argv[1]).convert("RGBA")
size = int(sys.argv[2])
img = img.resize((size, size), Image.LANCZOS)
img.save(sys.argv[3])
PYEOF
    }
else
    echo "Error: no image resize tool found (need ImageMagick or python3+Pillow)" >&2
    exit 1
fi

for size in 16 24 32 48 64 96 128 256 512; do
    dir="${HOME}/.local/share/icons/hicolor/${size}x${size}/apps"
    mkdir -p "$dir"
    resize_cmd "$SOURCE_ICON" "$size" "${dir}/${APP_ID}.png"
done
echo "Icons installed to ~/.local/share/icons/hicolor/"

# ── .desktop file ─────────────────────────────────────────────────────────────
DESKTOP_DIR="${HOME}/.local/share/applications"
mkdir -p "$DESKTOP_DIR"

cat > "${DESKTOP_DIR}/${APP_ID}.desktop" <<DESKTOP
[Desktop Entry]
Version=1.0
Type=Application
Name=${APP_NAME}
Comment=Browse, search, and manage CLI coding sessions
Exec=${EXEC_PATH} %U
Icon=${APP_ID}
Terminal=false
Categories=Development;IDE;
Keywords=claude;ai;terminal;sessions;coding;
StartupNotify=true
StartupWMClass=${APP_NAME}
DESKTOP

chmod 644 "${DESKTOP_DIR}/${APP_ID}.desktop"
echo "Desktop entry → ${DESKTOP_DIR}/${APP_ID}.desktop"

# ── Refresh caches ────────────────────────────────────────────────────────────
command -v update-desktop-database &>/dev/null \
    && update-desktop-database "$DESKTOP_DIR" 2>/dev/null \
    && echo "Desktop database updated" || true

command -v gtk-update-icon-cache &>/dev/null \
    && gtk-update-icon-cache -f -t "${HOME}/.local/share/icons/hicolor" 2>/dev/null \
    && echo "Icon cache refreshed" || true

echo ""
echo "Switchboard desktop integration installed."
echo "Log out and back in (or run: killall gnome-shell) to see it in the launcher."
