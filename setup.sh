#!/usr/bin/env bash
# One-time setup: creates the GitHub repo, turns on Pages, runs the first pull.
# Needs: GitHub CLI (brew install gh) and `gh auth login` done once.
set -euo pipefail
REPO="${1:-m365-radar}"

command -v gh >/dev/null || { echo "Install GitHub CLI first:  brew install gh  &&  gh auth login"; exit 1; }
OWNER="$(gh api user -q .login)"

git init -q -b main 2>/dev/null || true
git add -A
git commit -qm "M365 Radar: initial dashboard + 24/7 ingest" || true

# Public repo = unlimited free Actions minutes (everything in it is public Microsoft/job-board data; secrets stay private)
gh repo create "$OWNER/$REPO" --public --source . --push

# Enable GitHub Pages served from the Actions workflow
gh api -X POST "repos/$OWNER/$REPO/pages" -f build_type=workflow >/dev/null 2>&1 || \
gh api -X PUT  "repos/$OWNER/$REPO/pages" -f build_type=workflow >/dev/null

gh workflow run radar.yml -R "$OWNER/$REPO" || true
echo
echo "✅ Done. First pull is running (~1 min)."
echo "   Dashboard:  https://$OWNER.github.io/$REPO/"
echo "   Runs:       https://github.com/$OWNER/$REPO/actions"
echo
echo "Optional (recommended):"
echo "   Reddit leads:   gh secret set REDDIT_CLIENT_ID -R $OWNER/$REPO ; gh secret set REDDIT_CLIENT_SECRET -R $OWNER/$REPO"
echo "   Tenant health:  gh secret set M365_TENANT_ID / M365_CLIENT_ID / M365_CLIENT_SECRET -R $OWNER/$REPO"
