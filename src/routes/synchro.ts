/**
 * Synchronisation entrante depuis le CRM.
 *
 * Appelée par une machine — tâche planifiée Coolify ou cron — et non par un
 * utilisateur : elle s'authentifie par un secret partagé, pas par Keycloak.
 * Elle est donc montée avant la garde d'authentification du serveur.
 */

import { Router } from "express";
import { prisma } from "../lib/prisma";
import { configDepuisEnv, lireMessages, profondeurQueue } from "../crm/rabbitmq";
import { appliquerEvenement } from "../crm/synchronisation";

const routes = Router();

/** Taille d'un lot : borne la durée d'un appel. */
const LOT = 50;

function autorise(requete: Parameters<Parameters<typeof routes.post>[1]>[0]): boolean {
  const attendu = process.env.SYNCHRO_SECRET;
  // Sans secret configuré, la route reste fermée : mieux vaut une synchro
  // inactive qu'un point d'écriture ouvert.
  if (!attendu) return false;

  const fourni =
    requete.header("x-synchro-secret") ??
    requete.header("authorization")?.replace(/^Bearer\s+/i, "");

  return fourni === attendu;
}

/** Draine la queue : chaque appel consomme un lot puis s'arrête. */
routes.post("/", async (requete, reponse) => {
  if (!autorise(requete)) {
    return reponse.status(401).json({ erreur: "Non autorisé." });
  }

  const config = configDepuisEnv();
  if (!config) {
    return reponse.status(503).json({
      erreur:
        "Bus non configuré : renseignez RABBITMQ_MGMT_URL, RABBITMQ_USER et RABBITMQ_PASSWORD.",
    });
  }

  const debut = Date.now();
  const messages = await lireMessages(config, LOT);

  const bilan = {
    lus: messages.length,
    crees: 0,
    misAJour: 0,
    ignores: 0,
    erreurs: 0,
    details: [] as string[],
  };

  for (const message of messages) {
    const issue = await appliquerEvenement({
      routingKey: message.routingKey,
      charge: message.charge,
    });

    switch (issue.resultat) {
      case "CREE":
        bilan.crees += 1;
        break;
      case "MIS_A_JOUR":
        bilan.misAJour += 1;
        break;
      case "ERREUR":
        bilan.erreurs += 1;
        bilan.details.push(`${message.routingKey} : ${issue.detail}`);
        break;
      default:
        bilan.ignores += 1;
    }
  }

  const restants = await profondeurQueue(config);

  reponse.json({
    ...bilan,
    restants,
    dureeMs: Date.now() - debut,
    // Indique à l'appelant qu'un nouvel appel immédiat est utile.
    encoreATraiter: (restants ?? 0) > 0,
  });
});

/** État de la synchronisation, sans rien consommer. */
routes.get("/etat", async (requete, reponse) => {
  if (!autorise(requete)) {
    return reponse.status(401).json({ erreur: "Non autorisé." });
  }

  const config = configDepuisEnv();
  if (!config) return reponse.json({ configure: false });

  reponse.json({
    configure: true,
    queue: config.queue,
    exchange: config.exchange,
    liaisons: config.liaisons,
    enAttente: await profondeurQueue(config),
  });
});

/**
 * Journal des événements reçus, pour l'écran de diagnostic.
 *
 * Contrairement aux deux routes précédentes, celle-ci est consultée par un
 * humain : elle est montée séparément sous la garde d'authentification.
 */
export const routesDiagnostic = Router();

routesDiagnostic.get("/", async (_requete, reponse) => {
  const config = configDepuisEnv();

  const [evenements, stats, organisationsLiees, contactsLies] = await Promise.all([
    prisma.evenementCrm.findMany({ orderBy: { recuLe: "desc" }, take: 50 }),
    prisma.evenementCrm.groupBy({ by: ["resultat"], _count: { _all: true } }),
    prisma.organisation.count({ where: { idCrm: { not: null } } }),
    prisma.contact.count({ where: { idCrm: { not: null } } }),
  ]);

  reponse.json({
    configure: Boolean(config),
    queue: config?.queue ?? null,
    enAttente: config ? await profondeurQueue(config) : null,
    organisationsLiees,
    contactsLies,
    parResultat: Object.fromEntries(stats.map((s) => [s.resultat, s._count._all])),
    evenements,
  });
});

export default routes;
