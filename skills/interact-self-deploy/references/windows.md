# Windows Portable App

The desktop executable contains the public Supabase URL, publishable key, and GitHub Pages URL at build time. It contains no Gemini or Reurl secret. Rebuild the executable for every instructor's deployment.

Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\skills\interact-self-deploy\scripts\package-windows.ps1 `
  -SupabaseUrl https://PROJECT_REF.supabase.co `
  -PublishableKey sb_publishable_xxx `
  -PublicAppUrl https://OWNER.github.io/REPOSITORY
```

The script writes the local ignored `.env`, installs locked dependencies, builds the frontend, packages a portable x64 Windows app in the local temp directory, and copies `interact.exe` to the repository root.

## Checkpoint

Open `interact.exe`, create a session, and scan its QR code with a device not connected to the presenter's network. Confirm the URL points to the new GitHub Pages site and the session data appears only in the new Supabase project.
