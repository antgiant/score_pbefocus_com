🌐 [English](README.md) | [Español](README.es.md) | [Français](README.fr.md) | [Secret Code](README.pig.md)

# PBE Score Keeper
A tool to help keep track of Pathfinder Bible Experience (PBE) (aka Bible Bowl) Scores by block and team.

## Install as an App (PWA)
PBE Score Keeper is optimized for mobile use and can be installed to your home screen.

1. Android (Chrome): Open the app, tap the browser menu, then tap "Install app" or "Add to Home screen".
2. iPhone/iPad (Safari): Open the app, tap Share, then tap "Add to Home Screen".
3. Desktop (Chrome/Edge): Open the app and use the install icon in the address bar, or browser menu > "Install".

After installation, open the app from your home screen/app launcher for the best full-screen experience.

## App File and Link Handling
When installed in a compatible Chromium-based browser, PBE Score Keeper can open `.yjs` and `.json` quiz export files directly from the operating system file picker or file manager.

The installed app also registers `web+pbe://` links, which are the browser-safe form of PBE deep links:
- `web+pbe://session/new` starts a new quiz session when the current quiz has enough data to allow session creation.
- `web+pbe://import?file=<encoded .yjs export URL>` imports a quiz export from a link.

Browser support for file and protocol handlers varies. If a handler is unavailable, use the in-app Import/Export tools.

## Data Storage Note
Data is stored on your device by default. If you want, you can also save a quiz to your own Google Drive or OneDrive, or to a folder you share with other scorers (use the Storage button). Nothing is sent to our servers. You can still use the Export Data options under Import/Export to save copies of your data.

## Storage & Sync Note
The Storage & Sync feature lets one or more devices keep the same quiz in a cloud folder. Each device writes only its own files and merges everyone else's, so scoring keeps working offline and catches up when the connection returns. While a quiz syncs, history entries record your signed-in account name (or email if no name is available) as the scorer name; anyone who can open a shared folder can see its scores and those names. For events with more than about 20 scorers it switches to a large-event mode automatically. Setup for site owners is described in `SYNC_SETUP.md`.

## Contributing a Translation

Want to help translate PBE Score Keeper into your language? We'd love your help!

**To contribute a translation:**
1. Copy `scripts/i18n/en.js` as your starting point
2. Translate all the strings to your language
3. Submit a [Pull Request](https://github.com/antgiant/PBE_Score_Keeper/pulls) with your translation

**Not sure how to create a Pull Request?** No problem! You can:
- [Open an Issue](https://github.com/antgiant/PBE_Score_Keeper/issues/new?title=New%20Translation:%20[Language%20Name]&body=I%20would%20like%20to%20contribute%20a%20translation%20for%20[language].%0A%0A) to let us know you'd like to help
- Attach your translated file to the issue and we'll add it for you

See [AGENTS.md](AGENTS.md#adding-a-new-language) for detailed instructions on the translation format.

## Technical Details
[Technical Details](TECH.md)
