# Multi-Motors AI

IA de scraping automatique pour alimenter le catalogue de moteurs brushless FPV dans Google Sheets.

## Fonctionnement

L'application tourne en continu et effectue les étapes suivantes en boucle :

1. **Recherche via DuckDuckGo** - Découvre de nouvelles pages produit de moteurs brushless par marque, taille de stator et nouveautés
2. **Scraping de boutiques FPV** - Parcourt les boutiques en ligne spécialisées (GetFPV, RaceDayQuads, Pyrodrone, etc.)
3. **Scraping fabricants** - Visite directement les sites des fabricants (T-Motor, BetaFPV, Emax, iFlight, etc.)
4. **Extraction des specs** - Parse les pages produit pour extraire les spécifications techniques (KV, poids, stator, voltage, etc.)
5. **Ajout au catalogue** - Ajoute les nouveaux moteurs dans le Google Sheet en évitant les doublons

## Colonnes du Google Sheet

| Colonne | Description |
|---------|-------------|
| ID | Identifiant auto |
| REF | Référence unique (ex: EMAX-2207-1900) |
| MARQUE | Fabricant |
| NOM | Nom/série du moteur |
| VERSION | Version |
| CLASSE | Taille stator (ex: 2207) |
| KV | Vitesse en KV |
| POIDS | Poids en grammes |
| H STATOR | Hauteur stator (mm) |
| D STATOR | Diamètre stator (mm) |
| H MOTEUR | Hauteur moteur (mm) |
| D MOTEUR | Diamètre moteur (mm) |
| D SHAFT | Diamètre axe (mm) |
| L SHAFT | Longueur axe (mm) |
| TYPE SHAFT | Type d'axe |
| VIS HEL | Vis hélice |
| VIS FIX | Vis de fixation |
| ENTRAXE FIX | Entraxe fixation (mm) |
| LIPO | Batterie compatible |
| VOLTAGE | Tension |
| L CABLE | Longueur câble |
| TYPE CABLE | Gauge fil |
| HELICE | Taille hélice |
| PUISSANCE | Puissance (W) |
| AMP | Courant max (A) |
| AIMANT | Type d'aimant |
| CLOCHE | Type de cloche |
| CONFIG | Configuration N/P |
| LIEN | Lien produit |
| IMG | URL image |

## Installation

### 1. Prérequis

- Python 3.10+
- Un compte Google Cloud avec l'API Sheets activée

### 2. Configuration Google Sheets

