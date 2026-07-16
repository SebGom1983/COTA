import { login, logout, watchAuth } from "./auth.js";
import {
  addWorkout,
  deleteWorkout,
  watchWorkouts,
  addMetric,
  watchMetrics,
  shareToFeed,
  watchFeed,
} from "./store.js";
import { startStravaConnect, handleStravaCallback, isStravaConnected, syncStravaNow } from "./strava.js";
import { renderPaceChart, renderWeightChart } from "./charts.js";
import { predictRaceTimes, fmtHMS, fmtPace, detectPRs } from "./analytics.js";
import {
  runningZones,
  cyclingZones,
  combinedACWR,
  RISK_COPY,
  postWorkoutFeedback,
  suggestNextWorkout,
  nextRace,
} from "./coach.js";

const root = document.getElementById("root");
let currentUser = null;
let currentTab = "dashboard";
let workoutsCache = [];
let metricsCache = [];
let stravaConnected = false;
let unsubWorkouts = null;
let unsubMetrics = null;

function toast(msg) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function fmtDuration(sec) {
  if (!sec) return "-";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ---------- render principal ----------

function render() {
  if (!currentUser) {
    root.innerHTML = `
      <div class="app-shell">
        <div class="auth-screen">
          <div class="brand"><span class="cota-mark">·</span> COTA <span class="cota-mark">·</span></div>
          <p>Tu registro de entrenos, gym y físico — sincronizado con Strava, guardado en la nube.</p>
          <button class="primary" id="btnLogin">Entrar con Google</button>
        </div>
      </div>`;
    document.getElementById("btnLogin").onclick = () => login().catch((e) => toast(e.message));
    return;
  }

  const runs = workoutsCache.filter((w) => w.type === "run");
  const gymSessions = workoutsCache.filter((w) => w.type === "gym");
  const totalKm = runs.reduce((s, r) => s + (r.distanceKm || 0), 0).toFixed(1);
  const bestPace = runs.length ? Math.min(...runs.filter(r=>r.avgPaceMinKm).map((r) => r.avgPaceMinKm)) : null;
  const lastWeight = metricsCache.find((m) => m.weightKg)?.weightKg;

  root.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div>
          <div class="brand"><span class="cota-mark">·</span>COTA</div>
          <div class="brand-sub">${currentUser.displayName || ""}
            <div style="font-size:13px;color:var(--moss-500)">${currentUser.email || ""}</div>
          </div>
        </div>
        <button class="ghost" id="btnLogout">Salir</button>
      </header>

      <nav class="tabs">
        ${["dashboard", "running", "ride", "gym", "fisico", "coach", "comunidad"]
          .map(
            (t) =>
              `<button data-tab="${t}" class="${t === currentTab ? "active" : ""}">${labelFor(t)}</button>`
          )
          .join("")}
      </nav>

      <div id="tabContent"></div>
    </div>`;

  document.getElementById("btnLogout").onclick = () => logout();
  document.querySelectorAll("nav.tabs button").forEach((b) => {
    b.onclick = () => {
      currentTab = b.dataset.tab;
      render();
    };
  });

  const content = document.getElementById("tabContent");

  const rides = workoutsCache.filter((w) => w.type === "ride");

  if (currentTab === "dashboard") content.innerHTML = dashboardHTML(totalKm, bestPace, lastWeight, gymSessions.length);
  if (currentTab === "running") content.innerHTML = runningHTML(runs);
  if (currentTab === "ride") content.innerHTML = rideHTML(rides);
  if (currentTab === "gym") content.innerHTML = gymHTML(gymSessions);
  if (currentTab === "fisico") content.innerHTML = fisicoHTML(metricsCache);
  if (currentTab === "coach") content.innerHTML = coachHTML(runs, rides, workoutsCache);
  if (currentTab === "comunidad") content.innerHTML = comunidadHTML();

  attachTabHandlers();

  if (currentTab === "dashboard" && runs.length) {
    setTimeout(() => renderPaceChart("paceChart", runs), 0);
  }
  if (currentTab === "fisico" && metricsCache.some((m) => m.weightKg)) {
    setTimeout(() => renderWeightChart("weightChart", metricsCache), 0);
  }
}

function labelFor(t) {
  return {
    dashboard: "Panel",
    running: "Running",
    ride: "Ciclismo",
    gym: "Gym",
    fisico: "Físico",
    coach: "Coach",
    comunidad: "Comunidad",
  }[t];
}

function dashboardHTML(totalKm, bestPace, lastWeight, gymCount) {
  return `
    <div class="card">
      <h3>Resumen</h3>
      <div class="stat-grid">
        <div class="stat"><span class="value">${totalKm}</span><span class="label">Km totales</span></div>
        <div class="stat pr"><span class="value">${bestPace ? fmtPace(bestPace) : "-"}</span><span class="label">Mejor ritmo min/km</span></div>
        <div class="stat"><span class="value">${gymCount}</span><span class="label">Sesiones gym</span></div>
        <div class="stat"><span class="value">${lastWeight || "-"}</span><span class="label">Peso actual kg</span></div>
      </div>
    </div>
    <div class="card">
      <h3>Conexión Strava</h3>
      <p style="font-size:13px;color:var(--moss-500);margin-top:0">
        ${stravaConnected ? "Conectado — tus carreras se sincronizan automáticamente." : "Conecta tu cuenta para importar tus carreras automáticamente."}
      </p>
      ${
        stravaConnected
          ? `<button class="ghost" id="btnSyncNow">Sincronizar ahora</button>`
          : `<button class="strava" id="btnConnectStrava">Conectar con Strava</button>`
      }
    </div>
    <div class="card">
      <h3>Progreso de ritmo</h3>
      <canvas id="paceChart" height="90"></canvas>
    </div>`;
}

function runningHTML(runs) {
  return `
    <div class="card">
      <h3>Registrar carrera manual</h3>
      <form id="runForm" class="form-grid">
        <div class="field"><label>Fecha</label><input type="date" name="date" required value="${new Date().toISOString().slice(0,10)}"></div>
        <div class="field"><label>Distancia (km)</label><input type="number" step="0.01" name="distanceKm" required></div>
        <div class="field"><label>Duración (min)</label><input type="number" step="0.1" name="durationMin" required></div>
        <div class="field"><label>Notas</label><input type="text" name="name" placeholder="Rodaje suave, series..."></div>
        <div class="field" style="align-self:end"><button class="primary" type="submit">Guardar</button></div>
      </form>
    </div>
    <div class="card">
      <h3>Carreras (${runs.length})</h3>
      ${runs.length ? runs.map(runRow).join("") : `<div class="empty-state">Aún no tienes carreras registradas.</div>`}
    </div>`;
}

function runRow(r) {
  return `
    <div class="workout-row">
      <div>
        <span class="tag">${r.source === "strava" ? "strava" : "manual"}</span>
        <span class="meta">${r.name || "Carrera"} — ${new Date(r.date).toLocaleDateString("es-CO")}</span>
      </div>
      <div class="num">${r.distanceKm} km · ${r.avgPaceMinKm ? fmtPace(r.avgPaceMinKm) + " min/km" : fmtDuration(r.durationSec) + " min"}</div>
    </div>`;
}

function gymHTML(sessions) {
  return `
    <div class="card">
      <h3>Registrar sesión de gym</h3>
      <form id="gymForm" class="form-grid">
        <div class="field"><label>Fecha</label><input type="date" name="date" required value="${new Date().toISOString().slice(0,10)}"></div>
        <div class="field"><label>Grupo muscular</label><input type="text" name="name" placeholder="Piernas, empuje, tirón..." required></div>
        <div class="field"><label>Duración (min)</label><input type="number" name="durationMin" required></div>
        <div class="field"><label>Notas / ejercicios</label><input type="text" name="notes" placeholder="Sentadilla 4x8 80kg..."></div>
        <div class="field" style="align-self:end"><button class="primary" type="submit">Guardar</button></div>
      </form>
    </div>
    <div class="card">
      <h3>Sesiones (${sessions.length})</h3>
      ${sessions.length ? sessions.map(gymRow).join("") : `<div class="empty-state">Aún no tienes sesiones de gym.</div>`}
    </div>`;
}

function gymRow(g) {
  return `
    <div class="workout-row">
      <div>
        <span class="tag gym">gym</span>
        <span class="meta">${g.name} — ${new Date(g.date).toLocaleDateString("es-CO")}</span>
      </div>
      <div class="num">${g.durationSec ? Math.round(g.durationSec/60) : "-"} min</div>
    </div>`;
}

function rideHTML(rides) {
  return `
    <div class="card">
      <h3>Registrar salida en bici</h3>
      <form id="rideForm" class="form-grid">
        <div class="field"><label>Fecha</label><input type="date" name="date" required value="${new Date().toISOString().slice(0,10)}"></div>
        <div class="field"><label>Distancia (km)</label><input type="number" step="0.1" name="distanceKm" required></div>
        <div class="field"><label>Duración (min)</label><input type="number" step="0.1" name="durationMin" required></div>
        <div class="field"><label>Notas</label><input type="text" name="name" placeholder="Rodada de fondo, intervalos..."></div>
        <div class="field" style="align-self:end"><button class="primary" type="submit">Guardar</button></div>
      </form>
    </div>
    <div class="card">
      <h3>Salidas (${rides.length})</h3>
      ${rides.length ? rides.map(rideRow).join("") : `<div class="empty-state">Aún no tienes salidas en bici registradas.</div>`}
    </div>`;
}

function rideRow(r) {
  return `
    <div class="workout-row">
      <div>
        <span class="tag" style="background:rgba(124,147,160,0.16);color:var(--sky-mist)">${r.source === "strava" ? "strava" : "manual"}</span>
        <span class="meta">${r.name || "Salida"} — ${new Date(r.date).toLocaleDateString("es-CO")}</span>
      </div>
      <div class="num">${r.distanceKm ? r.distanceKm + " km" : ""} ${r.avgSpeedKmh ? "· " + r.avgSpeedKmh + " km/h" : ""}</div>
    </div>`;
}

function coachHTML(runs, rides, allWorkouts) {
  const rZones = runningZones(runs);
  const cZones = cyclingZones(rides);
  const acwr = combinedACWR(allWorkouts);
  const suggestion = suggestNextWorkout(allWorkouts);
  const race = nextRace();
  const { predictions } = predictRaceTimes(runs);
  const { recentPRs } = detectPRs(runs);

  const lastWorkout = allWorkouts.slice().sort((a, b) => new Date(b.date) - new Date(a.date))[0];
  const feedback = lastWorkout ? postWorkoutFeedback(lastWorkout, allWorkouts) : null;

  return `
    <div class="card">
      <h3>Sugerencia de hoy</h3>
      <div style="font-family:var(--font-display);font-size:20px;color:var(--sienna);margin-bottom:6px;">${suggestion.title}</div>
      <p style="font-size:13px;color:var(--moss-500);margin:0;">${suggestion.reason}</p>
      ${race ? `<p style="font-size:12px;color:var(--sky-mist);margin:10px 0 0;">Próxima carrera: ${race.name} — faltan ${race.daysLeft} días.</p>` : ""}
    </div>

    <div class="card">
      <h3>Carga de entreno (ACWR combinado)</h3>
      <div class="stat-grid">
        <div class="stat"><span class="value">${acwr.acute ?? "-"}</span><span class="label">Carga aguda (7d)</span></div>
        <div class="stat"><span class="value">${acwr.chronic ?? "-"}</span><span class="label">Carga crónica (28d)</span></div>
        <div class="stat pr"><span class="value">${acwr.ratio ?? "-"}</span><span class="label">Ratio A:C</span></div>
      </div>
      <p style="font-size:13px;color:var(--moss-500);margin:12px 0 0;">${RISK_COPY[acwr.zone]}</p>
    </div>

    ${
      feedback
        ? `<div class="card">
      <h3>Feedback de tu última sesión</h3>
      <p style="font-size:13px;color:var(--moss-500);margin:0;"><strong style="color:var(--moss-900)">${feedback.verdict.replace("-", " ")}</strong> — ${feedback.note}</p>
    </div>`
        : ""
    }

    ${
      rZones
        ? `<div class="card">
      <h3>Zonas de running (basadas en tu ritmo umbral estimado)</h3>
      ${rZones.zones.map((z) => `
        <div class="row">
          <div>${z.label}<div style="font-size:11px;color:var(--sky-mist)">${z.desc}</div></div>
          <div class="num">${z.paceRange[0] ? fmtPace(z.paceRange[0]) + "–" : "<"}${fmtPace(z.paceRange[1])} min/km</div>
        </div>`).join("")}
    </div>`
        : ""
    }

    ${
      cZones
        ? `<div class="card">
      <h3>Zonas de ciclismo (basadas en ${cZones.basis})</h3>
      ${cZones.zones.map((z) => `
        <div class="row"><div>${z.label}</div><div class="num">${z.range[0]}–${z.range[1]} ${cZones.basis === "potencia" ? "W" : "ppm"}</div></div>`).join("")}
    </div>`
        : `<div class="card"><h3>Zonas de ciclismo</h3><div class="empty-state">Registra salidas con FC o potencia para calcular tus zonas.</div></div>`
    }

    <div class="card">
      <h3>Predicción de tiempos de carrera</h3>
      ${
        predictions.length
          ? predictions.map((p) => `<div class="row"><div>${p.label}</div><div class="num">${fmtHMS(p.seconds)} (${fmtPace(p.paceMinKm)} min/km)</div></div>`).join("")
          : `<div class="empty-state">Necesito al menos una carrera reciente de 5km+ para predecir.</div>`
      }
    </div>

    <div class="card">
      <h3>Récords personales recientes</h3>
      ${
        recentPRs.length
          ? recentPRs.map((p) => `<div class="row"><div>${p.bucketLabel} — ${new Date(p.date).toLocaleDateString("es-CO")}</div><div class="num">${fmtHMS(p.durationSec)}</div></div>`).join("")
          : `<div class="empty-state">Aún no se detectan PRs — sigue registrando carreras.</div>`
      }
    </div>`;
}

function fisicoHTML(metrics) {
  return `
    <div class="card">
      <h3>Registrar métrica física</h3>
      <form id="metricForm" class="form-grid">
        <div class="field"><label>Fecha</label><input type="date" name="date" required value="${new Date().toISOString().slice(0,10)}"></div>
        <div class="field"><label>Peso (kg)</label><input type="number" step="0.1" name="weightKg"></div>
        <div class="field"><label>% Grasa (opcional)</label><input type="number" step="0.1" name="bodyFat"></div>
        <div class="field"><label>Foto</label><input type="file" name="photo" accept="image/*"></div>
        <div class="field" style="align-self:end"><button class="primary" type="submit">Guardar</button></div>
      </form>
    </div>
    <div class="card">
      <h3>Progreso de peso</h3>
      <canvas id="weightChart" height="90"></canvas>
    </div>
    <div class="card">
      <h3>Fotos de progreso</h3>
      <div class="metric-grid">
        ${metrics.filter((m) => m.photoBase64).map((m) => `<img class="metric-photo" src="${m.photoBase64}" title="${new Date(m.date).toLocaleDateString("es-CO")}">`).join("") || `<div class="empty-state">Sin fotos aún.</div>`}
      </div>
    </div>`;
}

function comunidadHTML() {
  return `<div class="card"><h3>Feed de la comunidad</h3><div id="feedList" class="empty-state">Cargando...</div></div>`;
}

// ---------- handlers de formularios ----------

function attachTabHandlers() {
  const runForm = document.getElementById("runForm");
  if (runForm) {
    runForm.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(runForm);
      const distanceKm = parseFloat(fd.get("distanceKm"));
      const durationMin = parseFloat(fd.get("durationMin"));
      await addWorkout(currentUser.uid, {
        type: "run",
        source: "manual",
        name: fd.get("name") || "Carrera manual",
        date: new Date(fd.get("date")).toISOString(),
        distanceKm,
        durationSec: Math.round(durationMin * 60),
        avgPaceMinKm: +(durationMin / distanceKm).toFixed(2),
      });
      toast("Carrera guardada");
      runForm.reset();
    };
  }

  const rideForm = document.getElementById("rideForm");
  if (rideForm) {
    rideForm.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(rideForm);
      const distanceKm = parseFloat(fd.get("distanceKm"));
      const durationMin = parseFloat(fd.get("durationMin"));
      await addWorkout(currentUser.uid, {
        type: "ride",
        source: "manual",
        name: fd.get("name") || "Salida en bici",
        date: new Date(fd.get("date")).toISOString(),
        distanceKm,
        durationSec: Math.round(durationMin * 60),
        avgSpeedKmh: +(distanceKm / (durationMin / 60)).toFixed(1),
      });
      toast("Salida guardada");
      rideForm.reset();
    };
  }

  const gymForm = document.getElementById("gymForm");
  if (gymForm) {
    gymForm.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(gymForm);
      await addWorkout(currentUser.uid, {
        type: "gym",
        source: "manual",
        name: fd.get("name"),
        notes: fd.get("notes") || "",
        date: new Date(fd.get("date")).toISOString(),
        durationSec: Math.round(parseFloat(fd.get("durationMin")) * 60),
      });
      toast("Sesión de gym guardada");
      gymForm.reset();
    };
  }

  const metricForm = document.getElementById("metricForm");
  if (metricForm) {
    metricForm.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(metricForm);
      const photo = fd.get("photo");
      await addMetric(
        currentUser.uid,
        {
          date: new Date(fd.get("date")).toISOString(),
          weightKg: fd.get("weightKg") ? parseFloat(fd.get("weightKg")) : null,
          bodyFat: fd.get("bodyFat") ? parseFloat(fd.get("bodyFat")) : null,
        },
        photo && photo.size ? photo : null
      );
      toast("Métrica guardada");
      metricForm.reset();
    };
  }

  const btnConnectStrava = document.getElementById("btnConnectStrava");
  if (btnConnectStrava) btnConnectStrava.onclick = () => startStravaConnect();

  const btnSyncNow = document.getElementById("btnSyncNow");
  if (btnSyncNow) {
    btnSyncNow.onclick = async () => {
      btnSyncNow.textContent = "Sincronizando...";
      try {
        const result = await syncStravaNow(currentUser.uid);
        toast(`${result.synced} actividades sincronizadas`);
      } catch (err) {
        toast("Error al sincronizar: " + err.message);
      }
      btnSyncNow.textContent = "Sincronizar ahora";
    };
  }

  const feedList = document.getElementById("feedList");
  if (feedList) {
    watchFeed((posts) => {
      feedList.className = "";
      feedList.innerHTML = posts.length
        ? posts.map(
            (p) => `
        <div class="feed-item">
          <div class="avatar">${(p.displayName || "?")[0]}</div>
          <div>
            <div class="meta">${p.displayName}</div>
            <div style="font-size:13px;color:var(--moss-500)">${p.summary}</div>
          </div>
        </div>`
          ).join("")
        : `<div class="empty-state">Nadie ha compartido nada todavía.</div>`;
    });
  }
}

// ---------- arranque ----------

watchAuth(async (user) => {
  currentUser = user;
  if (unsubWorkouts) unsubWorkouts();
  if (unsubMetrics) unsubMetrics();

  if (user) {
    stravaConnected = await isStravaConnected(user.uid);
    unsubWorkouts = watchWorkouts(user.uid, (w) => {
      workoutsCache = w;
      render();
    });
    unsubMetrics = watchMetrics(user.uid, (m) => {
      metricsCache = m;
      render();
    });

    // si volvemos de Strava con ?code=..., procesarlo
    const stravaResult = await handleStravaCallback(user.uid).catch((e) => {
      toast("Error conectando Strava: " + e.message);
      return null;
    });
    if (stravaResult) {
      stravaConnected = true;
      toast(`Strava conectado — ${stravaResult.synced} actividades importadas`);
    }
  }
  render();
});
