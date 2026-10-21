# skiapp

Web app des stations de ski des Alpes suisses : neige prévue, météo au village et au sommet, et favoris pour retrouver ses stations rapidement. Installable sur téléphone (« Ajouter à l'écran d'accueil »).

- Prévisions : [Open-Meteo](https://open-meteo.com/) (gratuit pour un usage non commercial, sans clé), une seule requête pour toutes les stations.
- Stations : `stations.json` (nom, canton, coordonnées, altitude du bas et du sommet).
- Favoris : enregistrés dans le navigateur de chaque personne.
- Carte (`carte.html`) : grille de points Open-Meteo (~15 km) sur la Suisse, interpolée et colorée par pas de 3 h sur 5 jours (neige cumulée, neige 3 h, précipitations, température), fond Leaflet + CARTO.

Aucune étape de build : ce sont des fichiers statiques. Pour tester en local :

```sh
python3 -m http.server 8000
```

puis ouvrir http://localhost:8000.