1. Aller sur [Google Cloud Console](https://console.cloud.google.com/)
2. Créer un projet (ou en utiliser un existant)
3. Activer l'API **Google Sheets** et l'API **Google Drive**
4. Créer un **Service Account** :
   - IAM & Admin > Service Accounts > Create
   - Télécharger la clé JSON → la renommer `credentials.json`
5. Partager le Google Sheet avec l'email du service account (droits **Éditeur**)

### 3. Installation des dépendances

```bash
cd Multi-Motors
python -m venv venv
source venv/bin/activate  # Linux/Mac
# ou: venv\Scripts\activate  # Windows

pip install -r multi_motors_ai/requirements.txt
```

### 4. Configuration

```bash
cp .env.example .env
# Éditer .env si nécessaire (les valeurs par défaut pointent vers le bon sheet)
```

Placer le fichier `credentials.json` à la racine du projet.

### 5. Lancement

```bash
python -m multi_motors_ai.main
```

L'IA va :
- Se connecter au Google Sheet
- Lancer un premier scan complet
- Puis scanner automatiquement toutes les 60 minutes (configurable)

### Arrêt propre

`Ctrl+C` pour arrêter proprement après le cycle en cours.

## Configuration avancée

Variables d'environnement (fichier `.env`) :

| Variable | Défaut | Description |
|----------|--------|-------------|
| `SCAN_INTERVAL_MINUTES` | 60 | Intervalle entre les scans |
| `REQUEST_DELAY_MIN` | 2 | Délai minimum entre requêtes (sec) |
| `REQUEST_DELAY_MAX` | 5 | Délai maximum entre requêtes (sec) |
| `MAX_RESULTS_PER_SEARCH` | 30 | Résultats max par recherche |
| `LOG_LEVEL` | INFO | Niveau de log (DEBUG, INFO, WARNING) |

## Architecture

```
multi_motors_ai/
├── __init__.py
├── main.py              # Point d'entrée, boucle principale
├── config.py            # Configuration et constantes
├── models.py            # Modèle de données MotorSpec
├── sheets.py            # Intégration Google Sheets
├── parser.py            # Extraction de specs par regex
└── scrapers/
    ├── __init__.py
    ├── base.py           # Scraper de base avec HTTP/parsing
    ├── search_engine.py  # Découverte via DuckDuckGo
    └── shop_scraper.py   # Scraping boutiques et fabricants
```

## Sources de données

### Moteurs recherchés par marque
3BHOBBY, BetaFPV, BrotherHobby, Cobra, DYS, Emax, FlyFishRC, Flywoo, GepRC, HappyModel, iFlight, T-Motor, Xnova, et 30+ autres.

### Tailles de stator couvertes
0603, 0802, 1103, 1404, 1507, 2004, 2205, 2207, 2306, 2405, 2507, 2806, 3115, etc.

### Boutiques FPV scrapées
GetFPV, RaceDayQuads, Pyrodrone, BetaFPV, iFlight-RC

## Recherche quotidienne et site catalogue

### Catalogue dans le dépôt

Le workflow `.github/workflows/nouveaux-moteurs.yml` s'exécute chaque jour à 06:00 UTC (08:00 à Paris en été) :

1. importe le tableau Google (export xlsx) avec `tools/import_sheet.py` : nouveaux moteurs et valeurs ajoutées dans le tableau ; les lignes aux colonnes décalées sont réalignées (poids, puissance) ;
2. cherche les nouveaux moteurs sur internet (`python -m multi_motors_ai.main --once --output github`) ;
3. complète 500 fiches par jour depuis les pages produit des boutiques (`tools/enrich.py`) ;
4. intègre les corrections validées par la communauté (`tools/community_sync.py`) ;
5. relève les prix et les photos dans 15 boutiques (`tools/prices.py`, liste dans `tools/shops.py` : RaceDayQuads, Pyrodrone, NewBeeDrone, Rotor Riot, SpeedyFPV, FPVFaster, Quadmula, Unmanned Tech, Drone-FPV-Racer, Studiosport et les boutiques officielles Emax, RushFPV, BetaFPV, HGLRC, Diatone) : 400 modèles par jour, les prix les plus anciens d'abord ;
6. ajoute des vidéos de review, des photos des sites fabricants (`tools/photos_sites.py`), les miniatures, les logos des nouvelles marques et le fil d'actualité ;
7. commit le tout ; le workflow `deploy-ovh.yml` met ensuite le site en ligne.

**Important :** GitHub ne lance les tâches planifiées que depuis la branche par défaut du dépôt (`Moteurs`). Tant que ces fichiers ne sont que sur une autre branche, rien ne tourne automatiquement.

Il peut aussi être lancé à la main depuis l'onglet **Actions**.

### Site (`site/`)

Site statique (HTML/CSS/JS, sans serveur) qui affiche `data/moteurs.csv` avec recherche, filtres par marque, stator et LiPo, et une fiche détaillée par moteur.

Aperçu en local :

```bash
python -m http.server 8000
# puis ouvrir http://localhost:8000/site/
```

### Mise en ligne sur OVH

Le workflow `.github/workflows/deploy-ovh.yml` envoie le site par FTP sur l'hébergement OVH après chaque recherche quotidienne et à chaque modification de `site/` sur `Moteurs`. Il n'efface aucun fichier existant sur l'hébergement.

À configurer une fois dans **Settings → Secrets and variables → Actions** du dépôt :

| Nom | Type | Valeur |
|-----|------|--------|
| `OVH_FTP_HOST` | Secret | Serveur FTP (ex. `ftp.cluster0XX.hosting.ovh.net`) |
| `OVH_FTP_USER` | Secret | Identifiant FTP |
| `OVH_FTP_PASSWORD` | Secret | Mot de passe FTP |
| `OVH_REMOTE_DIR` | Variable (optionnelle) | Dossier du site, `www` par défaut |

Ces informations se trouvent dans l'espace client OVH : **Web Cloud → Hébergements → votre hébergement → FTP - SSH**.

## Espace communautaire (comptes, likes, commentaires, suggestions, modération)

Le serveur communautaire est une petite API PHP (`site/api/`) avec la base MySQL de l'hébergement OVH. Tant qu'il n'est pas configuré, le catalogue fonctionne normalement et ces fonctions restent désactivées.

### 1. Créer la base de données (espace client OVH)

**Web Cloud → Hébergements → votre hébergement → Bases de données → Créer une base de données** (MySQL). Notez le serveur (`xxxx.mysql.db`), le nom de la base, l'utilisateur et le mot de passe. Les tables sont créées automatiquement au premier appel.

### 2. Connexion Google (facultatif)

[Google Cloud Console](https://console.cloud.google.com/) → **API et services → Identifiants → Créer des identifiants → ID client OAuth**, type « Application Web », origine JavaScript autorisée : l'adresse du site. Copiez l'**ID client**.

### 3. Secrets GitHub (Settings → Secrets and variables → Actions)

| Secret | Valeur |
|--------|--------|
| `MM_DB_HOST` | Serveur MySQL OVH (`xxxx.mysql.db`) |
| `MM_DB_NAME` | Nom de la base |
| `MM_DB_USER` | Utilisateur MySQL |
| `MM_DB_PASS` | Mot de passe MySQL |
| `MM_ADMIN_EMAIL` | Votre email : le compte créé avec cette adresse devient administrateur |
| `MM_SITE_URL` | Adresse publique du site, ex. `https://multi-motors.fr/` |
| `MM_MAIL_FROM` | Expéditeur des emails, une adresse de votre domaine OVH |
| `MM_EXPORT_KEY` | Une longue phrase secrète (permet à la tâche quotidienne de récupérer les corrections validées) |
| `MM_GOOGLE_CLIENT_ID` | ID client Google (facultatif) |

Au déploiement, `tools/make_config.py` écrit `api/config.php` à partir de ces secrets (ce fichier n'est jamais dans le dépôt).

### Fonctionnement

- **Comptes** : email + mot de passe (lien de confirmation par email, mot de passe oublié) ou Google.
- **J'aime** et **commentaires** par moteur ; l'onglet « Best-seller » trie par nombre de j'aime.
- **Suggestions de modification** : un membre propose une nouvelle valeur (avec sa source) ; un modérateur la valide (éventuellement corrigée) ou la refuse depuis **#admin**. Validée, elle s'affiche tout de suite sur la fiche (« Corrigé par la communauté ») et la tâche quotidienne l'intègre au catalogue (`tools/community_sync.py`).
- **Panneau d'administration** (`#admin`) : suggestions, commentaires (masquer / supprimer), membres (rôles modérateur / admin, suspension), actualités du site.
- **Prix indicatif et comparateur** : `tools/prices.py` relève les prix dans les boutiques, convertis en euros au taux BCE du jour (prix par moteur pour les lots).
- **Fil d'actualité** (`#actus`) : nouveaux moteurs (rapports quotidiens) et actualités publiées depuis le panneau d'administration.

## Logos des marques

`tools/logos.py` télécharge le logo de chaque marque listée dans `catalogue/logos_sources.json` et le redessine en noir sur fond transparent (`site/assets/logos/`, index dans `site/data/logos.json`). Pour une nouvelle marque, ajoutez son URL de logo au fichier puis lancez `python3 tools/logos.py` (options par marque : `crop` pour recadrer, `mode` `dark` ou `light` pour ne garder que les traits foncés ou clairs). Les marques sans logo gardent leur nom en toutes lettres.
