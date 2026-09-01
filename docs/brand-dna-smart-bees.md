# Brand DNA — Smart Bees (smart-bees.fr)

Mesuré le **2026-09-01** sur **5 pages**. Toutes les valeurs ci-dessous sont lues
sur le site live via `getComputedStyle` / CSSOM / réponses réseau. Les valeurs
marquées ⚠︎ sont inférées et doivent être confirmées avant usage.

**Cible :** UI de l'application ClientChat v2 (`clientchat_v2/`)
**Méthode :** chrome-devtools MCP, mesure des styles calculés à 1440x900 puis 500x844

---

## 1. La marque en un paragraphe

Smart Bees est un **cabinet de conseil Data & Analytics** qui se différencie par
l'exécution : « On ne livre pas seulement des recommandations. On les exécute. »
Cinq expertises (Mesure & Collecte, Data Engineering, CDP, Activation, IA & Data
Science), une seule équipe, un seul interlocuteur. Clients : Galeries Lafayette,
Aroma-Zone, Pennylane, Ornikar, Parfums de Marly. Le discours est celui de
praticiens, pas de vendeurs : « Vous parlez aux experts qui exécutent. »

**Conséquence design.** Le site est *clair, technique et chaleureux à la fois* :
fond blanc et bleu glacé, texture « blueprint » (grille de plan technique),
typographie géométrique très serrée, et un orange saturé utilisé avec parcimonie
comme unique signal d'action. La métaphore apicole (hexagone, ruche, alvéole)
est le marqueur formel omniprésent. Densité moyenne-haute, jamais tassée :
sections à 64px, cartes à 24-32px de padding. Rien de corporate froid, rien de
startup criard.

## 2. Voix & wording

| Trait | Observé | Preuve |
|---|---|---|
| Style de titre | Phrases déclaratives courtes, **point final assumé** | « Menées de bout en bout », « De la collecte de la donnée à l'IA » |
| Personne | « on » / « nous » pour Smart Bees, « vous » pour le client | « On ne livre pas… », « vos équipes en interne prennent le relais » |
| Casse | Sentence case partout ; ALL CAPS **uniquement** en eyebrow | `text-transform` : none ×476, uppercase ×77, lowercase ×5 |
| Registre | Technique et direct, chiffré, sans jargon commercial | « Recruter un profil expert data prend 12 à 18 mois » |
| Métaphore | Ruche / alvéole, utilisée sobrement | « Une ruche, cinq alvéoles, un seul interlocuteur. » |

Titres verbatim (mesurés) :

- h1 · « Une équipe data opérationnelle en quelques semaines. »
- h2 · « On ne livre pas seulement des recommandations. On les exécute. »
- h2 · « Une ruche, cinq alvéoles, un seul interlocuteur. »
- h2 · « Vous parlez aux experts qui exécutent »
- h2 · « Trois temps, et des résultats visibles dès les premières semaines »
- h3 · « Comment fiabiliser le tracking de votre site ? »

**Pour ClientChat :** les libellés d'UI doivent suivre cette voix — sentence case,
verbe à l'infinitif ou impératif, pas de ALL CAPS sauf pour les eyebrows de
section. « Ajouter une tâche », pas « AJOUTER UNE TÂCHE ».

## 3. Palette (mesurée)

Classée par surface rendue (fonds) ou par caractères rendus (texte).
`pages` = sur combien des 5 pages mesurées la valeur apparaît.

### Cœur de marque

| Hex | Rôle | Poids mesuré | Pages | Vu sur |
|---|---|---|---|---|
| `#264653` | **Encre / navy de marque** — texte principal, footer, hexagone du logo | texte : 7 399 car. (rang 1) ; fond : 3 596 760 px² | 5/5 | `nav a.sbs-brand`, `div.white-footer`, `span.sbs-bhex`, tous les titres |
| `#FF9E00` | **Orange d'action** — CTA primaire, hexagones numérotés, soulignement | fond : 336 855 px² ; texte : 164 car. | 5/5 | `a.sbs-btn-1`, `div.sbx-qhex-1`, `span.sbo-logoem` |
| `#FFFFFF` | Surface / carte / nav | 46 938 362 px² (rang 1 fonds) | 5/5 | `div.sbs-page`, `div.sbp-card`, `nav.sbs-nav` |
| `#F4F9FD` | **Bleu glacé** — fond de section alternée, hero, surfaces creusées | 18 892 087 px² (rang 2 fonds) | 5/5 | `div.sbs-hero`, `section.sbs-sec-alt`, `div.sbx-bitem` |

### Accents secondaires

| Hex | Rôle | Poids | Pages | Vu sur |
|---|---|---|---|---|
| `#85C4FF` | Bleu ciel — hexagone décoratif, jalon 2 | 10 751 px² | 2/5 | `div.sbo-xn2`, `span.sbs-hx-2` ; **déclaré `--royal-blue`** |
| `#BDE0FE` | Bleu pâle — barre de donnée, surlignage bleu | 100 798 px² | 1/5 | `div.sbx-bar-a`, `span.sbx-hl-b` |
| `#FE6D73` | Corail — hexagone décoratif, jalon 4 | 10 751 px² | 2/5 | `div.sbo-xn4`, `span.sbs-hx-4` |
| `#5EC045` | Vert — statut « recetté » | pill à 15% | 1/5 | **déclaré `--lime-green`** |
| `#B75DDA` | Orchidée | non rendu à l'écran | 5/5 | **déclaré `--medium-orchid`** (token seulement) |
| `#FFF3DF` | Crème chaude — surlignage jaune, barre | 71 445 px² | 1/5 | `div.sbx-bar-c`, `span.sbx-hl` |
| `#F1EFEA` | Sable — bouton tertiaire | 10 089 px² | 1/5 | `a.sbs-btn-2` |

### Neutres (rampe complète mesurée)

