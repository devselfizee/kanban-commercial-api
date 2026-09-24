/**
 * Pipeline n°1 — boîte de qualification des leads (§4, §5).
 *
 * Les règles du document sont appliquées ici, côté serveur : le front peut les
 * refléter pour guider la saisie, il ne peut pas les contourner.
 */

import { Router } from "express";
import { z } from "zod";
import type { Prisma, StatutLead } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { genererReference } from "../lib/references";
import { journaliser } from "../lib/journal";
import { peutReattribuer, voitToutesLesCartes } from "../lib/auth";
import {
  calculerPriorite,
  estEnRetard,
  estTerminaleLead,
  joursDepuis,
  normaliserEmail,
  normaliserNom,
  normaliserTelephone,
  peutConvertir,
  priseEnChargeEnRetard,
  sansSuiviPlanifie,
} from "../domaine/regles";

const routes = Router();

// ---------------------------------------------------------------------------
// Lecture du tableau
// ---------------------------------------------------------------------------

routes.get("/", async (requete, reponse) => {
  const utilisateur = requete.utilisateur!;

  // Le commercial voit ses leads et le pool non attribué ; manager et direction
  // voient l'ensemble.
  const filtre: Prisma.LeadWhereInput = voitToutesLesCartes(utilisateur.role)
    ? {}
    : { OR: [{ proprietaireId: utilisateur.id }, { proprietaireId: null }] };

  const leads = await prisma.lead.findMany({
    where: filtre,
    orderBy: [{ rang: "asc" }, { creeLe: "desc" }],
    include: {
      organisation: { select: { nom: true, ville: true } },
      contactPrincipal: { select: { nom: true, prenom: true } },
      proprietaire: { select: { prenom: true, nom: true } },
      activites: {
        orderBy: { dateReelle: "desc" },
        take: 1,
        select: { objet: true, dateReelle: true },
      },
      _count: { select: { activites: true } },
      opportunite: { select: { id: true, reference: true } },
    },
  });

  const maintenant = new Date();

  reponse.json(
    leads.map((l) => {
      const terminale = estTerminaleLead(l.statut);
      const derniere = l.activites[0];
      return {
        id: l.id,
        reference: l.reference,
        statut: l.statut,
        priorite: l.priorite,
        modeAcquisition: l.modeAcquisition,
        canalDetaille: l.canalDetaille,
        segment: l.segment,
        projetRecherche: l.projetRecherche,
        nom: l.organisation?.nom ?? l.nomBrut,
        ville: l.ville ?? l.organisation?.ville,
        besoinResume: l.besoinResume,
        horizonIndicatif: l.horizonIndicatif,
        contact: l.contactPrincipal
          ? `${l.contactPrincipal.prenom ?? ""} ${l.contactPrincipal.nom}`.trim()
          : (l.emailBrut ?? l.telephoneBrut),
        responsable: l.proprietaire
          ? `${l.proprietaire.prenom} ${l.proprietaire.nom}`
          : null,
        prochaineActionLe: l.prochaineActionLe,
        prochaineActionLabel: l.prochaineActionLabel,
        prochaineActionEnRetard: estEnRetard(l.prochaineActionLe, maintenant),
        dateReactivation: l.dateReactivation,
        derniereActivite: derniere
          ? { objet: derniere.objet, date: derniere.dateReelle }
          : null,
        nbActivites: l._count.activites,
        ageEtape: joursDepuis(l.entreEnEtapeLe, maintenant),
        // Ces deux drapeaux viennent du serveur : le front ne recalcule pas des
        // règles métier, il les affiche.
        sansSuivi: sansSuiviPlanifie({
          prochaineActionLe: l.prochaineActionLe,
          dateReactivation: l.dateReactivation,
          terminale,
        }),
        priseEnChargeTardive: priseEnChargeEnRetard(
          l.modeAcquisition,
          l.creeLe,
          l.premierContactLe,
          maintenant,
        ),
        opportunite: l.opportunite,
      };
    }),
  );
});

// ---------------------------------------------------------------------------
// Fiche détaillée
// ---------------------------------------------------------------------------

