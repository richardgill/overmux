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

<details>
<summary>macOS says Overmux is damaged or the developer cannot be verified</summary>

For quarantine-related blocking, run this **only for a trusted download from [official Overmux releases](https://github.com/richardgill/overmux/releases)**:

```bash
xattr -dr com.apple.quarantine "$HOME/Applications/Overmux.app"
```

Use `/Applications/Overmux.app` instead if you installed it there. Then reopen Overmux in Finder.

</details>

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
