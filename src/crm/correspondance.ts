/**
 * Correspondance entre les enregistrements du CRM Selfizee (CakePHP / MySQL)
 * et les objets du kanban.
 *
 * Sens unique : le CRM fait autorité sur l'identité du client. Le kanban ne
 * réécrit jamais ces champs vers lui, et conserve la main sur ce qui lui est
 * propre — leads, étapes commerciales, priorités, activités, dossiers LLD.
 *
 * Pièges du schéma CRM, relevés à la lecture du code :
 *   - `clients.deleted = 1` est une suppression logique, pas une ligne à ignorer
 *     silencieusement : la fiche doit être détachée côté kanban.
 *   - le téléphone d'un contact est dans `client_contacts.tel`, pas `telephone`.
 *   - `devis.is_model = 1` désigne un modèle de devis, pas un devis réel.
 *   - la table `contacts` désigne le personnel des antennes : ce ne sont PAS
 *     les interlocuteurs clients, qui vivent dans `client_contacts`.
 */

import type { Prisma, SegmentClient } from "@prisma/client";
import { normaliserEmail, normaliserNom, normaliserTelephone } from "@/domaine/regles";

// ---------------------------------------------------------------------------
// Forme des enregistrements reçus
// ---------------------------------------------------------------------------

/** Ligne `clients` du CRM, telle que publiée sur le bus (`$entity->toArray()`). */
export type ClientCrm = {
  id: number;
  client_type?: string | null; // 'person' | 'corporation'
  genre?: string | null;
  nom?: string | null;
  prenom?: string | null;
  enseigne?: string | null;
  email?: string | null;
  telephone?: string | null;
  telephone_2?: string | null;
  mobile?: string | null;
  adresse?: string | null;
  ville?: string | null;
  cp?: string | null;
  country?: string | null;
  pays_iso?: string | null;
  siren?: string | null;
  siret?: string | null;
  type_commercial?: string | null; // 'client' | 'prospect'
  secteurs_activite_id?: number | null;
  deleted?: number | boolean | null;
  created?: string | null;
  modified?: string | null;
};

/** Ligne `client_contacts` du CRM. */
export type ContactCrm = {
  id: number;
  client_id: number;
  civilite?: string | null;
  nom?: string | null;
  prenom?: string | null;
  position?: string | null; // la fonction chez le client
  email?: string | null;
  tel?: string | null; // attention : `tel`, pas `telephone`
  telephone_2?: string | null;
  optin?: number | boolean | null;
  receive_information?: number | boolean | null;
  deleted_by_webhooks?: number | boolean | null;
  created?: string | null;
  modified?: string | null;
};

// ---------------------------------------------------------------------------
// Segment client
// ---------------------------------------------------------------------------

/**
 * Le CRM ne porte pas la notion de segment du document (agence évènementielle,
 * lieu de réception, hôtel…). On déduit seulement ce qui est certain :
 * particulier ou professionnel. Le segment précis reste à la main du commercial
 * dans le kanban, et une synchronisation ultérieure ne l'écrase pas.
 */
export function segmentDepuisCrm(c: ClientCrm): SegmentClient {
  const estParticulier =
    c.client_type === "person" || c.genre === "person";
  return estParticulier ? "PARTICULIER" : "AUTRE_PROFESSIONNEL";
}

export function estParticulier(c: ClientCrm): boolean {
  return c.client_type === "person" || c.genre === "person";
}

/**
 * Nom affiché.
 * Une société est identifiée par son enseigne ; à défaut on retombe sur
 * « nom prénom », qui est le cas normal d'un particulier.
 */
export function nomDepuisCrm(c: ClientCrm): string {
  const enseigne = c.enseigne?.trim();
  if (enseigne) return enseigne;
  const complet = [c.prenom, c.nom].map((p) => p?.trim()).filter(Boolean).join(" ");
  return complet || `Client CRM ${c.id}`;
}

// ---------------------------------------------------------------------------
// Conversions
// ---------------------------------------------------------------------------

function booleen(v: number | boolean | null | undefined): boolean {
  return v === true || v === 1;
}

