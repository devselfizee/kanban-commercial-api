/**
 * Recherche d'un client, dans le kanban puis dans le CRM.
 *
 * Le CRM compte près de 170 000 clients. Les importer tous pour en utiliser
 * quelques centaines encombrerait la base sans rien apporter : une organisation
 * n'est créée ici qu'au moment où on travaille réellement dessus.
 *
 * La recherche interroge donc les deux sources. Les organisations déjà connues
 * du kanban viennent en premier — ce sont celles qui portent des leads et des
 * opportunités. Les clients du CRM suivent, et se transforment en organisation
 * seulement quand on les rattache.
 *
 * Un client déjà repris n'apparaît pas deux fois : les résultats CRM dont
 * l'identifiant est déjà lié à une organisation sont retirés.
 */

import { prisma } from "../lib/prisma";
import { appliquerEvenement } from "./synchronisation";
import { estGrenke, idClientGrenke } from "./partenaire";

const DELAI_MS = 5_000;

export type ResultatClient = {
  /** Identifiant d'organisation si elle existe déjà dans le kanban. */
  organisationId: string | null;
  /** Identifiant côté CRM, absent pour une organisation créée ici. */
  idCrm: number | null;
  nom: string;
  email: string | null;
  telephone: string | null;
  ville: string | null;
  estParticulier: boolean;
  /** D'où vient la ligne, pour que l'interface puisse le montrer. */
  source: "kanban" | "crm";
  /**
   * La fiche CRM d'origine, pour les résultats qui en viennent.
   *
   * Le front la renvoie telle quelle à la reprise : `list` n'offre pas d'accès
   * par identifiant, il faudrait sinon refaire une recherche en espérant
   * retrouver la même ligne.
   */
  ficheCrm?: LigneClientCrm;
};

export type ReponseRecherche = {
  resultats: ResultatClient[];
  /** Le CRM a-t-il pu être interrogé ? Sinon la recherche est partielle. */
  crm: { etat: "ok" } | { etat: "non_configure" } | { etat: "indisponible"; detail: string };
};

export type LigneClientCrm = {
  id: number;
  client_type?: string | null;
  display_name?: string | null;
  nom?: string | null;
  prenom?: string | null;
  enseigne?: string | null;
  email?: string | null;
  telephone?: string | null;
  mobile?: string | null;
};

export async function rechercherClient(
  terme: string,
  limite = 10,
): Promise<ReponseRecherche> {
  const recherche = terme.trim();
  if (recherche.length < 2) {
    return { resultats: [], crm: { etat: "ok" } };
  }

  const locales = await organisationsLocales(recherche, limite);
  const dejaConnus = new Set(
    locales.map((o) => o.idCrm).filter((n): n is number => n != null),
  );

  const duCrm = await clientsDuCrm(recherche, limite);

  if (duCrm.etat !== "ok") {
    return { resultats: locales, crm: duCrm };
  }

  // Un client déjà repris ne doit pas apparaître deux fois : l'organisation
  // locale fait foi, c'est elle qui porte le travail commercial.
  // GRENKE finance, il n'achète pas : on ne le propose jamais comme client.
  const nouveaux = duCrm.clients.filter(
    (c) => !dejaConnus.has(c.idCrm!) && !estGrenke(c.idCrm),
  );

  return {
    resultats: [...locales, ...nouveaux].slice(0, limite * 2),
    crm: { etat: "ok" },
  };
}

/**
 * Reprend un client du CRM dans le kanban, et renvoie son organisation.
 *
 * Appelée quand un commercial rattache un client trouvé par la recherche :
 * c'est à cet instant, et pas avant, qu'une des 170 000 fiches du CRM entre
 * dans le kanban.
 *
 * Elle passe par `appliquerEvenement()`, le même chemin que le bus, donc avec
 * le rapprochement avant création et l'idempotence. Rattacher deux fois le
 * même client ne crée pas de doublon.
 *
 * ⚠ `/api-v1/clients/list` ne renvoie que neuf champs : ni SIRET, ni adresse,
 * ni ville. L'organisation créée est donc incomplète, et se remplira à la
 * première modification côté CRM, via le bus.
 */
