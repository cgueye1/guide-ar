# JOJ Dakar 2026 — Guide AR

Application web mobile qui reconnaît les monuments de Dakar via la caméra
et affiche leur fiche en français ou en anglais.

JavaScript natif, aucune dépendance, aucun build.

---

## Écrans

| Écran | Rôle |
|---|---|
| Langue | Choix FR / EN au premier lancement, mémorisé ensuite |
| Caméra | Vue plein écran, bascule de langue, bouton **GUIDE** |
| Résultat | Fiche holographique : nom, description, vidéo YouTube, GPS |

---

## Lancer en local

Un serveur HTTPS est **obligatoire** pour accéder à la caméra
(sauf sur `localhost`).

```bash
# option 1 — python
python3 -m http.server 3000

# option 2 — docker
docker compose up --build
# → http://localhost:8080
```

Sur téléphone, utilisez un tunnel HTTPS :

```bash
npx localtunnel --port 3000
```

---

## Déployer sur Dokploy

**1. Créer une application** de type `Dockerfile`
(chemin du Dockerfile : `./Dockerfile`, contexte : `.`)

**2. Variables d'environnement**

| Variable | Valeur | Rôle |
|---|---|---|
| `BACKEND_URL` | `http://joj-backend:8089` | adresse du Spring Boot, **sans slash final** |
| `API_BASE` | `/api` | chemin appelé par le navigateur |

`BACKEND_URL` doit pointer vers le **nom du service** de votre backend
dans le réseau Docker de Dokploy, pas vers `localhost`. Un backend public
en HTTPS fonctionne aussi (`https://api.exemple.com`) : le SNI est envoyé.

Le nom est ré-résolu toutes les 10 s via le DNS Docker : redéployer le
backend ne casse pas le proxy.

**3. Port exposé** : `80`

**4. Domaine** : activez le HTTPS (Let's Encrypt).
Sans HTTPS, la caméra ne démarrera pas.

**5. Health check** (facultatif) : chemin `/healthz`, réponse `200 ok`.

### Vérifier après déploiement

```bash
curl -i https://votre-domaine/healthz          # → 200 ok
curl -s https://votre-domaine/config.js        # → API_BASE attendu
curl -i https://votre-domaine/api/joj-places   # → réponse du backend, pas 502
```

Les logs de démarrage du conteneur affichent la configuration retenue :

```
[joj] BACKEND_URL      = http://joj-backend:8089
[joj] JOJ_BACKEND_HOST = joj-backend:8089
[joj] JOJ_RESOLVERS    = 127.0.0.11
```

---

## Architecture

```
Navigateur mobile
   │  photo JPEG ≤ 1024px
   ▼
nginx  (ce conteneur)
   │  proxy /api/ → BACKEND_URL
   ▼
Spring Boot  /api/joj-places/recognize
   │
   ▼
Vertex AI  →  PostgreSQL
```

Le proxy nginx évite toute configuration CORS : le navigateur ne parle
qu'à une seule origine.

---

## Contraintes respectées

- **Format** : capture forcée en JPEG (Vertex AI refuse le WEBP)
- **Taille** : redimensionnement à 1024px max, ~200-400 Ko par photo
  (la limite Vertex AI en prédiction est de 1,5 Mo)
- **Timeout** : 20 s côté client, 60 s côté nginx

---

## Structure

```
.
├── index.html              trois écrans dans une seule page
├── config.js               API_BASE, réécrit au démarrage du conteneur
├── css/styles.css
├── js/
│   ├── i18n.js             libellés FR / EN
│   └── app.js              caméra, capture, appel API, rendu
├── docker/
│   ├── nginx.conf.template  vhost nginx (source unique)
│   ├── headers.conf         en-têtes communs, inclus par chaque location
│   ├── 05-joj-env.envsh     normalise BACKEND_URL avant envsubst
│   └── entrypoint.sh        → 40-joj-config.sh, réécrit config.js
├── Dockerfile
└── docker-compose.yml      test local
```

---

## Son de la scène en réalité augmentée

`audioFileUrl` est joué **au moment où le modèle est posé** dans le monde
réel. Le mécanisme diffère selon la plateforme, parce que les deux moteurs
AR n'offrent pas les mêmes prises :

| Plateforme | Moteur | Qui joue le son |
|---|---|---|
| Android | WebXR | la page, sur l'événement `object-placed` |
| Android | Scene Viewer | Scene Viewer, via le paramètre `sound` de l'intent |
| iOS | AR Quick Look | le `.usdz` lui-même |

Sur iOS, la page ne peut rien faire : Quick Look est une app native qui ne
publie aucun événement de pose, et sa session audio ARKit interrompt celle
du navigateur. Le son doit donc être **embarqué dans le `.usdz`** :

```bash
python3 -m pip install usd-core
./tools/usdz-add-audio.py porte.usdz ambiance.mp3 porte-sonore.usdz
```

Le script ajoute un prim `SpatialAudio` sous le prim par défaut, réempaquette
modèle + textures + audio, puis relit le résultat pour vérifier que rien
n'a été cassé. À exécuter sur chaque modèle, avant publication.

Formats acceptés dans un USDZ : **M4A, MP3, WAV** — M4A de préférence, le
poids s'ajoute à celui du modèle.

---

## Ajouter une langue

1. Ajoutez un bloc dans `js/i18n.js` (`I18N` et `CATEGORY`)
2. Ajoutez un bouton `.flag` dans `index.html`
3. Ajoutez les champs correspondants côté API (`nameEs`, `descriptionEs`…)
# guide-ar
