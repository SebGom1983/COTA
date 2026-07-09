// Reemplaza esto con la configuración de TU proyecto de Firebase
// (Firebase console → Configuración del proyecto → Tus apps → Config)
export const firebaseConfig = {
  apiKey: "TU_API_KEY",
  authDomain: "TU_PROYECTO.firebaseapp.com",
  projectId: "TU_PROYECTO",
  storageBucket: "TU_PROYECTO.appspot.com",
  messagingSenderId: "TU_SENDER_ID",
  appId: "TU_APP_ID",
};

// Client ID de tu app de Strava (público, no es secreto — el secreto vive solo en el Worker de Cloudflare)
export const STRAVA_CLIENT_ID = "TU_STRAVA_CLIENT_ID";

// URL de tu Worker de Cloudflare desplegado (paso "Worker" del README) — algo como:
// https://cota-strava-proxy.tu-usuario.workers.dev
export const STRAVA_PROXY_URL = "https://cota-strava-proxy.TU_SUBDOMINIO.workers.dev";

// Debe coincidir EXACTO con el "Authorization Callback Domain" configurado en tu app de Strava
// y con la URL donde publiques esta app en GitHub Pages.
export const STRAVA_REDIRECT_URI = "https://TU_USUARIO.github.io/cota-app/";
