import { randomUUID } from "node:crypto";
import { normalizeEmail, type Lead, type ReplyCheckMeta, type Store, type VisibilityScanRecord } from "./types";

/** In-memory store for development and tests. Data disappears on restart. */
export class MemoryStore implements Store {
  leads = new Map<string, Lead>();
  replyChecks: ReplyCheckMeta[] = [];
  scans = new Map<string, VisibilityScanRecord & { id: string; createdAt: Date }>();
  counters = new Map<string, number>();

  async upsertLead(input: { email: string; source: Lead["sources"][number]; marketingConsent: boolean }): Promise<Lead> {
    const email = normalizeEmail(input.email);
    const existing = [...this.leads.values()].find((l) => l.email === email);
    if (existing) {
      if (!existing.sources.includes(input.source)) existing.sources.push(input.source);
      existing.marketingConsent ||= input.marketingConsent;
      return { ...existing };
    }
    const lead: Lead = {
      id: randomUUID(),
      email,
      sources: [input.source],
      marketingConsent: input.marketingConsent,
      confirmedAt: null,
      unsubscribedAt: null,
      nurtureStep: 0,
      nurtureNextAt: null,
      createdAt: new Date(),
    };
    this.leads.set(lead.id, lead);
    return { ...lead };
  }

  async getLead(id: string) {
    const lead = this.leads.get(id);
    return lead ? { ...lead } : null;
  }

  async confirmLead(id: string, now: Date) {
    const lead = this.leads.get(id);
    if (!lead) return null;
    lead.confirmedAt ??= now;
    return { ...lead };
  }

  async unsubscribeLead(id: string, now: Date) {
    const lead = this.leads.get(id);
    if (lead) lead.unsubscribedAt ??= now;
  }

  async dueNurture(now: Date, limit: number) {
    return [...this.leads.values()]
      .filter((l) => l.marketingConsent && l.confirmedAt && !l.unsubscribedAt && l.nurtureNextAt && l.nurtureNextAt <= now)
      .slice(0, limit)
      .map((l) => ({ ...l }));
  }

  async setNurture(id: string, step: number, nextAt: Date | null) {
    const lead = this.leads.get(id);
    if (lead) {
      lead.nurtureStep = step;
      lead.nurtureNextAt = nextAt;
    }
  }

  async recordReplyCheck(meta: ReplyCheckMeta) {
    this.replyChecks.push(meta);
  }

  async saveVisibilityScan(scan: VisibilityScanRecord) {
    const id = randomUUID();
    this.scans.set(id, { ...scan, id, createdAt: new Date() });
    return id;
  }

  async getVisibilityScan(id: string) {
    return this.scans.get(id) ?? null;
  }

  async incrementCounter(key: string, day: string) {
    const k = `${day}:${key}`;
    const next = (this.counters.get(k) ?? 0) + 1;
    this.counters.set(k, next);
    return next;
  }
}
