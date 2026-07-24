# macOS direct-download release

Use `.github/workflows/release-macos.yml` for every public macOS release. It builds a universal application for Apple Silicon and Intel, signs the app with Developer ID, submits it to Apple's notary service, validates the stapled ticket, and optionally publishes the DMG and ZIP to GitHub Releases.

## Repository variables

These are public frontend configuration:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_PUBLIC_APP_URL`

Set them with `scripts/configure-github-pages.sh`.

## Repository secrets

These values must only exist in GitHub Actions secrets:

- `MACOS_CERTIFICATE_P12`: base64-encoded Developer ID Application `.p12`.
- `MACOS_CERTIFICATE_PASSWORD`: export password for that `.p12`.
- `APPLE_API_KEY_ID`: App Store Connect API key ID.
- `APPLE_API_ISSUER`: App Store Connect issuer ID.
- `APPLE_API_KEY_P8`: complete private `.p8` key contents.

Do not paste these values into `.env`, source files, issues, pull requests, screenshots, or support conversations. Restrict who can edit Actions workflows because a modified workflow could read repository secrets.

## Required Apple setup

1. Join the Apple Developer Program.
2. Create a Developer ID Application certificate and install it in Keychain Access.
3. Export the certificate and private key as a password-protected `.p12`.
4. Create an App Store Connect API key suitable for notarization and download its `.p8` file once.
5. Store the five values above as Actions secrets.

## Release checkpoint

Run `Release notarized macOS DMG` manually with a semantic tag such as `v0.1.0`. A successful job must pass:

- lint and TypeScript/Vite build;
- universal Electron packaging;
- `codesign --verify`;
- Gatekeeper `spctl --assess`;
- `stapler validate` for both the app and DMG;
- SHA-256 checksum generation.

Download the DMG from GitHub Releases and test it on a Mac that did not build the application. On first screen capture, grant Screen & System Audio Recording access and restart InterAct.
