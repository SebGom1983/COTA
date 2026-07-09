import { doc, getDoc, setDoc, collection, writeBatch, getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { app } from "./store.js";
import { STRAVA_CLIENT_ID, STRAVA_REDIRECT_URI, STRAVA_PROXY_URL } from "./firebase-config.js";

const db = getFirestore(app);

export function startStravaConnect() {
  const url = new URL("https://www.strava.com/oauth/authorize");
  url.searchParams.set("client_id", STRAVA_CLIENT_ID);
  url.searchParams.set("redirect_uri", STRAVA_REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("approval_prompt", "auto");
  url.searchParams.set("scope", "read,activity:read_all");
  window.location.href = url.toString();
}

const RUN_TYPES = ["Run", "TrailRun"];
const RIDE_TYPES = ["Ride", "VirtualRide", "GravelRide", "MountainBikeRide"];
const GYM_TYPES = ["WeightTraining", "Workout", "Crossfit"];

function disciplineOf(stravaType) {
  if (RUN_TYPES.includes(stravaType)) return "run";
  if (RIDE_TYPES.includes(stravaType)) return "ride";
  if (GYM_TYPES.includes(stravaType)) return "gym";
  return null;
}

function mapActivity(a) {
  const type = disciplineOf(a.sport_type || a.type);
  return {
    source: "strava",
    stravaId: a.id,
    type,
    name: a.name,
    date: a.start_date,
    distanceKm: a.distance ? +(a.distance / 1000).toFixed(2) : null,
    durationSec: a.moving_time,
    elevationGainM: a.total_elevation_gain || 0,
    avgPaceMinKm:
      type === "run" && a.moving_time && a.distance
        ? +((a.moving_time / 60) / (a.distance / 1000)).toFixed(2)
        : null,
    avgSpeedKmh: type === "ride" && a.average_speed ? +(a.average_speed * 3.6).toFixed(1) : null,
    avgWatts: a.average_watts || null,
    avgHeartRate: a.average_heartrate || null,
    relativeEffort: a.suffer_score || null,
  };
}

async function getValidAccessToken(uid) {
  const ref = doc(db, `users/${uid}/private/strava`);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const data = snap.data();

  const now = Math.floor(Date.now() / 1000);
  if (data.expiresAt && data.expiresAt > now + 60) {
    return data.accessToken;
  }

  // token vencido -> refrescar via el Worker
  const res = await fetch(`${STRAVA_PROXY_URL}/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: data.refreshToken }),
  });
  const fresh = await res.json();
  if (!fresh.accessToken) throw new Error("No se pudo refrescar el token de Strava");

  await setDoc(ref, { accessToken: fresh.accessToken, refreshToken: fresh.refreshToken, expiresAt: fresh.expiresAt }, { merge: true });
  return fresh.accessToken;
}

async function pullAndSaveActivities(uid) {
  const ref = doc(db, `users/${uid}/private/strava`);
  const snap = await getDoc(ref);
  if (!snap.exists()) return 0;
  const data = snap.data();

  const accessToken = await getValidAccessToken(uid);
  const after = data.lastSyncEpoch || Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 90;

  const res = await fetch(`${STRAVA_PROXY_URL}/activities?after=${after}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const activities = await res.json();
  if (!Array.isArray(activities)) throw new Error("Respuesta inesperada de Strava");

  const relevant = activities.filter((a) => disciplineOf(a.sport_type || a.type) !== null);
  const batch = writeBatch(db);
  for (const a of relevant) {
    const wRef = doc(collection(db, `users/${uid}/workouts`), `strava_${a.id}`);
    batch.set(wRef, mapActivity(a), { merge: true });
  }
  await batch.commit();

  await setDoc(ref, { lastSyncEpoch: Math.floor(Date.now() / 1000) }, { merge: true });
  return relevant.length;
}

// Llamar al cargar la app: revisa si venimos de vuelta de Strava con ?code=...
export async function handleStravaCallback(uid) {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (!code) return null;

  window.history.replaceState({}, document.title, window.location.pathname);

  const res = await fetch(`${STRAVA_PROXY_URL}/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const tokens = await res.json();
  if (!tokens.accessToken) throw new Error(tokens.error || "Strava rechazó la conexión");

  await setDoc(
    doc(db, `users/${uid}/private/strava`),
    {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      athleteId: tokens.athleteId,
      connectedAt: new Date().toISOString(),
    },
    { merge: true }
  );

  const synced = await pullAndSaveActivities(uid);
  return { connected: true, synced };
}

export async function isStravaConnected(uid) {
  const snap = await getDoc(doc(db, `users/${uid}/private/strava`));
  return snap.exists();
}

export async function syncStravaNow(uid) {
  const synced = await pullAndSaveActivities(uid);
  return { synced };
}
