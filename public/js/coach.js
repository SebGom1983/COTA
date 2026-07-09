import { predictRaceTimes } from "./analytics.js";

// Ajusta esto con tus fechas reales de carrera — se usa para el taper y las sugerencias.
export const RACES = [
  { name: "Media Maratón de Bogotá", date: "2026-07-26" },
  { name: "21K Medellín", date: "2026-09-06" },
];

function daysUntil(dateStr) {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (24 * 3600 * 1000));
}

export function nextRace() {
  const upcoming = RACES.map((r) => ({ ...r, daysLeft: daysUntil(r.date) })).filter((r) => r.daysLeft >= 0);
  upcoming.sort((a, b) => a.daysLeft - b.daysLeft);
  return upcoming[0] || null;
}

// ---------- Zonas de entreno por disciplina ----------

export function runningZones(runs) {
  const { predictions } = predictRaceTimes(runs);
  const tenK = predictions.find((p) => p.key === "10k");
  if (!tenK) return null;
  const threshold = tenK.paceMinKm; // min/km

  const zone = (label, factorLow, factorHigh, desc) => ({
    label,
    desc,
    paceRange: [
      factorHigh ? +(threshold * factorHigh).toFixed(2) : null,
      +(threshold * factorLow).toFixed(2),
    ],
  });

  return {
    thresholdPace: +threshold.toFixed(2),
    zones: [
      zone("Z1 · Recuperación", 1.3, null, "Trote muy suave, conversación fácil"),
      zone("Z2 · Aeróbico / base", 1.14, 1.3, "Rodajes largos, la mayoría de tu volumen"),
      zone("Z3 · Tempo", 1.04, 1.14, "Ritmo controlado, algo incómodo"),
      zone("Z4 · Umbral", 0.99, 1.04, "Ritmo de carrera 10K-21K"),
      zone("Z5 · VO2max / velocidad", 0, 0.99, "Series cortas, intervalos duros"),
    ],
  };
}

// Ciclismo: si hay potencia usamos zonas Coggan aproximadas; si no, zonas por FC.
export function cyclingZones(rides) {
  const withPower = rides.filter((r) => r.avgWatts);
  if (withPower.length) {
    const ftpEstimate = Math.round(Math.max(...withPower.map((r) => r.avgWatts)) * 0.95);
    return {
      basis: "potencia",
      ftpEstimate,
      zones: [
        { label: "Z1 · Recuperación", range: [0, Math.round(ftpEstimate * 0.55)] },
        { label: "Z2 · Aeróbico", range: [Math.round(ftpEstimate * 0.56), Math.round(ftpEstimate * 0.75)] },
        { label: "Z3 · Tempo", range: [Math.round(ftpEstimate * 0.76), Math.round(ftpEstimate * 0.9)] },
        { label: "Z4 · Umbral", range: [Math.round(ftpEstimate * 0.91), Math.round(ftpEstimate * 1.05)] },
        { label: "Z5 · VO2max", range: [Math.round(ftpEstimate * 1.06), Math.round(ftpEstimate * 1.2)] },
      ],
    };
  }

  const withHR = rides.filter((r) => r.avgHeartRate);
  if (!withHR.length) return null;
  const hrThreshold = Math.round(Math.max(...withHR.map((r) => r.avgHeartRate)) * 0.92);
  return {
    basis: "frecuencia cardíaca",
    hrThreshold,
    zones: [
      { label: "Z1 · Recuperación", range: [0, Math.round(hrThreshold * 0.75)] },
      { label: "Z2 · Aeróbico", range: [Math.round(hrThreshold * 0.76), Math.round(hrThreshold * 0.87)] },
      { label: "Z3 · Tempo", range: [Math.round(hrThreshold * 0.88), Math.round(hrThreshold * 0.95)] },
      { label: "Z4 · Umbral", range: [Math.round(hrThreshold * 0.96), Math.round(hrThreshold * 1.02)] },
      { label: "Z5 · VO2max", range: [Math.round(hrThreshold * 1.03), Math.round(hrThreshold * 1.15)] },
    ],
  };
}

// ---------- Carga combinada (running + ciclismo + gym) ----------

function loadOf(w) {
  if (w.relativeEffort) return w.relativeEffort;
  return (w.durationSec || 0) / 60;
}

