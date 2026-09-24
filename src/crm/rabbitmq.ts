/**
 * Client RabbitMQ par l'API HTTP de management.
 *
 * Le CRM procède ainsi parce que le port AMQP n'est pas joignable depuis le
 * réseau Docker de Coolify : on reprend la même approche, ce qui évite d'ouvrir
 * un port et de dépendre d'une bibliothèque AMQP.
 *
 * Contrepartie assumée : la consommation se fait par sondage (`/get`) et non par
 * abonnement. Pour le volume concerné — les modifications de fiches clients —
 * c'est largement suffisant.
 */

export type ConfigRabbitMq = {
  /** URL de l'API de management, par exemple https://rabbitmq.exemple.com */
  urlManagement: string;
  /** En-tête Host à forcer, quand l'URL pointe une IP derrière un proxy. */
  hostForce?: string;
  vhost: string;
  utilisateur: string;
  motDePasse: string;
  /** Queue dédiée au kanban, liée à l'échange du CRM. */
  queue: string;
  /** Échange publié par le CRM (« konitysevents »). */
  exchange: string;
  /** Motifs de liaison, par exemple ["crm.clients.*", "crm.client_contacts.*"] */
  liaisons: string[];
};

export function configDepuisEnv(): ConfigRabbitMq | null {
  const urlManagement = process.env.RABBITMQ_MGMT_URL;
  const utilisateur = process.env.RABBITMQ_USER;
  const motDePasse = process.env.RABBITMQ_PASSWORD;

  if (!urlManagement || !utilisateur || !motDePasse) return null;

  return {
    urlManagement: urlManagement.replace(/\/$/, ""),
    hostForce: process.env.RABBITMQ_HOST_HEADER || undefined,
    vhost: process.env.RABBITMQ_VHOST || "/",
    utilisateur,
    motDePasse,
    queue: process.env.RABBITMQ_QUEUE || "kanban.events.in",
    exchange: process.env.RABBITMQ_EXCHANGE || "konitysevents",
    liaisons: (process.env.RABBITMQ_BINDINGS || "crm.clients.*,crm.client_contacts.*")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

export type MessageBus = {
  routingKey: string;
  charge: Record<string, unknown>;
  /** Nombre de messages restants dans la queue après celui-ci. */
  restants: number;
};

class ErreurRabbitMq extends Error {
  constructor(
    message: string,
    readonly statut?: number,
  ) {
    super(message);
    this.name = "ErreurRabbitMq";
  }
}

function enTetes(c: ConfigRabbitMq): HeadersInit {
  const auth = Buffer.from(`${c.utilisateur}:${c.motDePasse}`).toString("base64");
  const h: Record<string, string> = {
    Authorization: `Basic ${auth}`,
    "Content-Type": "application/json",
  };
  // Le CRM force l'en-tête Host pour contourner un proxy : même besoin ici.
  if (c.hostForce) h.Host = c.hostForce;
  return h;
}

async function appeler(
  c: ConfigRabbitMq,
  chemin: string,
  init: RequestInit = {},
): Promise<unknown> {
  const reponse = await fetch(`${c.urlManagement}${chemin}`, {
    ...init,
    headers: { ...enTetes(c), ...(init.headers ?? {}) },
    cache: "no-store",
  });

  if (!reponse.ok) {
    const corps = await reponse.text().catch(() => "");
    throw new ErreurRabbitMq(
      `${init.method ?? "GET"} ${chemin} → ${reponse.status} ${corps.slice(0, 200)}`,
      reponse.status,
    );
  }

  const texte = await reponse.text();
  return texte ? JSON.parse(texte) : null;
}

const encoderVhost = (vhost: string) => encodeURIComponent(vhost);

/** Vérifie que le bus répond et que les identifiants sont bons. */
export async function verifierConnexion(c: ConfigRabbitMq): Promise<{
  ok: boolean;
  detail: string;
}> {
  try {
    await appeler(c, "/api/whoami");
    return { ok: true, detail: "Connexion au bus établie." };
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Crée la queue du kanban et la lie à l'échange du CRM.
 *
 * Idempotent : RabbitMQ accepte la redéclaration d'une queue identique. La queue
 * est durable pour survivre à un redémarrage du broker — sans quoi les
 * modifications faites pendant une coupure du kanban seraient perdues.
 */
export async function preparerQueue(c: ConfigRabbitMq): Promise<string[]> {
  const journal: string[] = [];
  const v = encoderVhost(c.vhost);

  await appeler(c, `/api/queues/${v}/${encodeURIComponent(c.queue)}`, {
    method: "PUT",
    body: JSON.stringify({ durable: true, auto_delete: false, arguments: {} }),
  });
  journal.push(`Queue « ${c.queue} » déclarée.`);

  for (const motif of c.liaisons) {
    await appeler(
      c,
      `/api/bindings/${v}/e/${encodeURIComponent(c.exchange)}/q/${encodeURIComponent(c.queue)}`,
      { method: "POST", body: JSON.stringify({ routing_key: motif, arguments: {} }) },
    );
    journal.push(`Liaison « ${motif} » → ${c.queue}.`);
  }

  return journal;
}

type ReponseGet = {
  routing_key?: string;
  payload?: string;
  payload_encoding?: string;
  message_count?: number;
};

/**
 * Retire jusqu'à `quantite` messages de la queue.
 *
 * `ack_requeue_false` acquitte immédiatement : un message lu est retiré du bus.
 * C'est la raison pour laquelle le traitement journalise tout en base avant de
 * conclure — un message perdu ici ne serait pas rejouable par le broker.
 */
export async function lireMessages(
  c: ConfigRabbitMq,
  quantite = 20,
): Promise<MessageBus[]> {
  const v = encoderVhost(c.vhost);
  const brut = (await appeler(
    c,
    `/api/queues/${v}/${encodeURIComponent(c.queue)}/get`,
    {
      method: "POST",
      body: JSON.stringify({
        count: quantite,
        ackmode: "ack_requeue_false",
        encoding: "auto",
      }),
    },
  )) as ReponseGet[] | null;

  if (!Array.isArray(brut)) return [];

  const messages: MessageBus[] = [];
  for (const m of brut) {
    const brutCharge =
      m.payload_encoding === "base64"
        ? Buffer.from(m.payload ?? "", "base64").toString("utf8")
        : (m.payload ?? "");

    let charge: Record<string, unknown>;
    try {
      charge = JSON.parse(brutCharge) as Record<string, unknown>;
    } catch {
      // Message illisible : on le signale sans interrompre le lot.
      charge = { _illisible: brutCharge.slice(0, 500) };
    }

    messages.push({
      routingKey: m.routing_key ?? "",
      charge,
      restants: m.message_count ?? 0,
    });
  }

  return messages;
}

/** Nombre de messages en attente, pour l'affichage d'état. */
export async function profondeurQueue(c: ConfigRabbitMq): Promise<number | null> {
  try {
    const v = encoderVhost(c.vhost);
    const q = (await appeler(
      c,
      `/api/queues/${v}/${encodeURIComponent(c.queue)}`,
    )) as { messages?: number } | null;
    return q?.messages ?? 0;
  } catch {
    return null;
  }
}