export async function reprendreClient(
  client: LigneClientCrm,
): Promise<{ organisationId: string } | { erreur: string }> {
  const idCrm = Number(client.id);
  if (!Number.isInteger(idCrm)) {
    return { erreur: "Identifiant CRM invalide." };
  }
  if (estGrenke(idCrm)) {
    return { erreur: "GRENKE est le partenaire de financement, pas un client." };
  }

  const dejaLa = await prisma.organisation.findUnique({
    where: { idCrm },
    select: { id: true },
  });
  if (dejaLa) return { organisationId: dejaLa.id };

  const issue = await appliquerEvenement({
    routingKey: "crm.clients.created",
    charge: client as unknown as Record<string, unknown>,
  });
  if (issue.resultat === "ERREUR") return { erreur: issue.detail };

  const creee = await prisma.organisation.findUnique({
    where: { idCrm },
    select: { id: true },
  });
  return creee
    ? { organisationId: creee.id }
    : { erreur: "L'organisation n'a pas pu être créée." };
}

async function organisationsLocales(
  recherche: string,
  limite: number,
): Promise<ResultatClient[]> {
  const organisations = await prisma.organisation.findMany({
    where: {
      OR: [
        { nom: { contains: recherche, mode: "insensitive" } },
        { email: { contains: recherche, mode: "insensitive" } },
      ],
      // Sans GRENKE. Écrit en deux branches : `idCrm <> 1853` seul écarterait
      // aussi les organisations sans lien CRM, puisque NULL <> 1853 n'est pas
      // vrai en SQL.
      AND: [{ OR: [{ idCrm: null }, { idCrm: { not: idClientGrenke() } }] }],
    },
    select: {
      id: true,
      idCrm: true,
      nom: true,
      email: true,
      telephone: true,
      ville: true,
      estParticulier: true,
    },
    orderBy: { nom: "asc" },
    take: limite,
  });

  return organisations.map((o) => ({
    organisationId: o.id,
    idCrm: o.idCrm,
    nom: o.nom,
    email: o.email,
    telephone: o.telephone,
    ville: o.ville,
    estParticulier: o.estParticulier,
    source: "kanban" as const,
  }));
}

type IssueCrm =
  | { etat: "ok"; clients: ResultatClient[] }
  | { etat: "non_configure" }
  | { etat: "indisponible"; detail: string };

async function clientsDuCrm(
  recherche: string,
  limite: number,
): Promise<IssueCrm> {
  const urlCrm = process.env.CRM_URL;
  if (!urlCrm) return { etat: "non_configure" };

  const url =
    `${urlCrm.replace(/\/$/, "")}/api-v1/clients/list` +
    `?search=${encodeURIComponent(recherche)}&limit=${Math.min(200, limite)}`;

  try {
    // Le CRM ne doit pas pouvoir bloquer la saisie d'un lead.
    const reponse = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(DELAI_MS),
    });

    if (!reponse.ok) {
      return { etat: "indisponible", detail: `Le CRM a répondu ${reponse.status}.` };
    }

    const corps = (await reponse.json()) as { data?: LigneClientCrm[] };
    const lignes = Array.isArray(corps.data) ? corps.data : [];

    return {
      etat: "ok",
      clients: lignes.map((c) => ({
        organisationId: null,
        idCrm: c.id,
        nom: c.display_name?.trim() || c.nom?.trim() || `Client ${c.id}`,
        email: c.email?.trim() || null,
        telephone: c.telephone?.trim() || c.mobile?.trim() || null,
        // `list` ne renvoie ni ville ni adresse : ils arriveront par le bus,
        // à la première modification côté CRM.
        ville: null,
        estParticulier: c.client_type === "person",
        source: "crm" as const,
        ficheCrm: c,
      })),
    };
  } catch (e) {
    const expire = e instanceof Error && e.name === "TimeoutError";
    return {
      etat: "indisponible",
      detail: expire
        ? "Le CRM n'a pas répondu dans le délai imparti."
        : e instanceof Error
          ? e.message
          : "CRM injoignable.",
    };
  }
}
