/**
 * Application d'un événement reçu du CRM.
 *
 * Trois garanties, dans cet ordre :
 *
 *   1. Idempotence — un message relivré par le bus (ce qui arrive : la
 *      livraison est « au moins une fois ») n'est appliqué qu'une seule fois,
 *      grâce à une empreinte unique en base.
 *   2. Ordre — le bus ne garantit pas l'ordre. Un événement plus ancien que la
 *      version déjà enregistrée est ignoré plutôt qu'appliqué à rebours.
 *   3. Non-régression — la synchronisation ne touche qu'aux champs dont le CRM
 *      est maître. Le travail commercial fait dans le kanban (segment affiné,
 *      propriétaire, notes, leads, étapes) n'est jamais écrasé.
 */

import { createHash } from "node:crypto";
import type { Prisma, ResultatSynchro } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { genererReference } from "@/lib/references";
import {
  type ClientCrm,
  type ContactCrm,
  contactDepuisCrm,
  criteresRapprochement,
  estPerime,
  estSupprimeCrm,
  organisationDepuisCrm,
  segmentDepuisCrm,
} from "./correspondance";

export type EvenementRecu = {
  routingKey: string; // « crm.clients.updated »
  charge: Record<string, unknown>;
};

export type IssueSynchro = {
  resultat: ResultatSynchro;
  detail: string;
};

/** Prisma accepte une chaîne ISO là où le domaine manipule des dates. */
function enDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  return v instanceof Date ? v : new Date(v);
}

/** `crm.clients.updated` → { tableSource: "clients", action: "updated" } */
export function analyserRoutingKey(
  routingKey: string,
): { tableSource: string; action: string } | null {
  const parts = routingKey.split(".");
  if (parts.length < 3) return null;
  return {
    tableSource: parts[parts.length - 2],
    action: parts[parts.length - 1],
  };
}

/**
 * Empreinte d'un message.
 *
 * Elle inclut la charge utile : deux mises à jour successives du même
 * enregistrement produisent deux empreintes différentes et sont toutes deux
 * appliquées, alors qu'une relivraison du même message est écartée.
 */
function empreinte(routingKey: string, charge: Record<string, unknown>): string {
  return createHash("sha256")
    .update(routingKey)
    .update(JSON.stringify(charge))
    .digest("hex");
}

// ---------------------------------------------------------------------------
// Point d'entrée
// ---------------------------------------------------------------------------

export async function appliquerEvenement(ev: EvenementRecu): Promise<IssueSynchro> {
  const cle = analyserRoutingKey(ev.routingKey);
  if (!cle) {
    return { resultat: "ERREUR", detail: `Routing key illisible : ${ev.routingKey}` };
  }

  const idCrm = Number(ev.charge.id);
  if (!Number.isInteger(idCrm)) {
    return { resultat: "ERREUR", detail: "Charge utile sans identifiant exploitable." };
  }

  const signature = empreinte(ev.routingKey, ev.charge);

  // Idempotence : si l'empreinte existe déjà, le message a déjà été traité.
  const deja = await prisma.evenementCrm.findUnique({
    where: { empreinte: signature },
    select: { resultat: true },
  });
  if (deja) {
    return {
      resultat: deja.resultat,
      detail: "Message déjà traité (relivraison du bus).",
    };
  }

  let issue: IssueSynchro;
  try {
    switch (cle.tableSource) {
      case "clients":
        issue = await appliquerClient(ev.charge as ClientCrm, cle.action);
        break;
      case "client_contacts":
        issue = await appliquerContact(ev.charge as ContactCrm, cle.action);
        break;
      default:
        issue = {
          resultat: "IGNORE_PERIME",
          detail: `Table « ${cle.tableSource} » non synchronisée.`,
        };
    }
  } catch (erreur) {
    issue = {
      resultat: "ERREUR",
      detail: erreur instanceof Error ? erreur.message : String(erreur),
    };
  }

  await prisma.evenementCrm.create({
    data: {
      routingKey: ev.routingKey,
      tableSource: cle.tableSource,
      action: cle.action,
      idCrm,
      empreinte: signature,
      resultat: issue.resultat,
      detail: issue.detail,
      charge: ev.charge as Prisma.InputJsonValue,
      traiteLe: new Date(),
    },
  });

  return issue;
}

// ---------------------------------------------------------------------------
// Clients → Organisation
// ---------------------------------------------------------------------------

