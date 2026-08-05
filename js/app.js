/* ═══════════════════════════════════════════════════════════
   JOJ DAKAR 2026 — logique applicative
   ═══════════════════════════════════════════════════════════ */

const API   = (window.__CONFIG__ && window.__CONFIG__.API_BASE) || '/api';
const STORE = 'joj.lang';
const GEOK  = 'joj.geo';          // 'granted' | 'skipped'

/* Vertex AI n'accepte que du JPEG/PNG sous 1,5 Mo :
   on redimensionne côté client avant l'envoi. */
const MAX_EDGE = 1024;
const QUALITY  = 0.86;

/* Position : on la rafraîchit si elle date de plus de 30 s */
const GEO_OPTS = { enableHighAccuracy:true, timeout:9000, maximumAge:30000 };

const $ = (s) => document.querySelector(s);

const el = {
  screens : { lang:$('#screen-lang'), cam:$('#screen-cam'), res:$('#screen-res') },
  video   : $('#video'),
  canvas  : $('#canvas'),
  freeze  : $('#freeze'),
  reticle : $('#reticle'),
  sweep   : $('#sweep'),
  trigger : $('#trigger'),
  hint    : $('#hint'),
  scan    : $('#scan'),
  scanTxt : $('.scan__txt'),
  sheet   : $('#sheet'),
  camfail : $('#camfail'),
  geoask  : $('#geoask'),
  geoDot  : $('#geoDot'),
  found   : $('#res-found'),
  far     : $('#res-far'),
  none    : $('#res-none'),
};

let lang   = null;
let stream = null;
let busy   = false;
let coords = null;               // { lat, lon } ou null


/* ─────────────────────────────────────────────
   Langue
   ───────────────────────────────────────────── */

function readStore(k){ try { return localStorage.getItem(k); } catch { return null; } }
function saveStore(k,v){ try { localStorage.setItem(k,v); } catch { /* mode privé */ } }

function setLang(v){
  lang = (v === 'en') ? 'en' : 'fr';
  saveStore(STORE, lang);
  document.documentElement.lang = lang;

  const t = I18N[lang];
  document.querySelectorAll('[data-i18n]').forEach(node => {
    const key = node.dataset.i18n;
    if (t[key]) node.textContent = t[key];
  });

  document.querySelectorAll('.sw').forEach(b => {
    b.classList.toggle('is-on', b.dataset.lang === lang);
  });

  // retraduit le résultat déjà affiché
  if (lastState === 'found' && lastPlace)  paintPlace(lastPlace, lastConfidence);
  if (steps.length && !$('#stepModal').hidden) paintStep();
  if (lastState === 'far')                 paintFar(lastDistance);
}


/* ─────────────────────────────────────────────
   Écrans
   ───────────────────────────────────────────── */

function show(name){
  Object.entries(el.screens).forEach(([k, node]) => {
    node.classList.toggle('is-active', k === name);
  });
}


/* ─────────────────────────────────────────────
   Position
   ───────────────────────────────────────────── */

function setGeoState(s){ el.geoDot.dataset.state = s; }

function locate(){
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null);

    setGeoState('pending');
    navigator.geolocation.getCurrentPosition(
      pos => {
        coords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        setGeoState('on');
        saveStore(GEOK, 'granted');
        resolve(coords);
      },
      err => {
        console.warn('geo:', err.message);
        coords = null;
        setGeoState('off');
        resolve(null);
      },
      GEO_OPTS
    );
  });
}

/* Demande l'autorisation au bon moment : juste après le choix de la langue. */
function askGeo(){
  return new Promise(resolve => {
    const seen = readStore(GEOK);

    // déjà accordée ou volontairement ignorée : on ne redemande pas
    if (seen === 'granted'){ locate().then(() => resolve()); return; }
    if (seen === 'skipped'){ resolve(); return; }

    el.geoask.hidden = false;

    $('#geoAllow').onclick = async () => {
      el.geoask.hidden = true;
      await locate();
      resolve();
    };
    $('#geoSkip').onclick = () => {
      el.geoask.hidden = true;
      saveStore(GEOK, 'skipped');
      setGeoState('off');
      resolve();
    };
  });
}


/* ─────────────────────────────────────────────
   Caméra
   ───────────────────────────────────────────── */

let camStarting = false;

