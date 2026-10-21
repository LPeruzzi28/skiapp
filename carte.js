// Carte des prévisions : grille de points Open-Meteo sur les Alpes suisses, interpolée
// et colorée par pas de 3 h, avec les stations (favoris en étoile) par-dessus.

const CLE_FAVORIS = "skiapp.favoris";
const CLE_CACHE = "skiapp.grille2";
const CLE_METEO = "skiapp.meteo"; // prévisions des stations, partagées avec la page Stations
const DUREE_CACHE_MS = 60 * 60 * 1000; // 1 h
const PAS_H = 3;
const JOURS = 5;

// Grille de 0,15° (~15 km) couvrant la Suisse.
const GRILLE = { latMin: 45.75, latMax: 47.85, lonMin: 5.85, lonMax: 10.65, pas: 0.15 };
const NB_LAT = Math.round((GRILLE.latMax - GRILLE.latMin) / GRILLE.pas) + 1;
const NB_LON = Math.round((GRILLE.lonMax - GRILLE.lonMin) / GRILLE.pas) + 1;

// Échelles de couleur : [valeur, r, g, b, opacité 0-255].
const COUCHES = {
  cumul: {
    unite: "cm",
    echelle: [[0, 160, 200, 255, 0], [1, 160, 200, 255, 120], [5, 90, 160, 255, 170], [15, 40, 90, 230, 190],
              [30, 120, 60, 210, 200], [60, 200, 60, 200, 210], [100, 255, 255, 255, 220]],
  },
  neige: {
    unite: "cm",
    echelle: [[0, 160, 200, 255, 0], [0.3, 160, 200, 255, 120], [1, 90, 160, 255, 170], [3, 40, 90, 230, 200],
              [6, 150, 60, 210, 210], [10, 230, 80, 200, 220]],
  },
  pluie: {
    unite: "mm",
    echelle: [[0, 120, 200, 120, 0], [0.2, 120, 200, 120, 110], [2, 60, 170, 70, 160], [5, 240, 220, 50, 190],
              [10, 240, 130, 30, 200], [20, 220, 30, 30, 210]],
  },
  temp: {
    unite: "°C",
    echelle: [[-20, 120, 40, 160, 170], [-10, 40, 80, 220, 170], [-4, 90, 170, 250, 170], [0, 230, 240, 255, 170],
              [4, 140, 220, 120, 170], [10, 250, 220, 60, 170], [20, 240, 90, 40, 170]],
  },
};

const ICONES = {
  0: "☀️", 1: "🌤️", 2: "⛅", 3: "☁️", 45: "🌫️", 48: "🌫️",
  51: "🌦️", 53: "🌦️", 55: "🌦️", 56: "🌧️", 57: "🌧️",
  61: "🌧️", 63: "🌧️", 65: "🌧️", 66: "🌧️", 67: "🌧️",
  71: "🌨️", 73: "🌨️", 75: "❄️", 77: "🌨️",
  80: "🌦️", 81: "🌧️", 82: "🌧️", 85: "🌨️", 86: "❄️",
  95: "⛈️", 96: "⛈️", 99: "⛈️",
};

let donnees = null; // { temps: [...], neige: [[...]], pluie, temp } par point de grille
let couche = "cumul";
let etape = 0;
let calque = null;

// La carte reste dans la zone couverte par la grille : impossible de dézoomer
// ou de glisser là où il n'y a pas de prévisions.
const ZONE = L.latLngBounds([[GRILLE.latMin, GRILLE.lonMin], [GRILLE.latMax, GRILLE.lonMax]]);
const carte = L.map("carte", { zoomSnap: 0.25, zoomDelta: 0.5, maxBounds: ZONE, maxBoundsViscosity: 1 });
function limiterZoom() {
  const min = carte.getBoundsZoom(ZONE, true);
  carte.setMinZoom(min);
  if (carte.getZoom() < min) carte.setZoom(min);
}
carte.setView(ZONE.getCenter(), carte.getBoundsZoom(ZONE, true));
limiterZoom();
carte.on("resize", limiterZoom);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · <a href="https://open-meteo.com/">Open-Meteo</a>',
  maxZoom: 12,
}).addTo(carte);
carte.createPane("meteo").style.zIndex = 350;