| Hex | Rôle | Poids | Pages | Vu sur |
|---|---|---|---|---|
| `#264653` | texte primaire | 7 399 car. | 5/5 | titres, nav, liens |
| `#4A5B63` | **texte courant / lede** | 4 639 car. | 5/5 | `p.sbs-herop`, `p.sbp-p` |
| `#5C7079` | texte courant alternatif | 5 131 car. | 2/5 | `p.sbo-rp`, `p.sbx-lede` |
| `#77878E` | **texte tertiaire / eyebrow** | 1 658 car. | 5/5 | `div.sbp-eyebrow`, `div.sbp-crumb` |
| `#8FA3AC` | texte quaternaire / méta | 735 car. | 2/5 | `div.sbo-fdur`, `div.sbx-qlab` |
| `#DCE6EC` | bordure de champ de formulaire | 1 894 | 1/5 | `input.sbs-input` |
| `#E6EDF1` | **bordure de carte** | 10 508 | 4/5 | `div.sbp-card`, `div.sbs-panel` |
| `#EDF3F8` / `#EFF4F7` | surface creusée (image, viz) | 179 316 / 161 470 px² | 2/5 | `img.sbp-caseimg`, `div.sbs-cardviz` |
| `#FBFDFE` | fond de champ de saisie | 116 924 px² | 1/5 | `input.sbs-input`, `textarea` |
| `rgba(38,70,83,0.13)` | bordure d'élément interactif | 41 424 | 2/5 | `a.sbo-xrow`, `div.sbx-bitem` |
| `rgba(38,70,83,0.16)` | anneau inset (= bordure du bouton secondaire, nav) | 29 occurrences | 5/5 | `a.sbs-btn-3`, `nav.sbs-nav` |

### Sémantique (mesurée sur les pills)

| Rôle | Fond | Texte | Vu sur |
|---|---|---|---|
| succès | `rgba(94,192,69,0.15)` | `#3C8B2B` | `span.sbx-pill` « recetté » |
| en cours / warning | `rgba(255,158,0,0.18)` | `#A96900` | `span.sbx-pill-w` « en recette » |

### Dégradés & textures mesurés

```css
/* « Blueprint » — LA texture de marque, sur .sbs-blueprint (5/5 pages) */
background-image:
  radial-gradient(circle, rgb(207,222,232) 1.4px, rgba(0,0,0,0) 1.6px),
  linear-gradient(rgb(227,237,244) 1px, rgba(0,0,0,0) 1px),
  linear-gradient(90deg, rgb(227,237,244) 1px, rgba(0,0,0,0) 1px);
background-size: 44px 44px, 44px 44px, 44px 44px;
```

```css
/* Halo radial derrière le hero (5/5 pages) */
radial-gradient(circle, rgb(207,222,232) …)
/* Barre de données horizontale (offre-detail) */
linear-gradient(90deg, rgba(38,70,83,0.13) …)
```

### Exclu comme incident

Écartés du système : `#0A66C2` (bouton LinkedIn), et toutes les couleurs des
logos clients de la bande « Ils nous confient leur donnée » (Galeries Lafayette,
Aroma-Zone, Pennylane, Ornikar, Parfums de Marly, 900.care, Alltricks, Ubiq,
Les Mini Mondes, Côté Sushi, Propriétés Privées) ainsi que des logos partenaires
(GA4, dbt, Segment, Looker Studio, Claude). `#424549` est le fond du `<body>`
Webflow *derrière* le conteneur de page — jamais visible : à ne pas reprendre.
`#222222` est le gris par défaut Webflow du toggle de menu déroulant, non
intentionnel.

### Tokens déclarés par la marque (verbatim, 5/5 pages)

```css
--royal-blue: #85c4ff;
--lime-green: #5ec045;
--medium-orchid: #b75dda;
```

C'est le seul nommage explicite exposé par le site. Le navy et l'orange ne sont
pas déclarés en variables — ils sont écrits en dur dans les classes Webflow.

### Contraste

| Paire | Ratio (WCAG 2.1, calculé) | Verdict |
|---|---|---|
| `#264653` sur `#FFFFFF` | 10,08:1 | ✅ AAA |
| `#264653` sur `#F4F9FD` | 9,51:1 | ✅ AAA |
| `#4A5B63` sur `#FFFFFF` | 7,08:1 | ✅ AAA |
| `#4A5B63` sur `#F4F9FD` | 6,68:1 | ✅ AAA |
| `#5C7079` sur `#FFFFFF` | 5,19:1 | ✅ AA |
| `#5C7079` sur `#F4F9FD` | 4,89:1 | ✅ AA |
| `#77878E` sur `#FFFFFF` | 3,72:1 | ⚠️ **échoue AA en texte courant** — acceptable en eyebrow 11px/700 uppercase, à ne pas utiliser pour du texte lu |
| `#8FA3AC` sur `#FFFFFF` | 2,62:1 | ⚠️ **échoue** — décoratif uniquement |
| `#264653` sur `#FF9E00` | 4,87:1 | ✅ AA — c'est bien du **navy sur orange**, jamais du blanc |
| `#FFFFFF` sur `#FF9E00` | 2,07:1 | ❌ à ne jamais faire (le site ne le fait pas) |

**Divergence recommandée pour ClientChat :** le site descend jusqu'à `#77878E`
(3,72:1) et `#8FA3AC` (2,62:1) pour ses labels. Dans ClientChat, `--tx3` porte des
horodatages et des compteurs qu'on lit vraiment : utiliser **`#5C7079`** — lui
aussi mesuré sur le site (5 131 caractères, 2/5 pages) et conforme AA — et
réserver `#77878E`/`#8FA3AC` aux eyebrows et au décoratif. Voir §11.

## 4. Typographie

### Familles réelles (réseau)

| Famille | Fichiers chargés | Usage mesuré |
|---|---|---|
| **Montserrat** | `fonts.gstatic.com/s/montserrat/v31/JTUQjIg1…woff2`, `JTUSjIg1…woff2` | Titres h1-h6, eyebrows, hexagones numérotés — 257 éléments, 5/5 pages |
| **Raleway** | `fonts.gstatic.com/s/raleway/v37/1Ptug8zYS_SKggPNyC0IT4ttDfA.woff2` | Corps, liens, boutons, pills — 297 éléments, 5/5 pages |
| **Source Sans Pro** | 4 woff2 chargés | Déclaré sur `<body>` mais **systématiquement surchargé** par les classes ; ne rend nulle part visiblement. ⚠︎ à ignorer. |
| **JetBrains Mono** | non chargé en woff2 (fallback système) | Code / noms d'événements — 4 éléments, page offre-detail |
| `webflow-icons` | data-URI TTF | Icônes de chevron Webflow, non transférable |

Toutes en **woff2 depuis Google Fonts** → librement utilisables dans ClientChat.

Stack de repli verbatim : `Montserrat, sans-serif` · `Raleway, sans-serif` ·
`"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace`

### Rôles mesurés (1440px)