routes.get("/:id", async (requete, reponse) => {
  const lead = await prisma.lead.findUnique({
    where: { id: requete.params.id },
    include: {
      organisation: true,
      contactPrincipal: true,
      proprietaire: { select: { id: true, prenom: true, nom: true } },
      opportunite: { select: { id: true, reference: true, titre: true } },
      activites: {
        orderBy: { dateReelle: "desc" },
        include: { auteur: { select: { prenom: true, nom: true } } },
      },
      taches: {
        orderBy: { echeance: "asc" },
        include: { responsable: { select: { prenom: true, nom: true } } },
      },
    },
  });

  if (!lead) return reponse.status(404).json({ erreur: "Lead introuvable." });

  const journal = await prisma.journalEntree.findMany({
    where: { typeObjet: "LEAD", objetId: lead.id },
    orderBy: { creeLe: "desc" },
    include: { auteur: { select: { prenom: true, nom: true } } },
  });

  reponse.json({ ...lead, journal });
});

// ---------------------------------------------------------------------------
// Création (§8)
// ---------------------------------------------------------------------------

const schemaCreation = z.object({
  modeAcquisition: z.enum(["ENTRANT", "PROSPECTION", "REACTIVATION"]),
  canalDetaille: z.string().min(1),
  nomBrut: z.string().optional(),
  emailBrut: z.string().optional(),
  telephoneBrut: z.string().optional(),
  organisationId: z.string().optional(),
  contactPrincipalId: z.string().optional(),
  segment: z.string().optional(),
  projetRecherche: z.string().optional(),
  besoinResume: z.string().optional(),
  horizonIndicatif: z.string().optional(),
  ville: z.string().optional(),
  proprietaireId: z.string().optional(),
  prochaineActionLe: z.string().min(1),
  prochaineActionLabel: z.string().min(1),
  devisDemande: z.boolean().optional(),
  clientExistant: z.boolean().optional(),
  joursAvantEcheance: z.number().optional(),
  valeurIndicative: z.number().optional(),
});

routes.post("/", async (requete, reponse) => {
  const utilisateur = requete.utilisateur!;
  const analyse = schemaCreation.safeParse(requete.body);
  if (!analyse.success) {
    return reponse.status(400).json({
      erreur: "Données invalides.",
      details: analyse.error.flatten().fieldErrors,
    });
  }
  const d = analyse.data;

  // §8 — à la création : identité, un moyen de contact, une prochaine action.
  if (!d.nomBrut?.trim() && !d.organisationId) {
    return reponse
      .status(400)
      .json({ erreur: "Indiquez un nom ou une organisation." });
  }
  if (!d.emailBrut?.trim() && !d.telephoneBrut?.trim() && !d.contactPrincipalId) {
    return reponse
      .status(400)
      .json({ erreur: "Indiquez au moins un moyen de contact." });
  }

  const { priorite } = calculerPriorite({
    estEntrant: d.modeAcquisition === "ENTRANT",
    joursAvantEcheance: d.joursAvantEcheance ?? null,
    devisDemande: d.devisDemande,
    clientExistant: d.clientExistant,
    valeurIndicative: d.valeurIndicative ?? null,
  });

  const attribue = Boolean(d.proprietaireId);
  const statut: StatutLead = attribue
    ? "PREMIER_CONTACT_A_REALISER"
    : "NOUVEAU_NON_ATTRIBUE";

  const prochaineActionLe = new Date(d.prochaineActionLe);
  const prochaineActionLabel = d.prochaineActionLabel.trim();

  const lead = await prisma.$transaction(async (tx) => {
    const reference = await genererReference(tx, "L");
    const max = await tx.lead.aggregate({
      where: { statut },
      _max: { rang: true },
    });

    const cree = await tx.lead.create({
      data: {
        reference,
        modeAcquisition: d.modeAcquisition,
        canalDetaille: d.canalDetaille as Prisma.LeadCreateInput["canalDetaille"],
        statut,
        priorite,
        segment: (d.segment || null) as Prisma.LeadCreateInput["segment"],
        projetRecherche:
          (d.projetRecherche as Prisma.LeadCreateInput["projetRecherche"]) ??
          "A_PRECISER",
        besoinResume: d.besoinResume?.trim() || null,
        horizonIndicatif: d.horizonIndicatif?.trim() || null,
        ville: d.ville?.trim() || null,
        nomBrut: d.nomBrut?.trim() || null,
        emailBrut: normaliserEmail(d.emailBrut ?? null),
        telephoneBrut: normaliserTelephone(d.telephoneBrut ?? null),
        organisationId: d.organisationId || null,
        contactPrincipalId: d.contactPrincipalId || null,
        proprietaireId: d.proprietaireId || null,
        dateAttribution: attribue ? new Date() : null,
        prochaineActionLe,
        prochaineActionLabel,
        rang: (max._max.rang ?? -1) + 1,
      },
    });

    await journaliser(tx, {
      typeObjet: "LEAD",
      objetId: cree.id,
      action: "CREATION",
      detail: `${cree.reference} créé (${d.modeAcquisition.toLowerCase()})`,
      auteurId: utilisateur.id,
    });

    // La prochaine action est aussi une tâche : elle apparaît dans « mes actions ».
    await tx.tache.create({
      data: {
        libelle: prochaineActionLabel,
        echeance: prochaineActionLe,
        responsableId: d.proprietaireId || null,
        leadId: cree.id,
      },
    });

    return cree;
  });

  reponse.status(201).json({ id: lead.id, reference: lead.reference });
});

