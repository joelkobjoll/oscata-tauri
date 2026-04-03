#!/bin/bash
set -e

source ~/.nvm/nvm.sh
nvm use 22

cd "$(dirname "$0")/.."

npm run tauri build

echo ""
echo "DMG:"
ls src-tauri/target/release/bundle/dmg/*.dmg
