-- Synchronisation entrante depuis le CRM Selfizee.
-- Sens unique : le CRM fait autorité sur l'identité du client.

-- CreateEnum
CREATE TYPE "ResultatSynchro" AS ENUM ('CREE', 'MIS_A_JOUR', 'IGNORE_PERIME', 'IGNORE_SUPPRIME', 'ERREUR');

-- AlterTable : rapprochement des organisations avec la table `clients` du CRM
ALTER TABLE "organisations"
  ADD COLUMN "idCrm" INTEGER,
  ADD COLUMN "synchroniseLe" TIMESTAMP(3),
  ADD COLUMN "versionCrm" TIMESTAMP(3);

-- AlterTable : rapprochement des contacts avec `client_contacts`
ALTER TABLE "contacts"
  ADD COLUMN "idCrm" INTEGER,
  ADD COLUMN "synchroniseLe" TIMESTAMP(3),
  ADD COLUMN "versionCrm" TIMESTAMP(3);

-- CreateTable : journal des événements reçus, pour l'idempotence et le diagnostic
CREATE TABLE "evenements_crm" (
    "id" TEXT NOT NULL,
    "routingKey" TEXT NOT NULL,
    "tableSource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "idCrm" INTEGER NOT NULL,
    "empreinte" TEXT NOT NULL,
    "resultat" "ResultatSynchro" NOT NULL,
    "detail" TEXT,
    "charge" JSONB,
    "recuLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "traiteLe" TIMESTAMP(3),

    CONSTRAINT "evenements_crm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organisations_idCrm_key" ON "organisations"("idCrm");
CREATE UNIQUE INDEX "contacts_idCrm_key" ON "contacts"("idCrm");
CREATE UNIQUE INDEX "evenements_crm_empreinte_key" ON "evenements_crm"("empreinte");
CREATE INDEX "evenements_crm_tableSource_idCrm_idx" ON "evenements_crm"("tableSource", "idCrm");
CREATE INDEX "evenements_crm_recuLe_idx" ON "evenements_crm"("recuLe");