| Rôle | Famille | Taille | Graisse | Interligne | Tracking | Notes |
|---|---|---|---|---|---|---|
| h1 | Montserrat | 56px | 700 | 61,6px (1,10) | −1,96px (**−0,035em**) | 3/5 pages ; variantes 54px et 44px |
| h2 | Montserrat | 44px | 700 | 49,28px (1,12) | −1,32px (−0,03em) | 10 occ., 3/5 pages |
| h2 (dense) | Montserrat | 38px | 800 | 40,28px (1,06) | −1,52px (−0,04em) | 10 occ., 2/5 pages |
| h3 | Montserrat | 19px | 700 | 25,65px (1,35) | −0,38px (−0,02em) | 9 occ. |
| h3 (dense) | Montserrat | 20px | 800 | 24px (1,20) | −0,60px (−0,03em) | 5 occ. |
| lede | Raleway | 17,5px | 400 | 28px (1,60) | 0 | `.sbs-lede`, 4 occ. |
| lede hero | Raleway | 18px | 400 | 29,16px (1,62) | 0 | `.sbs-herop` |
| corps | Raleway | 15px | 400 | 30px (2,00) | 0 | 50 occ. sur liens, 5/5 pages |
| corps compact | Raleway | 14px / 14,5px | 400 | 21,7px / 22,5px (1,55) | 0 / −0,005em | 17 occ. |
| lien fort | Raleway | 14,5px | 600 | 23px (1,59) | 0 | 12 occ., 3/5 |
| bouton | Montserrat | 16px | 600 | 23px | −0,16px (−0,01em) | 5/5 pages |
| eyebrow | Montserrat | **11px** | 700 | 23px | **+1,76px (+0,16em)** | uppercase, 3/5 pages |
| eyebrow (large) | Montserrat | **13px** | 700 | 23px | **+1,04px (+0,08em)** | uppercase, 30 occ., 5/5 pages |
| accroche soulignée | Raleway | 16px | 800 | — | −0,16px | + soulignement orange inset 4px |
| pill | Raleway | 10,5px | 800 | — | +0,21px (+0,02em) | 5 occ. |
| mono | JetBrains Mono | 12,5px | 600 | — | 0 | `span.sbx-pcode` |
| hexagone numéroté | Montserrat | 12px | 700 | — | +0,24px (+0,02em) | `.sbx-qhex-1` |

### Décalages responsive (mesurés à 500px)

| Rôle | 1440px | 500px | Ratio |
|---|---|---|---|
| h1 | 56px / −1,96px | **34px / −1,19px** | ×0,61 |
| h2 | 44px / −1,32px | **28px / −0,84px** | ×0,64 |
| lede | 17,5px | 17,5px | inchangé |
| bouton | 16px, pad 15px 26px | 16px, pad 15px 26px | inchangé |
| eyebrow | 11px / +1,76px | 11px / +1,76px | inchangé |

Le tracking négatif est **proportionnel** (−0,035em constant), pas absolu.

### Échelle typographique

`10,5 · 11 · 12 · 12,5 · 13 · 13,5 · 14 · 14,5 · 15 · 16 · 17,5 · 18 · 19 · 20 · 21 · 24 · 26 · 34 · 38 · 40 · 44 · 54 · 56`

Pas de ratio modulaire propre : l'échelle est **dessinée à la main**, dense entre
10 et 20px (l'UI) puis saute brutalement au-dessus de 24px (l'éditorial). C'est
exactement le profil dont une application a besoin.

**Règle de marque à retenir :** *Montserrat serré pour tout ce qui structure
(titres, labels, boutons, chiffres), Raleway pour tout ce qui se lit.*

## 5. Espace & rythme

### Échelle (occurrences mesurées, 5 pages)

`18px` ×117 · `10px` ×104 · `22px` ×78 · `26px` ×70 · `20px` ×59 · `64px` ×52 ·
`8px` ×50 · `40px` ×50 · `15px` ×45 · `32px` ×34 · `4px` ×33 · `24px` ×26 ·
`28px` ×26 · `14px` ×21 · `16px` ×20

**Base implicite : 2px, avec un rythme dominant pair non-8.** Le site n'est pas
sur une grille de 8 : les valeurs de tête sont 18, 10, 22, 26. C'est une échelle
hand-tuned Webflow. Pour ClientChat, voir la divergence recommandée en §11.

### Gaps flex/grid

`9px` ×42 · `12px` ×34 · `14px` ×21 · `11px` ×21 · `20px` ×18 · `16px` ×10 ·
`56px` ×9 · `8px` ×9 · `24px` ×8 · `32px` ×6

### Largeurs de conteneur

`1200px` ×35 (5/5 pages) — **la mesure de contenu de la marque**.
Puis `760px` (colonne de lecture, 2/5) et `572,8px` (demi-colonne calculée).

### Rythme vertical (padding des sections, homepage)

| Section | Padding vertical | Fond |
|---|---|---|
| `.sbs-hero` | `84px 0 56px` | `#F4F9FD` |
| `.sbs-heroband` | `26px 0 30px` | `#FFFFFF` |
| `.sbs-sec` | `64px 0` | transparent (blanc) |
| `.sbs-sec-alt` | `64px 0` | `#F4F9FD` |
| `.sbs-sec.is-feature` | `96px 0` | transparent |
| `.sbs-sec.is-tight` | `52px 0` | transparent |
| `.sbs-end` | `84px 0 92px` | `#F4F9FD` |

À 500px : hero `48px 0 40px`, sections `44px 0` (×0,69).

**Verdict de densité : standard-aéré.** 64px entre sections sur une page de
5 516px, cartes à 26-32px de padding interne, gaps de 9-14px à l'intérieur des
composants. La respiration est dans les sections, pas dans les composants — ce
qui se transpose parfaitement à une UI dense comme ClientChat.

L'alternance de fond `#FFFFFF` / `#F4F9FD` d'une section à l'autre est le
**mécanisme principal de séparation** de la page — plus que les bordures.

## 6. Surface & profondeur

### Rayons (occurrences mesurées)

| Valeur | Occ. | Pages | Rôle mesuré |
|---|---|---|---|
| `3px` | 75 | 5/5 | reset global des `<img>` — décoratif, pas un token |
| `99px` | 38 | 2/5 | **pills / badges** |
| `4px` | 25 | 5/5 | **boutons** (`.sbs-btn-1/2/3`) |
| `8px` | 21 | 3/5 | **petite carte** (`.sbs-card`, `.sbs-acard`) |
| `6px` | 15 | 2/5 | **champs de saisie** |
| `20px` | 16 | 3/5 | **carte interactive / ligne d'offre** |
| `22px` | — | 2/5 | carte de feature |
| `24px` | 7 | 4/5 | **grand panneau** (`.sbs-panel`, `.sbp-card`) |
| `14px` | 15 | 1/5 | menu déroulant de nav |
| `13px` / `16px` | 12 / — | 1/5 | puce de liste, carte device |

**Règle : 4px contrôles · 6px champs · 8px petites cartes · 20-24px panneaux ·
99px pills.** Les contrôles sont nets, les surfaces sont douces. C'est
l'inverse de la convention SaaS habituelle et c'est ce qui donne au site son
caractère « plan technique ».

