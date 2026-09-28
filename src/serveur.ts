/**
 * Serveur HTTP du kanban commercial.
 *
 * Il expose une API REST consommée par le front React. Toute la logique métier
 * et la matrice de droits vivent ici : le front affiche, le back décide.
 */

import express from "express";
import cors from "cors";
import { prisma } from "./lib/prisma";
import { exigerAuthentification, authentificationActive } from "./lib/auth";
import { securiser } from "./lib/routeur";
import { synchroniserEquipe, resumer } from "./crm/equipe";
import { importerDemandes, resumerDemandes } from "./crm/demandes";
import { importerFinancements, resumerFinancements } from "./crm/financements";
import { Prisma } from "@prisma/client";
import routesLeads from "./routes/leads";
import routesOpportunites from "./routes/opportunites";
import routesLld from "./routes/lld";
import routesTableauxBord from "./routes/tableaux-bord";
import routesSynchro, { routesDiagnostic } from "./routes/synchro";
import routesUtilisateurs from "./routes/utilisateurs";

const app = express();
const PORT = Number(process.env.PORT ?? 4000);

app.use(express.json({ limit: "1mb" }));

// Le front est servi depuis une autre origine : les identifiants circulent en
// en-tête Authorization, pas en cookie, donc pas besoin de `credentials`.
const originesAutorisees = (process.env.CORS_ORIGINES ?? "http://localhost:5173")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: originesAutorisees.includes("*") ? true : originesAutorisees,
    methods: ["GET", "POST", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "x-utilisateur", "x-synchro-secret"],
  }),
);

/** Sonde de santé, utilisée par Coolify pour savoir si le conteneur répond. */
app.get("/api/sante", async (_requete, reponse) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return reponse.json({ etat: "ok", authentification: authentificationActive });
  } catch {
    return reponse.status(503).json({ etat: "base_injoignable" });
  }
});

/**
 * Renseigne le front sur le mode d'authentification, avant toute connexion.
 * C'est la seule route ouverte : elle ne divulgue aucune donnée métier.
 */
app.get("/api/configuration", (_requete, reponse) => {
  reponse.json({
    authentification: authentificationActive,
    keycloak: authentificationActive
      ? {
          issuer: process.env.KEYCLOAK_ISSUER,
          clientId: process.env.KEYCLOAK_CLIENT_ID,
        }
      : null,
  });
});

/**
 * Liste des utilisateurs pour le sélecteur du mode local.
 *
 * Ouverte uniquement quand Keycloak est absent : le sélecteur doit pouvoir
 * s'afficher avant toute authentification. Avec Keycloak, la route renvoie 404
 * pour ne pas divulguer l'annuaire interne.
 */
app.get("/api/utilisateurs-locaux", async (_requete, reponse) => {
  if (authentificationActive) {
    return reponse.status(404).json({ erreur: "Indisponible." });
  }
  const utilisateurs = await prisma.utilisateur.findMany({
    where: { actif: true },
    orderBy: [{ role: "asc" }, { nom: "asc" }],
    select: { id: true, prenom: true, nom: true, role: true },
  });
  reponse.json(utilisateurs);
});

// La synchronisation CRM s'authentifie par son propre secret partagé : une
// machine n'a pas de session Keycloak.
app.use("/api/synchro", routesSynchro);

// Tout le reste exige une identité.
app.use("/api", securiser(exigerAuthentification));
app.use("/api/utilisateurs", routesUtilisateurs);
app.use("/api/leads", routesLeads);
app.use("/api/opportunites", routesOpportunites);
app.use("/api/lld", routesLld);
app.use("/api/tableaux-bord", routesTableauxBord);
app.use("/api/diagnostic-synchro", routesDiagnostic);

// Filet de sécurité : une exception non interceptée ne doit pas exposer de
// trace d'exécution au client.
app.use(
  (
    erreur: unknown,
    _requete: express.Request,
    reponse: express.Response,
    _suite: express.NextFunction,
  ) => {
    if (baseInjoignable(erreur)) {
      // 503 plutôt que 500 : le client et Coolify savent que c'est
      // passager, et que réessayer a un sens.
      console.error("Base de données injoignable :", messageCourt(erreur));
      if (reponse.headersSent) return;
      return reponse
        .status(503)
        .json({ erreur: "Base de données momentanément injoignable." });
    }
    console.error("Erreur non interceptée :", erreur);
    if (reponse.headersSent) return;
    reponse.status(500).json({ erreur: "Erreur interne du serveur." });
  },
);

