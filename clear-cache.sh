#!/bin/bash
for dir in .claude .config/opencode .opencode .gemini .codex; do
  rm -f "./$dir/cache/gsd-update-check.json"
  rm -f "$HOME/$dir/cache/gsd-update-check.json"
done
