import { fmtPace } from "./analytics.js";

/* global Chart */

let paceChart, weightChart, sleepLoadChart;

export function renderPaceChart(canvasId, workouts) {
  const runs = workouts
    .filter((w) => w.type === "run" && w.avgPaceMinKm)
    .slice()
    .reverse();

  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  if (paceChart) paceChart.destroy();

  paceChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: runs.map((r) => new Date(r.date).toLocaleDateString("es-CO", { day: "2-digit", month: "short" })),
      datasets: [
        {
          label: "Ritmo (min/km)",
          data: runs.map((r) => r.avgPaceMinKm),
          borderColor: "#2C5B3F",
          backgroundColor: "rgba(44,91,63,0.08)",
          tension: 0.3,
          fill: true,
          pointBackgroundColor: "#B5502B",
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => `Ritmo: ${fmtPace(ctx.parsed.y)} min/km` } },
      },
      scales: {
        y: {
          reverse: true,
          title: { display: true, text: "min/km (menos = mejor)" },
          ticks: { callback: (val) => fmtPace(val) },
        },
      },
    },
  });
}

export function renderWeightChart(canvasId, metrics) {
  const withWeight = metrics
    .filter((m) => m.weightKg)
    .slice()
    .reverse();

  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  if (weightChart) weightChart.destroy();

  weightChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: withWeight.map((m) => new Date(m.date).toLocaleDateString("es-CO", { day: "2-digit", month: "short" })),
      datasets: [
        {
          label: "Peso (kg)",
          data: withWeight.map((m) => m.weightKg),
          borderColor: "#B5502B",
          backgroundColor: "rgba(181,80,43,0.08)",
          tension: 0.3,
          fill: true,
          pointBackgroundColor: "#2C5B3F",
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
    },
  });
}

// Agrupa por semana: promedio de sueño vs carga total entrenada esa semana
export function renderSleepVsLoadChart(canvasId, wellness, workouts) {
  const weeks = {};
  const weekKey = (d) => {
    const date = new Date(d);
    const monday = new Date(date);
    monday.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    return monday.toISOString().slice(0, 10);
  };

  wellness.forEach((w) => {
    if (w.sleepScore == null) return;
    const k = weekKey(w.date);
    weeks[k] = weeks[k] || { sleepScores: [], load: 0 };
    weeks[k].sleepScores.push(w.sleepScore);
  });
  workouts.forEach((w) => {
    const k = weekKey(w.date);
    weeks[k] = weeks[k] || { sleepScores: [], load: 0 };
    weeks[k].load += w.relativeEffort || (w.durationSec || 0) / 60;
  });

  const sortedWeeks = Object.keys(weeks).sort().slice(-10);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  if (sleepLoadChart) sleepLoadChart.destroy();
  if (!sortedWeeks.length) return;

  sleepLoadChart = new Chart(ctx, {
    data: {
      labels: sortedWeeks.map((k) => new Date(k).toLocaleDateString("es-CO", { day: "2-digit", month: "short" })),
      datasets: [
        {
          type: "bar",
          label: "Carga de entreno",
          data: sortedWeeks.map((k) => Math.round(weeks[k].load)),
          backgroundColor: "rgba(181,80,43,0.35)",
          yAxisID: "y",
        },
        {
          type: "line",
          label: "Sueño promedio (score)",
          data: sortedWeeks.map((k) => {
            const s = weeks[k].sleepScores;
            return s.length ? Math.round(s.reduce((a, b) => a + b, 0) / s.length) : null;
          }),
          borderColor: "#2C5B3F",
          yAxisID: "y1",
          tension: 0.3,
        },
      ],
    },
    options: {
      responsive: true,
      scales: {
        y: { position: "left", title: { display: true, text: "Carga" } },
        y1: {
          position: "right",
          min: 0,
          max: 100,
          title: { display: true, text: "Sueño" },
          grid: { drawOnChartArea: false },
        },
      },
    },
  });
}
