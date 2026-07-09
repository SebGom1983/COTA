// Worker de Cota — reemplaza a Firebase Cloud Functions para todo lo de Strava.
// Es completamente STATELESS: no guarda nada, solo hace de intermediario seguro
// entre el navegador y la API de Strava (para no exponer el client_secret).
//
// Rutas:
//   POST /exchange   { code }                -> intercambia el code OAuth por tokens
//   POST /refresh     { refresh_token }        -> refresca un access_token vencido
//   GET  /activities?after=EPOCH               -> proxy autenticado a la API de Strava
//                                                  (header Authorization: Bearer <access_token>)

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*", // en producción puedes restringirlo a tu dominio de GitHub Pages
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === "/exchange" && request.method === "POST") {
        const { code } = await request.json();
        if (!code) return json({ error: "Falta el code" }, 400);

        const res = await fetch("https://www.strava.com/oauth/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: env.STRAVA_CLIENT_ID,
            client_secret: env.STRAVA_CLIENT_SECRET,
            code,
            grant_type: "authorization_code",
          }),
        });
        const data = await res.json();
        if (!data.access_token) return json({ error: "Strava rechazó el code", detail: data }, 400);

        return json({
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresAt: data.expires_at,
          athleteId: data.athlete?.id || null,
        });
      }

      if (url.pathname === "/refresh" && request.method === "POST") {
        const { refresh_token } = await request.json();
        if (!refresh_token) return json({ error: "Falta refresh_token" }, 400);

        const res = await fetch("https://www.strava.com/oauth/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: env.STRAVA_CLIENT_ID,
            client_secret: env.STRAVA_CLIENT_SECRET,
            grant_type: "refresh_token",
            refresh_token,
          }),
        });
        const data = await res.json();
        if (!data.access_token) return json({ error: "No se pudo refrescar", detail: data }, 400);

        return json({
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresAt: data.expires_at,
        });
      }

      if (url.pathname === "/activities" && request.method === "GET") {
        const auth = request.headers.get("Authorization");
        if (!auth) return json({ error: "Falta Authorization header" }, 401);

        const after = url.searchParams.get("after") || "0";
        const stravaRes = await fetch(
          `https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=100`,
          { headers: { Authorization: auth } }
        );
        const data = await stravaRes.json();
        return json(data, stravaRes.status);
      }

      return json({ error: "Ruta no encontrada" }, 404);
    } catch (err) {
      return json({ error: err.message }, 500);
    }
  },
};
