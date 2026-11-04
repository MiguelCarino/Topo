Topo for working offline: the same editor as https://topo.carino.systems/, as a desktop app or as a folder to open in a browser.

## Which file

The architecture is in each file name: `x64`, `amd64` or `x86_64` is for Intel and AMD processors, `arm64` or `aarch64` for Arm (Apple silicon, Windows on Arm, Arm Linux).

| You have | Download |
| --- | --- |
| Any computer, nothing to install | `Topo-<version>-offline.zip`: unzip, open `index.html` in Chrome, Edge, Firefox or Safari |
| Windows | the `-setup.exe` (or the `.msi`) for `x64` or `arm64`; needs no internet to install |
| Mac with Apple silicon (M1 and later) | the `aarch64` `.dmg` |
| Mac with Intel | the `x64` `.dmg` |
| Debian, Ubuntu, Mint | the `amd64` or `arm64` `.deb` |
| Fedora, RHEL, openSUSE | the `x86_64` or `aarch64` `.rpm` |
| Any other Linux | the `.AppImage` for your architecture |

The `.app.tar.gz` files are the macOS app without the disk image.

Phones and tablets: use the website. iOS Files and Android cannot run a local `index.html`, and there is no mobile app.

## These builds are not signed

- **macOS:** the app is signed ad hoc only. The first time, macOS says it cannot check the developer: open System Settings > Privacy & Security and choose Open Anyway, or run `xattr -dr com.apple.quarantine /Applications/Topo.app`.
- **Windows:** SmartScreen may warn about an unknown publisher: choose More info > Run anyway. Topo uses Microsoft Edge WebView2. The installers carry its offline installer, so a PC with no internet (an intranet) gets it from the installer itself if it is missing; Windows 10 and 11 normally have it already.
- **Linux:** the AppImage needs FUSE; without it, run it with `--appimage-extract-and-run`.

## Where your work is kept

- **Desktop app:** in the app's own data folder on this computer. It is separate from the website's and the zip's. Uninstalling the app (or ticking "delete app data" in the Windows uninstaller) can delete it, so Export a back-up first.
- **Zip:** in the browser you open it with, for that folder only.
- A network you have not kept is lost when you quit: keep it (or Export it) first.
- Files you save (JSON, CSV, images, reports) go to your Downloads folder. On macOS, Print opens the report in your default browser, which prints it.
- Share links and label QR codes point at the website; the app does not open links yet.
