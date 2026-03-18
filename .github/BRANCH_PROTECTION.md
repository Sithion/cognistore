# Branch Protection Setup Guide

This document provides instructions for setting up branch protection on the `main` branch of the knowledge-base repository.

## Prerequisites

- GitHub CLI (`gh`) installed and authenticated
- Administrator access to the Sithion/knowledge-base repository
- NPM account with permission to create organizations

## Step 1: Enable Branch Protection on Main

Use the `gh api` command to configure branch protection with the following requirements:

- Require pull requests for all changes
- Require 1 approval before merging
- Only RXT07 can approve pull requests
- Require the `build-and-test` status check to pass
- Prevent direct pushes and force pushes
- Enforce admins to comply with rules

Run this command in your terminal:

```bash
gh api repos/Sithion/knowledge-base/branches/main/protection \
  --method PUT \
  --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["build-and-test"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true
  },
  "restrictions": {
    "users": ["RXT07"],
    "teams": []
  },
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF
```

**Expected output:**
```json
{
  "url": "https://api.github.com/repos/Sithion/knowledge-base/branches/main/protection",
  "enabled": true,
  ...
}
```

## Step 2: Create NPM_TOKEN Secret in GitHub

The CI/CD pipeline requires an `NPM_TOKEN` secret to publish packages to npmjs.com.

### 2.1 Generate NPM Token

1. Log in to [npmjs.com](https://www.npmjs.com/)
2. Navigate to **Account settings** → **Auth Tokens**
3. Click **Generate New Token**
4. Select token type: **Automation** (allows publishing without 2FA prompts)
5. Give it a meaningful name: `github-actions-publish-knowledge-base`
6. Copy the token value (you will only see it once)

### 2.2 Add Token to GitHub Secrets

1. Go to the repository: https://github.com/Sithion/knowledge-base
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Name: `NPM_TOKEN`
5. Value: Paste the token from step 2.1
6. Click **Add secret**

Alternatively, use the GitHub CLI:

```bash
gh secret set NPM_TOKEN --repo Sithion/knowledge-base
# Paste the token when prompted
```

## Step 3: Create @ai-knowledge Organization on NPM

The knowledge-base publishes packages under the `@ai-knowledge` scope on npmjs.com.

### 3.1 Create the Organization

1. Log in to [npmjs.com](https://www.npmjs.com/) as `raphael.sithion`
2. Click your **avatar** → **Organizations**
3. Click **Create an Organization**
4. Enter organization name: `ai-knowledge`
5. Select billing plan (free tier available)
6. Complete the setup

### 3.2 Grant Publish Access

1. Go to the organization settings
2. Navigate to **Members**
3. Add `raphael.sithion` as an owner (if not already)
4. This ensures the `NPM_TOKEN` has permission to publish to `@ai-knowledge` scoped packages

### 3.3 Verify Scoped Package Publishing

Test that you can publish packages:

```bash
cd packages/cli
npm publish --scope @ai-knowledge
```

Or update `package.json` to include the scope:

```json
{
  "name": "@ai-knowledge/cli",
  "version": "1.0.0",
  ...
}
```

## Manual Setup Checklist

Complete these steps in order:

### GitHub Configuration
- [ ] **Branch Protection Enabled** — Run the `gh api` command above and verify success
- [ ] **Status Checks Required** — Verify that `build-and-test` status check is enabled in branch protection settings
- [ ] **PR Review Required** — Confirm that 1 approval is required before merging
- [ ] **Only RXT07 Can Approve** — Verify restrictions are set to user `RXT07` only
- [ ] **Force Push Disabled** — Confirm `allow_force_pushes` is `false`
- [ ] **Deletions Disabled** — Confirm `allow_deletions` is `false`

### NPM Configuration
- [ ] **NPM_TOKEN Generated** — Created token from npmjs.com automation flow
- [ ] **NPM_TOKEN Added to GitHub** — Secret is stored in repository Settings → Secrets
- [ ] **@ai-knowledge Organization Created** — Organization exists at npmjs.com
- [ ] **raphael.sithion is Owner** — User has permission to publish scoped packages
- [ ] **Test Publish Successful** — Ran a test publish to verify token works

### Verification

Run this command to verify branch protection is active:

```bash
gh api repos/Sithion/knowledge-base/branches/main/protection
```

Expected output should include:
```json
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["build-and-test"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1
  },
  "restrictions": {
    "users": ["RXT07"]
  },
  "allow_force_pushes": false,
  "allow_deletions": false
}
```

## Troubleshooting

### "Resource not found" when enabling branch protection
- Ensure you have administrator access to the repository
- Verify the branch name is exactly `main`
- Check that the repository is not a fork without protection settings

### NPM publish fails with "403 Forbidden"
- Verify `NPM_TOKEN` is correct and has not expired
- Confirm the `@ai-knowledge` organization exists and you are a member
- Check that the token was created with "Automation" type

### GitHub CLI returns authentication error
- Run `gh auth login` to re-authenticate
- Ensure your GitHub token has `repo` and `admin:repo_hook` scopes

## References

- [GitHub Branch Protection API](https://docs.github.com/en/rest/branches/branch-protection)
- [GitHub CLI Documentation](https://cli.github.com/manual)
- [NPM Token Documentation](https://docs.npmjs.com/using-npm/tokens)
- [NPM Organizations](https://docs.npmjs.com/organizations)
