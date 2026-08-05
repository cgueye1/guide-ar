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

async function startCamera(){
  el.camfail.hidden = true;
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
  }
}

function stopCamera(){
  if (stream){ stream.getTracks().forEach(t => t.stop()); stream = null; }
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
let   arModelUrl = null;   // évite de recharger le même .glb

function paintArButton(step){
  const btn = $('#stepArBtn');
  const url = (step && step.glbFileUrl || '').trim();

  if (!url){
    btn.hidden = true;
    btn.onclick = null;
    return;
  }

  btn.hidden = false;
  btn.disabled = false;
  btn.onclick = () => launchAr(url);

  // précharge le .glb en tâche de fond dès que le bouton apparaît :
  // au moment du tap, activateAR() doit s'exécuter en tout premier,
  // de façon parfaitement synchrone avec le geste utilisateur — iOS
  // Safari annule Quick Look si le moindre await le précède.
  preloadArModel(url);
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

function preloadArModel(glbUrl){
  if (arModelUrl === glbUrl) return;   // déjà (pré)chargé
  arModelUrl = glbUrl;
  arViewer.setAttribute('reveal', 'manual'); // ne rend rien à l'écran
  arViewer.src = glbUrl;
  arViewer.addEventListener('error', () => {
    if (arViewer.src === glbUrl) arModelUrl = null;
    console.warn('ar: échec de chargement du modèle', glbUrl);
  }, { once:true });
}

function launchAr(glbUrl){
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
  arModelUrl = null;
  $('#tube').src = '';
  show('cam');
  setTimeout(reset, 220);
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
    if (document.hidden){
      stopCamera();
    } else if (el.screens.cam.classList.contains('is-active') && !stream){
      startCamera();
    }
  });

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