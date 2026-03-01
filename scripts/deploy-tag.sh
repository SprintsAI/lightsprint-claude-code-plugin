#!/bin/bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

REPO="SprintsAI/lightsprint-claude-code-plugin"

echo -e "${BLUE}=== Lightsprint Claude Code Plugin Release ===${NC}\n"

# Function to compare versions
version_gt() {
  printf '%s\n%s' "$2" "$1" | sort -V | head -n1 | grep -q "^$2$"
}

# Get the latest tag
LATEST_TAG=$(git tag --sort=-version:refname | head -1 2>/dev/null || echo "")

if [ -z "$LATEST_TAG" ]; then
  echo -e "${YELLOW}No tags found in repository${NC}"
  CURRENT_VERSION="none"
else
  CURRENT_VERSION="$LATEST_TAG"
  echo -e "${GREEN}Current version: ${YELLOW}$CURRENT_VERSION${NC}"

  COMMIT_MSG=$(git tag -l --format='%(subject)' "$LATEST_TAG" 2>/dev/null || echo "")
  COMMIT_DATE=$(git tag -l --format='%(creatordate:short)' "$LATEST_TAG" 2>/dev/null || echo "")

  if [ -n "$COMMIT_MSG" ]; then
    echo -e "  Commit: $COMMIT_MSG"
  fi
  if [ -n "$COMMIT_DATE" ]; then
    echo -e "  Date: $COMMIT_DATE"
  fi
fi

echo ""

# Show recent tags
echo -e "${BLUE}Recent tags:${NC}"
git tag --sort=-version:refname | head -5 | while read tag; do
  echo "  • $tag"
done

echo ""
echo -e "${BLUE}Semantic versioning guide:${NC}"
echo "  • Patch (bug fix):     v0.3.1 → v0.3.2"
echo "  • Minor (new feature): v0.3.1 → v0.4.0"
echo "  • Major (breaking):    v0.3.1 → v1.0.0"
echo ""

# Get new version from user
read -p "Enter new version tag (e.g., v0.3.2): " NEW_VERSION

# Validate format
if ! [[ "$NEW_VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo -e "${RED}✗ Invalid version format. Use semantic versioning (e.g., v0.3.2)${NC}"
  exit 1
fi

echo ""

# Check if tag already exists
if git rev-parse "$NEW_VERSION" >/dev/null 2>&1; then
  echo -e "${RED}✗ Tag $NEW_VERSION already exists${NC}"
  exit 1
fi

# Validate version is higher than current
if [ "$CURRENT_VERSION" != "none" ]; then
  if ! version_gt "$NEW_VERSION" "$CURRENT_VERSION"; then
    echo -e "${RED}✗ Error: New version $NEW_VERSION must be higher than current version $CURRENT_VERSION${NC}"
    echo -e "${YELLOW}Please choose a version greater than $CURRENT_VERSION${NC}"
    exit 1
  fi
fi

echo -e "${GREEN}✓ Version validation passed${NC}"
echo ""

# Show what will be tagged
CURRENT_COMMIT=$(git rev-parse --short HEAD)
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

echo -e "${BLUE}Release details:${NC}"
echo "  Branch: $CURRENT_BRANCH"
echo "  Commit: $CURRENT_COMMIT"
echo "  Tag: $NEW_VERSION"
echo ""

# Confirm
read -p "Ready to tag and release? (yes/no): " CONFIRM

if ! [[ "$CONFIRM" =~ ^[Yy]([Ee][Ss])?$ ]]; then
  echo -e "${YELLOW}Release cancelled${NC}"
  exit 0
fi

echo ""
echo -e "${BLUE}Creating tag...${NC}"
git tag "$NEW_VERSION"
echo -e "${GREEN}✓ Tag created: $NEW_VERSION${NC}"

echo ""
echo -e "${BLUE}Pushing tag to GitHub...${NC}"
git push origin "$NEW_VERSION"
echo -e "${GREEN}✓ Tag pushed successfully${NC}"

echo ""
echo -e "${GREEN}✓ Release initiated!${NC}"
echo ""

# --- Create version bump PR ---
echo -e "${BLUE}Creating version bump PR...${NC}"

# Strip leading 'v' for package.json version
SEMVER="${NEW_VERSION#v}"
BUMP_BRANCH="bump/$NEW_VERSION"

# Create bump branch from current HEAD
git checkout -b "$BUMP_BRANCH"

# Update version in plugin.json and package.json
node -e "
const fs = require('fs');
for (const file of ['.claude-plugin/plugin.json', 'package.json']) {
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  pkg.version = '$SEMVER';
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
}
"

git add .claude-plugin/plugin.json package.json
git commit -m "chore: bump version to $NEW_VERSION"
git push -u origin "$BUMP_BRANCH"

# Create PR
gh pr create \
  --title "chore: bump version to $NEW_VERSION" \
  --body "Bump version to \`$SEMVER\` in \`plugin.json\` and \`package.json\` after the \`$NEW_VERSION\` release." \
  --base main \
  --head "$BUMP_BRANCH"

echo -e "${GREEN}✓ Version bump PR created${NC}"

# Return to original branch
git checkout "$CURRENT_BRANCH"

echo ""
echo -e "${BLUE}Monitor the release:${NC}"
echo "  GitHub Actions: https://github.com/$REPO/actions"
echo "  Check status: gh run list --workflow=release.yml --limit=1"
echo ""
echo -e "${YELLOW}What happens next:${NC}"
echo "  • GitHub Actions compiles binaries for all platforms"
echo "  • Binaries are uploaded to a GitHub release"
echo "  • Merge the version bump PR to keep plugin.json and package.json in sync"
echo "  • Users can install with: curl -fsSL https://raw.githubusercontent.com/$REPO/main/install.sh | bash"
echo ""
