import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, setDoc, getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { app } from "./store.js";

export const auth = getAuth(app);
const provider = new GoogleAuthProvider();

export function login() {
  return signInWithPopup(auth, provider).then(async (result) => {
    const u = result.user;
    const db = getFirestore(app);
    await setDoc(
      doc(db, "profiles", u.uid),
      {
        displayName: u.displayName,
        email: u.email || null,
        photoURL: u.photoURL,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
    return u;
  });
}

export function logout() {
  return signOut(auth);
}

export function watchAuth(callback) {
  return onAuthStateChanged(auth, callback);
}