// ---------------------------------------------------------------------------
// Prise en charge (§5)
// ---------------------------------------------------------------------------

routes.post("/:id/prendre-en-charge", async (requete, reponse) => {
  const utilisateur = requete.utilisateur!;
  const { le, label } = requete.body ?? {};
  if (!le || !String(label ?? "").trim()) {
    return reponse
      .status(400)
      .json({ erreur: "Indiquez une première action et son échéance." });
  }

  const lead = await prisma.lead.findUnique({ where: { id: requete.params.id } });
  if (!lead) return reponse.status(404).json({ erreur: "Lead introuvable." });

  if (
    lead.proprietaireId &&
    lead.proprietaireId !== utilisateur.id &&
    !peutReattribuer(utilisateur.role)
  ) {
    return reponse.status(403).json({
      erreur:
        "Cette carte appartient déjà à un autre commercial. Seul un manager peut la réattribuer.",
    });
  }

  await prisma.$transaction(async (tx) => {
    const statut: StatutLead =
      lead.statut === "NOUVEAU_NON_ATTRIBUE" || lead.statut === "A_PRENDRE_EN_CHARGE"
        ? "PREMIER_CONTACT_A_REALISER"
        : lead.statut;

    const max =
      statut !== lead.statut
        ? await tx.lead.aggregate({ where: { statut }, _max: { rang: true } })
        : null;

    await tx.lead.update({
      where: { id: lead.id },
      data: {
        proprietaireId: utilisateur.id,
        dateAttribution: new Date(),
        statut,
        entreEnEtapeLe: statut !== lead.statut ? new Date() : lead.entreEnEtapeLe,
        prochaineActionLe: new Date(le),
        prochaineActionLabel: String(label).trim(),
        rang: max ? (max._max.rang ?? -1) + 1 : lead.rang,
      },
    });

    await tx.tache.create({
      data: {
        libelle: String(label).trim(),
        echeance: new Date(le),
        responsableId: utilisateur.id,
        leadId: lead.id,
      },
    });

    await journaliser(tx, {
      typeObjet: "LEAD",
      objetId: lead.id,
      action: "PRISE_EN_CHARGE",
      detail: `Pris en charge par ${utilisateur.prenom} ${utilisateur.nom}`,
      auteurId: utilisateur.id,
    });
  });

  reponse.json({ message: "Carte prise en charge." });
});

// ---------------------------------------------------------------------------
// Réattribution (§5)
// ---------------------------------------------------------------------------