/**
 * Les codes Prisma d'une base injoignable — connexion refusée, hôte
 * introuvable, délai dépassé, connexion fermée par le serveur.
 */
const CODES_BASE_INJOIGNABLE = new Set(["P1001", "P1002", "P1008", "P1017"]);

function baseInjoignable(erreur: unknown): boolean {
  if (erreur instanceof Prisma.PrismaClientInitializationError) return true;
  return (
    erreur instanceof Prisma.PrismaClientKnownRequestError &&
    CODES_BASE_INJOIGNABLE.has(erreur.code)
  );
}

/**
 * La ligne utile du message : Prisma en met une trentaine, et la cause —
 * « Can't reach database server at … » — n'est pas la première.
 */
function messageCourt(erreur: unknown): string {
  const m = erreur instanceof Error ? erreur.message : String(erreur);
  const lignes = m.split("\n").map((l) => l.trim()).filter(Boolean);
  return (
    lignes.find((l) => /can't reach|refus|timed out|ECONN|ENOTFOUND/i.test(l)) ??
    lignes[0] ??
    m
  );
}

// Dernier filet : un rejet hors de toute requête ne doit pas tuer l'API.
// Il est journalisé bruyamment — ce n'est jamais normal, mais un serveur qui
// continue de répondre vaut mieux qu'une boucle de redémarrages.
process.on("unhandledRejection", (raison) => {
  console.error("Rejet de promesse non traité :", raison);
});

/**
 * L'équipe vient du CRM : relue au démarrage, puis toutes les heures. Un
 * commercial créé dans le CRM apparaît dans le kanban sans saisie. Un échec
 * est journalisé et n'empêche pas l'API de servir.
 */
const INTERVALLE_EQUIPE_MS = 60 * 60 * 1000;

async function tenirEquipeAJour() {
  try {
    console.log("→ " + resumer(await synchroniserEquipe()));
  } catch (e) {
    console.error("Synchronisation de l'équipe impossible :", e);
  }
}

/**
 * Les demandes entrantes du CRM deviennent des leads, toutes les 5 minutes :
 * une demande du site doit apparaître dans le tableau avant que le client ne
 * relance. L'équipe passe d'abord, pour qu'un commercial désigné dans le CRM
 * soit déjà connu quand sa demande arrive.
 */
const INTERVALLE_DEMANDES_MS = 5 * 60 * 1000;

async function importerNouvellesDemandes() {
  try {
    const bilan = await importerDemandes();
    // Un passage sans nouveauté ne mérite pas une ligne toutes les 5 minutes.
    if (bilan.etat !== "ok" || bilan.importees || bilan.erreurs.length) {
      console.log("→ " + resumerDemandes(bilan));
    }
  } catch (e) {
    console.error("Import des demandes CRM impossible :", e);
  }
}

/**
 * Les devis facturés à GRENKE deviennent des dossiers LLD, et suivent
 * l'évolution de leur statut. Un quart d'heure suffit : un dossier de
 * financement avance en jours, pas en minutes.
 */
const INTERVALLE_FINANCEMENTS_MS = 15 * 60 * 1000;

async function suivreFinancements() {
  try {
    const bilan = await importerFinancements();
    if (bilan.etat !== "ok" || bilan.crees || bilan.avances || bilan.erreurs.length) {
      console.log("→ " + resumerFinancements(bilan));
    }
  } catch (e) {
    console.error("Import des financements CRM impossible :", e);
  }
}

if (process.env.CRM_URL) {
  setInterval(() => void suivreFinancements(), INTERVALLE_FINANCEMENTS_MS).unref();
  // Après les demandes : un devis GRENKE se rattache au lead de sa demande.
  void tenirEquipeAJour().then(importerNouvellesDemandes).then(suivreFinancements);
  setInterval(() => void tenirEquipeAJour(), INTERVALLE_EQUIPE_MS).unref();
  setInterval(() => void importerNouvellesDemandes(), INTERVALLE_DEMANDES_MS).unref();
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`→ API du kanban commercial sur le port ${PORT}`);
  console.log(
    authentificationActive
      ? "→ Authentification Keycloak active."
      : "⚠ Authentification désactivée : mode local, à ne pas exposer.",
  );
});