async function appliquerClient(
  client: ClientCrm,
  action: string,
): Promise<IssueSynchro> {
  const existante = await prisma.organisation.findUnique({
    where: { idCrm: client.id },
  });

  // Suppression logique ou explicite : on détache la fiche sans jamais effacer
  // le travail commercial qui s'y rattache (leads, opportunités, activités).
  if (action === "deleted" || estSupprimeCrm(client)) {
    if (!existante) {
      return { resultat: "IGNORE_SUPPRIME", detail: "Fiche absente du kanban." };
    }
    await prisma.organisation.update({
      where: { id: existante.id },
      data: {
        idCrm: null, // libère l'identifiant pour une éventuelle recréation
        synchroniseLe: new Date(),
        notes: [existante.notes, "Supprimé côté CRM — fiche conservée ici."]
          .filter(Boolean)
          .join("\n"),
      },
    });
    return {
      resultat: "IGNORE_SUPPRIME",
      detail: `Organisation ${existante.reference} détachée du CRM.`,
    };
  }

  const donnees = organisationDepuisCrm(client);

  if (existante) {
    if (estPerime(enDate(donnees.versionCrm), existante.versionCrm)) {
      return {
        resultat: "IGNORE_PERIME",
        detail: "Événement antérieur à la version enregistrée.",
      };
    }
    await prisma.organisation.update({
      where: { id: existante.id },
      // Le segment n'est pas repris : il a pu être affiné par le commercial.
      data: donnees,
    });
    return {
      resultat: "MIS_A_JOUR",
      detail: `Organisation ${existante.reference} mise à jour.`,
    };
  }

  // Pas d'identifiant CRM connu : on tente un rapprochement avant de créer,
  // pour ne pas introduire de doublon face à une fiche saisie à la main.
  const criteres = criteresRapprochement(client);
  const candidate =
    criteres.length > 0
      ? await prisma.organisation.findFirst({
          where: { OR: criteres, idCrm: null, fusionneeDansId: null },
        })
      : null;

  if (candidate) {
    await prisma.organisation.update({
      where: { id: candidate.id },
      data: donnees,
    });
    return {
      resultat: "MIS_A_JOUR",
      detail: `Organisation ${candidate.reference} rapprochée du client CRM ${client.id}.`,
    };
  }

  const creee = await prisma.$transaction(async (tx) => {
    const reference = await genererReference(tx, "ORG");
    return tx.organisation.create({
      data: { ...donnees, reference, segment: segmentDepuisCrm(client) },
    });
  });

  return { resultat: "CREE", detail: `Organisation ${creee.reference} créée.` };
}

// ---------------------------------------------------------------------------
// Contacts → Contact
// ---------------------------------------------------------------------------

async function appliquerContact(
  contact: ContactCrm,
  action: string,
): Promise<IssueSynchro> {
  const existant = await prisma.contact.findUnique({
    where: { idCrm: contact.id },
  });

  if (action === "deleted") {
    if (!existant) {
      return { resultat: "IGNORE_SUPPRIME", detail: "Contact absent du kanban." };
    }
    // Le contact est conservé : des activités et des leads y sont rattachés.
    await prisma.contact.update({
      where: { id: existant.id },
      data: { idCrm: null, synchroniseLe: new Date() },
    });
    return { resultat: "IGNORE_SUPPRIME", detail: "Contact détaché du CRM." };
  }

  // Un contact n'a de sens que rattaché à son organisation.
  const organisation = await prisma.organisation.findUnique({
    where: { idCrm: contact.client_id },
    select: { id: true },
  });
  if (!organisation) {
    return {
      resultat: "ERREUR",
      detail: `Organisation CRM ${contact.client_id} inconnue : contact en attente.`,
    };
  }

  const donnees = contactDepuisCrm(contact, organisation.id);

  if (existant) {
    if (estPerime(enDate(donnees.versionCrm), existant.versionCrm)) {
      return {
        resultat: "IGNORE_PERIME",
        detail: "Événement antérieur à la version enregistrée.",
      };
    }
    await prisma.contact.update({ where: { id: existant.id }, data: donnees });
    return { resultat: "MIS_A_JOUR", detail: `Contact ${existant.nom} mis à jour.` };
  }

  // Rapprochement par e-mail au sein de la même organisation.
  const candidat = donnees.email
    ? await prisma.contact.findFirst({
        where: {
          email: donnees.email,
          organisationId: organisation.id,
          idCrm: null,
        },
      })
    : null;

  if (candidat) {
    await prisma.contact.update({ where: { id: candidat.id }, data: donnees });
    return { resultat: "MIS_A_JOUR", detail: `Contact ${candidat.nom} rapproché.` };
  }

  const cree = await prisma.contact.create({ data: donnees });
  return { resultat: "CREE", detail: `Contact ${cree.nom} créé.` };
}
