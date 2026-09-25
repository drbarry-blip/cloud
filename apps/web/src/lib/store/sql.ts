import type { Db } from "../db";
import { normalizeEmail, type Lead, type LeadSource, type ReplyCheckMeta, type Store, type VisibilityScanRecord } from "./types";

type LeadRow = {
  id: string;
  email: string;
  sources: LeadSource[];
  marketing_consent: boolean;
  confirmed_at: Date | null;
  unsubscribed_at: Date | null;
  nurture_step: number;
  nurture_next_at: Date | null;
  created_at: Date;
};

export const toLead = (r: LeadRow): Lead => ({
  id: r.id,
  email: r.email,
  sources: r.sources,
  marketingConsent: r.marketing_consent,
  confirmedAt: r.confirmed_at,
  unsubscribedAt: r.unsubscribed_at,
  nurtureStep: r.nurture_step,
  nurtureNextAt: r.nurture_next_at,
  createdAt: r.created_at,
});

/** The Phase 1 store, on either real Postgres or PGlite. Schema lives in apps/web/migrations. */
export class SqlStore implements Store {
  constructor(readonly db: Db) {}

  async upsertLead(input: { email: string; source: LeadSource; marketingConsent: boolean }): Promise<Lead> {
    const { rows } = await this.db.query<LeadRow>(
      `INSERT INTO leads (email, sources, marketing_consent)
       VALUES ($1, ARRAY[$2]::text[], $3)
       ON CONFLICT (email) DO UPDATE SET
         sources = CASE WHEN $2 = ANY(leads.sources) THEN leads.sources ELSE array_append(leads.sources, $2::text) END,
         marketing_consent = leads.marketing_consent OR EXCLUDED.marketing_consent
       RETURNING *`,
      [normalizeEmail(input.email), input.source, input.marketingConsent],
    );
    return toLead(rows[0]!);
  }

  async getLead(id: string) {
    const { rows } = await this.db.query<LeadRow>("SELECT * FROM leads WHERE id = $1", [id]);
    return rows[0] ? toLead(rows[0]) : null;
  }

  async getLeadByEmail(email: string) {
    const { rows } = await this.db.query<LeadRow>("SELECT * FROM leads WHERE email = $1", [normalizeEmail(email)]);
    return rows[0] ? toLead(rows[0]) : null;
  }

  async confirmLead(id: string, now: Date) {
    const { rows } = await this.db.query<LeadRow>("UPDATE leads SET confirmed_at = COALESCE(confirmed_at, $2) WHERE id = $1 RETURNING *", [id, now]);
    return rows[0] ? toLead(rows[0]) : null;
  }

  async unsubscribeLead(id: string, now: Date) {
    await this.db.query("UPDATE leads SET unsubscribed_at = COALESCE(unsubscribed_at, $2) WHERE id = $1", [id, now]);
  }

  async dueNurture(now: Date, limit: number) {
    const { rows } = await this.db.query<LeadRow>(
      `SELECT * FROM leads
       WHERE marketing_consent AND confirmed_at IS NOT NULL AND unsubscribed_at IS NULL
         AND nurture_next_at IS NOT NULL AND nurture_next_at <= $1
       ORDER BY nurture_next_at LIMIT $2`,
      [now, limit],
    );
    return rows.map(toLead);
  }

  async setNurture(id: string, step: number, nextAt: Date | null) {
    await this.db.query("UPDATE leads SET nurture_step = $2, nurture_next_at = $3 WHERE id = $1", [id, step, nextAt]);
  }

  async recordReplyCheck(meta: ReplyCheckMeta) {
    await this.db.query("INSERT INTO reply_checks (verdict, categories, clinic_type, mode, lead_id) VALUES ($1, $2, $3, $4, $5)", [
      meta.verdict,
      meta.categories,
      meta.clinicType,
      meta.mode,
      meta.leadId,
    ]);
  }

  async saveVisibilityScan(scan: VisibilityScanRecord) {
    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO visibility_scans (place_id, clinic_type, clinic_name, total, pillars, quick_wins, playbook_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [scan.placeId, scan.clinicType, scan.clinicName, scan.total, JSON.stringify(scan.pillars), scan.quickWins, scan.playbookVersion],
    );
    return rows[0]!.id;
  }

  async getVisibilityScan(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const { rows } = await this.db.query<Record<string, unknown>>("SELECT * FROM visibility_scans WHERE id = $1", [id]);
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id as string,
      createdAt: r.created_at as Date,
      placeId: r.place_id as string,
      clinicType: r.clinic_type as string,
      clinicName: r.clinic_name as string,
      total: r.total as number,
      pillars: r.pillars as VisibilityScanRecord["pillars"],
      quickWins: r.quick_wins as string[],
      playbookVersion: r.playbook_version as string,
    };
  }

  async incrementCounter(key: string, day: string) {
    const { rows } = await this.db.query<{ count: number }>(
      `INSERT INTO daily_counters (key, day, count) VALUES ($1, $2, 1)
       ON CONFLICT (key, day) DO UPDATE SET count = daily_counters.count + 1
       RETURNING count`,
      [key, day],
    );
    return rows[0]!.count;
  }
}