function lire(cle, defaut) {
  try { return JSON.parse(localStorage.getItem(cle)) ?? defaut; } catch { return defaut; }
}
function ecrire(cle, valeur) {
  try { localStorage.setItem(cle, JSON.stringify(valeur)); } catch { /* stockage plein ou indisponible */ }
}

async function demarrer() {
  ajouterStations();
  try {
    donnees = await chargerGrille();
  } catch (e) {
    document.getElementById("moment").textContent = "Prévisions indisponibles";
    return;
  }
  const curseur = document.getElementById("curseur");
  curseur.max = donnees.temps.length - 1;
  // La neige cumulée s'ouvre sur le total des 5 jours.
  etape = couche === "cumul" ? donnees.temps.length - 1 : 0;
  curseur.value = etape;
  dessiner();
}

async function chargerGrille() {
  const cache = lire(CLE_CACHE, null);
  if (cache && Date.now() - cache.date < DUREE_CACHE_MS) return cache.donnees;

  const lats = [], lons = [];
  for (let i = 0; i < NB_LAT; i++) {
    for (let j = 0; j < NB_LON; j++) {
      lats.push((GRILLE.latMin + i * GRILLE.pas).toFixed(2));
      lons.push((GRILLE.lonMin + j * GRILLE.pas).toFixed(2));
    }
  }
  const params = new URLSearchParams({
    latitude: lats.join(","),
    longitude: lons.join(","),
    hourly: "snowfall,precipitation,temperature_2m",
    timezone: "Europe/Zurich",
    forecast_days: JOURS,
  });
  const rep = await fetch("https://api.open-meteo.com/v1/forecast?" + params);
  if (!rep.ok) throw new Error("Open-Meteo " + rep.status);
  let res = await rep.json();
  if (!Array.isArray(res)) res = [res];

  // Premier pas : l'heure en cours, puis tous les 3 h.
  const heures = res[0].hourly.time;
  const maintenant = new Date();
  let debut = heures.findIndex(t => new Date(t) >= maintenant) - 1;
  if (debut < 0) debut = 0;
  const indices = [];
  for (let k = debut; k < heures.length; k += PAS_H) indices.push(k);

  const somme = (tab, k) => tab.slice(Math.max(0, k - PAS_H + 1), k + 1).reduce((a, b) => a + (b ?? 0), 0);
  const resultat = {
    temps: indices.map(k => heures[k]),
    neige: res.map(p => indices.map(k => +somme(p.hourly.snowfall, k).toFixed(1))),
    pluie: res.map(p => indices.map(k => +somme(p.hourly.precipitation, k).toFixed(1))),
    temp: res.map(p => indices.map(k => +(p.hourly.temperature_2m[k] ?? 0).toFixed(1))),
  };
  // Neige cumulée depuis maintenant jusqu'à chaque pas.
  resultat.cumul = res.map(p => {
    let total = 0;
    return indices.map(k => {
      total += somme(p.hourly.snowfall, k);
      return +total.toFixed(1);
    });
  });
  ecrire(CLE_CACHE, { date: Date.now(), donnees: resultat });
  return resultat;
}

function valeurGrille(champ, lat, lon) {
  const y = (lat - GRILLE.latMin) / GRILLE.pas;
  const x = (lon - GRILLE.lonMin) / GRILLE.pas;
  const i0 = Math.max(0, Math.min(NB_LAT - 2, Math.floor(y)));
  const j0 = Math.max(0, Math.min(NB_LON - 2, Math.floor(x)));
  const fy = Math.min(1, Math.max(0, y - i0)), fx = Math.min(1, Math.max(0, x - j0));
  const v = (i, j) => donnees[champ][i * NB_LON + j][etape];
  return v(i0, j0) * (1 - fx) * (1 - fy) + v(i0, j0 + 1) * fx * (1 - fy)
       + v(i0 + 1, j0) * (1 - fx) * fy + v(i0 + 1, j0 + 1) * fx * fy;
}

