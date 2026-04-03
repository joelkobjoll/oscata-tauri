#!/bin/bash
set -e

if [ ! -f "$HOME/.nvm/nvm.sh" ]; then
  echo "Installing nvm..."
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
fi

source ~/.nvm/nvm.sh
nvm install 22 --no-progress
nvm use 22

# Ensure Rust/Cargo is on PATH, install via rustup if missing
if [ ! -f "$HOME/.cargo/env" ] && ! command -v cargo &>/dev/null; then
  echo "Installing Rust via rustup..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path
fi

if [ -f "$HOME/.cargo/env" ]; then
  source "$HOME/.cargo/env"
else
  export PATH="$HOME/.cargo/bin:$PATH"
fi

cd "$(dirname "$0")/.."

npm install

npm run tauri build

echo ""
echo "DMG:"
ls src-tauri/target/release/bundle/dmg/*.dmg