function dateOuNull(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Un SIREN/SIRET n'est conservé que s'il a la bonne longueur. */
function identifiantLegal(v: string | null | undefined, longueur: number): string | null {
  const chiffres = v?.replace(/\D/g, "") ?? "";
  return chiffres.length === longueur ? chiffres : null;
}

/**
 * SIREN retenu pour une fiche : le champ `siren` s'il est valide, sinon les neuf
 * premiers chiffres du SIRET, qui le contient par construction.
 *
 * Cette dérivation doit être identique à l'écriture et au rapprochement, faute
 * de quoi une fiche est créée en double au lieu d'être reconnue.
 */
function sirenRetenu(c: ClientCrm): string | null {
  return identifiantLegal(c.siren, 9) ?? identifiantLegal(c.siret, 14)?.slice(0, 9) ?? null;
}

// ---------------------------------------------------------------------------
// Organisation
// ---------------------------------------------------------------------------

/**
 * Champs d'une organisation pilotés par le CRM.
 *
 * Volontairement absents : `segment` (affiné par le commercial), `proprietaire`,
 * `notes`, et tout ce qui relève du travail commercial. Ils ne doivent pas être
 * écrasés par une synchronisation.
 */
export function organisationDepuisCrm(
  c: ClientCrm,
): Omit<Prisma.OrganisationUncheckedCreateInput, "reference" | "segment"> {
  return {
    idCrm: c.id,
    nom: nomDepuisCrm(c),
    estParticulier: estParticulier(c),
    email: normaliserEmail(c.email ?? null),
    telephone: normaliserTelephone(c.telephone ?? c.mobile ?? null),
    siren: sirenRetenu(c),
    adresse: c.adresse?.trim() || null,
    codePostal: c.cp?.trim() || null,
    ville: c.ville?.trim() || null,
    pays: c.country?.trim() || "France",
    versionCrm: dateOuNull(c.modified),
    synchroniseLe: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Contact
// ---------------------------------------------------------------------------

export function contactDepuisCrm(
  c: ContactCrm,
  organisationId: string,
): Omit<Prisma.ContactUncheckedCreateInput, "id"> {
  return {
    idCrm: c.id,
    organisationId,
    nom: c.nom?.trim() || `Contact ${c.id}`,
    prenom: c.prenom?.trim() || null,
    role: c.position?.trim() || null,
    email: normaliserEmail(c.email ?? null),
    // `tel` côté CRM, et non `telephone`.
    telephone: normaliserTelephone(c.tel ?? null),
    mobile: normaliserTelephone(c.telephone_2 ?? null),
    // `optin` gouverne la prospection : sans lui, pas de sollicitation.
    accepteEmail: booleen(c.optin) || booleen(c.receive_information),
    accepteTelephone: true,
    accepteSms: false,
    versionCrm: dateOuNull(c.modified),
    synchroniseLe: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Rapprochement d'un client existant
// ---------------------------------------------------------------------------

/**
 * Critères de rapprochement, du plus fiable au moins fiable.
 *
 * Le SIRET identifie un établissement de façon certaine ; l'e-mail et le
 * téléphone sont des indices, utilisés seulement en dernier recours et
 * uniquement pour un premier appariement — jamais pour fusionner deux fiches
 * déjà rattachées à des identifiants CRM différents.
 */
export function criteresRapprochement(c: ClientCrm): Prisma.OrganisationWhereInput[] {
  const criteres: Prisma.OrganisationWhereInput[] = [];

  const siren = sirenRetenu(c);
  if (siren) criteres.push({ siren });

  const email = normaliserEmail(c.email ?? null);
  if (email) criteres.push({ email });

  const telephone = normaliserTelephone(c.telephone ?? null);
  if (telephone) criteres.push({ telephone });

  const nom = normaliserNom(nomDepuisCrm(c));
  if (nom && nom.length > 3) {
    criteres.push({ nom: { equals: nomDepuisCrm(c), mode: "insensitive" } });
  }

  return criteres;
}

/** Une ligne supprimée logiquement côté CRM ne doit plus alimenter le kanban. */
export function estSupprimeCrm(c: ClientCrm): boolean {
  return booleen(c.deleted);
}

/**
 * Un événement plus ancien que la version déjà enregistrée est ignoré :
 * le bus ne garantit pas l'ordre de livraison.
 */
export function estPerime(
  versionRecue: Date | null,
  versionEnregistree: Date | null,
): boolean {
  if (!versionRecue || !versionEnregistree) return false;
  return versionRecue.getTime() < versionEnregistree.getTime();
}
