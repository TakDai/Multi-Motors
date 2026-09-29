# Multi-Motors

Catalogue des moteurs brushless pour drones FPV : [multi-motors.fr](https://multi-motors.fr).

Le catalogue (`catalogue/moteurs.csv`) est mis à jour chaque jour par les outils de `tools/`, lancés par
la tâche GitHub « Recherche quotidienne des nouveaux moteurs » : import du tableau Google communautaire,
moteurs vendus en boutique qui manquent au catalogue, fiches fabricants, compléments des fiches, prix,
photos, vidéos, vérification des liens, classement et actualités (détail plus bas).

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

```bash
git clone https://github.com/TakDai/Multi-Motors.git
cd Multi-Motors
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
```

Chaque outil se lance seul, par exemple `python tools/shop_motors.py --dry-run` (moteurs qui seraient ajoutés,
sans rien écrire) ou `python tools/prices.py --brand EMAX`. L'usage est décrit en tête de chaque fichier.

## Recherche quotidienne et site catalogue

### Catalogue dans le dépôt

Le workflow `.github/workflows/nouveaux-moteurs.yml` s'exécute chaque jour à 06:00 UTC (08:00 à Paris en été) :

1. importe le tableau Google (export xlsx) avec `tools/import_sheet.py` : nouveaux moteurs et valeurs ajoutées dans le tableau ; les lignes aux colonnes décalées sont réalignées (poids, puissance)  ; puis `tools/dedupe.py` fusionne les doublons : une seule écriture par marque (les marques connues sous deux noms sont listées dans `catalogue/marques_alias.json`) et un seul moteur par marque + modèle + KV ;
2. ajoute les moteurs vendus par les boutiques qui manquent au catalogue (`tools/shop_motors.py` : rayon moteurs complet d'une vingtaine de boutiques, dont Drone-FPV-Racer, Studiosport, Drone Doctors, FPV Fly et Team BlackSheep ; marque, modèle, classe et KV reconnus dans chaque produit, caractéristiques lues sur la fiche produit, sources dans `catalogue/ajouts_boutiques.csv`, références refusées dans `catalogue/exclus.txt`) puis lit les fiches fabricants T-Motor (`tools/maker_sheets.py`) ;
3. complète 500 fiches par jour depuis les pages produit des boutiques (`tools/enrich.py`) ;
4. intègre les corrections validées par la communauté (`tools/community_sync.py`) ;
5. relève les prix et les photos dans 21 boutiques (`tools/prices.py`, liste et pays dans `tools/shops.py`) : 400 modèles par jour, les prix les plus anciens d'abord ;
6. vérifie les liens (`tools/links_check.py` : pages produit, photos, pages fabricant et vidéos, chacun une fois par semaine ; un lien mort est remplacé ou retiré), cadre les photos sur le moteur (`tools/photos_frame.py`), calcule le classement Populaire / Nouveauté / Best-seller (`tools/ranking.py`), ajoute des vidéos de review, des photos des sites fabricants (`tools/photos_sites.py`), retire les photos en double (`tools/photos_dedupe.py`, par empreinte visuelle), relève les tableaux de poussée / banc d'essai des fiches produit (`tools/bench.py`, affichés sous la fiche technique avec leur courbe), les miniatures, les logos des nouvelles marques et le fil d'actualité ;
7. uniformise l'écriture des caractéristiques et corrige les fiches mal lues (`tools/normalize.py` : « 150 mm », « 20 AWG », « 5\" », « 16x16 », « 46.8 mΩ », poids aberrants, KV pris pour la taille, doublons) puis commit le tout ; le workflow `ovh-branch.yml` construit alors le site (avec les pages pour Google de `tools/seo_pages.py`) sur la branche `ovh`, que l'hébergement OVH récupère.

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

**Méthode conseillée : association Git (sans identifiants à stocker).** Le workflow `.github/workflows/ovh-branch.yml` construit le site prêt à servir (contenu de `site/` + `data/moteurs.csv`) et le pousse sur la branche **`ovh`** après chaque recherche quotidienne et chaque modification de `Moteurs`. Dans l'espace client OVH : *Web Cloud → Hébergements → Sites internet → Associer Git* sur le dossier de multi-motors.fr (vide au départ), dépôt `https://github.com/TakDai/Multi-Motors`, branche `ovh` ; puis, dans GitHub (*Settings → Webhooks → Add webhook*), coller l'« Url de webhook » donnée par OVH (type `application/json`, évènement *push*). La configuration de la base (`api/config.php`, modèle `api/config.sample.php`) se dépose une seule fois dans le dossier par FTP ou le gestionnaire de fichiers OVH ; elle n'est jamais dans Git.

**Autre méthode : FTP.**

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
- **Profils** : chaque membre a une page publique (`#u/ID`) avec photo ou initiales sur une couleur, présentation, localisation, type de vol, liens (site, YouTube, Instagram), badges gagnés (contributeur, avis, setup partagé…), statistiques, « Mon setup » (jusqu'à 8 moteurs du catalogue), moteurs aimés et derniers avis. La page **Modifier mon profil** (`#profil`) permet aussi de changer de pseudo, d'email ou de mot de passe, de rendre son profil privé, de masquer ses « j'aime » et de supprimer son compte. Les photos sont recadrées et réduites dans le navigateur, puis vérifiées par le serveur (PNG, JPEG ou WebP, 200 Ko au maximum). La table `profiles` est créée automatiquement.
- **Mon espace** (`#moi`) : historique des moteurs consultés (sur l'appareil, et sur le compte une fois connecté), moteurs aimés, « Mes moteurs » (possédés, testés, envies, avec une note perso, affichés aussi sur le profil public) et mes avis. Sur chaque fiche, les boutons « Je le possède / Je l'ai testé / Il me fait envie » et le nombre de pilotes qui l'ont en main.
- **Avis** : note sur 5, qualités et défauts (une par ligne), texte libre ; la note moyenne s'affiche sur la fiche. Tables `garage` et `history` et colonnes `rating`, `pros`, `cons` ajoutées automatiquement.
- **J'aime** et **commentaires** par moteur ; l'onglet « Best-seller » trie par nombre de j'aime.
- **Suggestions de modification** : un membre propose une nouvelle valeur (avec sa source) ; un modérateur la valide (éventuellement corrigée) ou la refuse depuis **#admin**. Validée, elle s'affiche tout de suite sur la fiche (« Corrigé par la communauté ») et la tâche quotidienne l'intègre au catalogue (`tools/community_sync.py`).
- **Panneau d'administration** (`#admin`) : suggestions, commentaires (masquer / supprimer), membres (rôles modérateur / admin, suspension), actualités du site.
- **Prix indicatif et comparateur** : `tools/prices.py` relève les prix dans les boutiques, convertis en euros au taux BCE du jour (prix par moteur pour les lots).
- **Fil d'actualité** (`#actus`) : nouveaux moteurs (rapports quotidiens) et actualités publiées depuis le panneau d'administration.

## Logos des marques

`tools/logos.py` télécharge le logo de chaque marque listée dans `catalogue/logos_sources.json` et le redessine en noir sur fond transparent (`site/assets/logos/`, index dans `site/data/logos.json`). Pour une nouvelle marque, ajoutez son URL de logo au fichier puis lancez `python3 tools/logos.py` (options par marque : `crop` pour recadrer, `mode` `dark` ou `light` pour ne garder que les traits foncés ou clairs). Les marques sans logo gardent leur nom en toutes lettres.
