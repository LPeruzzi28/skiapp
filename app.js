// Ski Suisse V1 : liste des stations, prévisions de neige Open-Meteo, favoris stockés sur l'appareil.

const CLE_FAVORIS = "skiapp.favoris";
const CLE_CACHE = "skiapp.meteo";
const DUREE_CACHE_MS = 60 * 60 * 1000; // 1 h
const JOURS = 7;

const ICONES = {
  0: "☀️", 1: "🌤️", 2: "⛅", 3: "☁️", 45: "🌫️", 48: "🌫️",
  51: "🌦️", 53: "🌦️", 55: "🌦️", 56: "🌧️", 57: "🌧️",
  61: "🌧️", 63: "🌧️", 65: "🌧️", 66: "🌧️", 67: "🌧️",
  71: "🌨️", 73: "🌨️", 75: "❄️", 77: "🌨️",
  80: "🌦️", 81: "🌧️", 82: "🌧️", 85: "🌨️", 86: "❄️",
  95: "⛈️", 96: "⛈️", 99: "⛈️",
};

let stations = [];
let meteo = {}; // id -> { sommet, village }
let favoris = new Set(lire(CLE_FAVORIS, []));

function lire(cle, defaut) {
  try { return JSON.parse(localStorage.getItem(cle)) ?? defaut; } catch { return defaut; }
}
function ecrire(cle, valeur) {
  try { localStorage.setItem(cle, JSON.stringify(valeur)); } catch { /* stockage indisponible */ }
}

async function demarrer() {
  stations = await (await fetch("stations.json")).json();
  afficher();
  try {
    meteo = await chargerMeteo();
    afficher();
  } catch (e) {
    const err = document.getElementById("erreur");
    err.textContent = "Impossible de charger les prévisions. Vérifie ta connexion et recharge la page.";
    err.hidden = false;
    document.getElementById("maj").textContent = "Prévisions indisponibles";
  }
}

// Une seule requête pour toutes les stations : chaque station est demandée deux fois,
// à l'altitude du sommet puis à celle du village.
async function chargerMeteo() {
  const cache = lire(CLE_CACHE, null);
  if (cache && Date.now() - cache.date < DUREE_CACHE_MS && cache.nb === stations.length) {
    majHeure(cache.date);
    return cache.donnees;
  }
  const points = stations.flatMap(s => [
    { s, ou: "sommet", alt: s.alt_sommet },
    { s, ou: "village", alt: s.alt_base },
  ]);
  const params = new URLSearchParams({
    latitude: points.map(p => p.s.lat).join(","),
    longitude: points.map(p => p.s.lon).join(","),
    elevation: points.map(p => p.alt).join(","),
    current: "temperature_2m,weather_code,snow_depth,wind_speed_10m",
    daily: "weather_code,snowfall_sum,temperature_2m_max,temperature_2m_min,wind_speed_10m_max",
    timezone: "Europe/Zurich",
    forecast_days: JOURS,
  });
  const rep = await fetch("https://api.open-meteo.com/v1/forecast?" + params);
  if (!rep.ok) throw new Error("Open-Meteo " + rep.status);
  let res = await rep.json();
  if (!Array.isArray(res)) res = [res];

  const donnees = {};
  points.forEach((p, i) => {
    donnees[p.s.id] ??= {};
    donnees[p.s.id][p.ou] = res[i];
  });
  const date = Date.now();
  ecrire(CLE_CACHE, { date, nb: stations.length, donnees });
  majHeure(date);
  return donnees;
}

function majHeure(date) {
  const h = new Date(date).toLocaleTimeString("fr-CH", { hour: "2-digit", minute: "2-digit" });
  document.getElementById("maj").textContent = `Prévisions mises à jour à ${h}`;
}

function cumul(m, n) {
  if (!m?.daily) return null;
  return m.daily.snowfall_sum.slice(0, n).reduce((a, b) => a + (b ?? 0), 0);
}

