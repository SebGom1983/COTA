"""
Cota — Sync de Garmin Connect

Corre este script en tu Terminal cuando quieras traer tus actividades de Garmin a Cota.
NO le des tu contraseña a nadie más que a este script (te la pide con getpass, oculta).

La primera vez te va a pedir:
  1) El correo y contraseña de tu cuenta de GARMIN CONNECT (no la de Cota/Google)
  2) El correo de tu cuenta de Google con la que entras a Cota (para ubicar tu UID de Firebase)
  3) La ruta a tu archivo serviceAccountKey.json (ver README.md en esta carpeta)

Las siguientes veces, la sesión de Garmin queda guardada localmente (carpeta .garth/)
así que no te va a pedir la contraseña de Garmin cada vez — solo cuando expire el token.
"""

import getpass
import json
import os
import sys
from datetime import datetime, timedelta

try:
    import garminconnect
    import firebase_admin
    from firebase_admin import credentials, auth, firestore
except ImportError:
    print("Faltan librerías. Corre primero: pip install -r requirements.txt")
    sys.exit(1)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
TOKEN_STORE = os.path.join(SCRIPT_DIR, ".garth")
CONFIG_PATH = os.path.join(SCRIPT_DIR, "config.json")

RUN_TYPES = {"running", "trail_running", "track_running", "treadmill_running"}
RIDE_TYPES = {"cycling", "road_biking", "mountain_biking", "gravel_cycling", "virtual_ride", "indoor_cycling"}
GYM_TYPES = {"strength_training", "fitness_equipment", "indoor_cardio"}


def discipline_of(type_key):
    if type_key in RUN_TYPES:
        return "run"
    if type_key in RIDE_TYPES:
        return "ride"
    if type_key in GYM_TYPES:
        return "gym"
    return None


def load_config():
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH) as f:
            return json.load(f)
    return {}


def save_config(cfg):
    with open(CONFIG_PATH, "w") as f:
        json.dump(cfg, f, indent=2)


def connect_garmin():
    os.makedirs(TOKEN_STORE, exist_ok=True)
    try:
        # Intenta reusar la sesión guardada de una corrida anterior
        client = garminconnect.Garmin()
        client.login(TOKEN_STORE)
        print("✓ Sesión de Garmin reutilizada (no hizo falta contraseña).")
        return client
    except Exception:
        pass

    print("\n--- Inicia sesión en Garmin Connect ---")
    email = input("Correo de Garmin Connect: ").strip()
    password = getpass.getpass("Contraseña de Garmin Connect (no se muestra en pantalla): ")

    client = garminconnect.Garmin(email, password)
    client.login()
    client.garth.dump(TOKEN_STORE)  # guarda el token para no pedir password la próxima vez
    print("✓ Login exitoso — sesión guardada para próximas veces.")
    return client


def get_firebase_uid(cfg):
    if cfg.get("firebase_uid"):
        return cfg["firebase_uid"]

    email = input("\nCorreo de Google con el que entras a Cota: ").strip()
    user = auth.get_user_by_email(email)
    cfg["firebase_uid"] = user.uid
    save_config(cfg)
    print(f"✓ UID encontrado y guardado para próximas veces: {user.uid}")
    return user.uid


def map_activity(a):
    type_key = (a.get("activityType") or {}).get("typeKey")
    discipline = discipline_of(type_key)
    if not discipline:
        return None

    distance_m = a.get("distance") or 0
    duration_s = a.get("duration") or 0
    distance_km = round(distance_m / 1000, 2) if distance_m else None

    doc = {
        "source": "garmin",
        "garminId": a.get("activityId"),
        "type": discipline,
        "name": a.get("activityName") or "Actividad Garmin",
        "date": a.get("startTimeLocal", "").replace(" ", "T") + "Z" if a.get("startTimeLocal") else None,
        "distanceKm": distance_km,
        "durationSec": int(duration_s) if duration_s else None,
        "elevationGainM": a.get("elevationGain") or 0,
        "avgHeartRate": a.get("averageHR"),
    }

    if discipline == "run" and distance_km and duration_s:
        doc["avgPaceMinKm"] = round((duration_s / 60) / distance_km, 2)
    if discipline == "ride" and a.get("averageSpeed"):
        doc["avgSpeedKmh"] = round(a["averageSpeed"] * 3.6, 1)

    return doc


def safe_call(fn, *args, default=None):
    """Llama a un método del cliente de Garmin sin tumbar todo el script si ese
    dato no está disponible para tu reloj/cuenta (no todos los modelos reportan lo mismo)."""
    try:
        return fn(*args)
    except Exception:
        return default


