-- Lien entre un utilisateur du kanban et son compte dans le CRM.
-- Nullable : les comptes créés à la main restent valides et hors synchronisation.
ALTER TABLE "utilisateurs" ADD COLUMN "idCrm" INTEGER;
ALTER TABLE "utilisateurs" ADD COLUMN "synchroniseLe" TIMESTAMP(3);

CREATE UNIQUE INDEX "utilisateurs_idCrm_key" ON "utilisateurs"("idCrm");
