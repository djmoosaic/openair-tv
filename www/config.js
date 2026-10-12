// ─────────────────────────────────────────────
//  Your app settings — edit these freely
// ─────────────────────────────────────────────
window.APP_CONFIG = {
  // Name shown in the sidebar and browser tab
  appName: "OpenAir TV",

  // Any M3U playlist works. iptv-org has many:
  //   All channels:        https://iptv-org.github.io/iptv/index.m3u
  //   One country (Kenya): https://iptv-org.github.io/iptv/countries/ke.m3u
  //   One language:        https://iptv-org.github.io/iptv/languages/swa.m3u
  // You can list several; they are merged.
  playlists: [
    "https://iptv-org.github.io/iptv/index.m3u",
  ],

  // Categories shown first, in this order. Others follow alphabetically.
  featuredCategories: ["News", "Sports", "Movies", "Entertainment", "Music", "Kids", "Documentary"],

  // Categories that are never shown
  hiddenCategories: ["XXX", "Adult"],

  // Channels that are never shown, by name or ID (e.g. after a removal request)
  // Example: ["Some Channel", "SomeChannel.uk"]
  hiddenChannels: [],

  // Hide streams marked [Geo-blocked] in their name
  hideGeoBlocked: false,

  // Link to your Android app (.apk) download. Leave "" to hide the button.
  // Example: "https://github.com/YOUR-NAME/openair-tv/releases/latest/download/OpenAirTV.apk"
  androidAppUrl: "https://openairtv.uk/apk",

  // How long to wait for a stream before showing an error (ms)
  loadTimeout: 15000,
};
