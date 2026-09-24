/**
 * « Mes actions » et « Pilotage » (§3, §9, §10, §11).
 *
 * Le stock LLD par statut est une mesure de complétude du processus Selfizee :
 * ce n'est ni un « score GRENKE », ni une probabilité d'acceptation, ni un
 * indicateur de solvabilité.
 */

import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { voitToutesLesCartes } from "../lib/auth";
import { ETAPES_OPPORTUNITE, STATUTS_LLD } from "../domaine/etapes";
import {
  estTerminaleLead,
  estTerminaleLld,
  estTerminaleOpportunite,
  priseEnChargeEnRetard,
  sansSuiviPlanifie,
} from "../domaine/regles";

const routes = Router();

// ---------------------------------------------------------------------------
// Mes actions
// ---------------------------------------------------------------------------

routes.get("/mes-actions", async (requete, reponse) => {
  const utilisateur = requete.utilisateur!;
  const maintenant = new Date();
  const tout = voitToutesLesCartes(utilisateur.role);

  const [taches, leads, opportunites, dossiers] = await Promise.all([
    prisma.tache.findMany({
      where: { faite: false, ...(tout ? {} : { responsableId: utilisateur.id }) },
      orderBy: { echeance: "asc" },
      include: {
        responsable: { select: { prenom: true, nom: true } },
        lead: { select: { id: true, reference: true } },
        opportunite: { select: { id: true, reference: true } },
        dossierLld: { select: { id: true, reference: true } },
      },
    }),
    prisma.lead.findMany({
      where: tout ? {} : { proprietaireId: utilisateur.id },
      include: { organisation: { select: { nom: true } } },
    }),
    prisma.opportunite.findMany({
      where: tout ? {} : { commercialId: utilisateur.id },
      include: { organisation: { select: { nom: true } } },
    }),
    prisma.dossierLld.findMany({
      where: tout
        ? {}
        : utilisateur.role === "COLLABORATRICE_LLD"
          ? { collaboratriceId: utilisateur.id }
          : { commercialId: utilisateur.id },
      include: {
        opportunite: { select: { organisation: { select: { nom: true } } } },
      },
    }),
  ]);

  const enTache = (t: (typeof taches)[number]) => {
    const cible = t.lead
      ? { espace: "leads", id: t.lead.id, reference: t.lead.reference }
      : t.opportunite
        ? { espace: "ventes", id: t.opportunite.id, reference: t.opportunite.reference }
        : t.dossierLld
          ? { espace: "lld", id: t.dossierLld.id, reference: t.dossierLld.reference }
          : null;
    return {
      id: t.id,
      libelle: t.libelle,
      detail: t.detail,
      echeance: t.echeance,
      responsable: t.responsable
        ? `${t.responsable.prenom} ${t.responsable.nom}`
        : null,
      cible,
    };
  };

  const echues = taches
    .filter((t) => t.echeance && t.echeance.getTime() < maintenant.getTime())
    .map(enTache);
  const aVenir = taches
    .filter((t) => !t.echeance || t.echeance.getTime() >= maintenant.getTime())
    .map(enTache);

  // Cartes sans suivi planifié, tous pipelines confondus.
  const sansSuivi = [
    ...leads
      .filter((l) =>
        sansSuiviPlanifie({
          prochaineActionLe: l.prochaineActionLe,
          dateReactivation: l.dateReactivation,
          terminale: estTerminaleLead(l.statut),
        }),
      )
      .map((l) => ({
        espace: "leads",
        id: l.id,
        reference: l.reference,
        nom: l.organisation?.nom ?? l.nomBrut ?? "Sans nom",
        etape: l.statut,
      })),
    ...opportunites
      .filter((o) =>
        sansSuiviPlanifie({
          prochaineActionLe: o.prochaineActionLe,
          terminale: estTerminaleOpportunite(o.etape),
        }),
      )
      .map((o) => ({
        espace: "ventes",
        id: o.id,
        reference: o.reference,
        nom: o.organisation.nom,
        etape: o.etape,
      })),
    ...dossiers
      .filter((d) =>
        sansSuiviPlanifie({
          prochaineActionLe: d.prochaineActionLe,
          prochaineRelanceLe: d.prochaineRelanceLe,
          terminale: estTerminaleLld(d.statut),
        }),
      )
      .map((d) => ({
        espace: "lld",
        id: d.id,
        reference: d.reference,
        nom: d.opportunite.organisation.nom,
        etape: d.statut,
      })),
  ];

  // Entrants dont le délai de première prise en charge est dépassé.
  const priseEnChargeTardive = leads
    .filter((l) =>
      priseEnChargeEnRetard(l.modeAcquisition, l.creeLe, l.premierContactLe, maintenant),
    )
    .map((l) => ({
      id: l.id,
      reference: l.reference,
      nom: l.organisation?.nom ?? l.nomBrut ?? "Sans nom",
      creeLe: l.creeLe,
    }));

  reponse.json({
    perimetreComplet: tout,
    echues,
    aVenir,
    sansSuivi,
    priseEnChargeTardive,
  });
});

