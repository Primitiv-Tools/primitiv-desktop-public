# macOS Code Signing & Notarization Guide

## Overview
This guide explains how to sign and notarize the Primitiv Desktop app for macOS distribution.

## Required Credentials

### Apple Developer Account
- **Apple ID**: dvaldes.info@gmail.com
- **App-Specific Password**: ofdv-pybu-ijxc-jrox
  - Name: "Primitiv Desktop App"
- **Team ID**: 2TGXL5UR2Y

## Environment Variables for CI/CD

Set these environment variables in your CI/CD platform (GitHub Actions, CircleCI, etc.):

```bash
# Apple ID for notarization
APPLE_ID=dvaldes.info@gmail.com

# App-specific password (NOT your Apple ID password)
APPLE_APP_SPECIFIC_PASSWORD=ofdv-pybu-ijxc-jrox

# Team ID
APPLE_TEAM_ID=2TGXL5UR2Y

# Certificate and provisioning (base64 encoded)
CSC_LINK=<base64-encoded-p12-certificate>
CSC_KEY_PASSWORD=<certificate-password>
```

## Certificate Setup

### 1. Export Certificate from Keychain (on Mac)

1. Open **Keychain Access** app
2. In the login keychain, find your "Developer ID Application" certificate
3. Right-click → Export "Developer ID Application: ..."
4. Save as `.p12` file with a password
5. Convert to base64 for CI/CD:
   ```bash
   base64 -i certificate.p12 | pbcopy
   ```
6. Paste the output as `CSC_LINK` environment variable

### 2. Create App-Specific Password (Already Done)

The app-specific password has already been created:
- Password: `ofdv-pybu-ijxc-jrox`
- Name: "Primitiv Desktop App"

To create a new one in the future:
1. Go to https://appleid.apple.com
2. Sign in with Apple ID
3. Security → App-Specific Passwords
4. Generate new password

## GitHub Actions Configuration Example

Create `.github/workflows/build-mac.yml`:

```yaml
name: Build macOS App

on:
  push:
    branches: [main, development]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: macos-latest

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        working-directory: ./desktop
        run: npm install

      - name: Build macOS app
        working-directory: ./desktop
        env:
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
          CSC_LINK: ${{ secrets.CSC_LINK }}
          CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}
        run: npm run dist-mac

      - name: Upload artifact
        uses: actions/upload-artifact@v3
        with:
          name: macos-dmg
          path: desktop/dist/*.dmg
```

## Required Secrets in GitHub

Add these secrets in your GitHub repository:
- Settings → Secrets and variables → Actions → New repository secret

1. `APPLE_ID`: dvaldes.info@gmail.com
2. `APPLE_APP_SPECIFIC_PASSWORD`: ofdv-pybu-ijxc-jrox
3. `APPLE_TEAM_ID`: 2TGXL5UR2Y
4. `CSC_LINK`: Base64-encoded .p12 certificate
5. `CSC_KEY_PASSWORD`: Password for the .p12 certificate

## Local Building (for Testing)

To build locally on a Mac:

```bash
cd desktop

# Set environment variables
export APPLE_ID="dvaldes.info@gmail.com"
export APPLE_APP_SPECIFIC_PASSWORD="ofdv-pybu-ijxc-jrox"
export APPLE_TEAM_ID="2TGXL5UR2Y"

# Build
npm run dist-mac
```

Note: Your Developer ID certificate must be installed in your Mac's Keychain.

## Notarization Process

Notarization happens automatically during the build process via `electron-builder`. The process:

1. App is built and signed with your Developer ID
2. electron-builder uploads the app to Apple for notarization
3. Apple scans the app (takes 1-15 minutes)
4. If approved, the app is "stapled" with the notarization ticket
5. Users can now download and run the app without security warnings

## Troubleshooting

### "App is damaged and can't be opened"
- Certificate might not be valid
- Notarization might have failed
- Check the build logs for notarization errors

### "Developer cannot be verified"
- App was not notarized
- Check `APPLE_ID` and `APPLE_APP_SPECIFIC_PASSWORD` are set correctly

### Notarization timeout
- Apple's servers can be slow
- Wait up to 30 minutes
- Check https://developer.apple.com/system-status/

## Distribution

Once built, the `.dmg` file in `desktop/dist/` can be:
- Shared directly with friends
- Uploaded to your website
- Distributed via GitHub Releases

Users will be able to open it without security warnings (thanks to notarization).

## Security Notes

- **NEVER** commit credentials to the repository
- Use environment variables or CI/CD secrets
- Rotate app-specific passwords periodically
- Keep the .p12 certificate file secure
