// Configuración de TU proyecto de Firebase (cota-98162)
export const firebaseConfig = {
  apiKey: "AIzaSyAkJHoBs8eoU1J0x2tA98kdplO6tRrB1YY",
  authDomain: "cota-98162.firebaseapp.com",
  projectId: "cota-98162",
  storageBucket: "cota-98162.firebasestorage.app",
  messagingSenderId: "71304685528",
  appId: "1:71304685528:web:f2ec905570168545b274ad",
};

// Client ID de tu app de Strava (lo sacas de https://www.strava.com/settings/api)
export const STRAVA_CLIENT_ID = "264259";

// URL de tu Worker de Cloudflare (lo sacas cuando hagamos "wrangler deploy" más adelante)
export const STRAVA_PROXY_URL = "https://cota-strava-proxy.cota-strava-proxy.workers.dev";
// URL real donde vive tu app en GitHub Pages
export const STRAVA_REDIRECT_URI = "https://sebgom1983.github.io/COTA/";