### Ombres (valeurs complètes mesurées)

```css
/* E0 — anneau : LE séparateur par défaut. 29 occ., 5/5 pages */
box-shadow: rgba(38,70,83,0.16) 0 0 0 1px inset;

/* E1 — élévation de panneau. 8 occ., 5/5 pages */
box-shadow: rgba(38,70,83,0.08) 0 4px 20px 0, rgba(38,70,83,0.04) 0 1px 4px 0;

/* E2 — menu déroulant de nav. 1 occ. */
box-shadow: rgba(38,70,83,0.14) 0 12px 32px 0, rgba(38,70,83,0.06) 0 2px 6px 0;

/* SIGNATURE — décalage dur, sans flou. 23 occ., 2/5 pages */
box-shadow: rgba(38,70,83,0.13) 4px 4px 0 0;
box-shadow: rgba(38,70,83,0.11) 2px 2px 0 0;   /* variante compacte, 15 occ. */

/* SIGNATURE — soulignement orange inset. 12 occ., 2/5 pages */
box-shadow: rgb(255,158,0) 0 -4px 0 0 inset;
```

### Bordures

`1px solid #E6EDF1` (cartes, 4/5) · `1px solid rgba(38,70,83,0.13)` (interactif,
2/5) · `1px solid #DCE6EC` (champs) · `1.5px solid rgba(38,70,83,0.28)` (slot vide)
· `1px solid rgba(38,70,83,0.16)` (barre de nav, bas).

**Réponse principale : la marque sépare par l'anneau inset et le changement de
fond, pas par l'ombre portée.** L'ombre est réservée aux panneaux qui doivent
flotter, et le décalage dur `4px 4px 0` aux éléments cliquables qui doivent
signaler « appuie-moi ». C'est le geste le plus caractéristique du système.

## 7. Recettes de composants

```
Bouton primaire — .sbs-btn-1, mesuré sur 5/5 pages
background : #FF9E00
color      : #264653          ← navy sur orange, jamais blanc
padding    : 15px 26px
radius     : 4px
font       : Montserrat 16px / 600 / -0.16px / none
border     : none
shadow     : none
transition : 0.16s ease
rendered   : 274x53 (hero) · 211x50 (section)
label      : « Échanger avec un expert → » — flèche → collée au libellé
```

```
Bouton secondaire — .sbs-btn-3, mesuré sur 5/5 pages
background : #FFFFFF
color      : #264653
padding    : 15px 26px
radius     : 4px
font       : Montserrat 16px / 600 / -0.16px / none
border     : none
shadow     : rgba(38,70,83,0.16) 0 0 0 1px inset   ← l'anneau tient lieu de bordure
transition : 0.16s ease
rendered   : 215x53
```

```
Bouton tertiaire — .sbs-btn-2, mesuré sur home
background : #F1EFEA          ← sable chaud
color      : #264653
padding    : 11px 20px
radius     : 4px
font       : Montserrat 14.5px / 600 / -0.145px
shadow     : none
rendered   : 224x45
```

```
Panneau — .sbs-panel / .sbp-card, mesuré sur 4/5 pages
background : #FFFFFF
border     : 1px solid #E6EDF1
radius     : 24px
padding    : 32px  (26px 28px en variante carte)
shadow     : rgba(38,70,83,0.08) 0 4px 20px 0, rgba(38,70,83,0.04) 0 1px 4px 0
```

```
Carte / ligne interactive — .sbo-xrow, mesuré sur offres
background : #FFFFFF
border     : 1px solid rgba(38,70,83,0.13)
radius     : 20px
padding    : 22px 24px
shadow     : rgba(38,70,83,0.13) 4px 4px 0 0     ← décalage dur : « cliquable »
transition : 0.18s ease
rendered   : 900x144
```

```
Petite carte — .sbs-card / .sbs-acard, mesuré sur home
background : #FFFFFF
border     : none
radius     : 8px
padding    : 16px   (28px 28px 24px en variante .sbs-acard)
shadow     : rgba(38,70,83,0.16) 0 0 0 1px inset
```

```
Champ de saisie — input.sbs-input / textarea, mesuré sur contact
background : #FBFDFE          ← quasi blanc, très légèrement bleuté
color      : #264653
border     : 1px solid #DCE6EC
radius     : 6px
padding    : 10px 14px  (12px 14px en textarea)
font       : Raleway 15px / 400
height     : 46px
```

```
Pill / badge — .sbx-pill, mesuré sur offre-detail
background : rgba(<accent>, 0.15)     ex. rgba(94,192,69,0.15)
color      : <accent assombri>        ex. #3C8B2B
radius     : 99px
padding    : ~3px 10px  (rendu 58x21)
font       : Raleway 10.5px / 800 / +0.21px
```

```
Barre de nav — nav.sbs-nav, mesuré sur 5/5 pages
background   : #FFFFFF
height       : 67px
border-bottom: 1px solid rgba(38,70,83,0.16)
shadow       : none
color        : #264653
lien         : Raleway 15px / 400  (16px / 600 pour le lien actif/CTA)
marque       : <span class="sbs-bhex"></span> + « Smart Bees »
               hexagone 18x16, bg #264653, Montserrat 17px / 700 / -0.51px
```

```
Menu déroulant — .sbs-ddlist
background : #FFFFFF
radius     : 14px
shadow     : rgba(38,70,83,0.14) 0 12px 32px 0, rgba(38,70,83,0.06) 0 2px 6px 0
```

```
Eyebrow de section — .sbs-eyebrow / .sbp-eyebrow, 5/5 pages
color          : #77878E
font           : Montserrat 11px / 700 / +1.76px  (variante 13px / +1.04px)
text-transform : uppercase
préfixe        : petit hexagone navy en puce (hero)
```

```
Accroche soulignée — .sbx-eyebrow, 8 occ. sur offre-detail
color   : #264653
font    : Raleway 16px / 800 / -0.16px
shadow  : rgb(255,158,0) 0 -4px 0 0 inset    ← soulignement orange plein de 4px
rendered: hauteur 24px
```

```
Hexagone numéroté — .sbx-qhex-1
clip-path  : polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)
background : #FF9E00
color      : #264653
font       : Montserrat 12px / 700 / +0.24px
size       : 40x35
```

```
Pied de page — .white-footer, 5/5 pages
background : #264653
padding    : 40px 0 24px
titre col. : #FFFFFF
lien       : rgba(255,255,255,0.62)
séparateur : 1px solid rgba(255,255,255,0.12)
accent     : #FF9E00 sur « MAYIA° » et le nom de marque
```

## 8. Créa & imagerie

