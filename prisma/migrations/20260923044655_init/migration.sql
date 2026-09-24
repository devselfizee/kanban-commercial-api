-- CreateEnum
CREATE TYPE "public"."Role" AS ENUM ('COMMERCIAL', 'COLLABORATRICE_LLD', 'MANAGER', 'DIRECTION');

-- CreateEnum
CREATE TYPE "public"."ModeAcquisition" AS ENUM ('ENTRANT', 'PROSPECTION', 'REACTIVATION');

-- CreateEnum
CREATE TYPE "public"."CanalDetaille" AS ENUM ('FORMULAIRE_SITE', 'APPEL_ENTRANT', 'EMAIL_ENTRANT', 'CHAT', 'RESEAU_SOCIAL_ENTRANT', 'DEMANDE_DEVIS', 'DEMANDE_DEMONSTRATION', 'SALON', 'EVENEMENT', 'DEMONSTRATION', 'SCAN_BADGE', 'CARTE_DE_VISITE', 'PARTENAIRE', 'APPORTEUR', 'PRESCRIPTEUR', 'REVENDEUR', 'RECOMMANDATION_CLIENT', 'LISTE_COMPTES_CIBLES', 'APPEL_SORTANT', 'EMAIL_SORTANT', 'LINKEDIN', 'VISITE_TERRAIN', 'SEQUENCE_PROSPECTION', 'ANCIEN_CLIENT', 'ANCIEN_DEVIS', 'FIN_DE_CONTRAT', 'RENOUVELLEMENT', 'UPSELL', 'CROSS_SELL', 'MIGRATION_HISTORIQUE');

-- CreateEnum
CREATE TYPE "public"."SegmentClient" AS ENUM ('AGENCE_EVENEMENTIELLE', 'LIEU_DE_RECEPTION', 'HOTEL_CAMPING', 'ENTREPRISE', 'COLLECTIVITE_ASSOCIATION', 'ANIMATION_LOISIRS', 'COMMERCE', 'LOUEUR_PRESTATAIRE_EVENEMENTIEL', 'ETABLISSEMENT_ENSEIGNEMENT', 'PARTICULIER', 'AUTRE_PROFESSIONNEL');

-- CreateEnum
CREATE TYPE "public"."ProjetRecherche" AS ENUM ('ACHAT', 'LLD', 'LOCATION_COURTE_DUREE', 'ACHAT_OU_LLD_A_CONSEILLER', 'PRESTATION_PONCTUELLE', 'A_PRECISER');

-- CreateEnum
CREATE TYPE "public"."Priorite" AS ENUM ('P1_REPONSE_IMMEDIATE', 'P2_A_TRAITER_AUJOURDHUI', 'P3_SUIVI_PLANIFIE', 'P4_NURTURING');

-- CreateEnum
CREATE TYPE "public"."StatutLead" AS ENUM ('NOUVEAU_NON_ATTRIBUE', 'A_PRENDRE_EN_CHARGE', 'PREMIER_CONTACT_A_REALISER', 'CONTACT_EN_COURS', 'CONTACT_ETABLI_A_QUALIFIER', 'QUALIFIE_A_CONVERTIR', 'NURTURING_A_REACTIVER', 'NON_QUALIFIE_CLOTURE');

-- CreateEnum
CREATE TYPE "public"."MotifClotureLead" AS ENUM ('PAS_DE_BESOIN', 'MAUVAIS_SEGMENT', 'DOUBLON', 'COORDONNEES_INEXPLOITABLES', 'REFUS_EXPLICITE', 'AUTRE');

-- CreateEnum
CREATE TYPE "public"."EtapeCommerciale" AS ENUM ('QUALIFICATION_VALIDEE', 'DECOUVERTE_SOLUTION', 'OFFRE_A_CONSTRUIRE', 'OFFRE_ENVOYEE', 'NEGOCIATION_VALIDATION_CLIENT', 'DOSSIER_LLD_EN_COURS', 'CONTRATS_A_SIGNER', 'LIVRAISON_MISE_EN_SERVICE', 'GAGNE_ACTIF', 'PERDU_ABANDONNE');

