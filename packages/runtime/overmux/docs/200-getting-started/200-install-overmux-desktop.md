---
title: Install Overmux Desktop
---

Overmux Desktop makes your already-running Overmux web server feel like a native app, with notifications.

## macOS

### Install using the CLI

After installing the Overmux CLI:

```bash
overmux desktop install
```

Overmux Desktop is installed in `~/Applications/Overmux.app`.

### Install from GitHub

Download the ZIP for your Mac from the [Overmux releases](https://github.com/richardgill/overmux/releases), extract it, then move `Overmux.app` to `~/Applications`.

Overmux is not currently signed or notarized. Follow [Apple's instructions for opening an app from an unidentified developer](https://support.apple.com/en-us/102445) to allow it to run.

### macOS blocks the app from opening

macOS Gatekeeper, which checks downloaded apps before opening them, may report that “Overmux.app is damaged and can’t be opened” or that “the developer cannot be verified”. If the app is blocked by its download quarantine flag, you can remove that flag in Terminal.

Only run this for an app you trust and downloaded from the official [Overmux releases](https://github.com/richardgill/overmux/releases), since it bypasses the quarantine check for this app.

For the `~/Applications` location used above:

```bash
xattr -dr com.apple.quarantine "$HOME/Applications/Overmux.app"
```

If you placed the app in `/Applications` instead, use:

```bash
xattr -dr com.apple.quarantine /Applications/Overmux.app
```

Then try opening `Overmux.app` again in Finder. This only addresses quarantine-related blocking, not every launch failure.

## Linux

Download the AppImage or Debian package from the [Overmux releases](https://github.com/richardgill/overmux/releases).

For the AppImage:

```bash
chmod +x Overmux-Desktop-<version>-linux-x64.AppImage
./Overmux-Desktop-<version>-linux-x64.AppImage
```

For Debian-based distributions:

```bash
sudo apt install ./overmux-desktop_<version>_amd64.deb
overmux-desktop
```