routes.post("/:id/reattribuer", async (requete, reponse) => {
  const utilisateur = requete.utilisateur!;
  if (!peutReattribuer(utilisateur.role)) {
    return reponse
      .status(403)
      .json({ erreur: "Seul un manager peut réattribuer une carte." });
  }

  const { destinataireId, motif } = requete.body ?? {};
  if (!String(motif ?? "").trim()) {
    return reponse
      .status(400)
      .json({ erreur: "Le motif de réattribution est obligatoire." });
  }

  const lead = await prisma.lead.findUnique({
    where: { id: requete.params.id },
    include: { proprietaire: true },
  });
  if (!lead) return reponse.status(404).json({ erreur: "Lead introuvable." });

  const nouveau = await prisma.utilisateur.findUnique({
    where: { id: String(destinataireId) },
  });
  if (!nouveau) {
    return reponse.status(400).json({ erreur: "Destinataire introuvable." });
  }

  await prisma.$transaction(async (tx) => {
    await tx.lead.update({
      where: { id: lead.id },
      data: { proprietaireId: nouveau.id, dateAttribution: new Date() },
    });
    // Le journal conserve l'ancien et le nouveau propriétaire, la date, l'auteur
    // et le motif.
    await journaliser(tx, {
      typeObjet: "LEAD",
      objetId: lead.id,
      action: "REATTRIBUTION",
      ancienneValeur: lead.proprietaire
        ? `${lead.proprietaire.prenom} ${lead.proprietaire.nom}`
        : "non attribué",
      nouvelleValeur: `${nouveau.prenom} ${nouveau.nom}`,
      motif: String(motif).trim(),
      auteurId: utilisateur.id,
    });
  });

  reponse.json({ message: "Carte réattribuée." });
});

// ---------------------------------------------------------------------------
// Déplacement dans le kanban
// ---------------------------------------------------------------------------