function afficher() {
  const q = document.getElementById("recherche").value.trim().toLowerCase();
  const tri = document.getElementById("tri").value;
  const visibles = stations
    .filter(s => !q || s.nom.toLowerCase().includes(q) || s.canton.toLowerCase() === q)
    .sort(comparateur(tri));

  const favs = visibles.filter(s => favoris.has(s.id));
  remplir("liste-favoris", favs);
  remplir("liste-toutes", visibles);
  document.getElementById("favoris-vide").hidden = favoris.size > 0;
  document.getElementById("bloc-favoris").hidden = favoris.size > 0 && favs.length === 0;
}

function comparateur(tri) {
  const neige = n => s => cumul(meteo[s.id]?.sommet, n) ?? -1;
  switch (tri) {
    case "nom": return (a, b) => a.nom.localeCompare(b.nom, "fr");
    case "altitude": return (a, b) => b.alt_sommet - a.alt_sommet;
    case "neige7": return (a, b) => neige(7)(b) - neige(7)(a) || a.nom.localeCompare(b.nom, "fr");
    default: return (a, b) => neige(3)(b) - neige(3)(a) || a.nom.localeCompare(b.nom, "fr");
  }
}

function remplir(idListe, liste) {
  const el = document.getElementById(idListe);
  el.replaceChildren(...liste.map(carte));
}

function carte(s) {
  const tpl = document.getElementById("tpl-station").content.cloneNode(true);
  const art = tpl.querySelector(".station");
  const m = meteo[s.id] || {};
  const haut = m.sommet;

  const fav = favoris.has(s.id);
  const btn = art.querySelector(".fav");
  btn.textContent = fav ? "★" : "☆";
  btn.classList.toggle("actif", fav);
  btn.setAttribute("aria-label", fav ? "Retirer des favoris" : "Ajouter aux favoris");
  btn.addEventListener("click", () => basculerFavori(s.id));

  art.querySelector("h3").textContent = s.nom;
  art.querySelector(".meta").textContent = `${s.canton} · ${s.alt_base}–${s.alt_sommet} m`;

  if (haut?.current) {
    const c = haut.current;
    art.querySelector(".actuel").innerHTML =
      `<span class="ico">${ICONES[c.weather_code] ?? ""}</span><span class="temp">${Math.round(c.temperature_2m)}°</span>`;
  }

  if (haut?.daily) {
    const n24 = cumul(haut, 1), n3 = cumul(haut, 3), n7 = cumul(haut, 7);
    const hauteur = haut.current?.snow_depth;
    art.querySelector(".resume").innerHTML = [
      bulle("Aujourd'hui", cm(n24)),
      bulle("3 jours", cm(n3)),
      bulle("7 jours", cm(n7)),
      bulle("Neige au sol", hauteur != null ? Math.round(hauteur * 100) + " cm" : "–"),
    ].join("");

    const max = Math.max(10, ...haut.daily.snowfall_sum);
    art.querySelector(".jours").innerHTML = haut.daily.time.map((t, i) => {
      const v = haut.daily.snowfall_sum[i] ?? 0;
      const j = new Date(t + "T12:00").toLocaleDateString("fr-CH", { weekday: "short" }).replace(".", "");
      return `<div class="jour" title="${cm(v)} au sommet">
        <span class="val">${v >= 0.5 ? Math.round(v) : ""}</span>
        <span class="barre" style="height:${Math.round((v / max) * 100)}%"></span>
        <span class="ico">${ICONES[haut.daily.weather_code[i]] ?? ""}</span>
        <span class="nom">${j}</span>
      </div>`;
    }).join("");

    art.querySelector(".detail").innerHTML = tableau(s, m);
  } else {
    art.querySelector(".resume").innerHTML = `<span class="charge">Prévisions en cours de chargement…</span>`;
    art.querySelector("details.det").hidden = true;
  }
  const cams = art.querySelector("details.cams");
  cams.addEventListener("toggle", () => {
    if (cams.open && !cams.dataset.charge) {
      cams.dataset.charge = "1";
      afficherWebcams(s, cams.querySelector(".cams-liste"));
    }
  });
  return art;
}

