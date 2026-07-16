/* global Chart */
import { fmtPace } from "./analytics.js";
let paceChart, weightChart;

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
