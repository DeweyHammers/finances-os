# Android release: keystore and secrets (maintainer notes)

The Android APK is built by GitHub Actions (`.github/workflows/release.yml`,
job `android`) on every `v*` tag and attached to the Release beside the
Windows installer as `Finances-OS-X.Y.Z.apk`. The APK must be **signed**, and
Android only installs an update over an existing app when both are signed
with the **same key**. So the project has exactly one release keystore, it
lives only in this repository's Actions secrets, and it must never be
committed (`*.jks` / `*.keystore` are gitignored).

## 1. Create the keystore (once)

`keytool` ships with any JDK. The dev PC has none; install a free one:

```bash
winget install EclipseAdoptium.Temurin.21.JDK
```

Then, in a folder OUTSIDE the repository:

```bash
keytool -genkeypair -v -keystore finances-os-release.jks -alias finances-os -keyalg RSA -keysize 4096 -validity 10000
```

It asks for a keystore password, then for the key's details (name, unit,
organisation, city, state, country: anything; they appear in the certificate
only) and whether the key gets its own password (press Enter to reuse the
keystore password, which is what the workflow expects unless you set
`ANDROID_KEY_PASSWORD` differently).

**Keep this file and its password safe, in two places** (a password manager
and an offline copy). If it is lost, no future APK can update the installed
app: every user would have to uninstall, which deletes their data on the
phone, and install the new one.

## 2. Add the four repository secrets

GitHub → the repository → Settings → Secrets and variables → Actions → New
repository secret:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | the keystore file, base64-encoded (below) |
| `ANDROID_KEYSTORE_PASSWORD` | the keystore password |
| `ANDROID_KEY_ALIAS` | `finances-os` (or whatever `-alias` you used) |
| `ANDROID_KEY_PASSWORD` | the key password (= the keystore password if you pressed Enter) |

Base64 of the file, copied to the clipboard:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("finances-os-release.jks")) | Set-Clipboard
```

(or `base64 -w0 finances-os-release.jks` on Linux/macOS).

A **tag build fails** with a message naming the missing secret(s) until all
four exist; nothing is published half-signed.

## 3. Trial builds

Actions → Release → **Run workflow** on any branch builds the installer and
the APK without releasing and keeps both as artifacts for 14 days
(`finances-os-android`). With the secrets in place the trial APK is signed
with the release key and is exactly what a Release would carry, so it can be
installed and later updated by a Release. Without them the job builds a
**debug** APK (`Finances-OS-X.Y.Z-debug.apk`) signed with the runner's
throw-away debug key: it installs and works, but a release APK won't install
over it, Android says "App not installed" or asks to uninstall first, and
uninstalling deletes the phone's data. Set the secrets up before handing
anyone a trial build.

## 4. Installing on a phone

Open the Release page on the phone, download the `.apk`, open it. The first
time, Android asks to allow installs from the browser (Settings → Apps →
Special app access → Install unknown apps, or the prompt's own "Settings"
button). Google Play Protect may warn about an app it hasn't seen; "Install
anyway". Later versions install over the old one with the data kept.

## 5. Building locally

The web part needs nothing beyond `npm install`:

```bash
npm run android:web        # next build → app-android/ → npx cap sync android
```

The APK needs a JDK 21 and the Android SDK (`ANDROID_HOME`): install Android
Studio, or the command-line tools plus `platforms;android-36` and
`build-tools;36.0.0`. Then:

```bash
npm run android:apk                      # debug APK → dist-android/Finances-OS-X.Y.Z-debug.apk
npm run android:apk -- --release         # release APK; needs ANDROID_KEYSTORE_FILE / _PASSWORD, ANDROID_KEY_ALIAS / _PASSWORD in the environment
```

`npm run android:browser` runs the phone's data path in a desktop browser
(port 8889) without any of that: see CLAUDE.md → "Android app".

## Version numbers

`android/app/build.gradle` reads `package.json`: `versionName` is the version
string and `versionCode` is `major * 10000 + minor * 100 + patch`
(1.3.2 → 10302), the increasing number Android compares on an update. The
release workflow already refuses a tag that doesn't match `package.json`, so
the APK and the installer on a Release always carry the same version.