routes.patch("/:id/deplacer", async (requete, reponse) => {
  const utilisateur = requete.utilisateur!;
  const { statut, rang } = requete.body ?? {};

  const lead = await prisma.lead.findUnique({ where: { id: requete.params.id } });
  if (!lead) return reponse.status(404).json({ erreur: "Lead introuvable." });

  // La clôture passe par son action dédiée : elle exige un motif.
  if (statut === "NON_QUALIFIE_CLOTURE" && !lead.motifCloture) {
    return reponse.status(400).json({
      erreur:
        "Utilisez « Clôturer » pour renseigner le motif obligatoire et la date de clôture.",
    });
  }

  await prisma.$transaction(async (tx) => {
    if (statut !== lead.statut) {
      await journaliser(tx, {
        typeObjet: "LEAD",
        objetId: lead.id,
        action: "CHANGEMENT_ETAPE",
        ancienneValeur: lead.statut,
        nouvelleValeur: String(statut),
        auteurId: utilisateur.id,
      });
    }

    await tx.lead.update({
      where: { id: lead.id },
      data: {
        statut: statut as StatutLead,
        rang: Number(rang ?? 0),
        entreEnEtapeLe: statut !== lead.statut ? new Date() : lead.entreEnEtapeLe,
        // Le premier contact réalisé alimente le délai de prise en charge.
        premierContactLe:
          !lead.premierContactLe &&
          statut !== "NOUVEAU_NON_ATTRIBUE" &&
          statut !== "A_PRENDRE_EN_CHARGE" &&
          statut !== "PREMIER_CONTACT_A_REALISER"
            ? new Date()
            : lead.premierContactLe,
      },
    });
  });

  reponse.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Conversion en opportunité (§1, §4)
// ---------------------------------------------------------------------------

routes.post("/:id/convertir", async (requete, reponse) => {
  const utilisateur = requete.utilisateur!;
  const d = requete.body ?? {};

  const lead = await prisma.lead.findUnique({
    where: { id: requete.params.id },
    include: { opportunite: true },
  });
  if (!lead) return reponse.status(404).json({ erreur: "Lead introuvable." });
  if (lead.opportunite) {
    return reponse.status(409).json({ erreur: "Ce lead est déjà converti." });
  }

  const verification = peutConvertir({
    organisation: Boolean(lead.organisationId || String(d.nomOrganisation ?? "").trim()),
    interlocuteurPrincipal: Boolean(
      lead.contactPrincipalId || lead.emailBrut || lead.telephoneBrut,
    ),
    besoinOuCasDUsage: Boolean(lead.besoinResume?.trim()),
    solutionEnvisagee: Boolean(String(d.solutionEnvisagee ?? "").trim()),
    horizonDecisionOuEvenement: Boolean(d.dateCible),
    prochaineEtape: Boolean(d.prochaineActionLe && String(d.prochaineActionLabel ?? "").trim()),
  });

  if (!verification.ok) {
    return reponse.status(400).json({
      erreur: `Qualification incomplète : il manque ${verification.manquants.join(", ")}.`,
      manquants: verification.manquants,
    });
  }

  const opportunite = await prisma.$transaction(async (tx) => {
    // L'organisation est créée si le lead n'en portait pas encore.
    let organisationId = lead.organisationId;
    if (!organisationId) {
      const refOrg = await genererReference(tx, "ORG");
      const org = await tx.organisation.create({
        data: {
          reference: refOrg,
          nom: String(d.nomOrganisation).trim(),
          segment: lead.segment ?? "AUTRE_PROFESSIONNEL",
          estParticulier: lead.segment === "PARTICULIER",
          email: lead.emailBrut,
          telephone: lead.telephoneBrut,
          ville: lead.ville,
          modeAcquisitionInitial: lead.modeAcquisition,
          canalInitial: lead.canalDetaille,
          dateCollecte: lead.creeLe,
          proprietaireId: lead.proprietaireId,
        },
      });
      organisationId = org.id;
      await tx.lead.update({ where: { id: lead.id }, data: { organisationId } });
    }

    const reference = await genererReference(tx, "OPP");
    const max = await tx.opportunite.aggregate({
      where: { etape: "QUALIFICATION_VALIDEE" },
      _max: { rang: true },
    });

    const opp = await tx.opportunite.create({
      data: {
        reference,
        titre: String(d.titre).trim(),
        etape: "QUALIFICATION_VALIDEE",
        priorite: lead.priorite,
        projetRecherche: lead.projetRecherche,
        solutionEnvisagee: String(d.solutionEnvisagee).trim(),
        quantiteBornes: d.quantiteBornes ? Number(d.quantiteBornes) : null,
        dateCible: new Date(d.dateCible),
        montantVente: d.montantVente ? Number(d.montantVente) : null,
        loyerMensuelEnvisage: d.loyerMensuelEnvisage
          ? Number(d.loyerMensuelEnvisage)
          : null,
        dureeLldMois: d.dureeLldMois ? Number(d.dureeLldMois) : null,
        organisationId: organisationId!,
        contactPrincipalId: lead.contactPrincipalId,
        commercialId: d.commercialId || lead.proprietaireId || utilisateur.id,
        leadId: lead.id,
        prochaineActionLe: new Date(d.prochaineActionLe),
        prochaineActionLabel: String(d.prochaineActionLabel).trim(),
        rang: (max._max.rang ?? -1) + 1,
      },
    });

    // Le lead sort du tableau de qualification en conservant son historique.
    await tx.lead.update({
      where: { id: lead.id },
      data: { statut: "QUALIFIE_A_CONVERTIR", entreEnEtapeLe: new Date() },
    });

    await tx.tache.create({
      data: {
        libelle: String(d.prochaineActionLabel).trim(),
        echeance: new Date(d.prochaineActionLe),
        responsableId: opp.commercialId,
        opportuniteId: opp.id,
      },
    });

    await journaliser(tx, {
      typeObjet: "LEAD",
      objetId: lead.id,
      action: "CONVERSION_LEAD",
      detail: `Converti en ${opp.reference}`,
      nouvelleValeur: opp.reference,
      auteurId: utilisateur.id,
    });
    await journaliser(tx, {
      typeObjet: "OPPORTUNITE",
      objetId: opp.id,
      action: "CREATION",
      detail: `Créée depuis le lead ${lead.reference}`,
      auteurId: utilisateur.id,
    });

    return opp;
  });

  reponse
    .status(201)
    .json({ id: opportunite.id, reference: opportunite.reference });
});

// ---------------------------------------------------------------------------
// Clôture et nurturing
// ---------------------------------------------------------------------------

routes.post("/:id/cloturer", async (requete, reponse) => {
  const utilisateur = requete.utilisateur!;
  const { motif, commentaire } = requete.body ?? {};

  if (!motif) {
    return reponse
      .status(400)
      .json({ erreur: "Le motif de clôture est obligatoire." });
  }
  if (motif === "AUTRE" && !String(commentaire ?? "").trim()) {
    return reponse
      .status(400)
      .json({ erreur: "Le motif « Autre » exige un commentaire." });
  }

  await prisma.$transaction(async (tx) => {
    await tx.lead.update({
      where: { id: requete.params.id },
      data: {
        statut: "NON_QUALIFIE_CLOTURE",
        motifCloture: motif,
        commentaireCloture: String(commentaire ?? "").trim() || null,
        dateCloture: new Date(),
        prochaineActionLe: null,
        prochaineActionLabel: null,
        entreEnEtapeLe: new Date(),
      },
    });
    // Les tâches ouvertes n'ont plus lieu d'être ; la carte n'est pas supprimée.
    await tx.tache.updateMany({
      where: { leadId: requete.params.id, faite: false },
      data: { faite: true, faiteLe: new Date(), resultat: "Lead clôturé" },
    });
    await journaliser(tx, {
      typeObjet: "LEAD",
      objetId: requete.params.id,
      action: "CLOTURE",
      nouvelleValeur: String(motif),
      motif: String(commentaire ?? "").trim() || null,
      auteurId: utilisateur.id,
    });
  });

  reponse.json({ message: "Lead clôturé." });
});

routes.post("/:id/nurturing", async (requete, reponse) => {
  const utilisateur = requete.utilisateur!;
  const { dateReactivation } = requete.body ?? {};

  if (!dateReactivation) {
    return reponse.status(400).json({
      erreur:
        "Une date de réactivation est obligatoire : un lead en nurturing n'est pas un lead perdu.",
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.lead.update({
      where: { id: requete.params.id },
      data: {
        statut: "NURTURING_A_REACTIVER",
        dateReactivation: new Date(dateReactivation),
        priorite: "P4_NURTURING",
        entreEnEtapeLe: new Date(),
      },
    });
    await journaliser(tx, {
      typeObjet: "LEAD",
      objetId: requete.params.id,
      action: "CHANGEMENT_ETAPE",
      nouvelleValeur: "NURTURING_A_REACTIVER",
      detail: `Réactivation prévue le ${new Date(dateReactivation).toLocaleDateString("fr-FR")}`,
      auteurId: utilisateur.id,
    });
  });

  reponse.json({ message: "Lead placé en nurturing." });
});

// ---------------------------------------------------------------------------
// Détection de doublons (§10)
// ---------------------------------------------------------------------------

routes.get("/doublons/rechercher", async (requete, reponse) => {
  const email = normaliserEmail(String(requete.query.email ?? "") || null);
  const telephone = normaliserTelephone(String(requete.query.telephone ?? "") || null);
  const nom = normaliserNom(String(requete.query.nom ?? "") || null);
  const siren = String(requete.query.siren ?? "").replace(/\D/g, "") || null;

  if (!email && !telephone && !nom && !siren) return reponse.json([]);

  const ou: Prisma.OrganisationWhereInput[] = [];
  if (email) ou.push({ email });
  if (telephone) ou.push({ telephone });
  if (siren) ou.push({ siren });
  if (nom) ou.push({ nom: { contains: nom, mode: "insensitive" } });

  reponse.json(
    await prisma.organisation.findMany({
      where: { OR: ou, fusionneeDansId: null },
      include: {
        contacts: true,
        _count: { select: { leads: true, opportunites: true } },
      },
      take: 10,
    }),
  );
});

export default routes;
