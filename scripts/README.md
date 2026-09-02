# Sync de Garmin → Cota

Script local (corre en tu compu, no en la nube) que trae tus actividades de Garmin Connect
y las guarda en Firestore, junto a las de Strava.

⚠️ Tu contraseña de Garmin **nunca** se guarda ni se le pasa a nadie — el script te la
pide directo en la Terminal (oculta, con `getpass`) y solo la usa para iniciar sesión.
Después de la primera vez, la sesión queda guardada localmente (carpeta `.garth/`, que
**no se sube a git** — ya está en `.gitignore`).

---

## 1. Instala las dependencias

```bash
cd scripts
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## 2. Consigue tu `serviceAccountKey.json`

Este es un archivo de Firebase que le da al script permiso de administrador para escribir
en tu Firestore (por eso corre en tu compu y no en el navegador — nunca debe llegar a un
sitio público).

1. Ve a https://console.firebase.google.com/project/cota-98162/settings/serviceaccounts/adminsdk
2. Click **"Generate new private key"** → confirma → se descarga un `.json`
3. Muévelo a esta carpeta (`scripts/`) — **ya está en `.gitignore`, nunca se va a subir a GitHub**

## 3. Corre el script

```bash
python garmin_sync.py
```

La primera vez te va a pedir, en este orden:
1. Ruta al `serviceAccountKey.json` (si lo pusiste en `scripts/`, solo escribe `serviceAccountKey.json`)
2. Tu correo de Google (el mismo con el que entras a Cota) — para encontrar tu usuario
3. Tu correo y contraseña de **Garmin Connect**

De ahí en adelante, cada vez que quieras sincronizar, solo corres:
```bash
source venv/bin/activate
python garmin_sync.py
```
y no te va a volver a pedir contraseña (a menos que la sesión de Garmin expire, ahí te la
vuelve a pedir).

## Qué trae

- Running, ciclismo y fuerza/gym de los últimos 30 días (ajustable en `config.json`,
  campo `days_back`, que se crea solo después de la primera corrida)
- Convive sin problema con tus datos de Strava — cada actividad se guarda con un ID único
  (`garmin_...` vs `strava_...`) así que no se duplican ni se pisan entre sí

## Nunca subas a git

Ya están en `.gitignore`, pero por si acaso, **nunca compartas ni subas**:
- `serviceAccountKey.json` (acceso total de administrador a tu Firestore)
- la carpeta `.garth/` (tu sesión activa de Garmin)
- `config.json` (tiene tu UID de Firebase — no es gravísimo si se filtra, pero mejor no)
