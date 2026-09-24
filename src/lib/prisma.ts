import { PrismaClient } from "@prisma/client";

/**
 * Instance Prisma unique du processus.
 *
 * En développement, `tsx watch` recharge les modules : on conserve le client sur
 * globalThis pour ne pas épuiser le pool de connexions à chaque rechargement.
 */
const global_ = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  global_.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "production" ? ["error"] : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") global_.prisma = prisma;
