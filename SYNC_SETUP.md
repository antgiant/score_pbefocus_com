# Cloud folder sync setup

Folder sync lets a quiz be saved to Google Drive or OneDrive, optionally in a folder shared with other scorers. It needs one app registration per provider. Client IDs are public identifiers, not secrets. Put them in `scripts/app-sync-config.js`. Until a provider's values are filled in, the Storage & Sync dialog shows that provider as "not set up".

Add `https://score.pbefocus.com` as an authorized origin / redirect URI in both registrations (and any development origin you test from).

## Google (Drive)

1. Create a project in Google Cloud Console and enable the **Google Drive API** and **Google Picker API**.
2. Configure the OAuth consent screen. The app requests two scopes: `https://www.googleapis.com/auth/drive.file` (only files the app creates or the user picks) and `https://www.googleapis.com/auth/userinfo.email` (the signed-in email, used as the scorer name).
3. Create an **OAuth client ID** of type *Web application*. Authorized JavaScript origin: `https://score.pbefocus.com`. Copy the client ID to `google.clientId`.
4. Create an **API key**, restricted to HTTP referrers `https://score.pbefocus.com/*` and to the Picker API. Copy it to `google.apiKey`.
5. Copy the numeric **project number** to `google.appId` (the Picker needs it so `drive.file` can see the chosen folder).

Access tokens last about an hour and there is no browser refresh token, so after expiry the app keeps scoring locally and shows a Reconnect button.

## Microsoft (OneDrive)

1. In Entra ID (Azure) create an **App registration**. Supported account types: *accounts in any organizational directory and personal Microsoft accounts*.
2. Add a **Single-page application** platform with redirect URI `https://score.pbefocus.com/`.
3. Under API permissions add Microsoft Graph delegated permissions `Files.ReadWrite.AppFolder` (private backup) and `Files.ReadWrite.All` (folders shared by other people). The app requests the broader permission only when someone chooses a shared folder. Some work or school tenants require admin consent for `.All`.
4. Copy the **Application (client) ID** to `microsoft.clientId`. The scorer name comes from the account sign-in name in the ID token, so no extra permission is needed.

If the Microsoft and Google registrations are shared with the other pbefocus.com apps, use those shared IDs.

## Notes

- While a quiz syncs to a cloud folder, history entries record the signed-in account's email as the scorer name. In a shared folder everyone who can open it can see those emails; the dialog says so.
- Large events: beyond about 20 scorers the app switches to relay mode automatically. A few active devices merge everyone's changes into snapshot files and the other devices read only those snapshots. Nothing to configure.
- OneDrive shared folders are chosen by pasting the folder's share link. The OneDrive file picker is not wired in yet.
- Files are only ever written by the device that owns them (`c-{clientId}.yjs`, `snapshot-{clientId}.yjs`) plus a `pbe-session.json` marker. Nothing in a shared folder is deleted by the app.