async function startCamera(){
  if (camStarting) return;        // deux getUserMedia simultanés = image noire
  camStarting = true;
  el.camfail.hidden = true;

  // Toujours libérer le capteur avant de le redemander : sur iOS, un flux
  // précédent encore ouvert fait renvoyer une piste qui ne délivre aucune
  // image. #camretry et les reprises de page appellent cette fonction
  // plusieurs fois, elle doit rester idempotente.
  stopCamera();

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode : { ideal: 'environment' },
        width      : { ideal: 1920 },
        height     : { ideal: 1080 }
      },
      audio: false
    });
    el.video.srcObject = stream;
    await el.video.play();
    el.trigger.disabled = false;
  } catch (err) {
    console.error('camera:', err);
    el.camfail.hidden = false;
    el.trigger.disabled = true;
  } finally {
    camStarting = false;
  }
}

function stopCamera(){
  if (stream){ stream.getTracks().forEach(t => t.stop()); stream = null; }
  // sans cela le <video> conserve sa dernière image — noire — au retour
  if (el.video.srcObject) el.video.srcObject = null;
}


/* ─────────────────────────────────────────────
   Capture
   ───────────────────────────────────────────── */

function capture(){
  const v = el.video, vw = v.videoWidth, vh = v.videoHeight;
  if (!vw || !vh) return Promise.resolve(null);

  const scale = Math.min(1, MAX_EDGE / Math.max(vw, vh));
  const w = Math.round(vw * scale), h = Math.round(vh * scale);

  const c = el.canvas;
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(v, 0, 0, w, h);

  return new Promise(resolve => {
    c.toBlob(blob => resolve({ blob, url: c.toDataURL('image/jpeg', 0.7) }),
             'image/jpeg', QUALITY);
  });
}


/* ─────────────────────────────────────────────
   Séquence de scan  ── l'élément signature
   ───────────────────────────────────────────── */

async function runScan(){
  if (busy) return;
  busy = true;

  el.trigger.disabled = true;
  el.hint.textContent = I18N[lang].holdStill;
  el.hint.classList.add('is-alert');

  const shot = await capture();
  if (!shot){ reset(); return; }

  // 1 — on fige l'image
  el.freeze.src = shot.url;
  el.freeze.hidden = false;

  // 2 — balayage + verrouillage du réticule
  el.sweep.classList.remove('is-on');
  void el.sweep.offsetWidth;
  el.sweep.classList.add('is-on');
  el.reticle.classList.add('is-locked');
  if (navigator.vibrate) navigator.vibrate(18);

  await wait(620);

  // 3 — position (rafraîchie en parallèle si déjà autorisée)
  el.scanTxt.textContent = coords ? I18N[lang].scanning : I18N[lang].locating;
  el.scan.hidden = false;

  if (readStore(GEOK) === 'granted') await locate();
  el.scanTxt.textContent = I18N[lang].scanning;

  // 4 — appel API
  try {
    const result = await recognise(shot.blob, coords);
    await wait(300);
    render(result);
  } catch (err) {
    console.error('api:', err);
    render({ found:false, message: I18N[lang].netBody });
  } finally {
    el.scan.hidden = true;
    show('res');
    if (navigator.vibrate) navigator.vibrate([12, 40, 12]);
  }
}

function wait(ms){ return new Promise(r => setTimeout(r, ms)); }

function reset(){
  busy = false;
  el.trigger.disabled = false;
  el.freeze.hidden = true;
  el.freeze.src = '';
  el.sweep.classList.remove('is-on');
  el.reticle.classList.remove('is-locked');
  el.hint.textContent = I18N[lang].aim;
  el.hint.classList.remove('is-alert');
}


/* ─────────────────────────────────────────────
   Appel API
   ───────────────────────────────────────────── */

