---
name: npm-publish
description: Step-by-step procedure to prepare, verify, and publish a new version of an npm package. Use when publishing or releasing updates to npm, handling package.json file inclusions, or managing npm 2FA and registry cache verification.
---

# Publishing an NPM Package

Follow this procedure to safely release and publish a new version of an npm package.

## 1. Pre-Publish Verification & Preparation

### Verify Packaged Files
Check the `"files"` array in `package.json`. Newly added files (e.g., `.json` data files, templates, or assets) loaded at runtime must be explicitly listed in `"files"`; otherwise, they will be omitted from the distributed package.

```bash
# Preview the exact files that will be bundled
npm pack --dry-run
```

Ensure only required distribution files (e.g., binaries, compiled code, README, LICENSE, data files) are included, and no sensitive files (`cookies.txt`, `.env`, tokens) are packaged.

### Clean & Bump Version
1. Clean any formatting or path issues:
   ```bash
   npm pkg fix
   ```
2. Bump the version according to Semantic Versioning (`major`, `minor`, or `patch`):
   ```bash
   # Example: minor update for backward-compatible features
   npm version minor --no-git-tag-version
   ```
   *(Or edit `"version"` in `package.json` manually).*

## 2. Commit and Sync with Git

Always commit and push version bumps to the remote repository before publishing:

```bash
git add package.json
git commit -m "chore: bump version to <version>"
git push origin main
```

## 3. NPM Authentication & Publish

### Check Authentication
Verify that the CLI is authenticated with the npm registry:

```bash
npm whoami
```

- If this returns `ENEEDAUTH` or `401 Unauthorized`, authenticate via:
  ```bash
  npm login
  ```

### Publish Package
Run the publish command with public access:

```bash
npm publish --access public
```

### Browser 2FA / CLI Auth
If 2FA is active, npm will prompt:
```text
Authenticate your account at:
https://www.npmjs.com/auth/cli/<uuid>
Press ENTER to open in the browser...
```
Open the link in a browser, authenticate/approve the session, and the CLI will complete the publish process (`+ <package>@<version>`).

## 4. Post-Publish Verification

Do not rely immediately on the `npmjs.com` web UI; it uses edge CDN caching that can take 5–15 minutes to update the main page.

Verify the release directly against the registry API:

```bash
# Verify the latest tag points to the new version
npm view <package> dist-tags

# Verify latest published version
npm view <package> version
```

You can also view the exact version page directly:
`https://www.npmjs.com/package/<package>/v/<version>`
