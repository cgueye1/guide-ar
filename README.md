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

**2. Variables d'environnement**

| Variable | Valeur | Rôle |
|---|---|---|
| `BACKEND_URL` | `http://joj-backend:8089` | adresse interne du Spring Boot |
| `API_BASE` | `/api` | chemin appelé par le navigateur |

`BACKEND_URL` doit pointer vers le **nom du service** de votre backend
dans le réseau Docker de Dokploy, pas vers `localhost`.

**3. Port exposé** : `80`

**4. Domaine** : activez le HTTPS (Let's Encrypt).
Sans HTTPS, la caméra ne démarrera pas.

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
│   ├── nginx.conf.template
│   └── entrypoint.sh
├── Dockerfile
└── docker-compose.yml      test local
```

---

## Ajouter une langue

1. Ajoutez un bloc dans `js/i18n.js` (`I18N` et `CATEGORY`)
2. Ajoutez un bouton `.flag` dans `index.html`
3. Ajoutez les champs correspondants côté API (`nameEs`, `descriptionEs`…)
# guide-ar
