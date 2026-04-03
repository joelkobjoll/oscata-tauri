#!/bin/bash
set -e

if [ ! -f "$HOME/.nvm/nvm.sh" ]; then
  echo "Installing nvm..."
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
fi

source ~/.nvm/nvm.sh
nvm install 22 --no-progress
nvm use 22

# Ensure Rust/Cargo is on PATH
if [ -f "$HOME/.cargo/env" ]; then
  source "$HOME/.cargo/env"
elif [ -d "$HOME/.cargo/bin" ]; then
  export PATH="$HOME/.cargo/bin:$PATH"
else
  echo "Error: Cargo not found. Install Rust from https://rustup.rs/" >&2
  exit 1
fi

cd "$(dirname "$0")/.."

npm run tauri build

echo ""
echo "DMG:"
ls src-tauri/target/release/bundle/dmg/*.dmg
