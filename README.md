# Kanban commercial — API

API du CRM Selfizee : qualification des leads, pipeline commercial, suivi
LLD / GRENKE, autour d'une **fiche client unique**.

Implémentation de « Proposition de pipeline commercial et LLD pour Selfizee »
(Manus AI, 21 septembre 2026).

L'interface est un projet distinct : **kanban-commercial-front**.

---

## Le principe

**Le back décide, le front affiche.** Les règles du document — priorité, seuil
de qualification, alerte de compatibilité partenaire, matrice de droits — sont
appliquées ici. L'interface peut les refléter pour guider la saisie, elle ne
peut pas les contourner : les drapeaux « sans suivi » ou « prise en charge
tardive » partent d'ici, déjà calculés.

L'API renvoie des **codes**, jamais des libellés d'affichage : la traduction en
français appartient au front.

## Démarrage

Il faut un PostgreSQL joignable.

```bash
npm install
cp .env.example .env     # renseigner DATABASE_URL
npm run db:deploy        # applique les migrations
npm run db:seed          # jeu de démonstration (optionnel)
npm run dev              # http://localhost:4000
```

**Authentification.** Sans `KEYCLOAK_ISSUER`, l'API accepte un en-tête
`x-utilisateur` désignant le compte. Pratique pour éprouver la matrice de droits
en développement, à ne jamais exposer publiquement. Cinq comptes sont créés par
le seed — Marie et Thomas (commerciaux), Sophie (collaboratrice LLD), Laurent
(manager), Claire (direction).

## Structure

```
prisma/
├── schema.prisma        les 5 objets, les listes de valeurs, les relations
├── migrations/          l'historique du schéma
└── seed.ts              données de démonstration, y compris les cas qui
                         déclenchent les alertes
src/
├── serveur.ts           montage des routes, CORS, sonde de santé
├── domaine/
│   ├── regles.ts        priorité, seuil de qualification, alerte GRENKE
│   └── etapes.ts        ordre des étapes (sans libellés : ils sont au front)
├── routes/
│   ├── leads.ts         pipeline 1 : création, prise en charge, conversion
│   ├── opportunites.ts  pipeline 2 : offre, création LLD, gagné / perdu
│   ├── lld.ts           pipeline 3 : transmission, retour partenaire, livraison
│   ├── tableaux-bord.ts « Mes actions » et « Pilotage »
│   ├── synchro.ts       synchronisation CRM (secret partagé, pas Keycloak)
│   └── utilisateurs.ts  identité et équipe
├── crm/                 correspondance et consommation du bus RabbitMQ
└── lib/                 Prisma, authentification, journal, références
```

## Le modèle de données

Cinq objets reliés, et une règle : **le passage du lead à l'opportunité est un
changement de maturité, pas un changement de fiche**. Le lead est conservé, les
activités et les tâches lui restent attachées, l'opportunité pointe vers lui.
De même, un dossier LLD est relié à une opportunité unique, sans créer de
seconde fiche client.

```
Organisation ─┬─ Contact
              ├─ Lead ──────► Opportunité ──────► Dossier LLD
              └─ Opportunité      │                    │
                                  ├─ Devis             ├─ ChecklistItem
                                  │                    └─ Document
                                  └─ Activité, Tâche, JournalEntrée
```

Chaque enregistrement porte une référence stable et lisible — `L-2026-00184`,
`OPP-2026-00073`, `LLD-2026-00018` — destinée à circuler dans les exports, devis
et échanges internes.

### Quatre notions distinctes

Le modèle sépare volontairement quatre informations que les CRM mal paramétrés
confondent :

| Notion | Question | Champ |
|---|---|---|
| Origine | Comment le contact est arrivé | `modeAcquisition` + `canalDetaille` |
| Statut de lead | Sa maturité avant qualification | `statut` (pipeline 1) |
| Étape commerciale | L'avancement de la vente | `etape` (pipeline 2) |
| Statut LLD | Des événements de dossier et de contrat | `statut` (pipeline 3) |

