/**
 * Pipeline n°3 — dossier LLD / GRENKE (§7).
 *
 * Règle absolue de ce module : on enregistre des faits observables
 * (transmission, retour communiqué, signature, livraison) et l'on ne déduit
 * jamais une décision de financement. Aucune route ici ne calcule, n'estime ni
 * n'expose de probabilité d'acceptation.
 */

import { Router } from "express";
import type { Prisma, StatutLld } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { journaliser } from "../lib/journal";
import {
  peutModifierLld,
  peutVoirDocumentsFinanciers,
  voitToutesLesCartes,
} from "../lib/auth";
import {
  estEnRetard,
  estTerminaleLld,
  joursDepuis,
  sansSuiviPlanifie,
  verifierCompatibilitePartenaire,
} from "../domaine/regles";

const routes = Router();

function dansNJours(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(9, 0, 0, 0);
  return d;
}

/** Les faits requis avant d'entrer dans un statut donné. */
function verifierPrerequisStatut(
  dossier: {
    dateTransmission: Date | null;
    dateRetourCommunique: Date | null;
    signatureClientLe: Date | null;
    dateLivraisonConfirmee: Date | null;
    motifCloture: string | null;
  },
  statut: StatutLld,
): string | null {
  switch (statut) {
    case "TRANSMIS_A_GRENKE":
      return dossier.dateTransmission
        ? null
        : "Utilisez « Transmettre » pour horodater l'envoi et conserver la preuve de transmission.";
    case "REPONSE_COMMUNIQUEE_PAR_GRENKE":
      return dossier.dateRetourCommunique
        ? null
        : "Enregistrez d'abord le retour effectivement communiqué par le partenaire, avec sa date et sa source.";
    case "SIGNE_LIVRAISON_A_CONFIRMER":
      return dossier.signatureClientLe
        ? null
        : "Enregistrez d'abord la signature client.";
    case "LIVRAISON_CONFIRMEE_CONTRAT_ACTIF":
      return dossier.dateLivraisonConfirmee
        ? null
        : "La carte ne peut pas passer à « contrat actif » sans évènement de confirmation de livraison saisi.";
    case "CLOTURE_NON_POURSUIVI":
      return dossier.motifCloture
        ? null
        : "Utilisez « Clôturer » pour choisir un motif factuel.";
    default:
      return null;
  }
}