// ---------------------------------------------------------------------------
// Pilotage (§11)
// ---------------------------------------------------------------------------

routes.get("/pilotage", async (_requete, reponse) => {
  const [leads, opportunites, dossiers] = await Promise.all([
    prisma.lead.findMany(),
    prisma.opportunite.findMany(),
    prisma.dossierLld.findMany(),
  ]);

  // --- Délai de première prise en charge (entrants uniquement) -------------
  const entrantsTraites = leads.filter(
    (l) => l.modeAcquisition === "ENTRANT" && l.premierContactLe,
  );
  const delaiMoyenHeures =
    entrantsTraites.length > 0
      ? entrantsTraites.reduce(
          (s, l) => s + (l.premierContactLe!.getTime() - l.creeLe.getTime()) / 3_600_000,
          0,
        ) / entrantsTraites.length
      : null;

  // --- Délai jusqu'à qualification -----------------------------------------
  const leadsParId = new Map(leads.map((l) => [l.id, l]));
  const delaisQualif = opportunites
    .filter((o) => o.leadId)
    .map((o) => {
      const l = leadsParId.get(o.leadId!);
      return l ? (o.creeLe.getTime() - l.creeLe.getTime()) / 86_400_000 : null;
    })
    .filter((v): v is number => v != null);
  const delaiQualifMoyen =
    delaisQualif.length > 0
      ? delaisQualif.reduce((a, b) => a + b, 0) / delaisQualif.length
      : null;

  // --- Leads par canal d'acquisition ---------------------------------------
  const parCanal = new Map<string, { mode: string; total: number; qualifies: number }>();
  for (const l of leads) {
    const e = parCanal.get(l.canalDetaille) ?? {
      mode: l.modeAcquisition,
      total: 0,
      qualifies: 0,
    };
    e.total += 1;
    if (l.statut === "QUALIFIE_A_CONVERTIR") e.qualifies += 1;
    parCanal.set(l.canalDetaille, e);
  }

  // --- Couverture d'activité commerciale -----------------------------------
  const cartesOuvertes =
    leads.filter((l) => !estTerminaleLead(l.statut)).length +
    opportunites.filter((o) => !estTerminaleOpportunite(o.etape)).length +
    dossiers.filter((d) => !estTerminaleLld(d.statut)).length;

  const cartesSansSuivi =
    leads.filter(
      (l) =>
        !estTerminaleLead(l.statut) &&
        sansSuiviPlanifie({
          prochaineActionLe: l.prochaineActionLe,
          dateReactivation: l.dateReactivation,
          terminale: false,
        }),
    ).length +
    opportunites.filter(
      (o) =>
        !estTerminaleOpportunite(o.etape) &&
        sansSuiviPlanifie({ prochaineActionLe: o.prochaineActionLe, terminale: false }),
    ).length +
    dossiers.filter(
      (d) =>
        !estTerminaleLld(d.statut) &&
        sansSuiviPlanifie({
          prochaineActionLe: d.prochaineActionLe,
          prochaineRelanceLe: d.prochaineRelanceLe,
          terminale: false,
        }),
    ).length;

  const couverture =
    cartesOuvertes > 0
      ? Math.round(((cartesOuvertes - cartesSansSuivi) / cartesOuvertes) * 100)
      : 100;

  // --- Pipeline par étape : ventes et LLD séparées -------------------------
  //
  // Les étapes terminales sont écartées : un pipeline montre ce qui reste à
  // faire, pas ce qui est clos.
  const parEtape = ETAPES_OPPORTUNITE.filter(
    (e) => !estTerminaleOpportunite(e),
  ).map((etape) => {
    const lot = opportunites.filter((o) => o.etape === etape);
    return {
      // Un code, pas un libellé : la traduction en français appartient au front.
      etape,
      nb: lot.length,
      ventes: lot
        .filter((o) => o.projetRecherche !== "LLD")
        .reduce((s, o) => s + Number(o.montantVente ?? 0), 0),
      loyers: lot
        .filter((o) => o.projetRecherche === "LLD")
        .reduce((s, o) => s + Number(o.loyerMensuelEnvisage ?? 0), 0),
    };
  });

  // --- Délai de cycle de vente ---------------------------------------------
  const closes = opportunites.filter((o) => o.dateCloture);
  const cycleMoyen =
    closes.length > 0
      ? closes.reduce(
          (s, o) => s + (o.dateCloture!.getTime() - o.creeLe.getTime()) / 86_400_000,
          0,
        ) / closes.length
      : null;

  const gagnees = opportunites.filter((o) => o.etape === "GAGNE_ACTIF");
  const perdues = opportunites.filter((o) => o.etape === "PERDU_ABANDONNE");

  // --- Stock LLD par statut ------------------------------------------------
  const stockLld = STATUTS_LLD.map((statut) => ({
    statut,
    nb: dossiers.filter((d) => d.statut === statut).length,
    valeur: dossiers
      .filter((d) => d.statut === statut)
      .reduce((s, d) => s + Number(d.loyerMensuel ?? 0), 0),
  })).filter((s) => s.nb > 0);

  // --- Délai de traitement LLD ---------------------------------------------
  const transmis = dossiers.filter((d) => d.dateTransmission);
  const delaiTransmission =
    transmis.length > 0
      ? transmis.reduce(
          (s, d) => s + (d.dateTransmission!.getTime() - d.creeLe.getTime()) / 86_400_000,
          0,
        ) / transmis.length
      : null;

  reponse.json({
    delaiMoyenHeures,
    delaiQualifMoyen,
    couverture,
    cycleMoyen,
    parEtape,
    stockLld,
    parCanal: [...parCanal.entries()]
      .map(([canal, e]) => ({ canal, ...e }))
      .sort((a, b) => b.total - a.total),
    gagnees: gagnees.length,
    perdues: perdues.length,
    tauxReussite:
      gagnees.length + perdues.length > 0
        ? Math.round((gagnees.length / (gagnees.length + perdues.length)) * 100)
        : null,
    delaiTransmission,
    dossiersEnCours: dossiers.filter((d) => !estTerminaleLld(d.statut)).length,
    qualite: {
      sansProchaineAction: cartesSansSuivi,
      dossiersSansResponsable: dossiers.filter((d) => !d.collaboratriceId).length,
      cloturesSansMotif:
        leads.filter((l) => l.statut === "NON_QUALIFIE_CLOTURE" && !l.motifCloture)
          .length +
        opportunites.filter((o) => o.etape === "PERDU_ABANDONNE" && !o.motifCloture)
          .length +
        dossiers.filter((d) => d.statut === "CLOTURE_NON_POURSUIVI" && !d.motifCloture)
          .length,
    },
  });
});

// ---------------------------------------------------------------------------
// Organisations, pour les listes déroulantes
// ---------------------------------------------------------------------------

routes.get("/organisations", async (_requete, reponse) => {
  const organisations = await prisma.organisation.findMany({
    where: { fusionneeDansId: null } satisfies Prisma.OrganisationWhereInput,
    select: { id: true, nom: true, ville: true },
    orderBy: { nom: "asc" },
    take: 500,
  });
  reponse.json(organisations);
});

export default routes;
