-- Import des devis CRM facturés à GRENKE en dossiers LLD : la durée devient
-- facultative (un devis ne la porte pas), et le dossier garde son devis d'origine.
-- AlterTable
ALTER TABLE "public"."dossiers_lld" ADD COLUMN     "idCrmDevis" INTEGER,
ADD COLUMN     "referenceDevisCrm" TEXT,
ADD COLUMN     "statutCrm" TEXT,
ALTER COLUMN "dureeDemandeeMois" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "dossiers_lld_idCrmDevis_key" ON "public"."dossiers_lld"("idCrmDevis");