-- CreateEnum
CREATE TYPE "public"."MotifClotureOpportunite" AS ENUM ('CONCURRENT', 'BUDGET', 'PROJET_REPORTE', 'PROJET_ANNULE', 'SANS_REPONSE', 'HORS_PERIMETRE', 'DOUBLON', 'AUTRE');

-- CreateEnum
CREATE TYPE "public"."StatutLld" AS ENUM ('LLD_A_ETUDIER', 'DOSSIER_A_PREPARER', 'EN_ATTENTE_ELEMENTS_CLIENT', 'PRET_A_TRANSMETTRE', 'TRANSMIS_A_GRENKE', 'RETOUR_ANALYSE_EN_ATTENTE', 'REPONSE_COMMUNIQUEE_PAR_GRENKE', 'CONTRAT_A_SIGNER', 'SIGNE_LIVRAISON_A_CONFIRMER', 'LIVRAISON_CONFIRMEE_CONTRAT_ACTIF', 'CLOTURE_NON_POURSUIVI');

-- CreateEnum
CREATE TYPE "public"."MotifClotureLld" AS ENUM ('CLIENT_RETIRE_SA_DEMANDE', 'DOSSIER_INCOMPLET_APRES_RELANCES', 'SOLUTION_ACHAT_RETENUE', 'SOLUTION_LOCATION_COURTE_DUREE_RETENUE', 'RETOUR_PARTENAIRE_DEFAVORABLE_COMMUNIQUE', 'PROJET_REPORTE', 'DOUBLON', 'AUTRE');

-- CreateEnum
CREATE TYPE "public"."TypeActivite" AS ENUM ('APPEL_ENTRANT', 'APPEL_SORTANT', 'EMAIL_ENTRANT', 'EMAIL_SORTANT', 'MESSAGE_WHATSAPP', 'MESSAGE_SMS', 'MESSAGE_LINKEDIN', 'REUNION', 'DEMONSTRATION', 'EVENEMENT_SALON_VISITE', 'DEVIS_OFFRE', 'ACTIVITE_LLD', 'TACHE_INTERNE', 'NOTE');

-- CreateEnum
CREATE TYPE "public"."SensActivite" AS ENUM ('ENTRANT', 'SORTANT', 'INTERNE');

-- CreateEnum
CREATE TYPE "public"."TypeObjet" AS ENUM ('LEAD', 'OPPORTUNITE', 'DOSSIER_LLD', 'ORGANISATION', 'CONTACT');