Le canal d'acquisition est un **champ filtrable**, jamais une colonne de
pipeline : un même lead peut venir d'un salon puis se convertir après une
relance téléphonique. La durée de LLD suit la même règle.

## Les garde-fous implémentés

Ces règles sont dans le code, pas seulement dans la documentation.

**Aucune carte n'est perdue.** Une carte sans prochaine action datée ni attente
formalisée est signalée. Les étapes terminales et les attentes explicitement
datées en sont exclues.

**La priorité n'évalue jamais la solvabilité.** `calculerPriorite()` n'accepte
que des critères commerciaux visibles — demande entrante, échéance proche, devis
demandé, client existant, valeur indicative.

**Le CRM n'interprète pas le partenaire.** Le pipeline LLD n'enregistre que des
faits observables. Passer à « réponse communiquée par GRENKE » exige d'avoir
saisi le contenu du retour ; passer à « contrat actif » exige l'évènement de
confirmation de livraison.

**La compatibilité est une alerte, jamais un refus.** Selfizee propose des durées
de 1 à 36 mois ; les informations publiques du partenaire indiquent 12 à 60 mois.
Hors de cette plage, `verifierCompatibilitePartenaire()` signale « compatibilité
partenaire à confirmer » — et le dossier suit son cours.

**Le libellé « non finançable » n'existe pas.** Les motifs de clôture LLD sont
factuels : client retire sa demande, dossier incomplet après relances, solution
d'achat retenue, retour partenaire défavorable communiqué.

**Les valeurs ne sont jamais additionnées.** Montant de vente, mise en place,
loyer mensuel et durée sont des champs distincts.

**La réattribution laisse une trace.** Le journal conserve l'ancien propriétaire,
le nouveau, la date, l'auteur et le motif — ce dernier étant obligatoire.

## Matrice de droits

| Rôle | Périmètre |
|---|---|
| Commercial | Ses leads et opportunités, plus le pool non attribué ; lecture du statut LLD associé, sans le contenu des documents financiers |
| Collaboratrice LLD | Ses dossiers LLD ; seule elle (avec le manager) fait progresser un dossier |
| Manager | Vision complète, réattribution, paramétrage |
| Direction | Lecture des rapports et des dossiers |

La collaboratrice valide elle-même l'état « prêt à transmettre » : aucune
automatisation ne le fait à sa place, même quand la checklist est complète.

## Les routes

| Route | Rôle |
|---|---|
| `GET /api/sante` | sonde pour Coolify |
| `GET /api/configuration` | mode d'authentification, avant connexion |
| `GET /api/utilisateurs/moi` | identité de l'appelant |
| `GET /api/leads` | pipeline 1 |
| `POST /api/leads/:id/prendre-en-charge` | §5 |
| `POST /api/leads/:id/convertir` | conversion en opportunité |
| `GET /api/opportunites` | pipeline 2, avec les valeurs séparées |
| `POST /api/opportunites/:id/dossier-lld` | ouverture du dossier de financement |
| `GET /api/lld` | pipeline 3 |
| `POST /api/lld/:id/transmettre` | transmission horodatée et prouvée |
| `GET /api/tableaux-bord/mes-actions` | tâches échues, cartes sans suivi |
| `GET /api/tableaux-bord/pilotage` | indicateurs du §11 |
| `POST /api/synchro` | drainage de la queue CRM (secret partagé) |

## Déploiement Coolify

**New Resource → Application → Private Repository**, ce dépôt, avec le build
pack **Dockerfile** et le port **4000**.

| Variable | Obligatoire | Valeur |
|---|---|---|
| `DATABASE_URL` | oui | l'URL interne du service PostgreSQL |
| `CORS_ORIGINES` | oui | l'URL publique de l'interface |
| `KEYCLOAK_ISSUER` | recommandé | `https://.../realms/NOM_DU_REALM` |
| `KEYCLOAK_CLIENT_ID` | recommandé | `kanban-commercial` |
| `SYNCHRO_SECRET` | non | si la synchro CRM est activée |
| `RABBITMQ_*` | non | voir `.env.example` |

