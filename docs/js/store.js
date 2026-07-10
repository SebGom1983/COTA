import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  setDoc,
  deleteDoc,
  query,
  orderBy,
  limit,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// Comprime y redimensiona una imagen en el navegador antes de guardarla como base64 en Firestore.
// Así evitamos necesitar Firebase Storage (que exige plan Blaze) — un documento de Firestore
// aguanta hasta 1MB, y con esta compresión una foto de progreso pesa unos 60-120KB.
function compressImageToBase64(file, maxDim = 500, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => (img.src = e.target.result);
    reader.onerror = reject;
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ---------- Entrenos (running manual + gym) ----------

export function addWorkout(uid, workout) {
  return addDoc(collection(db, `users/${uid}/workouts`), {
    ...workout,
    createdAt: new Date().toISOString(),
  });
}

export function deleteWorkout(uid, id) {
  return deleteDoc(doc(db, `users/${uid}/workouts/${id}`));
}

export function watchWorkouts(uid, callback, max = 100) {
  const q = query(collection(db, `users/${uid}/workouts`), orderBy("date", "desc"), limit(max));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

// ---------- Métricas físicas (peso, medidas, fotos) ----------

export async function addMetric(uid, metric, photoFile) {
  let photoBase64 = null;
  if (photoFile) {
    photoBase64 = await compressImageToBase64(photoFile);
  }
  return addDoc(collection(db, `users/${uid}/metrics`), {
    ...metric,
    photoBase64,
    createdAt: new Date().toISOString(),
  });
}

export function watchMetrics(uid, callback, max = 60) {
  const q = query(collection(db, `users/${uid}/metrics`), orderBy("date", "desc"), limit(max));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

// ---------- Feed comunidad (opcional, público) ----------

export function shareToFeed(uid, displayName, workout) {
  return addDoc(collection(db, "feed"), {
    uid,
    displayName,
    summary: workout,
    createdAt: new Date().toISOString(),
  });
}

export function watchFeed(callback, max = 30) {
  const q = query(collection(db, "feed"), orderBy("createdAt", "desc"), limit(max));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}
