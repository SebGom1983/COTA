# Cota 🏔️

App de entrenamiento: running + ciclismo + gym + métricas físicas, con sync automático a Strava
y un módulo de coaching (zonas, carga de entreno, predicción de tiempos, PRs).

**100% gratis, sin tarjeta de crédito en ningún lado.**

Arquitectura:
- **Frontend**: HTML/JS estático → GitHub Pages (gratis)
- **Auth + base de datos**: Firebase Auth + Firestore, plan **Spark** (gratis, sin tarjeta)
- **Proxy de Strava**: Cloudflare Workers (gratis, sin tarjeta) — reemplaza lo que normalmente sería
  Cloud Functions, solo para esconder el `client_secret` de Strava
- **Fotos de progreso**: comprimidas en el navegador y guardadas como base64 directo en Firestore
  (evita necesitar Firebase Storage, que sí exige tarjeta)

---

## 0. Qué necesitas

- Cuenta de Google (para Firebase) — gratis
- Cuenta de Cloudflare (para el proxy de Strava) — gratis, sin tarjeta
- Cuenta de Strava
- Cuenta de GitHub
- Node.js 18+ instalado

---

## 1. Firebase (Auth + Firestore)

1. https://console.firebase.google.com → **Crear proyecto**
2. Activa:
   - **Authentication** → Sign-in method → habilita **Google**
   - **Firestore Database** → Crear base de datos → modo producción → región `southamerica-east1`
3. **NO actives Storage y NO subas a Blaze** — no lo necesitas.
4. Configuración del proyecto → Tus apps → Web (`</>`) → registra la app → copia el `firebaseConfig`.
5. Pégalo en `public/js/firebase-config.js`.
6. Despliega las reglas de seguridad de Firestore:
   ```bash
   npm install -g firebase-tools
   firebase login
   firebase use --add        # elige tu proyecto
   firebase deploy --only firestore:rules
   ```

---

## 2. Cloudflare Worker (proxy de Strava)

1. Crea cuenta gratis en https://dash.cloudflare.com/sign-up (no pide tarjeta).
2. Instala Wrangler (CLI de Cloudflare) y despliega:
   ```bash
   cd worker
   npm install -g wrangler
   wrangler login              # abre el navegador, autoriza

   wrangler secret put STRAVA_CLIENT_ID
   wrangler secret put STRAVA_CLIENT_SECRET

   wrangler deploy
   ```
3. Al terminar, Wrangler te muestra una URL tipo `https://cota-strava-proxy.tu-usuario.workers.dev`.
   Cópiala y pégala en `public/js/firebase-config.js` como `STRAVA_PROXY_URL`.

(Los valores de `STRAVA_CLIENT_ID`/`STRAVA_CLIENT_SECRET` los sacas del paso 3.)

---

## 3. App de Strava

1. https://www.strava.com/settings/api → crea una app.
2. **Authorization Callback Domain**: el dominio de GitHub Pages sin `https://`, ej: `tuusuario.github.io`.
3. Copia **Client ID** → `firebase-config.js` (`STRAVA_CLIENT_ID`) y también úsalo en `wrangler secret put STRAVA_CLIENT_ID`.
4. Copia **Client Secret** → solo en `wrangler secret put STRAVA_CLIENT_SECRET` (nunca en el código del frontend).
5. Actualiza `STRAVA_REDIRECT_URI` en `firebase-config.js` con tu URL final de GitHub Pages.

---

## 4. Publicar el frontend en GitHub Pages

```bash
cd cota-app
git init
git add .
git commit -m "Cota v1"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/cota-app.git
git push -u origin main
```

GitHub → tu repo → **Settings → Pages** → Source: rama `main`, carpeta `/public`.

⚠️ La URL final debe coincidir EXACTO con `STRAVA_REDIRECT_URI` y con el "Authorization Callback Domain" de Strava.

---

## 5. Probar

1. Abre tu URL de GitHub Pages → **Entrar con Google**.
2. **Panel** → **Conectar con Strava** → autoriza.
3. Deberías ver tus carreras/salidas recientes importadas.
4. Prueba registrar sesiones manuales y una métrica física con foto.

⚠️ Diferencia importante vs la versión con Cloud Functions: acá el sync pasa **cuando abres la app**
(no cada 3 horas en segundo plano, porque eso sí requeriría un servidor corriendo solo, con costo).
En la práctica, cada vez que abras Cota se sincroniza sola — para tu uso es prácticamente lo mismo.

---

## Estructura del proyecto

```
cota-app/
├── public/                      ← se publica en GitHub Pages
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── firebase-config.js   ← TUS credenciales van aquí
│       ├── auth.js
│       ├── store.js
│       ├── strava.js            ← habla con el Worker de Cloudflare
│       ├── analytics.js
│       ├── coach.js
│       ├── charts.js
│       └── app.js
├── worker/                      ← Cloudflare Worker (reemplaza Cloud Functions)
│   ├── strava-proxy.js
│   └── wrangler.toml
└── firestore.rules
```

## Modelo de datos (Firestore)

- `profiles/{uid}` — nombre y foto públicos
- `users/{uid}/private/strava` — tokens de Strava (privado, solo el dueño lee/escribe)
- `users/{uid}/workouts/{id}` — running, ciclismo y gym (manuales o de Strava)
- `users/{uid}/metrics/{id}` — peso, % grasa, fotos de progreso (base64)
- `feed/{id}` — posts públicos opcionales para la pestaña Comunidad

## Coach

Ver la pestaña "Coach" en la app: predicción de tiempos (Riegel), zonas por disciplina,
carga de entreno combinada (ACWR), feedback post-entreno y sugerencia del próximo entreno.
Lógica basada en fórmulas de ciencia del deporte, auditable en `public/js/coach.js`.
Las fechas de tus carreras están en `RACES` dentro de ese archivo — actualízalas si cambian.

## Si más adelante SÍ quieres pagar por más features

- Firebase Blaze + Cloud Functions → sync automático en segundo plano cada X horas sin abrir la app
- Firebase Storage → fotos en calidad completa en vez de comprimidas
- Webhook de Strava → sync casi instantáneo en vez de al abrir la app

Ninguna de estas es necesaria para que Cota funcione bien hoy.