function couleur(echelle, v) {
  if (v <= echelle[0][0]) return echelle[0].slice(1);
  for (let n = 1; n < echelle.length; n++) {
    const [v1, ...c1] = echelle[n];
    if (v <= v1) {
      const [v0, ...c0] = echelle[n - 1];
      const t = (v - v0) / (v1 - v0);
      return c0.map((c, i) => c + (c1[i] - c) * t);
    }
  }
  return echelle[echelle.length - 1].slice(1);
}

// Une image couvrant la grille, calculée pixel par pixel en projection Mercator
// pour rester alignée avec le fond de carte.
function dessiner() {
  if (!donnees) return;
  const L_PX = 480;
  const merc = lat => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const yN = merc(GRILLE.latMax), yS = merc(GRILLE.latMin);
  const H_PX = Math.round((L_PX * (yN - yS)) / (((GRILLE.lonMax - GRILLE.lonMin) * Math.PI) / 180));

  const canvas = document.createElement("canvas");
  canvas.width = L_PX; canvas.height = H_PX;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(L_PX, H_PX);
  const { echelle } = COUCHES[couche];
  for (let py = 0; py < H_PX; py++) {
    const lat = (Math.atan(Math.sinh(yN - ((py + 0.5) / H_PX) * (yN - yS))) * 180) / Math.PI;
    for (let px = 0; px < L_PX; px++) {
      const lon = GRILLE.lonMin + ((px + 0.5) / L_PX) * (GRILLE.lonMax - GRILLE.lonMin);
      const [r, g, b, a] = couleur(echelle, valeurGrille(couche, lat, lon));
      const o = (py * L_PX + px) * 4;
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);

  const bornes = [[GRILLE.latMin, GRILLE.lonMin], [GRILLE.latMax, GRILLE.lonMax]];
  if (calque) calque.setUrl(canvas.toDataURL());
  else calque = L.imageOverlay(canvas.toDataURL(), bornes, { pane: "meteo", opacity: 0.85 }).addTo(carte);

  const t = new Date(donnees.temps[etape]);
  document.getElementById("moment").textContent =
    t.toLocaleDateString("fr-CH", { weekday: "short", day: "numeric" }) + " " +
    t.toLocaleTimeString("fr-CH", { hour: "2-digit", minute: "2-digit" });
  legende();
  majInfobulles();
}

function legende() {
  const { echelle, unite } = COUCHES[couche];
  const stops = echelle.map(([v, r, g, b, a], n) =>
    `rgba(${r},${g},${b},${Math.max(a, 60) / 255}) ${(n / (echelle.length - 1)) * 100}%`).join(",");
  document.getElementById("legende").innerHTML =
    `<div class="degrade" style="background:linear-gradient(to right,${stops})"></div>
     <div class="graduations">${echelle.map(([v]) => `<span>${v}</span>`).join("")}<span class="u">${unite}</span></div>`;
}

let marqueurs = [];
async function ajouterStations() {
  const stations = await (await fetch("stations.json")).json();
  const favoris = new Set(lire(CLE_FAVORIS, []));
  marqueurs = stations.map(s => {
    const fav = favoris.has(s.id);
    const icone = L.divIcon({
      className: "",
      html: `<span class="pin ${fav ? "pin-fav" : ""}">${fav ? "★" : ""}</span>`,
      iconSize: fav ? [26, 26] : [12, 12],
    });
    const m = L.marker([s.lat, s.lon], { icon: icone, zIndexOffset: fav ? 1000 : 0 }).addTo(carte);
    m.station = s;
    if (fav) m.bindTooltip("", { permanent: true, direction: "right", offset: [12, 0], className: "etiquette" });
    else m.bindTooltip("", { direction: "top" });
    m.bindPopup(() => fiche(s), { className: "fiche", maxWidth: 240, minWidth: 210, autoPanPadding: [20, 20] });
    m.on("popupopen", () => { if (!fav) m.closeTooltip(); });
    return m;
  });
  majInfobulles();
}

function majInfobulles() {
  for (const m of marqueurs) {
    const s = m.station;
    let texte = s.nom.split(" (")[0];
    if (donnees) {
      const v = valeurGrille(couche, s.lat, s.lon);
      texte += ` · ${couche === "temp" ? Math.round(v) : v < 0.5 ? 0 : Math.round(v)} ${COUCHES[couche].unite}`;
    }
    m.setTooltipContent(texte);
  }
}

// Mini-fiche d'une station au clic sur son point : météo au sommet en quelques chiffres.
// Reprend les prévisions déjà chargées par la page Stations, sinon une petite requête.
const previsions = {};
function previsionStation(s) {
  const cache = lire(CLE_METEO, null);
  const haut = cache && Date.now() - cache.date < DUREE_CACHE_MS && cache.donnees?.[s.id]?.sommet;
  if (haut?.daily) return Promise.resolve(haut);
  previsions[s.id] ??= (async () => {
    const params = new URLSearchParams({
      latitude: s.lat, longitude: s.lon, elevation: s.alt_sommet,
      current: "temperature_2m,weather_code,snow_depth",
      daily: "weather_code,snowfall_sum",
      timezone: "Europe/Zurich",
      forecast_days: 7,
    });
    const rep = await fetch("https://api.open-meteo.com/v1/forecast?" + params);
    if (!rep.ok) throw new Error("Open-Meteo " + rep.status);
    return rep.json();
  })().catch(e => { delete previsions[s.id]; throw e; });
  return previsions[s.id];
}

function fiche(s) {
  const el = document.createElement("div");
  el.innerHTML = `
    <div class="fiche-tete"><strong>${s.nom}</strong><span class="fiche-actuel"></span></div>
    <p class="fiche-meta">${s.canton} · ${s.alt_base}–${s.alt_sommet} m</p>
    <div class="fiche-chiffres"><span class="charge">Chargement…</span></div>
    <a class="fiche-lien" href="./#${s.id}">Voir la station →</a>`;
  previsionStation(s).then(h => {
    const somme = n => h.daily.snowfall_sum.slice(0, n).reduce((a, b) => a + (b ?? 0), 0);
    const cm = v => (v < 0.5 ? 0 : Math.round(v));
    const sol = h.current?.snow_depth;
    if (h.current) {
      el.querySelector(".fiche-actuel").textContent =
        `${ICONES[h.current.weather_code] ?? ""} ${Math.round(h.current.temperature_2m)}°`;
    }
    el.querySelector(".fiche-chiffres").innerHTML = [
      ["24 h", cm(somme(1))], ["3 j", cm(somme(3))], ["7 j", cm(somme(7))],
      ["Au sol", sol != null ? Math.round(sol * 100) : "–"],
    ].map(([nom, v]) => `<span><b>${v}</b>${nom}</span>`).join("");
  }).catch(() => {
    el.querySelector(".fiche-chiffres").innerHTML = `<span class="charge">Prévisions indisponibles</span>`;
  });
  return el;
}

document.querySelectorAll(".couches button").forEach(b => b.addEventListener("click", () => {
  document.querySelectorAll(".couches button").forEach(x => x.classList.toggle("actif", x === b));
  couche = b.dataset.couche;
  dessiner();
}));

document.getElementById("curseur").addEventListener("input", e => {
  etape = +e.target.value;
  dessiner();
});

demarrer();