function dailyLoad(workouts, days) {
  const cutoff = Date.now() - days * 24 * 3600 * 1000;
  const inWindow = workouts.filter((w) => new Date(w.date).getTime() >= cutoff);
  const total = inWindow.reduce((sum, w) => sum + loadOf(w), 0);
  return total / days;
}

export function combinedACWR(workouts) {
  const acute = dailyLoad(workouts, 7);
  const chronic = dailyLoad(workouts, 28);
  if (chronic === 0) return { acute, chronic, ratio: null, zone: "sin-datos" };
  const ratio = +(acute / chronic).toFixed(2);
  let zone = "óptima";
  if (ratio < 0.8) zone = "baja-carga";
  else if (ratio > 1.5) zone = "riesgo-alto";
  else if (ratio > 1.3) zone = "precaución";
  return { acute: +acute.toFixed(1), chronic: +chronic.toFixed(1), ratio, zone };
}

export const RISK_COPY = {
  "sin-datos": "Aún no hay suficiente historial combinado para calcular esto.",
  "baja-carga": "Carga baja en conjunto — hay margen para meterle más volumen.",
  "óptima": "Carga combinada (running + ciclismo + gym) en zona sana.",
  "precaución": "La carga total subió rápido esta semana entre todas las disciplinas. Ojo con la recuperación.",
  "riesgo-alto": "Carga total muy alta vs tu base reciente — riesgo real de lesión o fatiga acumulada. Prioriza descanso.",
};

// ---------- Feedback post-entreno ----------

export function postWorkoutFeedback(workout, allWorkouts) {
  const sameType = allWorkouts.filter((w) => w.type === workout.type && w.id !== workout.id);
  if (sameType.length < 3) {
    return { verdict: "sin-base", note: "Necesito más sesiones de este tipo para comparar." };
  }
  const avgLoad = sameType.reduce((s, w) => s + loadOf(w), 0) / sameType.length;
  const thisLoad = loadOf(workout);
  const ratio = thisLoad / avgLoad;

  let verdict, note;
  if (ratio >= 1.4) {
    verdict = "muy-duro";
    note = "Bastante más exigente que tu promedio reciente en este tipo de sesión. Prioriza dormir bien y considera un día suave mañana.";
  } else if (ratio >= 1.15) {
    verdict = "duro";
    note = "Sesión exigente, por encima de tu normal. Buen estímulo si venías descansado.";
  } else if (ratio <= 0.7) {
    verdict = "suave";
    note = "Sesión ligera comparada a tu promedio — perfecta como recuperación activa.";
  } else {
    verdict = "normal";
    note = "En línea con tu carga habitual. Buen trabajo consistente.";
  }
  return { verdict, note, ratio: +ratio.toFixed(2) };
}

// ---------- Sugerencia del próximo entreno ----------

export function suggestNextWorkout(workouts) {
  const acwr = combinedACWR(workouts);
  const race = nextRace();
  const last3Days = workouts.filter(
    (w) => Date.now() - new Date(w.date).getTime() <= 3 * 24 * 3600 * 1000
  );
  const chronicLoad = dailyLoad(workouts, 28);
  const lastWasHard = last3Days.some((w) => loadOf(w) > chronicLoad * 1.3);
  const recentTypes = new Set(last3Days.map((w) => w.type));

  if (acwr.zone === "riesgo-alto") {
    return { title: "Descanso o muy suave", reason: RISK_COPY["riesgo-alto"] };
  }
  if (lastWasHard) {
    return {
      title: "Día suave / recuperación activa",
      reason: "Tu última sesión fue notablemente exigente — un trote suave, bici fácil o movilidad ayuda a absorber ese estímulo.",
    };
  }
  if (race && race.daysLeft <= 10) {
    return {
      title: `Taper — carga baja, toques de ritmo (faltan ${race.daysLeft} días para ${race.name})`,
      reason: "Estás en la última semana antes de la carrera: prioriza frescura sobre volumen. Sesiones cortas con algo de ritmo de carrera, sin fatiga.",
    };
  }
  if (!recentTypes.has("gym") && !recentTypes.has("ride")) {
    return {
      title: "Cross-training: bici o gym",
      reason: "Llevas varios días seguidos solo corriendo — meter bici o gym reduce el impacto acumulado en las piernas sin perder condición.",
    };
  }
  return {
    title: "Sesión de calidad (tempo o series)",
    reason: "Tu carga está controlada y no vienes de una sesión dura — es un buen momento para estímulo de calidad.",
  };
}