⚠️ **Sans `KEYCLOAK_ISSUER`, l'API accepte un simple en-tête `x-utilisateur`**
pour désigner le compte. Ce mode ne doit jamais être exposé publiquement.

`docker-entrypoint.sh` applique `prisma migrate deploy` avant de démarrer : les
migrations suivent chaque déploiement sans intervention.

### Après le premier déploiement

La base démarre **vide**. Pour la peupler avec le jeu de démonstration, ouvrir un
terminal sur le conteneur :

```bash
node dist/seed.cjs
```

⚠️ Le seed **efface toutes les données existantes**. Il ne doit jamais être
exécuté sur une base contenant de vraies données.

Sans seed, aucun utilisateur n'existe et la connexion aboutira sur « aucun compte
ne vous correspond ». Les créer en SQL, avec **les mêmes e-mails que dans
Keycloak** :

```sql
INSERT INTO utilisateurs (id, email, nom, prenom, role, actif, "creeLe", "majLe")
VALUES (gen_random_uuid()::text, 'prenom.nom@selfizee.fr', 'Nom', 'Prénom',
        'COMMERCIAL', true, now(), now());
```

Rôles : `COMMERCIAL`, `COLLABORATRICE_LLD`, `MANAGER`, `DIRECTION`.

## Synchronisation avec le CRM Selfizee

**Sens unique : CRM → kanban.** Le CRM fait autorité sur l'identité du client ;
le kanban ne lui réécrit jamais rien.

| Objet | Table CRM | État |
|---|---|---|
| Organisation | `clients` | Actif — le CRM publie déjà ces événements |
| Contact | `client_contacts` | Nécessite une ligne côté CRM |
| Devis | `devis` | Nécessite une ligne côté CRM |
| Lead, opportunité, dossier LLD | — | Propres au kanban |

Le CRM publie sur un bus RabbitMQ avec des clés `crm.{table}.{action}`. Le kanban
lit sa queue par l'API HTTP de management — le port AMQP n'étant pas joignable
sous Coolify.

```bash
curl -X POST https://kanban-api.exemple.com/api/synchro \
  -H "x-synchro-secret: $SYNCHRO_SECRET"
```

Une tâche planifiée toutes les deux minutes suffit.

**Garanties** : idempotence par empreinte unique, rejet des événements périmés,
préservation du travail commercial, rapprochement avant création pour éviter les
doublons, et détachement plutôt que suppression.

Pour étendre aux contacts et aux devis, une ligne à ajouter côté CRM dans
`ClientContactsTable` et `DevisTable` :

```php
$this->addBehavior('EventPublisher');
```

## Points à trancher avant le paramétrage définitif

Implémentés avec des valeurs par défaut, à ajuster :

- **Délai de première prise en charge** — 8 h ouvrées pour un entrant, 72 h pour
  la prospection (`DELAI_PRISE_EN_CHARGE_HEURES`).
- **Définition de « gagné »** — commande finalisée ou livraison confirmée.
- **Segments à conserver** — à ajuster après un mois de données réelles.
- **Informations à confirmer avec GRENKE** — durées, pièces, canal de
  transmission, délais. Tant que cette confirmation n'a pas eu lieu, le suivi
  partenaire reste manuel et factuel.

## RGPD

Les consentements et préférences de contact sont portés par le contact. Les
organisations conservent leur source, leur date de collecte et le fondement du
contact. Les changements de statut LLD, les transmissions et les accès aux
documents sont journalisés.

Une **politique de conservation** reste à définir avec la personne compétente en
protection des données.

## Commandes

```bash
npm run dev          # développement
npm run build        # compilation TypeScript
npm run db:migrate   # créer une migration
npm run db:deploy    # appliquer les migrations
npm run db:studio    # explorer la base
npm run db:seed      # réinitialiser le jeu de démonstration
```
