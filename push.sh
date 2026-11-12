#!/usr/bin/env bash
set -euo pipefail

git config user.name 'github-actions[bot]'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'

# Only the generated data file is committed; a failed run never pushes partial
# or unrelated changes.
git add ranking.json

if git diff --cached --quiet -- ranking.json; then
  echo 'ranking.json 没有变化，跳过提交。'
  exit 0
fi

git commit -m "auto update $(date +%Y-%m-%d)" -- ranking.json
git push origin main