-- CreateTable
CREATE TABLE "public"."utilisateurs" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "prenom" TEXT NOT NULL,
    "role" "public"."Role" NOT NULL DEFAULT 'COMMERCIAL',
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "motDePasse" TEXT,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "majLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "utilisateurs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."organisations" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "segment" "public"."SegmentClient" NOT NULL,
    "estParticulier" BOOLEAN NOT NULL DEFAULT false,
    "email" TEXT,
    "telephone" TEXT,
    "siteWeb" TEXT,
    "siren" TEXT,
    "adresse" TEXT,
    "codePostal" TEXT,
    "ville" TEXT,
    "pays" TEXT DEFAULT 'France',
    "modeAcquisitionInitial" "public"."ModeAcquisition",
    "canalInitial" "public"."CanalDetaille",
    "dateCollecte" TIMESTAMP(3),
    "fondementContact" TEXT,
    "proprietaireId" TEXT,
    "notes" TEXT,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "majLe" TIMESTAMP(3) NOT NULL,
    "fusionneeDansId" TEXT,

    CONSTRAINT "organisations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."contacts" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "prenom" TEXT,
    "role" TEXT,
    "email" TEXT,
    "telephone" TEXT,
    "mobile" TEXT,
    "accepteEmail" BOOLEAN NOT NULL DEFAULT true,
    "accepteTelephone" BOOLEAN NOT NULL DEFAULT true,
    "accepteSms" BOOLEAN NOT NULL DEFAULT false,
    "oppositionNotee" TEXT,
    "estDecideurEconomique" BOOLEAN NOT NULL DEFAULT false,
    "organisationId" TEXT,
    "notes" TEXT,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "majLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."leads" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "modeAcquisition" "public"."ModeAcquisition" NOT NULL,
    "canalDetaille" "public"."CanalDetaille" NOT NULL,
    "statut" "public"."StatutLead" NOT NULL DEFAULT 'NOUVEAU_NON_ATTRIBUE',
    "priorite" "public"."Priorite" NOT NULL DEFAULT 'P3_SUIVI_PLANIFIE',
    "segment" "public"."SegmentClient",
    "projetRecherche" "public"."ProjetRecherche" NOT NULL DEFAULT 'A_PRECISER',
    "besoinResume" TEXT,
    "horizonIndicatif" TEXT,
    "ville" TEXT,
    "organisationId" TEXT,
    "contactPrincipalId" TEXT,
    "nomBrut" TEXT,
    "emailBrut" TEXT,
    "telephoneBrut" TEXT,
    "proprietaireId" TEXT,
    "dateAttribution" TIMESTAMP(3),
    "prochaineActionLe" TIMESTAMP(3),
    "prochaineActionLabel" TEXT,
    "dernierContactLe" TIMESTAMP(3),
    "premierContactLe" TIMESTAMP(3),
    "dateReactivation" TIMESTAMP(3),
    "motifCloture" "public"."MotifClotureLead",
    "commentaireCloture" TEXT,
    "dateCloture" TIMESTAMP(3),
    "rang" INTEGER NOT NULL DEFAULT 0,
    "entreEnEtapeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "majLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."opportunites" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "titre" TEXT NOT NULL,
    "etape" "public"."EtapeCommerciale" NOT NULL DEFAULT 'QUALIFICATION_VALIDEE',
    "priorite" "public"."Priorite" NOT NULL DEFAULT 'P3_SUIVI_PLANIFIE',
    "projetRecherche" "public"."ProjetRecherche" NOT NULL DEFAULT 'A_PRECISER',
    "solutionEnvisagee" TEXT,
    "produitGamme" TEXT,
    "usagePrevu" TEXT,
    "quantiteBornes" INTEGER,
    "lieuInstallation" TEXT,
    "montantVente" DECIMAL(12,2),
    "montantMiseEnPlace" DECIMAL(12,2),
    "loyerMensuelEnvisage" DECIMAL(12,2),
    "dureeLldMois" INTEGER,
    "valeurContractuelleEstimee" DECIMAL(12,2),
    "probabiliteInterne" INTEGER,
    "dateCible" TIMESTAMP(3),
    "dateEvenement" TIMESTAMP(3),
    "concurrentIdentifie" TEXT,
    "echeanceContratExistant" TIMESTAMP(3),
    "organisationId" TEXT NOT NULL,
    "contactPrincipalId" TEXT,
    "commercialId" TEXT,
    "leadId" TEXT,
    "prochaineActionLe" TIMESTAMP(3),
    "prochaineActionLabel" TEXT,
    "dernierContactLe" TIMESTAMP(3),
    "dateOffreEnvoyee" TIMESTAMP(3),
    "dateRelancePrevue" TIMESTAMP(3),
    "motifCloture" "public"."MotifClotureOpportunite",
    "commentaireCloture" TEXT,
    "dateCloture" TIMESTAMP(3),
    "montantRetenu" DECIMAL(12,2),
    "rang" INTEGER NOT NULL DEFAULT 0,
    "entreEnEtapeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "majLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opportunites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."dossiers_lld" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "statut" "public"."StatutLld" NOT NULL DEFAULT 'LLD_A_ETUDIER',
    "dureeDemandeeMois" INTEGER NOT NULL,
    "montantFinance" DECIMAL(12,2),
    "loyerMensuel" DECIMAL(12,2),
    "locataire" TEXT,
    "opportuniteId" TEXT NOT NULL,
    "collaboratriceId" TEXT,
    "commercialId" TEXT,
    "dateTransmission" TIMESTAMP(3),
    "canalTransmission" TEXT,
    "auteurTransmission" TEXT,
    "preuveTransmission" TEXT,
    "dateRetourCommunique" TIMESTAMP(3),
    "sourceRetour" TEXT,
    "contenuRetour" TEXT,
    "dateContratDisponible" TIMESTAMP(3),
    "signatureClientLe" TIMESTAMP(3),
    "signatureAutresLe" TIMESTAMP(3),
    "dateLivraisonPrevue" TIMESTAMP(3),
    "dateLivraisonConfirmee" TIMESTAMP(3),
    "prochaineActionLe" TIMESTAMP(3),
    "prochaineActionLabel" TEXT,
    "prochaineRelanceLe" TIMESTAMP(3),
    "elementAttenduLabel" TEXT,
    "elementDemandeLe" TIMESTAMP(3),
    "elementDemandeA" TEXT,
    "motifCloture" "public"."MotifClotureLld",
    "commentaireCloture" TEXT,
    "dateCloture" TIMESTAMP(3),
    "rang" INTEGER NOT NULL DEFAULT 0,
    "entreEnEtapeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "majLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dossiers_lld_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."checklist_items" (
    "id" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,
    "fait" BOOLEAN NOT NULL DEFAULT false,
    "faitLe" TIMESTAMP(3),
    "faitPar" TEXT,
    "ordre" INTEGER NOT NULL DEFAULT 0,
    "dossierLldId" TEXT NOT NULL,

    CONSTRAINT "checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."devis" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "montant" DECIMAL(12,2),
    "dateEnvoi" TIMESTAMP(3),
    "dateValidite" TIMESTAMP(3),
    "lienDocument" TEXT,
    "opportuniteId" TEXT NOT NULL,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "majLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "devis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."documents" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "chemin" TEXT NOT NULL,
    "type" TEXT,
    "taille" INTEGER,
    "confidentiel" BOOLEAN NOT NULL DEFAULT false,
    "dossierLldId" TEXT,
    "deposeParId" TEXT,
    "deposeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."activites" (
    "id" TEXT NOT NULL,
    "type" "public"."TypeActivite" NOT NULL,
    "sens" "public"."SensActivite" NOT NULL DEFAULT 'INTERNE',
    "objet" TEXT NOT NULL,
    "contenu" TEXT,
    "dateReelle" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dureeMinutes" INTEGER,
    "resultat" TEXT,
    "suiteAttendue" TEXT,
    "sansSuite" BOOLEAN NOT NULL DEFAULT false,
    "auteurId" TEXT,
    "contactId" TEXT,
    "leadId" TEXT,
    "opportuniteId" TEXT,
    "dossierLldId" TEXT,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."taches" (
    "id" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,
    "detail" TEXT,
    "echeance" TIMESTAMP(3),
    "faite" BOOLEAN NOT NULL DEFAULT false,
    "faiteLe" TIMESTAMP(3),
    "resultat" TEXT,
    "responsableId" TEXT,
    "leadId" TEXT,
    "opportuniteId" TEXT,
    "dossierLldId" TEXT,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "majLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "taches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."journal" (
    "id" TEXT NOT NULL,
    "typeObjet" "public"."TypeObjet" NOT NULL,
    "objetId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "ancienneValeur" TEXT,
    "nouvelleValeur" TEXT,
    "motif" TEXT,
    "auteurId" TEXT,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."compteurs_reference" (
    "prefixe" TEXT NOT NULL,
    "annee" INTEGER NOT NULL,
    "valeur" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "compteurs_reference_pkey" PRIMARY KEY ("prefixe")
);

-- CreateIndex
CREATE UNIQUE INDEX "utilisateurs_email_key" ON "public"."utilisateurs"("email");

-- CreateIndex
CREATE UNIQUE INDEX "organisations_reference_key" ON "public"."organisations"("reference");

-- CreateIndex
CREATE INDEX "organisations_nom_idx" ON "public"."organisations"("nom");

-- CreateIndex
CREATE INDEX "organisations_email_idx" ON "public"."organisations"("email");

-- CreateIndex
CREATE INDEX "organisations_telephone_idx" ON "public"."organisations"("telephone");

-- CreateIndex
CREATE INDEX "organisations_siren_idx" ON "public"."organisations"("siren");

-- CreateIndex
CREATE INDEX "contacts_email_idx" ON "public"."contacts"("email");

-- CreateIndex
CREATE INDEX "contacts_telephone_idx" ON "public"."contacts"("telephone");

-- CreateIndex
CREATE INDEX "contacts_nom_idx" ON "public"."contacts"("nom");

-- CreateIndex
CREATE UNIQUE INDEX "leads_reference_key" ON "public"."leads"("reference");

-- CreateIndex
CREATE INDEX "leads_statut_rang_idx" ON "public"."leads"("statut", "rang");

-- CreateIndex
CREATE INDEX "leads_proprietaireId_idx" ON "public"."leads"("proprietaireId");

-- CreateIndex
CREATE INDEX "leads_prochaineActionLe_idx" ON "public"."leads"("prochaineActionLe");

-- CreateIndex
CREATE UNIQUE INDEX "opportunites_reference_key" ON "public"."opportunites"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "opportunites_leadId_key" ON "public"."opportunites"("leadId");

-- CreateIndex
CREATE INDEX "opportunites_etape_rang_idx" ON "public"."opportunites"("etape", "rang");

-- CreateIndex
CREATE INDEX "opportunites_commercialId_idx" ON "public"."opportunites"("commercialId");

-- CreateIndex
CREATE INDEX "opportunites_prochaineActionLe_idx" ON "public"."opportunites"("prochaineActionLe");

-- CreateIndex
CREATE UNIQUE INDEX "dossiers_lld_reference_key" ON "public"."dossiers_lld"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "dossiers_lld_opportuniteId_key" ON "public"."dossiers_lld"("opportuniteId");

-- CreateIndex
CREATE INDEX "dossiers_lld_statut_rang_idx" ON "public"."dossiers_lld"("statut", "rang");

-- CreateIndex
CREATE INDEX "dossiers_lld_collaboratriceId_idx" ON "public"."dossiers_lld"("collaboratriceId");

-- CreateIndex
CREATE INDEX "checklist_items_dossierLldId_ordre_idx" ON "public"."checklist_items"("dossierLldId", "ordre");

-- CreateIndex
CREATE UNIQUE INDEX "devis_reference_key" ON "public"."devis"("reference");

-- CreateIndex
CREATE INDEX "activites_leadId_idx" ON "public"."activites"("leadId");

-- CreateIndex
CREATE INDEX "activites_opportuniteId_idx" ON "public"."activites"("opportuniteId");

-- CreateIndex
CREATE INDEX "activites_dossierLldId_idx" ON "public"."activites"("dossierLldId");

-- CreateIndex
CREATE INDEX "activites_dateReelle_idx" ON "public"."activites"("dateReelle");

-- CreateIndex
CREATE INDEX "taches_responsableId_echeance_idx" ON "public"."taches"("responsableId", "echeance");

-- CreateIndex
CREATE INDEX "taches_faite_echeance_idx" ON "public"."taches"("faite", "echeance");

-- CreateIndex
CREATE INDEX "journal_typeObjet_objetId_idx" ON "public"."journal"("typeObjet", "objetId");

-- CreateIndex
CREATE INDEX "journal_creeLe_idx" ON "public"."journal"("creeLe");

-- AddForeignKey
ALTER TABLE "public"."organisations" ADD CONSTRAINT "organisations_proprietaireId_fkey" FOREIGN KEY ("proprietaireId") REFERENCES "public"."utilisateurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."organisations" ADD CONSTRAINT "organisations_fusionneeDansId_fkey" FOREIGN KEY ("fusionneeDansId") REFERENCES "public"."organisations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."contacts" ADD CONSTRAINT "contacts_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "public"."organisations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."leads" ADD CONSTRAINT "leads_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "public"."organisations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."leads" ADD CONSTRAINT "leads_contactPrincipalId_fkey" FOREIGN KEY ("contactPrincipalId") REFERENCES "public"."contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."leads" ADD CONSTRAINT "leads_proprietaireId_fkey" FOREIGN KEY ("proprietaireId") REFERENCES "public"."utilisateurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."opportunites" ADD CONSTRAINT "opportunites_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "public"."organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."opportunites" ADD CONSTRAINT "opportunites_contactPrincipalId_fkey" FOREIGN KEY ("contactPrincipalId") REFERENCES "public"."contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."opportunites" ADD CONSTRAINT "opportunites_commercialId_fkey" FOREIGN KEY ("commercialId") REFERENCES "public"."utilisateurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."opportunites" ADD CONSTRAINT "opportunites_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "public"."leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."dossiers_lld" ADD CONSTRAINT "dossiers_lld_opportuniteId_fkey" FOREIGN KEY ("opportuniteId") REFERENCES "public"."opportunites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."dossiers_lld" ADD CONSTRAINT "dossiers_lld_collaboratriceId_fkey" FOREIGN KEY ("collaboratriceId") REFERENCES "public"."utilisateurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."dossiers_lld" ADD CONSTRAINT "dossiers_lld_commercialId_fkey" FOREIGN KEY ("commercialId") REFERENCES "public"."utilisateurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."checklist_items" ADD CONSTRAINT "checklist_items_dossierLldId_fkey" FOREIGN KEY ("dossierLldId") REFERENCES "public"."dossiers_lld"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."devis" ADD CONSTRAINT "devis_opportuniteId_fkey" FOREIGN KEY ("opportuniteId") REFERENCES "public"."opportunites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."documents" ADD CONSTRAINT "documents_dossierLldId_fkey" FOREIGN KEY ("dossierLldId") REFERENCES "public"."dossiers_lld"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."activites" ADD CONSTRAINT "activites_auteurId_fkey" FOREIGN KEY ("auteurId") REFERENCES "public"."utilisateurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."activites" ADD CONSTRAINT "activites_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "public"."contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."activites" ADD CONSTRAINT "activites_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "public"."leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."activites" ADD CONSTRAINT "activites_opportuniteId_fkey" FOREIGN KEY ("opportuniteId") REFERENCES "public"."opportunites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."activites" ADD CONSTRAINT "activites_dossierLldId_fkey" FOREIGN KEY ("dossierLldId") REFERENCES "public"."dossiers_lld"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."taches" ADD CONSTRAINT "taches_responsableId_fkey" FOREIGN KEY ("responsableId") REFERENCES "public"."utilisateurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."taches" ADD CONSTRAINT "taches_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "public"."leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."taches" ADD CONSTRAINT "taches_opportuniteId_fkey" FOREIGN KEY ("opportuniteId") REFERENCES "public"."opportunites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."taches" ADD CONSTRAINT "taches_dossierLldId_fkey" FOREIGN KEY ("dossierLldId") REFERENCES "public"."dossiers_lld"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."journal" ADD CONSTRAINT "journal_auteurId_fkey" FOREIGN KEY ("auteurId") REFERENCES "public"."utilisateurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
