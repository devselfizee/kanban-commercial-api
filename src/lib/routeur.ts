/**
 * Routeur Express qui ne laisse pas tomber le processus.
 *
 * Express 4 ignore les promesses : un handler `async` qui rejette — base
 * injoignable, jeton mal formé — n'atteint jamais le gestionnaire d'erreurs.
 * Le rejet remonte en `unhandledRejection`, et Node 15+ tue le processus. En
 * production, cela se lit comme une boucle de redémarrages à chaque coupure
 * de Postgres, sur n'importe quelle requête.
 *
 * Ce routeur enveloppe chaque handler pour transmettre le rejet à `next`, où
 * le gestionnaire d'erreurs le transforme en réponse — 503 quand la base est
 * en cause, 500 sinon. Toute route déclarée par son intermédiaire est
 * couverte, y compris celles qu'on écrira demain : c'est ce qui le rend
 * préférable à 36 `try/catch` à ne pas oublier.
 */

import {
  Router,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from "express";

type Handler = (
  requete: Request,
  reponse: Response,
  suite: NextFunction,
) => unknown;

/**
 * Transmet à `next` le rejet d'un handler ou d'un middleware asynchrone.
 *
 * Exportée pour les middlewares montés directement sur `app`, que le routeur
 * ne voit pas — l'authentification, en premier lieu.
 */
export function securiser(fn: Handler): RequestHandler {
  return (requete, reponse, suite) => {
    // `Promise.resolve().then` capture aussi un `throw` synchrone.
    Promise.resolve()
      .then(() => fn(requete, reponse, suite))
      .catch(suite);
  };
}

const METHODES = ["get", "post", "put", "patch", "delete", "all"] as const;

/** Un `Router()` dont chaque handler est passé par `securiser`. */
export function routeur(): Router {
  const r = Router();
  for (const methode of METHODES) {
    const originale = (r[methode] as (...args: unknown[]) => Router).bind(r);
    (r as unknown as Record<string, unknown>)[methode] = (
      chemin: unknown,
      ...handlers: unknown[]
    ) =>
      originale(
        chemin,
        ...handlers.map((h) =>
          typeof h === "function" ? securiser(h as Handler) : h,
        ),
      );
  }
  return r;
}