def pull_wellness_day(garmin, date_str):
    """Trae sueño, HRV, FC en reposo, training readiness, body battery y estrés de un día."""
    doc = {"date": date_str}

    sleep = safe_call(garmin.get_sleep_data, date_str)
    if sleep:
        dto = sleep.get("dailySleepDTO", {})
        doc["sleepScore"] = (dto.get("sleepScores") or {}).get("overall", {}).get("value")
        doc["sleepDurationMin"] = round((dto.get("sleepTimeSeconds") or 0) / 60)
        doc["deepSleepMin"] = round((dto.get("deepSleepSeconds") or 0) / 60)
        doc["remSleepMin"] = round((dto.get("remSleepSeconds") or 0) / 60)
        doc["lightSleepMin"] = round((dto.get("lightSleepSeconds") or 0) / 60)

    hrv = safe_call(garmin.get_hrv_data, date_str)
    if hrv:
        summary = hrv.get("hrvSummary", {})
        doc["hrvValueMs"] = summary.get("lastNightAvg")
        doc["hrvStatus"] = summary.get("status")

    stats = safe_call(garmin.get_stats, date_str)
    if stats:
        doc["restingHR"] = stats.get("restingHeartRate")
        doc["steps"] = stats.get("totalSteps")
        doc["intensityMinutes"] = stats.get("moderateIntensityMinutes", 0) + stats.get(
            "vigorousIntensityMinutes", 0
        ) * 2

    readiness = safe_call(garmin.get_training_readiness, date_str)
    if readiness and isinstance(readiness, list) and readiness:
        doc["trainingReadinessScore"] = readiness[0].get("score")

    battery = safe_call(garmin.get_body_battery, date_str, date_str)
    if battery and isinstance(battery, list) and battery:
        doc["bodyBatteryHigh"] = battery[0].get("charged")
        doc["bodyBatteryLow"] = battery[0].get("drained")

    stress = safe_call(garmin.get_stress_data, date_str)
    if stress:
        doc["avgStressLevel"] = stress.get("avgStressLevel")

    # Si no conseguimos NADA de este día (reloj apagado, sin datos), no guardamos doc vacío
    if len(doc) <= 1:
        return None
    return doc


def sync_wellness(db, uid, garmin, days_back):
    print(f"\nBuscando datos de recuperación (sueño/HRV/FC/readiness) de los últimos {days_back} días...")
    batch = db.batch()
    count = 0
    for i in range(days_back):
        date_str = (datetime.now() - timedelta(days=i)).strftime("%Y-%m-%d")
        doc = pull_wellness_day(garmin, date_str)
        if not doc:
            continue
        ref = db.collection(f"users/{uid}/wellness").document(date_str)
        batch.set(ref, doc, merge=True)
        count += 1
    if count:
        batch.commit()
    print(f"✓ {count} días de datos de recuperación sincronizados.")


def main():
    cfg = load_config()

    sa_path = cfg.get("service_account_path")
    if not sa_path or not os.path.exists(sa_path):
        sa_path = input(
            "\nRuta a tu serviceAccountKey.json (ver README.md si no lo tienes): "
        ).strip()
        cfg["service_account_path"] = sa_path
        save_config(cfg)

    cred = credentials.Certificate(sa_path)
    firebase_admin.initialize_app(cred)
    db = firestore.client()

    uid = get_firebase_uid(cfg)
    garmin = connect_garmin()

    days_back = cfg.get("days_back", 30)
    print(f"\nBuscando actividades de los últimos {days_back} días...")
    start_date = (datetime.now() - timedelta(days=days_back)).strftime("%Y-%m-%d")
    end_date = datetime.now().strftime("%Y-%m-%d")

    activities = garmin.get_activities_by_date(start_date, end_date)
    print(f"Encontradas {len(activities)} actividades en total en Garmin.")

    batch = db.batch()
    count = 0
    for a in activities:
        doc = map_activity(a)
        if not doc or not doc["date"]:
            continue
        ref = db.collection(f"users/{uid}/workouts").document(f"garmin_{doc['garminId']}")
        batch.set(ref, doc, merge=True)
        count += 1

    if count:
        batch.commit()
    print(f"\n✓ Listo — {count} actividades (running/ciclismo/gym) sincronizadas a Cota.")

    sync_wellness(db, uid, garmin, days_back=cfg.get("wellness_days_back", 30))


if __name__ == "__main__":
    main()
