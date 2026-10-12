# OpenAir TV — free live TV, on the web and on Android

One project, two apps:

- **Website** — the `www/` folder. Plain HTML, CSS and JavaScript, no build step.
- **Android app (APK)** — the `android/` folder wraps the same website in a native app.

Channels come from the free [iptv-org](https://github.com/iptv-org/iptv) playlists.

## Try it right now
Double-click **`OpenAirTV-web.html`** — it's the whole website in one file, so it works from anywhere.

To work on the separate files, first **extract** the zip (right-click → *Extract All*), then open `www/index.html` from the extracted folder. Opening it straight from inside the zip leaves its other files behind and the page won't work.

## Put the website live on openairtv.uk (Cloudflare Pages, free)

1. Log in at **dash.cloudflare.com** → **Workers & Pages** → **Create** → **Pages** → **Upload assets** (direct upload).
2. Project name: `openair-tv`. Upload **OpenAirTV-website.zip** (or drag in the contents of the `www` folder) → **Deploy**.
   Your site is now live at `https://openair-tv.pages.dev`.
3. In the project, open **Custom domains** → **Set up a custom domain** → enter `openairtv.uk` → **Activate**.
   Because your domain is at Cloudflare, it connects automatically. Repeat for `www.openairtv.uk` if you like.
4. **Email:** the About / Privacy / Disclaimer pages list `contact@openairtv.uk`. Make it work for free:
   Cloudflare dashboard → `openairtv.uk` → **Email** → **Email Routing** → forward `contact@` to your own inbox.

To update the site later: change files in `www`, then in the Pages project click **Create deployment** and upload again.

## Build the Android app (APK) with GitHub, free

1. Create a free account at github.com and a **new repository** (e.g. `openair-tv`).
2. Upload everything in this folder (including the hidden `.github` folder — GitHub Desktop is easiest).
3. Open the **Actions** tab and wait for **Build Android APK** (about 5 minutes).
   The APK appears under **Releases → Latest APK → OpenAirTV.apk**.
4. The website already links to it: **openairtv.uk/apk** always downloads the latest APK
   (set in `www/_redirects`). On a Fire Stick, type `openairtv.uk/apk` into the Downloader app.

## Make it yours
| What | Where |
|---|---|
| App name in the website | `www/config.js` → `appName` |
| App name on the phone | `capacitor.config.json` → `appName`, and `android/app/src/main/res/values/strings.xml` |
| Which channels (all, one country, one language…) | `www/config.js` → `playlists` (examples inside) |
| Category order, hidden categories | `www/config.js` |
| Hide a specific channel (e.g. after a removal request) | `www/config.js` → `hiddenChannels` |
| Android app download button | `www/config.js` → `androidAppUrl` |
| About / Privacy / Disclaimer text | `www/about.html`, `www/privacy.html`, `www/disclaimer.html` |
| Colours | `www/style.css`, top of the file — changing `--accent` restyles everything |
| Package ID (must be unique if you publish on Play Store) | `capacitor.config.json` → `appId` and `android/app/build.gradle` → `applicationId` |

## Good to know
- **Some channels only play in the app.** Streams with `http://` links are blocked by browsers on secure (`https://`) websites. The website labels these *App only*; the Android app plays them.
- **Some streams fail.** iptv-org links to streams run by others: some go offline, run part-time (`Not 24/7`) or only work in certain countries (`Geo-blocked`). When a channel has several sources, the app tries the next one automatically and shows buttons to switch.
- **The APK is a "debug" build** — fine for installing on your own and friends' phones. To publish on the Google Play Store you'd need a signed release build; ask and I can add that.
- iptv-org only collects links to publicly available streams. Respect each broadcaster's terms, especially if you share or monetise the app.

## Features
Search (press `/` to jump to it) · category chips · favourites (saved on the device) · multiple sources per channel with automatic fallback · shareable links like `?channel=AlJazeera.qa@English` · remembers the last channel · phone layout with the player on top.