async function recognise(blob, pos){
  const form = new FormData();
  form.append('picture', blob, 'capture.jpg');

  // la position part en paramètres d'URL, comme attendu par l'API
  let url = `${API}/joj-places/recognize`;
  if (pos){
    const q = new URLSearchParams({
      latitude : pos.lat.toFixed(6),
      longitude: pos.lon.toFixed(6)
    });
    url += `?${q}`;
  }

  const ctl = new AbortController();
  const to  = setTimeout(() => ctl.abort(), 25000);

  try {
    const res = await fetch(url, { method:'POST', body:form, signal:ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(to);
  }
}


/* ─────────────────────────────────────────────
   Rendu du résultat
   ───────────────────────────────────────────── */

let lastState      = null;    // 'found' | 'far' | 'none'
let lastPlace      = null;
let lastConfidence = 0;
let lastDistance   = 0;

function render(data){
  const d = data || {};

  // ── trouvé ──
  if (d.found && d.place){
    lastState = 'found';
    lastPlace = d.place;
    lastConfidence = d.confidence || 0;
    paintPlace(d.place, d.confidence);
    el.found.hidden = false; el.far.hidden = true; el.none.hidden = true;

  // ── reconnu mais trop loin ──
  } else if (!d.found && typeof d.distanceKm === 'number' && d.distanceKm > 0){
    lastState = 'far';
    lastDistance = d.distanceKm;
    lastPlace = null;
    paintFar(d.distanceKm);
    el.found.hidden = true; el.far.hidden = false; el.none.hidden = true;

  // ── non reconnu ──
  } else {
    lastState = 'none';
    lastPlace = null;
    $('#noneMsg').textContent = d.message && d.message !== 'null'
      ? I18N[lang].noneBody
      : I18N[lang].noneBody;
    el.found.hidden = true; el.far.hidden = true; el.none.hidden = false;
  }

  el.sheet.scrollTop = 0;
}

/* ── fiche du lieu ── */
function paintPlace(p, confidence){
  const fr = (lang === 'fr');

  const pct = Math.round((confidence ?? lastConfidence ?? 0) * 100);
  $('#meterVal').textContent = pct + '%';
  $('#meterFill').style.width = '0%';
  requestAnimationFrame(() => { $('#meterFill').style.width = pct + '%'; });

  const cats = CATEGORY[lang] || CATEGORY.fr;
  $('#resCat').textContent = cats[p.category] || cats.OTHER;

  const name = $('#resName');
  name.textContent = fr ? (p.nameFr || p.nameEn) : (p.nameEn || p.nameFr);
  name.classList.remove('is-in');
  void name.offsetWidth;
  name.classList.add('is-in');

  $('#resAddr').textContent = p.address || '—';
  $('#resDesc').textContent = fr
    ? (p.descriptionFr || p.descriptionEn || '')
    : (p.descriptionEn || p.descriptionFr || '');

  $('#resLat').textContent = fmtCoord(p.latitude,  'N', 'S');
  $('#resLon').textContent = fmtCoord(p.longitude, 'E', fr ? 'O' : 'W');

  const raw  = fr ? (p.videoUrlFr || p.videoUrlEn) : (p.videoUrlEn || p.videoUrlFr);
  const id   = youtubeId(raw);
  const wrap = $('#tubeWrap');

  if (id){
    $('#tube').src = `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1&playsinline=1`;
    wrap.hidden = false;
  } else {
    $('#tube').src = '';
    wrap.hidden = true;
  }

  loadSteps(p.id);
}


/* ═════════════════════════════════════════════════════════════
   PARCOURS DE VISITE
   Un lieu peut avoir 0, 1 ou plusieurs étapes.
   ═════════════════════════════════════════════════════════════ */

let steps        = [];
let stepIdx      = 0;
let stepsPlaceId = null;

async function loadSteps(placeId){
  // même lieu : on garde les étapes en mémoire et on se contente
  // de les redessiner (utile au changement de langue)
  if (placeId && placeId === stepsPlaceId){
    if (steps.length) paintSteps();
    return;
  }

  steps = [];
  stepsPlaceId = placeId || null;
  $('#stepsWrap').hidden = true;
  $('#tl').innerHTML = '';

  if (!placeId) return;

  try {
    const res = await fetch(`${API}/joj-places/${placeId}/steps`);
    if (!res.ok) return;

    const data = await res.json();
    steps = (Array.isArray(data) ? data : []).filter(s => s && s.active !== false);

    if (steps.length) paintSteps();

  } catch (err) {
    console.warn('steps:', err);   // silencieux : les étapes sont optionnelles
  }
}

function paintSteps(){
  const fr = (lang === 'fr');
  const t  = I18N[lang];

  $('#stepsCount').textContent = steps.length === 1
    ? t.oneStep
    : t.manySteps.replace('{n}', steps.length);

  const list = $('#tl');
  list.innerHTML = '';

  steps.forEach((s, i) => {
    const name = (fr ? s.nameFr : s.nameEn) || s.nameFr || s.nameEn || '';
    const desc = (fr ? s.descriptionFr : s.descriptionEn)
              || s.descriptionFr || s.descriptionEn || '';
    const img  = (s.imageUrl || '').trim();
    const vid  = youtubeId(s.videoLink);

    const li = document.createElement('li');
    li.className = 'tl__i';
    li.style.animationDelay = (0.16 + i * 0.09) + 's';

    li.innerHTML = `
      <span class="tl__dot">${i + 1}</span>
      <button class="tl__card${img ? '' : ' tl__card--noimg'}" type="button" data-step="${i}">
        ${img ? `<span class="tl__bg" style="background-image:url('${esc(img)}')"></span>`
              : `<span class="tl__ghost">${i + 1}</span>`}
        <span class="tl__scrim"></span>
        <span class="tl__in">
          <span class="tl__name">${esc(name)}</span>
          <span class="tl__x">${esc(desc)}</span>
          ${vid ? `<span class="tl__play">
                     <svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8 5v14l11-7z"/></svg>
                     ${t.watch}
                   </span>` : ''}
        </span>
        <svg class="tl__go" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>
      </button>`;

    li.querySelector('.tl__card')
      .addEventListener('click', () => openStep(i));

    list.appendChild(li);
  });

  $('#stepsWrap').hidden = false;
}

/* ── modale ── */

function openStep(i){
  if (!steps[i]) return;
  stepIdx = i;
  paintStep();
  $('#stepModal').hidden = false;
  document.body.style.overflow = 'hidden';
  if (navigator.vibrate) navigator.vibrate(10);
}

function paintStep(){
  const fr = (lang === 'fr');
  const s  = steps[stepIdx];
  if (!s) return;

  $('#stepIdx').textContent   = stepIdx + 1;
  $('#stepTotal').textContent = steps.length;
  $('#stepNum').textContent   = stepIdx + 1;

  $('#stepName').textContent = (fr ? s.nameFr : s.nameEn) || s.nameFr || s.nameEn || '';
  $('#stepDesc').textContent = (fr ? s.descriptionFr : s.descriptionEn)
                             || s.descriptionFr || s.descriptionEn || '';

  const img  = (s.imageUrl || '').trim();
  const el   = $('#stepImg');
  const hero = $('#stepHero');
  if (img){
    el.src = img; el.hidden = false;
    hero.classList.remove('modal__hero--noimg');
  } else {
    el.removeAttribute('src'); el.hidden = true;
    hero.classList.add('modal__hero--noimg');
  }

  const vid  = youtubeId(s.videoLink);
  const wrap = $('#stepTubeWrap');
  if (vid){
    $('#stepTube').src = `https://www.youtube-nocookie.com/embed/${vid}?rel=0&modestbranding=1&playsinline=1`;
    wrap.hidden = false;
  } else {
    $('#stepTube').src = '';
    wrap.hidden = true;
  }

  $('#stepPrev').disabled = (stepIdx === 0);
  $('#stepNext').disabled = (stepIdx === steps.length - 1);

  paintArButton(s);

  const sc = document.querySelector('.modal__scroll');
  if (sc) sc.scrollTop = 0;
}

function closeStep(){
  $('#stepTube').src = '';
  $('#stepModal').hidden = true;
  document.body.style.overflow = '';
}


/* ═════════════════════════════════════════════════════════════
   RÉALITÉ AUGMENTÉE
   model-viewer gère le rendu WebXR (hit-test réel, ancrage sol)
   sur Android et AR Quick Look sur iOS — deux moteurs AR natifs,
   au lieu d'un moteur maison, pour de meilleures performances
   et une meilleure compatibilité.
   ═══════════════════════════════════════════════════════════ */

const arViewer   = $('#arViewer');
let   arModelKey = null;   // évite de recharger le même couple glb/usdz

/* Même détection que model-viewer, pour que notre décision d'afficher le
   bouton corresponde exactement au moteur qui sera réellement utilisé.
   iPadOS 13+ s'annonce comme un Mac : d'où le test sur maxTouchPoints. */
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !self.MSStream
            || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;

function paintArButton(step){
  const btn = $('#stepArBtn');
  const glbUrl  = (step && step.glbFileUrl  || '').trim();
  const usdzUrl = (step && step.usdzFileUrl || '').trim();

  // Chaque moteur AR n'accepte qu'un seul format, on n'affiche donc le
  // bouton que si le format de la plateforme est réellement disponible :
  // - iOS : AR Quick Look exige l'USDZ. Sans lui, model-viewer
  //   convertirait le GLB de son côté (échelle et rendu non maîtrisés).
  // - Android : WebXR et Scene Viewer exigent le GLB, l'USDZ seul est
  //   inutilisable.
  if (IS_IOS ? !usdzUrl : !glbUrl){
    btn.hidden = true;
    btn.onclick = null;
    return;
  }

  btn.hidden = false;
  btn.disabled = false;
  btn.onclick = IS_IOS ? launchArQuickLook : () => launchAr(glbUrl, usdzUrl);

  // précharge le modèle en tâche de fond dès que le bouton apparaît :
  // au moment du tap, le lancement doit s'exécuter en tout premier,
  // de façon parfaitement synchrone avec le geste utilisateur — iOS
  // Safari annule Quick Look si le moindre await le précède.
  preloadArModel(glbUrl, usdzUrl);
}

function showArToast(msg, autoHideMs){
  const t = $('#arToast');
  $('#arToastMsg').textContent = msg;
  t.hidden = false;
  clearTimeout(showArToast._t);
  if (autoHideMs){
    showArToast._t = setTimeout(() => { t.hidden = true; }, autoHideMs);
  }
}
function hideArToast(){ $('#arToast').hidden = true; }

function preloadArModel(glbUrl, usdzUrl){
  const key = glbUrl + '|' + usdzUrl;
  if (arModelKey === key) return;   // déjà (pré)chargé
  arModelKey = key;

  // Sur iOS on ouvre AR Quick Look nous-mêmes (voir launchArQuickLook) :
  // ni model-viewer ni le GLB ne servent, autant ne pas les télécharger.
  if (IS_IOS){
    arUsdzHref = '';           // renseigné par prepareUsdzHref
    prepareUsdzHref(usdzUrl, key);
    return;
  }

  arViewer.setAttribute('reveal', 'manual'); // ne rend rien à l'écran
  arViewer.removeAttribute('ios-src');

  if (glbUrl){
    arViewer.src = glbUrl;
    arViewer.addEventListener('error', () => {
      if (arViewer.src === glbUrl) arModelKey = null;
      console.warn('ar: échec de chargement du modèle glb', glbUrl);
    }, { once:true });
  } else {
    arViewer.removeAttribute('src');
  }
}

/* ── iOS : AR Quick Look ──────────────────────────────────────
   On n'utilise pas activateAR() de model-viewer ici. Quand ios-src est
   fourni, model-viewer ouvre son lien SANS attribut « download » ; une
   URL blob: n'ayant ni nom ni extension, Quick Look ne reconnaît alors
   pas un contenu RA et s'ouvre en mode « Objet ». En construisant le
   lien nous-mêmes on garde la main sur les trois conditions du mode RA
   direct de WebKit : rel="ar", un enfant <img>, et un nom de fichier.

   Le type MIME est déterminant pour le MODE d'ouverture. La doc WebKit
   est explicite : « For Safari to recognize AR content it must be served
   over HTTP with the appropriate MIME-type. Safari is looking for
   model/vnd.usdz+zip. » Servi en application/octet-stream, le fichier
   n'est pas reconnu comme contenu RA et Quick Look s'ouvre en mode
   « Objet ». On vérifie donc le type avant d'utiliser l'URL distante, et
   on ré-enveloppe le fichier dans un Blob au bon type si le serveur se
   trompe. Quand le serveur est correct, aucun téléchargement en double. */
const USDZ_MIME = 'model/vnd.usdz+zip';

let arUsdzHref  = '';     // href passé à Quick Look ; '' = pas encore prêt
let usdzBlobUrl = null;   // révoqué à chaque nouveau modèle (fuites mémoire)

async function prepareUsdzHref(usdzUrl, expectedKey){
  try {
    const head = await fetch(usdzUrl, { method:'HEAD' });
    const type = (head.headers.get('content-type') || '').toLowerCase();
    if (arModelKey !== expectedKey) return;          // étape changée entre-temps

    // type correct : l'URL distante s'ouvrira directement en mode RA
    if (type.startsWith(USDZ_MIME)){ arUsdzHref = usdzUrl; return; }

    // type incorrect : on préfère faire attendre le téléchargement plutôt
    // que d'ouvrir un aperçu « Objet » dégradé
    console.warn(`ar: .usdz servi en "${type}" au lieu de ${USDZ_MIME}`);
    const res = await fetch(usdzUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = await res.arrayBuffer();
    if (arModelKey !== expectedKey) return;

    if (usdzBlobUrl) URL.revokeObjectURL(usdzBlobUrl);
    usdzBlobUrl = URL.createObjectURL(new Blob([bytes], { type: USDZ_MIME }));
    arUsdzHref  = usdzBlobUrl;
  } catch (err) {
    // vérification impossible (CORS) ou téléchargement échoué : on tente
    // l'URL distante telle quelle, au moins le modèle sera visible
    console.warn('ar: type MIME du .usdz non vérifiable', usdzUrl, err);
    if (arModelKey === expectedKey) arUsdzHref = usdzUrl;
  }
}

function launchArQuickLook(){
  const t = I18N[lang];

  if (navigator.vibrate) navigator.vibrate(10);

  // modèle pas encore prêt : on ne lance rien, un tap plus tard suffira
  if (!arUsdzHref){ showArToast(t.arLoading, 2600); return; }

  // AR Quick Look va prendre le capteur : on le libère pour ARKit,
  // sinon iOS peut ne plus délivrer aucune image au retour dans la page.
  stopCamera();

  // ar-scale="fixed" côté model-viewer ⇒ même consigne pour Quick Look
  const href = arUsdzHref + (arUsdzHref.includes('#') ? '&' : '#')
             + 'allowsContentScaling=0';

  const a = document.createElement('a');
  a.rel = 'ar';
  a.href = href;

  // Une URL blob: n'a ni nom ni extension : « download » est le seul moyen
  // d'en donner un à Quick Look. Sur une URL distante en .usdz on s'abstient,
  // pour rester sur la forme documentée par Apple.
  if (arUsdzHref.startsWith('blob:')) a.setAttribute('download', 'model.usdz');

  // WebKit n'ouvre en mode RA direct que si le PREMIER enfant du lien est
  // un <img> ou un <picture> : sans lui, on obtient l'aperçu fichier.
  a.appendChild(document.createElement('img'));
  a.style.display = 'none';

  document.body.appendChild(a);
  a.click();
  a.remove();
}

function launchAr(glbUrl, usdzUrl){
  const t = I18N[lang];

  if (navigator.vibrate) navigator.vibrate(10);

  // écoute le statut de la session AR pour guider l'utilisateur
  // pendant la recherche de surface / l'ancrage au sol
  const onArStatus = (ev) => {
    switch (ev.detail.status){
      case 'session-started':
        showArToast(t.arAimFloor);
        break;
      case 'object-placed':
        showArToast(t.arPlaced, 1400);
        break;
      case 'not-presenting':
      case 'failed':
        hideArToast();
        arViewer.removeEventListener('ar-status', onArStatus);
        if (ev.detail.status === 'failed') showArToast(t.arLoadError, 2600);
        break;
    }
  };
  arViewer.addEventListener('ar-status', onArStatus);

  // Appel synchrone, dans le même tick que le clic : c'est ce qui permet
  // à iOS Safari de reconnaître un vrai geste utilisateur et d'ouvrir
  // Quick Look. model-viewer gère lui-même l'attente si le .glb n'est
  // pas encore totalement chargé.
  const result = arViewer.activateAR();
  if (result && typeof result.catch === 'function'){
    result.catch(err => {
      console.warn('ar:', err);
      showArToast(t.arNotSupported, 2600);
    });
  }
}

function goStep(delta){
  const next = stepIdx + delta;
  if (next < 0 || next >= steps.length) return;
  stepIdx = next;
  paintStep();
}

/* échappe le HTML injecté depuis l'API */
function esc(str){
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/* ── écran « trop loin » ── */
function paintFar(km){
  const t = I18N[lang];
  // 11.71 → « 11,7 » en français, « 11.7 » en anglais
  const n = Number(km).toFixed(1);
  $('#farKm').textContent   = lang === 'fr' ? n.replace('.', ',') : n;
  $('#farUnit').textContent = t.farUnit;
  $('#farAway').textContent = t.farAway;
}

function fmtCoord(v, pos, neg){
  if (v === null || v === undefined) return '—';
  return `${Math.abs(v).toFixed(4)}° ${v >= 0 ? pos : neg}`;
}

function youtubeId(url){
  if (!url) return null;
  const m = String(url).match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
  );
  return m ? m[1] : null;
}


/* ─────────────────────────────────────────────
   Retour
   ───────────────────────────────────────────── */

function backToCamera(){
  closeStep();
  stepsPlaceId = null;
  arModelKey = null;
  if (usdzBlobUrl){ URL.revokeObjectURL(usdzBlobUrl); usdzBlobUrl = null; }
  arUsdzHref = '';   // ne pas garder un blob révoqué comme cible Quick Look
  $('#tube').src = '';
  show('cam');
  setTimeout(reset, 220);

  // Sur iOS, l'ouverture d'AR Quick Look (une app native distincte)
  // suspend le flux getUserMedia de la page. Au retour, le <video> peut
  // rester figé sur une image noire même si `stream` semble toujours
  // vivant côté JS. On vérifie l'état réel des pistes et on relance
  // la caméra si besoin.
  ensureCameraAlive();
}

/* Quand une app native prend le capteur — c'est le cas d'AR Quick Look —
   iOS ne termine pas la piste vidéo : il la passe en « muted ». Son
   readyState reste 'live' et le <video> n'est pas en pause, seule l'image
   est noire. Une vérification sur le seul readyState conclurait donc à
   tort que la caméra est vivante et ne relancerait jamais rien. */
function cameraIsLive(){
  const t = stream && stream.getVideoTracks()[0];
  return !!t && t.readyState === 'live' && !t.muted;
}

function ensureCameraAlive(){
  if (!cameraIsLive()){
    startCamera();
  } else if (el.video.paused){
    el.video.play().catch(() => startCamera());
  }
}

function onPageResume(){
  if (el.screens.cam.classList.contains('is-active')) ensureCameraAlive();
}


/* ─────────────────────────────────────────────
   Démarrage
   ───────────────────────────────────────────── */

async function enterCamera(){
  show('cam');
  await startCamera();
  await askGeo();
}

function init(){

  document.querySelectorAll('.flag').forEach(btn => {
    btn.addEventListener('click', () => {
      setLang(btn.dataset.lang);
      enterCamera();
    });
  });

  document.querySelectorAll('.sw').forEach(btn => {
    btn.addEventListener('click', () => setLang(btn.dataset.lang));
  });

  el.trigger.addEventListener('click', runScan);
  $('#back').addEventListener('click', backToCamera);
  $('#retry').addEventListener('click', backToCamera);
  $('#farRetry').addEventListener('click', backToCamera);
  $('#camretry').addEventListener('click', startCamera);

  // modale d'étape
  $('#stepClose').addEventListener('click', closeStep);
  $('#stepVeil').addEventListener('click',  closeStep);
  $('#stepPrev').addEventListener('click',  () => goStep(-1));
  $('#stepNext').addEventListener('click',  () => goStep(+1));

  document.addEventListener('keydown', e => {
    if ($('#stepModal').hidden) return;
    if (e.key === 'Escape')     closeStep();
    if (e.key === 'ArrowLeft')  goStep(-1);
    if (e.key === 'ArrowRight') goStep(+1);
  });

  window.addEventListener('popstate', () => {
    if (el.screens.res.classList.contains('is-active')) backToCamera();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopCamera();
    else onPageResume();
  });

  // AR Quick Look s'affiche comme un calque natif au-dessus de la page :
  // iOS ne déclenche pas toujours visibilitychange en s'ouvrant ni en se
  // fermant. On se raccroche donc aussi au retour du focus.
  window.addEventListener('focus', onPageResume);

  // Retour arrière depuis le cache de navigation (bfcache) : la page est
  // restaurée telle quelle, avec un flux caméra mort et aucun rechargement
  // du script. Sans ce gestionnaire, l'écran reste noir même après un
  // rafraîchissement, puisque c'est l'état restauré qui est réaffiché.
  window.addEventListener('pageshow', e => {
    if (e.persisted) stopCamera();
    onPageResume();
  });

  // libère le capteur en quittant la page, pour que la prochaine
  // ouverture — ou la page restaurée — puisse le réacquérir
  window.addEventListener('pagehide', stopCamera);

  const saved = readStore(STORE);
  if (saved){
    setLang(saved);
    enterCamera();
  } else {
    setLang('fr');
    el.screens.lang.classList.add('is-active');
  }
}

document.addEventListener('DOMContentLoaded', init);