- **Mix :** illustration vectorielle (hexagones, fleurs stylisées) + photographie
  documentaire (portraits d'équipe) + captures produit (dashboards, consoles).
  Aucun rendu 3D, aucune banque d'images générique.
- **Traitement :** portraits en `object-fit: cover`, cadrés **344×372 (ratio 0,93,
  quasi carré légèrement portrait)**, 5 personnes, page équipe. Captures produit
  en 560×315 (16:9) avec rayon `20px 0 0 20px` — arrondi seulement du côté qui
  jouxte le texte, l'image sort de la carte à droite.
- **Ratios réellement utilisés :** 0,93 (portrait), 1,78 (16:9 capture), 1,33 (4:3
  photo d'équipe), 0,96 et 0,73 pour les illustrations « fleur ».
- **Iconographie :** SVG inline, `viewBox="0 0 24 24"`, `fill: none`,
  `stroke: #264653`, **`stroke-width: 1.6`**, `stroke-linecap: round`,
  `stroke-linejoin: round`. 20 icônes sur la page offre-detail.
  ⚠️ **1,6 et non 2** — c'est nettement plus fin que le défaut de lucide-react.
- **Devices signatures** (à nommer, car c'est ce qui fait « Smart Bees » et pas
  « SaaS propre générique ») :
  1. **L'hexagone.** `clip-path: polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)`. Du hexagone de 18px du logo aux clusters de 300px qui débordent hors du hero. Toujours pointes gauche/droite (pas pointe en haut).
  2. **La grille blueprint.** Points de 1,4px `#CFDEE8` + lignes de 1px `#E3EDF4`, pas de 44px. Papier millimétré d'ingénieur — le fond de tout le site.
  3. **Le surligneur orange.** Bloc `#FF9E00` plein derrière les mots-clés du h1, texte navy par-dessus. Un feutre passé sur un mot.
  4. **Le décalage dur.** `4px 4px 0` sans flou sur les blocs cliquables.
  5. **Le soulignement orange inset.** `0 -4px 0 inset` sous les accroches.
  6. **La numérotation.** `01`…`05` en hexagone orange devant chaque expertise.
- **Composition :** conteneur 1200px centré, titres et lede **centrés** dans le
  hero et les en-têtes de section, contenu **aligné à gauche** dans les cartes.
  Asymétrie assumée par les clusters d'hexagones qui débordent en haut à droite
  et en bas à gauche du hero.

**Ce qui se transpose à ClientChat :** hexagone, grille blueprint (en fond de zone
vide / écran de connexion), surligneur orange (sur un mot d'un titre d'accueil),
décalage dur (sur les cartes de tâche au survol), soulignement orange inset (sur
l'onglet actif), icônes à stroke 1,6, numérotation hexagonale.

**Ce qui ne se transpose pas :** les clusters d'hexagones de 300px (ils mangeraient
une UI dense), la centrage des titres (une app se lit à gauche), les photos
plein cadre.

## 9. Motion

| Durée + easing | Occ. | Pages | Usage |
|---|---|---|---|
| `0.16s ease` | 38 | 5/5 | **boutons** — la valeur par défaut de la marque |
| `0.2s ease` | 56 | 5/5 | liens de nav, éléments de texte |
| `0.18s ease` | 24 | 2/5 | cartes / lignes interactives |
| `0.22s ease` | 4 | 1/5 | grandes surfaces |
| `0.3s ease` | 3 | 1/5 | rares, révélations |

Keyframes déclarées : `spin` (5/5, spinner de chargement Webflow) et
`sbsSlide` (home uniquement, glissement du bandeau de logos clients).

**Toutes les transitions sont en `ease` simple** — aucun cubic-bezier
personnalisé sur tout le site. Pas de scroll-behavior custom mesuré.

**Transférable à ClientChat :** intégralement. Adopter `0.16s ease` comme durée
d'interaction par défaut et `0.18s ease` pour les cartes.

## 10. Analyse d'écart vs ClientChat

| Élément | Valeur actuelle ClientChat | Valeur de marque mesurée | Verdict | Où changer |
|---|---|---|---|---|
| Navy de marque | `#193644` | **`#264653`** | **wrong** — 2 couleurs distinctes, pas un arrondi | `src/index.css:24`, `tailwind.config.js:16` |
| Orange de marque | `#F89B1C` | **`#FF9E00`** | **wrong** | `src/index.css:25`, `tailwind.config.js:17` |
| Corail | `#FF6772` | **`#FE6D73`** | drifting | `src/index.css:26`, `tailwind.config.js:18` |
| Bleu clair | `#C2E2F5` | **`#BDE0FE`** | drifting | `src/index.css:27`, `tailwind.config.js:19` |
| Bleu moyen | `#00779B` | **absent du site** — le bleu de marque est `#85C4FF` | **wrong** | `src/index.css:28`, `tailwind.config.js:20` |
| Fond d'app | `#F2F4F6` (gris neutre) | **`#F4F9FD`** (bleu glacé) | **wrong** — le gris tue la fraîcheur de la marque | `src/index.css:30` |
| Surface 2 | `#EEF1F4` | `#EDF3F8` / `#EFF4F7` | drifting | `src/index.css:32` |
| Surface 3 | `#E4E8EC` | `#E6EDF1` | drifting | `src/index.css:33` |
| Bordure | `rgba(25,54,68,0.09)` | `rgba(38,70,83,0.13)` et `#E6EDF1` | drifting (base navy fausse) | `src/index.css:35-36` |
| Texte primaire | `#193644` | **`#264653`** | wrong | `src/index.css:38` |
| Texte secondaire | `#4E6A78` | **`#4A5B63`** | drifting | `src/index.css:39` |
| Texte tertiaire | `#8AA0AB` (2,4:1, échoue AA) | **`#5C7079`** (5,19:1) | **wrong** | `src/index.css:40` |
| Police de titre | DM Sans (une seule famille) | **Montserrat 700/800, tracking −0,035em** | **absent** — la marque est bi-typo | `tailwind.config.js:23`, `src/index.css` (toutes les règles `font-size`) |
| Police de corps | DM Sans | **Raleway 400/600/800** | **absent** | `tailwind.config.js:23` |
| Police mono | DM Mono | **JetBrains Mono** | drifting | `tailwind.config.js:24`, `src/index.css:382,1057,1182` |
| Rayon contrôle | `--rs: 8px` | **4px** (boutons), 6px (champs) | **wrong** — trop mou | `src/index.css:57` |
| Rayon carte | `--r: 12px` | **8px** petite carte, **20-24px** panneau | drifting | `src/index.css:56` |
| Pills | pas de token, `border-radius: 10px` en dur | **99px** | drifting | `src/index.css:903` |
| CTA primaire (clair) | `.btn` navy `#193644` + texte blanc | navy `#264653` + blanc — variante `.sbj-cta` du site | aligned (intention) / drifting (valeur) | `src/index.css:753-758` |
| CTA primaire (sombre) | `.btn` orange + **texte blanc hérité** → 2,07:1 | orange `#FF9E00` + **texte navy `#264653`** → 4,87:1 | **wrong** | `src/index.css:760`, `:517` (`.send`) |
| Bouton secondaire | fond `--sur2`, bordure | fond blanc + **anneau inset** `rgba(38,70,83,0.16) 0 0 0 1px` | drifting | `src/index.css:768` |
| Ombre de carte | aucune ombre systématique | E0 anneau / E1 panneau / décalage dur | **absent** | `src/index.css` (pas de token d'élévation) |
| Eyebrow / label | `text-transform: uppercase` sans tracking (`:1046`) | Montserrat 11px/700 **+0,16em** | drifting | `src/index.css:1046,832,926` |
| Grille blueprint | **absente** | texture de marque, 5/5 pages | **absent** | à créer |
| Hexagone | présent (`.ws-hex`, `:1142-1151`) mais en `border-radius`, pas en clip-path | `clip-path: polygon(25% 0%…)` | drifting | `src/index.css:1143` |
| Soulignement orange | absent | `0 -4px 0 inset` sur onglet/accroche | **absent** | `src/index.css:807` (`.stab`) |
| Icônes | lucide-react, stroke 2 par défaut | **stroke 1,6** | drifting | composants `.jsx` (prop `strokeWidth`) |
| Transitions | `.15s` ad hoc | **0,16s ease** contrôles, **0,18s ease** cartes | drifting | `src/index.css` (multiples) |

## 11. Recommandations, classées par impact

1. **Corriger les 5 couleurs de marque en dur.** `--sb-navy` `#193644`→**`#264653`**,
   `--sb-orange` `#F89B1C`→**`#FF9E00`**, `--sb-coral` `#FF6772`→**`#FE6D73`**,
   `--sb-blue-lt` `#C2E2F5`→**`#BDE0FE`**, et remplacer `--sb-blue-md` `#00779B`
   (inexistant sur le site) par **`#85C4FF`** (token déclaré `--royal-blue`) dans
   `src/index.css:24-28` et `tailwind.config.js:16-20`. C'est le correctif le plus
   rentable : cinq lignes, et toute l'application bascule sur les vraies couleurs.

2. **Passer en bi-typographie Montserrat + Raleway.** Aujourd'hui tout est en
   DM Sans, ce qui rend l'outil anonyme. Charger Montserrat (600/700/800) et
   Raleway (400/600/700/800) depuis Google Fonts, mapper `font-sans: Raleway`
   et ajouter `font-display: Montserrat` dans `tailwind.config.js:22-25`, puis
   passer tous les titres, labels, boutons et chiffres en Montserrat avec
   `letter-spacing: -0.02em` (−0,035em au-delà de 32px). Deuxième plus gros effet
   visuel après la couleur.

3. **Corriger le CTA orange en mode sombre.** `src/index.css:760`
   (`[data-theme="dark"] .btn`) et `:517` (`[data-theme="dark"] .send`) passent le
   fond en orange **sans redéfinir la couleur du texte**, qui reste le `#fff`
   hérité de `.btn` → **2,07:1, illisible**. Le site met systématiquement du navy
   sur l'orange (`.sbs-btn-1`, `color: #264653`, mesuré 5/5 pages, **4,87:1**).
   Ajouter `color: var(--sb-navy)` sur ces deux règles : conforme AA *et* conforme
   à la DA. En mode clair le CTA navy à texte blanc est légitime — le site a la
   même variante (`.sbj-cta`, bg `#264653`, texte `#FFFFFF`).

4. **Remplacer le fond gris par le bleu glacé.** `--bg: #F2F4F6` →
   **`#F4F9FD`** (`src/index.css:30`). Le gris neutre est ce qui fait le plus
   « template » dans l'outil actuel ; `#F4F9FD` est le 2ᵉ fond du site par surface
   (18,9 M px², 5/5 pages) et c'est lui qui donne la fraîcheur de la marque.

5. **Durcir les rayons de contrôle.** `--rs: 8px` → **`4px`** (`src/index.css:57`)
   pour boutons et petits contrôles, ajouter `--r-input: 6px`, garder
   `--r: 12px` pour les cartes internes et introduire `--r-panel: 20px` pour les
   modales et panneaux. La marque est nette sur les contrôles et douce sur les
   surfaces — l'outil fait aujourd'hui l'inverse.

6. **Introduire les 3 niveaux d'élévation mesurés.** Aucun n'existe aujourd'hui :
   `--e0: rgba(38,70,83,.16) 0 0 0 1px inset` (séparateur par défaut),
   `--e1: rgba(38,70,83,.08) 0 4px 20px, rgba(38,70,83,.04) 0 1px 4px` (modales,
   panneaux), `--e2: rgba(38,70,83,.14) 0 12px 32px, rgba(38,70,83,.06) 0 2px 6px`
   (menus). C'est ce qui manque pour que les modales de `src/components/shared/Modal.jsx`
   arrêtent de flotter sans logique.

7. **Poser la grille blueprint sur les zones vides.** Le fond
   `radial-gradient(circle, #CFDEE8 1.4px, transparent 1.6px) 44px 44px` + les deux
   `linear-gradient` `#E3EDF4` (§3) sur l'écran de connexion
   (`src/components/auth/LoginScreen.jsx`) et l'état vide
   (`.welcome-state`, `src/index.css:1137`). Un fond, zéro coût, et l'outil est
   immédiatement identifiable comme Smart Bees.

8. **Passer les hexagones en `clip-path`.** `.ws-hex` (`src/index.css:1143`)
   utilise aujourd'hui un `border-radius` : remplacer par le clip-path exact
   `polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)`, pointes à
   gauche/droite comme sur le site. Ajouter le même hexagone 14px devant le
   wordmark dans `src/components/layout/Sidebar.jsx` (`.sb-brand`, `:143`).

9. **Ajouter le soulignement orange inset sur l'onglet actif.**
   `box-shadow: #FF9E00 0 -4px 0 inset` sur `.stab.on` (`src/index.css:807`) et
   sur l'élément de sidebar actif — ça remplace avantageusement le
   `border-left` orange actuel et c'est un geste que le site utilise 12 fois.

10. **Aligner les timings.** Remplacer les `.15s` ad hoc par **`0.16s ease`**
    (contrôles) et **`0.18s ease`** (cartes) — les deux seules valeurs que la
    marque utilise vraiment.

11. **Affiner les icônes à `strokeWidth={1.6}`.** lucide-react est à 2 par défaut ;
    le site est à 1,6 sur ses 20 icônes SVG. À poser une fois globalement plutôt
    qu'icône par icône.

12. **Retracker les eyebrows.** `.task-meta-label` (`src/index.css:1046`),
    `.sources-label` (`:832`), `.section-divider-label` (`:926`) sont en uppercase
    sans tracking : ajouter `letter-spacing: 0.16em` et passer en Montserrat 700
    à 11px. Sans tracking, l'uppercase se lit mal et fait daté.

### Divergences délibérées

- **Ne pas reprendre `#8FA3AC` ni `#77878E` pour du texte lu.** Mesurés à 2,62:1
  et 3,72:1 sur blanc, ils échouent AA. Sur le site ce sont des eyebrows de
  11px/700 qu'on survole ; dans ClientChat, `--tx3` sert aux horodatages et
  compteurs qu'on lit vraiment. Prendre `#5C7079` à la place — également mesuré
  sur le site (5 131 car., 2/5 pages) et conforme AA à 5,19:1 — et réserver
  `#77878E` aux eyebrows, `#8FA3AC` au décoratif.
- **Ne pas reprendre l'échelle d'espacement hand-tuned** (18/10/22/26). Le site
  est sur du Webflow ajusté à la main, pas sur une grille. Garder une grille de 4px
  dans ClientChat et n'emprunter que les valeurs qui y tombent déjà : 8, 12, 16,
  20, 24, 32, 64. Un outil a besoin d'une grille reproductible, une landing page non.
- **Ne pas centrer les titres.** Le site centre ses h1/h2 ; une application se
  lit en L, aligné à gauche. On garde la typo, pas l'alignement.
- **Ne pas reprendre le conteneur 1200px.** ClientChat est une app pleine largeur
  à 3 colonnes ; la mesure de 1200px ne s'applique qu'aux modales, où elle se
  traduit en `max-width: 760px` (la colonne de lecture mesurée du site).
- **Mode sombre : non mesurable.** Le site n'a pas de thème sombre. Les valeurs
  sombres de `src/index.css:70-98` sont donc à dériver, pas à mesurer — on les
  reconstruit à partir du navy `#264653` plutôt que du gris `#1C1C1E` actuel,
  mais c'est une extrapolation ⚠︎ inférée, pas une mesure.

## 12. Tokens prêts à coller

Format cible : variables CSS dans `src/index.css` + extension de thème Tailwind
dans `tailwind.config.js` (les deux existent déjà).

```css
:root {
  /* ── Cœur de marque (mesuré 5/5 pages) ───────────────────────── */
  --sb-navy:      #264653;  /* texte 7399 car. rang 1 + footer + hexagone logo */
  --sb-orange:    #FF9E00;  /* .sbs-btn-1, .sbx-qhex-1, 336855 px² */
  --sb-coral:     #FE6D73;  /* .sbo-xn4, .sbs-hx-4, 2/5 pages */
  --sb-blue-lt:   #BDE0FE;  /* .sbx-bar-a, .sbx-hl-b */
  --sb-blue-sky:  #85C4FF;  /* token déclaré --royal-blue, 5/5 pages */
  --sb-green:     #5EC045;  /* token déclaré --lime-green */
  --sb-orchid:    #B75DDA;  /* token déclaré --medium-orchid */
  --sb-cream:     #FFF3DF;  /* .sbx-bar-c, surligneur jaune */
  --sb-sand:      #F1EFEA;  /* .sbs-btn-2, bouton tertiaire */

  /* ── Surfaces (rangées par surface rendue) ───────────────────── */
  --bg:    #F4F9FD;  /* .sbs-hero + .sbs-sec-alt, 18,9 M px², rang 2 */
  --sur:   #FFFFFF;  /* .sbs-page + cartes, 46,9 M px², rang 1 */
  --sur2:  #EDF3F8;  /* .sbp-more, surface creusée */
  --sur3:  #E6EDF1;  /* .sbp-av, bordure de carte utilisée en surface */
  --sur-input: #FBFDFE; /* input.sbs-input, 1/5 page */

  /* ── Bordures ────────────────────────────────────────────────── */
  --brd:   rgba(38, 70, 83, 0.13); /* a.sbo-xrow, .sbx-bitem, 2/5 pages */
  --brd2:  rgba(38, 70, 83, 0.16); /* anneau inset, nav bottom, 5/5 pages */
  --brd-card:  #E6EDF1;            /* .sbp-card, .sbs-panel, 4/5 pages */
  --brd-input: #DCE6EC;            /* input.sbs-input */

  /* ── Texte ───────────────────────────────────────────────────── */
  --tx:  #264653;  /* 7399 car., rang 1, 5/5 pages */
  --tx2: #4A5B63;  /* 4639 car., p.sbs-herop, p.sbp-p, 5/5 pages */
  --tx3: #5C7079;  /* 5131 car., p.sbo-rp / p.sbx-lede, 2/5 pages — AA 5,19:1 */
  --tx4: #8FA3AC;  /* .sbo-fdur / .sbx-qlab — décoratif uniquement, 2,62:1 */
  --tx-eyebrow: #77878E; /* .sbp-eyebrow, OK car 11px/700 uppercase */

  /* ── Sémantique (mesuré sur .sbx-pill) ───────────────────────── */
  --c-green: #3C8B2B;  --c-green-bg: rgba(94, 192, 69, 0.15);
  --c-amb:   #A96900;  --c-amb-bg:   rgba(255, 158, 0, 0.18);

  /* ── Rayons (par occurrences mesurées) ───────────────────────── */
  --r-btn:   4px;   /* .sbs-btn-1/2/3, 25 occ., 5/5 pages */
  --r-input: 6px;   /* input.sbs-input, 15 occ. */
  --r:       8px;   /* .sbs-card / .sbs-acard, 21 occ. */
  --r-panel: 20px;  /* .sbo-xrow / .sbx-case, 16 occ. */
  --r-modal: 24px;  /* .sbs-panel / .sbp-card, 4/5 pages */
  --r-menu:  14px;  /* .sbs-ddlist */
  --r-pill:  99px;  /* .sbx-pill, 38 occ. */

  /* ── Élévation (valeurs complètes mesurées) ──────────────────── */
  --e0: rgba(38,70,83,0.16) 0 0 0 1px inset;                              /* 29 occ., 5/5 */
  --e1: rgba(38,70,83,0.08) 0 4px 20px 0, rgba(38,70,83,0.04) 0 1px 4px 0; /* 8 occ., 5/5 */
  --e2: rgba(38,70,83,0.14) 0 12px 32px 0, rgba(38,70,83,0.06) 0 2px 6px 0;/* .sbs-ddlist */
  --e-hard:   rgba(38,70,83,0.13) 4px 4px 0 0;  /* .sbo-xrow, 23 occ. */
  --e-hard-s: rgba(38,70,83,0.11) 2px 2px 0 0;  /* variante compacte, 15 occ. */
  --e-underline: #FF9E00 0 -4px 0 0 inset;      /* .sbx-eyebrow, 12 occ. */

  /* ── Motion (seules valeurs employées par la marque) ─────────── */
  --t-ctrl: 0.16s ease;  /* boutons, 38 occ., 5/5 pages */
  --t-card: 0.18s ease;  /* cartes interactives, 24 occ. */
  --t-nav:  0.2s ease;   /* liens, 56 occ., 5/5 pages */

  /* ── Texture blueprint (5/5 pages, .sbs-blueprint) ───────────── */
  --blueprint:
    radial-gradient(circle, #CFDEE8 1.4px, rgba(0,0,0,0) 1.6px),
    linear-gradient(#E3EDF4 1px, rgba(0,0,0,0) 1px),
    linear-gradient(90deg, #E3EDF4 1px, rgba(0,0,0,0) 1px);
  --blueprint-size: 44px 44px;

  /* ── Hexagone (clip-path exact, .sbs-bhex / .sbx-qhex-1) ─────── */
  --hex: polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%);
}
```

```js
// tailwind.config.js — extension de thème
theme: {
  extend: {
    colors: {
      'sb-navy':     '#264653', // texte rang 1 + footer, 5/5 pages
      'sb-orange':   '#FF9E00', // CTA primaire, 5/5 pages
      'sb-coral':    '#FE6D73', // .sbo-xn4, 2/5 pages
      'sb-blue-lt':  '#BDE0FE', // .sbx-bar-a
      'sb-blue-sky': '#85C4FF', // token déclaré --royal-blue
      'sb-green':    '#5EC045', // token déclaré --lime-green
      'sb-orchid':   '#B75DDA', // token déclaré --medium-orchid
      'sb-ice':      '#F4F9FD', // fond de section, rang 2, 5/5 pages
      'sb-cream':    '#FFF3DF', // .sbx-bar-c
      'sb-sand':     '#F1EFEA', // .sbs-btn-2
    },
    fontFamily: {
      // Montserrat : 257 éléments, titres/labels/boutons, 5/5 pages
      display: ['Montserrat', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      // Raleway : 297 éléments, corps/liens, 5/5 pages
      sans:    ['Raleway', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      // JetBrains Mono : span.sbx-pcode, 12,5px/600
      mono:    ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
    },
    letterSpacing: {
      'sb-tight':   '-0.035em', // h1 56px/-1,96px
      'sb-heading': '-0.03em',  // h2 44px/-1,32px
      'sb-ctrl':    '-0.01em',  // bouton 16px/-0,16px
      'sb-eyebrow': '0.16em',   // eyebrow 11px/+1,76px
      'sb-label':   '0.08em',   // eyebrow large 13px/+1,04px
    },
    borderRadius: { 'sb-btn': '4px', 'sb-input': '6px', 'sb-card': '8px',
                    'sb-panel': '20px', 'sb-modal': '24px', 'sb-pill': '99px' },
    boxShadow: {
      'sb-ring':  'inset 0 0 0 1px rgba(38,70,83,0.16)',
      'sb-e1':    '0 4px 20px 0 rgba(38,70,83,0.08), 0 1px 4px 0 rgba(38,70,83,0.04)',
      'sb-e2':    '0 12px 32px 0 rgba(38,70,83,0.14), 0 2px 6px 0 rgba(38,70,83,0.06)',
      'sb-hard':  '4px 4px 0 0 rgba(38,70,83,0.13)',
      'sb-hard-s':'2px 2px 0 0 rgba(38,70,83,0.11)',
      'sb-under': 'inset 0 -4px 0 0 #FF9E00',
    },
  },
}
```

## 13. Preuves

**Pages mesurées (5) :**

- https://www.smart-bees.fr/
- https://www.smart-bees.fr/offres
- https://www.smart-bees.fr/smart-bees-notre-equipe
- https://www.smart-bees.fr/smart-bees-nous-contacter
- https://www.smart-bees.fr/offre/mesure-collecte

**Captures :**

- `docs/brand-dna-evidence/home-1440.webp` — homepage, pleine page, 1440×900
- Capture de viewport du hero à 1440×900 (hexagones, surligneur orange, blueprint)
- Mesure responsive à 500×844 (largeur minimale de fenêtre macOS ; le breakpoint
  mobile est bien franchi — h1 passe de 56px à 34px)

**Méthode :** `references/measure.js` du skill `brand-dna`, exécuté via
chrome-devtools MCP `evaluate_script` sur chaque page. JSON brut par page dans
`docs/brand-dna-evidence/{home,offres,equipe,contact,offre-detail}.json`.
Mesures ciblées supplémentaires (hexagones, eyebrows, pills, nav, blueprint,
icônes SVG, responsive) par scripts dédiés dans la même session.

**Recette visuelle :** `preview.html` (servi par Vite sur
`/clientchat_v2/preview.html`) rend tous les composants réels avec les classes de
`src/index.css`, en clair et en sombre. C'est la page à rouvrir pour vérifier une
modification de la DA sans avoir à se connecter à l'application.

**Non mesurable / limites :**

- **1 feuille de style cross-origin bloquée par page** (CORS) — les `@font-face`
  Google Fonts ne sont donc pas lisibles dans le CSSOM ; les familles réelles ont
  été relevées via `list_network_requests` (filtre `font`) à la place.
- **Aucun thème sombre sur le site** : toutes les valeurs sombres proposées pour
  ClientChat sont dérivées, jamais mesurées.
- **Pas de bandeau de consentement** rencontré — aucune surface faussée.
- **`--medium-orchid: #b75dda`** est déclaré en token sur les 5 pages mais **ne
  rend nulle part** dans les zones mesurées : présent dans le système, non utilisé.
- **États `:hover` / `:focus` non mesurés** — `getComputedStyle` ne les capture
  pas sans simulation d'état. Les transitions (0,16s / 0,18s) prouvent qu'ils
  existent, mais leurs valeurs cibles sont inconnues. ⚠︎ à ne pas inventer.
- Pages non mesurées : `/smart-bees-nos-ressources` et les articles de blog
  (typographie long-form, tableaux, code) — le vocabulaire éditorial long n'est
  donc pas couvert.