// Webcams Windy à moins de 8 km de la station, chargées à l'ouverture du bloc.
// Les liens d'image Windy expirent : on ne les met jamais en cache.
const webcamsCache = {};
async function chargerWebcams(s) {
  if (webcamsCache[s.id]) return webcamsCache[s.id];
  const params = new URLSearchParams({
    nearby: `${s.lat},${s.lon},8`,
    include: "images,urls,location",
    limit: 8,
  });
  const rep = await fetch("https://api.windy.com/webcams/api/v3/webcams?" + params, {
    headers: { "x-windy-api-key": window.CONFIG?.windyKey },
  });
  if (!rep.ok) throw new Error("Windy " + rep.status);
  const { webcams = [] } = await rep.json();
  return (webcamsCache[s.id] = webcams.filter(w => w.status === "active" && w.images?.current?.preview));
}

async function afficherWebcams(s, el) {
  const lienCarte = `https://www.windy.com/webcams?${s.lat},${s.lon},12`;
  if (!window.CONFIG?.windyKey) {
    el.innerHTML = `<p class="cam-info"><a href="${lienCarte}" target="_blank" rel="noopener">Voir les webcams autour de ${s.nom} sur Windy</a></p>`;
    return;
  }
  el.innerHTML = `<p class="cam-info">Chargement des webcams…</p>`;
  try {
    const cams = await chargerWebcams(s);
    if (!cams.length) {
      el.innerHTML = `<p class="cam-info">Aucune webcam trouvée près de la station.</p>`;
      return;
    }
    el.innerHTML = cams.map(w => {
      const img = w.images.current.preview;
      const maj = new Date(w.lastUpdatedOn).toLocaleString("fr-CH", { weekday: "short", hour: "2-digit", minute: "2-digit" });
      return `<a class="cam" href="${w.urls?.detail ?? lienCarte}" target="_blank" rel="noopener">
        <img src="${img}" alt="" loading="lazy">
        <span>${w.title}${w.lastUpdatedOn ? ` · ${maj}` : ""}</span>
      </a>`;
    }).join("") + `<p class="cam-credit">Webcams fournies par <a href="https://www.windy.com/" target="_blank" rel="noopener">Windy.com</a></p>`;
  } catch {
    el.innerHTML = `<p class="cam-info">Webcams indisponibles. <a href="${lienCarte}" target="_blank" rel="noopener">Les voir sur Windy</a></p>`;
  }
}

function tableau(s, m) {
  const ligne = (nom, alt, d) => {
    if (!d?.daily) return "";
    return `<tr><th>${nom}<br><small>${alt} m</small></th>
      <td>${Math.round(d.current.temperature_2m)}°</td>
      <td>${Math.round(d.daily.temperature_2m_min[0])}° / ${Math.round(d.daily.temperature_2m_max[0])}°</td>
      <td>${cm(cumul(d, 3))}</td>
      <td>${Math.round(d.daily.wind_speed_10m_max[0])} km/h</td></tr>`;
  };
  return `<tr><th></th><th>Maint.</th><th>Min / max</th><th>Neige 3 j</th><th>Vent max</th></tr>`
    + ligne("Sommet", s.alt_sommet, m.sommet)
    + ligne("Village", s.alt_base, m.village);
}

function bulle(titre, valeur) {
  return `<div class="bulle"><span>${titre}</span><strong>${valeur}</strong></div>`;
}
function cm(v) {
  if (v == null) return "–";
  return v < 0.5 ? "0 cm" : Math.round(v) + " cm";
}

function basculerFavori(id) {
  favoris.has(id) ? favoris.delete(id) : favoris.add(id);
  ecrire(CLE_FAVORIS, [...favoris]);
  afficher();
}

document.getElementById("recherche").addEventListener("input", afficher);
document.getElementById("tri").addEventListener("change", afficher);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

demarrer();
