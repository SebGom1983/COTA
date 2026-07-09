// ---------- Predictor de tiempo de carrera (fórmula de Riegel) ----------
// T2 = T1 * (D2/D1)^1.06 — estándar en ciencia del deporte para estimar tiempos en otras distancias
// a partir de tu mejor rendimiento reciente.

const RACE_DISTANCES = [
  { key: "5k", label: "5K", km: 5 },
  { key: "10k", label: "10K", km: 10 },
  { key: "15k", label: "15K", km: 15 },
  { key: "21k", label: "21.1K (media)", km: 21.0975 },
  { key: "42k", label: "42.2K (maratón)", km: 42.195 },
];

// Elige la "mejor" carrera reciente para basar la predicción: prioriza esfuerzo/distancia relevante
// (>= 5km) y ritmo más rápido en los últimos 60 días.
function pickReferenceRun(runs) {
  const cutoff = Date.now() - 60 * 24 * 3600 * 1000;
  const candidates = runs.filter((r) => r.distanceKm >= 5 && new Date(r.date).getTime() >= cutoff && r.durationSec);
  if (!candidates.length) return null;
  return candidates.reduce((best, r) => {
    const paceR = r.durationSec / r.distanceKm;
    const paceBest = best.durationSec / best.distanceKm;
    return paceR < paceBest ? r : best;
  });
}

export function predictRaceTimes(runs) {
  const ref = pickReferenceRun(runs);
  if (!ref) return { ref: null, predictions: [] };

  const predictions = RACE_DISTANCES.map((d) => {
    const seconds = ref.durationSec * Math.pow(d.km / ref.distanceKm, 1.06);
    return { ...d, seconds, paceMinKm: seconds / 60 / d.km };
  });

  return { ref, predictions };
}

export function fmtHMS(totalSeconds) {
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

// ---------- Carga de entreno: ratio agudo:crónico (ACWR) ----------
// Cada sesión aporta una "carga". Usamos el relative_effort de Strava si existe (ya viene calibrado
// tipo TSS); si es manual, aproximamos con minutos de duración como proxy de carga.

function dailyLoad(runs, days) {
  const cutoff = Date.now() - days * 24 * 3600 * 1000;
  const inWindow = runs.filter((r) => new Date(r.date).getTime() >= cutoff);
  const totalLoad = inWindow.reduce((sum, r) => sum + (r.relativeEffort || (r.durationSec || 0) / 60), 0);
  return totalLoad / days;
}

export function computeACWR(runs) {
  const acute = dailyLoad(runs, 7);
  const chronic = dailyLoad(runs, 28);
  if (chronic === 0) return { acute, chronic, ratio: null, zone: "sin-datos" };

  const ratio = +(acute / chronic).toFixed(2);
  let zone = "óptima";
  if (ratio < 0.8) zone = "baja-carga";
  else if (ratio > 1.5) zone = "riesgo-alto";
  else if (ratio > 1.3) zone = "precaución";

  return { acute: +acute.toFixed(1), chronic: +chronic.toFixed(1), ratio, zone };
}

export const ACWR_COPY = {
  "sin-datos": "Aún no hay suficiente historial para calcular esto.",
  "baja-carga": "Carga baja — hay espacio para aumentar volumen sin mucho riesgo.",
  "óptima": "Carga en zona óptima — buen balance entre estímulo y recuperación.",
  "precaución": "Subiste la carga rápido esta semana. Vigila cómo te sientes.",
  "riesgo-alto": "Carga muy por encima de tu base reciente — riesgo elevado de lesión o fatiga.",
};

// ---------- Detección automática de PRs ----------

const PR_BUCKETS = [
  { key: "5k", label: "5K", km: 5, tolerance: 0.5 },
  { key: "10k", label: "10K", km: 10, tolerance: 1 },
  { key: "15k", label: "15K", km: 15, tolerance: 1.5 },
  { key: "21k", label: "21.1K", km: 21.0975, tolerance: 1.5 },
];

export function detectPRs(runs) {
  const sorted = runs.slice().sort((a, b) => new Date(a.date) - new Date(b.date));
  const bestSoFar = {};
  const prEvents = [];

  for (const r of sorted) {
    if (!r.distanceKm || !r.durationSec) continue;
    const bucket = PR_BUCKETS.find((b) => Math.abs(r.distanceKm - b.km) <= b.tolerance);
    if (!bucket) continue;

    const current = bestSoFar[bucket.key];
    if (!current || r.durationSec < current.durationSec) {
      bestSoFar[bucket.key] = r;
      prEvents.push({ ...r, bucketLabel: bucket.label, bucketKey: bucket.key });
    }
  }

  return {
    currentBests: PR_BUCKETS.map((b) => ({ ...b, best: bestSoFar[b.key] || null })),
    recentPRs: prEvents.slice(-5).reverse(),
  };
}

// ---------- Plan de 10 semanas vs realidad ----------

export function compareWeeklyPlan(runs, plan) {
  if (!plan || !plan.startDate || !plan.weeks || !plan.weeks.length) return [];
  const start = new Date(plan.startDate).getTime();

  return plan.weeks.map((targetKm, i) => {
    const weekStart = start + i * 7 * 24 * 3600 * 1000;
    const weekEnd = weekStart + 7 * 24 * 3600 * 1000;
    const actualKm = runs
      .filter((r) => {
        const t = new Date(r.date).getTime();
        return t >= weekStart && t < weekEnd;
      })
      .reduce((sum, r) => sum + (r.distanceKm || 0), 0);

    return {
      week: i + 1,
      targetKm,
      actualKm: +actualKm.toFixed(1),
      diffPct: targetKm ? Math.round(((actualKm - targetKm) / targetKm) * 100) : null,
      isFuture: weekStart > Date.now(),
    };
  });
}
