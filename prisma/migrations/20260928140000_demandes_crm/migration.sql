-- Import des demandes du CRM : lien de chaque lead avec son opportunité
-- d'origine, et mémoire de l'endroit où l'import s'est arrêté.
-- AlterTable
ALTER TABLE "public"."leads" ADD COLUMN     "demandeCrmLe" TIMESTAMP(3),
ADD COLUMN     "idCrmOpportunite" INTEGER,
ADD COLUMN     "numeroCrm" TEXT,
ADD COLUMN     "secteurCrm" TEXT,
ADD COLUMN     "sourceCrm" TEXT;

-- CreateTable
CREATE TABLE "public"."parametres" (
    "cle" TEXT NOT NULL,
    "valeur" TEXT NOT NULL,
    "majLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parametres_pkey" PRIMARY KEY ("cle")
);

-- CreateIndex
CREATE UNIQUE INDEX "leads_idCrmOpportunite_key" ON "public"."leads"("idCrmOpportunite");