/** Garde commune aux actions qui font progresser un dossier. */
function exigerDroitLld(
  requete: Parameters<Parameters<typeof routes.post>[1]>[0],
  reponse: Parameters<Parameters<typeof routes.post>[1]>[1],
): boolean {
  if (!peutModifierLld(requete.utilisateur!.role)) {
    reponse.status(403).json({
      erreur:
        "Seules la collaboratrice LLD et le manager font progresser un dossier de financement.",
    });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Lecture du tableau
// ---------------------------------------------------------------------------

routes.get("/", async (requete, reponse) => {
  const utilisateur = requete.utilisateur!;

  // La collaboratrice voit ses dossiers ; manager et direction voient tout ;
  // le commercial voit ceux de ses opportunités.
  const filtre: Prisma.DossierLldWhereInput = voitToutesLesCartes(utilisateur.role)
    ? {}
    : utilisateur.role === "COLLABORATRICE_LLD"
      ? { collaboratriceId: utilisateur.id }
      : { commercialId: utilisateur.id };

  const dossiers = await prisma.dossierLld.findMany({
    where: filtre,
    orderBy: [{ rang: "asc" }, { creeLe: "desc" }],
    include: {
      opportunite: {
        select: {
          id: true,
          reference: true,
          titre: true,
          organisation: { select: { nom: true, ville: true } },
        },
      },
      collaboratrice: { select: { prenom: true, nom: true } },
      checklist: { select: { fait: true } },
      activites: {
        orderBy: { dateReelle: "desc" },
        take: 1,
        select: { objet: true, dateReelle: true },
      },
      _count: { select: { activites: true } },
    },
  });

  const maintenant = new Date();

  reponse.json(
    dossiers.map((d) => {
      const alerte = verifierCompatibilitePartenaire(
        d.dureeDemandeeMois,
        d.montantFinance ? Number(d.montantFinance) : null,
      );

      return {
        id: d.id,
        reference: d.reference,
        statut: d.statut,
        dureeDemandeeMois: d.dureeDemandeeMois,
        montantFinance: d.montantFinance ? Number(d.montantFinance) : null,
        loyerMensuel: d.loyerMensuel ? Number(d.loyerMensuel) : null,
        locataire: d.locataire,
        nom: d.locataire ?? d.opportunite.organisation.nom,
        ville: d.opportunite.organisation.ville,
        titreOpportunite: d.opportunite.titre,
        referenceOpportunite: d.opportunite.reference,
        opportuniteId: d.opportunite.id,
        checklistFaits: d.checklist.filter((c) => c.fait).length,
        checklistTotal: d.checklist.length,
        dateTransmission: d.dateTransmission,
        canalTransmission: d.canalTransmission,
        elementAttenduLabel: d.elementAttenduLabel,
        dateLivraisonPrevue: d.dateLivraisonPrevue,
        prochaineRelanceLe: d.prochaineRelanceLe,
        prochaineActionLe: d.prochaineActionLe,
        prochaineActionLabel: d.prochaineActionLabel,
        prochaineActionEnRetard: estEnRetard(d.prochaineActionLe, maintenant),
        responsable: d.collaboratrice
          ? `${d.collaboratrice.prenom} ${d.collaboratrice.nom}`
          : null,
        derniereActivite: d.activites[0]
          ? { objet: d.activites[0].objet, date: d.activites[0].dateReelle }
          : null,
        nbActivites: d._count.activites,
        ageEtape: joursDepuis(d.entreEnEtapeLe, maintenant),
        sansSuivi: sansSuiviPlanifie({
          prochaineActionLe: d.prochaineActionLe,
          prochaineRelanceLe: d.prochaineRelanceLe,
          terminale: estTerminaleLld(d.statut),
        }),
        alerteCompatibilite: alerte.message,
      };
    }),
  );
});

// ---------------------------------------------------------------------------
// Fiche détaillée
// ---------------------------------------------------------------------------

routes.get("/:id", async (requete, reponse) => {
  const utilisateur = requete.utilisateur!;

  const dossier = await prisma.dossierLld.findUnique({
    where: { id: requete.params.id },
    include: {
      opportunite: { include: { organisation: true, contactPrincipal: true } },
      collaboratrice: { select: { prenom: true, nom: true } },
      commercial: { select: { prenom: true, nom: true } },
      checklist: { orderBy: { ordre: "asc" } },
      documents: true,
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

  if (!dossier) return reponse.status(404).json({ erreur: "Dossier introuvable." });

  const journal = await prisma.journalEntree.findMany({
    where: { typeObjet: "DOSSIER_LLD", objetId: dossier.id },
    orderBy: { creeLe: "desc" },
    include: { auteur: { select: { prenom: true, nom: true } } },
  });

  const alerte = verifierCompatibilitePartenaire(
    dossier.dureeDemandeeMois,
    dossier.montantFinance ? Number(dossier.montantFinance) : null,
  );

  // Les documents liés au financement ne sont accessibles qu'aux personnes qui
  // les traitent (§12) : le commercial n'en reçoit que le nombre.
  const voitDocuments = peutVoirDocumentsFinanciers(utilisateur.role);

  reponse.json({
    ...dossier,
    documents: voitDocuments ? dossier.documents : [],
    nbDocuments: dossier.documents.length,
    voitDocuments,
    journal,
    alerteCompatibilite: alerte.message,
    peutModifier: peutModifierLld(utilisateur.role),
  });
});

// ---------------------------------------------------------------------------
// Déplacement
// ---------------------------------------------------------------------------

routes.patch("/:id/deplacer", async (requete, reponse) => {
  if (!exigerDroitLld(requete, reponse)) return;
  const utilisateur = requete.utilisateur!;
  const { statut, rang } = requete.body ?? {};

  const dossier = await prisma.dossierLld.findUnique({
    where: { id: requete.params.id },
  });
  if (!dossier) return reponse.status(404).json({ erreur: "Dossier introuvable." });

  const blocage = verifierPrerequisStatut(dossier, statut as StatutLld);
  if (blocage) return reponse.status(400).json({ erreur: blocage });

  await prisma.$transaction(async (tx) => {
    if (statut !== dossier.statut) {
      await journaliser(tx, {
        typeObjet: "DOSSIER_LLD",
        objetId: dossier.id,
        action: "CHANGEMENT_ETAPE",
        ancienneValeur: dossier.statut,
        nouvelleValeur: String(statut),
        auteurId: utilisateur.id,
      });
    }
    await tx.dossierLld.update({
      where: { id: dossier.id },
      data: {
        statut: statut as StatutLld,
        rang: Number(rang ?? 0),
        entreEnEtapeLe:
          statut !== dossier.statut ? new Date() : dossier.entreEnEtapeLe,
      },
    });
  });

  reponse.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Checklist interne
// ---------------------------------------------------------------------------

routes.patch("/checklist/:itemId", async (requete, reponse) => {
  if (!exigerDroitLld(requete, reponse)) return;
  const utilisateur = requete.utilisateur!;
  const fait = Boolean(requete.body?.fait);

  await prisma.checklistItem.update({
    where: { id: requete.params.itemId },
    data: {
      fait,
      faitLe: fait ? new Date() : null,
      faitPar: fait ? `${utilisateur.prenom} ${utilisateur.nom}` : null,
    },
  });

  reponse.json({ ok: true });
});

/**
 * Passe le dossier en « prêt à transmettre ».
 * La collaboratrice valide elle-même cet état : aucune automatisation ne le fait
 * à sa place, même quand la checklist est complète.
 */
routes.post("/:id/pret-a-transmettre", async (requete, reponse) => {
  if (!exigerDroitLld(requete, reponse)) return;
  const utilisateur = requete.utilisateur!;

  const dossier = await prisma.dossierLld.findUnique({
    where: { id: requete.params.id },
    include: { checklist: true },
  });
  if (!dossier) return reponse.status(404).json({ erreur: "Dossier introuvable." });

  const restants = dossier.checklist.filter((i) => !i.fait);
  if (restants.length > 0) {
    return reponse.status(400).json({
      erreur: `Checklist interne incomplète : ${restants.length} point(s) restant(s).`,
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.dossierLld.update({
      where: { id: dossier.id },
      data: {
        statut: "PRET_A_TRANSMETTRE",
        entreEnEtapeLe: new Date(),
        prochaineActionLabel: "Transmettre par le canal convenu",
        prochaineActionLe: dansNJours(1),
      },
    });
    await journaliser(tx, {
      typeObjet: "DOSSIER_LLD",
      objetId: dossier.id,
      action: "CHANGEMENT_ETAPE",
      ancienneValeur: dossier.statut,
      nouvelleValeur: "PRET_A_TRANSMETTRE",
      detail: "Complétude validée par la collaboratrice",
      auteurId: utilisateur.id,
    });
  });

  reponse.json({ message: "Dossier prêt à transmettre." });
});

// ---------------------------------------------------------------------------
// Transmission (§8 — rendre le suivi externe auditable)
// ---------------------------------------------------------------------------

routes.post("/:id/transmettre", async (requete, reponse) => {
  if (!exigerDroitLld(requete, reponse)) return;
  const utilisateur = requete.utilisateur!;
  const { dateTransmission, canal, preuve, prochaineRelanceLe } = requete.body ?? {};

  if (!dateTransmission || !String(canal ?? "").trim()) {
    return reponse
      .status(400)
      .json({ erreur: "La date et le canal de transmission sont obligatoires." });
  }
  if (!String(preuve ?? "").trim()) {
    return reponse.status(400).json({
      erreur:
        "Indiquez la preuve ou la référence de transmission : le suivi externe doit être auditable.",
    });
  }
  if (!prochaineRelanceLe) {
    return reponse
      .status(400)
      .json({ erreur: "Planifiez une relance factuelle dans le délai interne convenu." });
  }

  const dossier = await prisma.dossierLld.findUnique({
    where: { id: requete.params.id },
  });
  if (!dossier) return reponse.status(404).json({ erreur: "Dossier introuvable." });

  await prisma.$transaction(async (tx) => {
    await tx.dossierLld.update({
      where: { id: dossier.id },
      data: {
        statut: "TRANSMIS_A_GRENKE",
        entreEnEtapeLe: new Date(),
        dateTransmission: new Date(dateTransmission),
        canalTransmission: String(canal).trim(),
        auteurTransmission: `${utilisateur.prenom} ${utilisateur.nom}`,
        preuveTransmission: String(preuve).trim(),
        prochaineRelanceLe: new Date(prochaineRelanceLe),
        prochaineActionLe: new Date(prochaineRelanceLe),
        prochaineActionLabel: "Relance factuelle si aucun accusé reçu",
      },
    });

    await tx.activite.create({
      data: {
        type: "ACTIVITE_LLD",
        sens: "SORTANT",
        objet: "Demande transmise au partenaire",
        contenu: `Canal : ${String(canal).trim()} — preuve : ${String(preuve).trim()}`,
        dateReelle: new Date(dateTransmission),
        resultat: "Demande envoyée",
        suiteAttendue: `Contrôle le ${new Date(prochaineRelanceLe).toLocaleDateString("fr-FR")}`,
        auteurId: utilisateur.id,
        dossierLldId: dossier.id,
      },
    });

    await tx.tache.create({
      data: {
        libelle: "Vérifier l'accusé de réception du partenaire",
        detail: "Relance factuelle. Ne déduire aucune décision en l'absence de retour.",
        echeance: new Date(prochaineRelanceLe),
        responsableId: dossier.collaboratriceId,
        dossierLldId: dossier.id,
      },
    });

    await journaliser(tx, {
      typeObjet: "DOSSIER_LLD",
      objetId: dossier.id,
      action: "TRANSMISSION_LLD",
      detail: `Transmis le ${new Date(dateTransmission).toLocaleDateString("fr-FR")} via ${String(canal).trim()}`,
      nouvelleValeur: String(preuve).trim(),
      auteurId: utilisateur.id,
    });
  });

  reponse.json({ message: "Transmission enregistrée." });
});

// ---------------------------------------------------------------------------
// Retour partenaire — on enregistre ce qui a été communiqué, rien de plus
// ---------------------------------------------------------------------------

routes.post("/:id/retour-partenaire", async (requete, reponse) => {
  if (!exigerDroitLld(requete, reponse)) return;
  const utilisateur = requete.utilisateur!;
  const {
    dateRetour,
    source,
    contenu,
    statutSuivant,
    prochaineActionLe,
    prochaineActionLabel,
  } = requete.body ?? {};

  if (!dateRetour || !String(source ?? "").trim() || !String(contenu ?? "").trim()) {
    return reponse.status(400).json({
      erreur: "La date, la source et le contenu du retour communiqué sont obligatoires.",
    });
  }

  const statutsAdmis: StatutLld[] = [
    "REPONSE_COMMUNIQUEE_PAR_GRENKE",
    "RETOUR_ANALYSE_EN_ATTENTE",
    "EN_ATTENTE_ELEMENTS_CLIENT",
    "CONTRAT_A_SIGNER",
  ];
  if (!statutsAdmis.includes(statutSuivant)) {
    return reponse.status(400).json({ erreur: "Statut suivant non admis." });
  }

  const dossier = await prisma.dossierLld.findUnique({
    where: { id: requete.params.id },
  });
  if (!dossier) return reponse.status(404).json({ erreur: "Dossier introuvable." });

  await prisma.$transaction(async (tx) => {
    await tx.dossierLld.update({
      where: { id: dossier.id },
      data: {
        statut: statutSuivant,
        entreEnEtapeLe: new Date(),
        dateRetourCommunique: new Date(dateRetour),
        sourceRetour: String(source).trim(),
        contenuRetour: String(contenu).trim(),
        prochaineActionLe: prochaineActionLe ? new Date(prochaineActionLe) : null,
        prochaineActionLabel: String(prochaineActionLabel ?? "").trim() || null,
      },
    });

    await tx.activite.create({
      data: {
        type: "ACTIVITE_LLD",
        sens: "ENTRANT",
        objet: "Retour communiqué par le partenaire",
        contenu: String(contenu).trim(),
        dateReelle: new Date(dateRetour),
        resultat: `Source : ${String(source).trim()}`,
        suiteAttendue: String(prochaineActionLabel ?? "").trim() || null,
        auteurId: utilisateur.id,
        dossierLldId: dossier.id,
      },
    });

    await journaliser(tx, {
      typeObjet: "DOSSIER_LLD",
      objetId: dossier.id,
      action: "RETOUR_PARTENAIRE",
      detail: String(contenu).trim(),
      nouvelleValeur: String(statutSuivant),
      auteurId: utilisateur.id,
    });
  });

  reponse.json({ message: "Retour enregistré." });
});

// ---------------------------------------------------------------------------
// Attente d'éléments client
// ---------------------------------------------------------------------------

routes.post("/:id/demander-element", async (requete, reponse) => {
  if (!exigerDroitLld(requete, reponse)) return;
  const utilisateur = requete.utilisateur!;
  const { element, demandeA, relanceLe } = requete.body ?? {};

  if (!String(element ?? "").trim() || !String(demandeA ?? "").trim() || !relanceLe) {
    return reponse.status(400).json({
      erreur: "Enregistrez l'élément demandé, son destinataire et l'échéance de relance.",
    });
  }

  const dossier = await prisma.dossierLld.findUnique({
    where: { id: requete.params.id },
  });
  if (!dossier) return reponse.status(404).json({ erreur: "Dossier introuvable." });

  await prisma.$transaction(async (tx) => {
    await tx.dossierLld.update({
      where: { id: dossier.id },
      data: {
        statut: "EN_ATTENTE_ELEMENTS_CLIENT",
        entreEnEtapeLe: new Date(),
        elementAttenduLabel: String(element).trim(),
        elementDemandeLe: new Date(),
        elementDemandeA: String(demandeA).trim(),
        prochaineRelanceLe: new Date(relanceLe),
        prochaineActionLe: new Date(relanceLe),
        prochaineActionLabel: `Relancer : ${String(element).trim()}`,
      },
    });
    await tx.tache.create({
      data: {
        libelle: `Relancer ${String(demandeA).trim()} : ${String(element).trim()}`,
        echeance: new Date(relanceLe),
        responsableId: dossier.collaboratriceId,
        dossierLldId: dossier.id,
      },
    });
    await journaliser(tx, {
      typeObjet: "DOSSIER_LLD",
      objetId: dossier.id,
      action: "MODIFICATION",
      detail: `Élément demandé à ${String(demandeA).trim()} : ${String(element).trim()}`,
      auteurId: utilisateur.id,
    });
  });

  reponse.json({ message: "Demande enregistrée." });
});

// ---------------------------------------------------------------------------
// Signatures et livraison
// ---------------------------------------------------------------------------

routes.post("/:id/signature", async (requete, reponse) => {
  if (!exigerDroitLld(requete, reponse)) return;
  const utilisateur = requete.utilisateur!;
  const { signatureClientLe, signatureAutresLe, dateLivraisonPrevue } =
    requete.body ?? {};

  const dossier = await prisma.dossierLld.findUnique({
    where: { id: requete.params.id },
  });
  if (!dossier) return reponse.status(404).json({ erreur: "Dossier introuvable." });

  const sigClient = signatureClientLe
    ? new Date(signatureClientLe)
    : dossier.signatureClientLe;
  const sigAutres = signatureAutresLe
    ? new Date(signatureAutresLe)
    : dossier.signatureAutresLe;

  // Le passage à « signé » suppose que les signatures suivies sont complètes.
  const toutesSignatures = Boolean(sigClient && sigAutres);

  await prisma.$transaction(async (tx) => {
    await tx.dossierLld.update({
      where: { id: dossier.id },
      data: {
        signatureClientLe: sigClient,
        signatureAutresLe: sigAutres,
        dateLivraisonPrevue: dateLivraisonPrevue
          ? new Date(dateLivraisonPrevue)
          : dossier.dateLivraisonPrevue,
        statut: toutesSignatures ? "SIGNE_LIVRAISON_A_CONFIRMER" : dossier.statut,
        entreEnEtapeLe: toutesSignatures ? new Date() : dossier.entreEnEtapeLe,
        prochaineActionLe: dateLivraisonPrevue
          ? new Date(dateLivraisonPrevue)
          : dossier.prochaineActionLe,
        prochaineActionLabel: toutesSignatures
          ? "Confirmer la livraison"
          : "Suivre les signatures restantes",
      },
    });
    await journaliser(tx, {
      typeObjet: "DOSSIER_LLD",
      objetId: dossier.id,
      action: "SIGNATURE",
      detail: toutesSignatures
        ? "Signatures suivies complètes"
        : "Signature enregistrée ; signatures restantes à suivre",
      auteurId: utilisateur.id,
    });
  });

  reponse.json({ message: "Signature enregistrée." });
});

/**
 * Confirme la livraison. C'est l'évènement de confirmation requis : sans lui, la
 * carte ne peut pas passer à « contrat actif ».
 */
routes.post("/:id/confirmer-livraison", async (requete, reponse) => {
  if (!exigerDroitLld(requete, reponse)) return;
  const utilisateur = requete.utilisateur!;
  const { dateConfirmation } = requete.body ?? {};

  if (!dateConfirmation) {
    return reponse
      .status(400)
      .json({ erreur: "Indiquez la date de confirmation de livraison." });
  }

  const dossier = await prisma.dossierLld.findUnique({
    where: { id: requete.params.id },
  });
  if (!dossier) return reponse.status(404).json({ erreur: "Dossier introuvable." });

  await prisma.$transaction(async (tx) => {
    await tx.dossierLld.update({
      where: { id: dossier.id },
      data: {
        statut: "LIVRAISON_CONFIRMEE_CONTRAT_ACTIF",
        entreEnEtapeLe: new Date(),
        dateLivraisonConfirmee: new Date(dateConfirmation),
        prochaineActionLe: null,
        prochaineActionLabel: null,
      },
    });
    await tx.tache.updateMany({
      where: { dossierLldId: dossier.id, faite: false },
      data: { faite: true, faiteLe: new Date(), resultat: "Livraison confirmée" },
    });
    await journaliser(tx, {
      typeObjet: "DOSSIER_LLD",
      objetId: dossier.id,
      action: "LIVRAISON",
      detail: `Livraison confirmée le ${new Date(dateConfirmation).toLocaleDateString("fr-FR")}`,
      auteurId: utilisateur.id,
    });
  });

  reponse.json({ message: "Livraison confirmée ; contrat actif." });
});

// ---------------------------------------------------------------------------
// Clôture
// ---------------------------------------------------------------------------

routes.post("/:id/cloturer", async (requete, reponse) => {
  if (!exigerDroitLld(requete, reponse)) return;
  const utilisateur = requete.utilisateur!;
  const { motif, commentaire } = requete.body ?? {};

  if (!motif) {
    return reponse.status(400).json({ erreur: "Le motif de clôture est obligatoire." });
  }
  if (motif === "AUTRE" && !String(commentaire ?? "").trim()) {
    return reponse.status(400).json({ erreur: "Le motif « Autre » exige un commentaire." });
  }

  await prisma.$transaction(async (tx) => {
    await tx.dossierLld.update({
      where: { id: requete.params.id },
      data: {
        statut: "CLOTURE_NON_POURSUIVI",
        motifCloture: motif,
        commentaireCloture: String(commentaire ?? "").trim() || null,
        dateCloture: new Date(),
        prochaineActionLe: null,
        prochaineActionLabel: null,
        entreEnEtapeLe: new Date(),
      },
    });
    await tx.tache.updateMany({
      where: { dossierLldId: requete.params.id, faite: false },
      data: { faite: true, faiteLe: new Date(), resultat: "Dossier clôturé" },
    });
    await journaliser(tx, {
      typeObjet: "DOSSIER_LLD",
      objetId: requete.params.id,
      action: "CLOTURE",
      nouvelleValeur: String(motif),
      motif: String(commentaire ?? "").trim() || null,
      auteurId: utilisateur.id,
    });
  });

  reponse.json({ message: "Dossier clôturé." });
});

export default routes;
