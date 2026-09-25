export type LeadSource = "reply_checker" | "visibility_score" | "secret_shopper_waitlist" | "secret_shopper";

export interface Lead {
  id: string;
  email: string;
  sources: LeadSource[];
  marketingConsent: boolean;
  confirmedAt: Date | null;
  unsubscribedAt: Date | null;
  /** Nurture emails already sent (0 = none). */
  nurtureStep: number;
  nurtureNextAt: Date | null;
  createdAt: Date;
}

export interface ReplyCheckMeta {
  verdict: "safe" | "needs_changes" | "unsafe";
  categories: string[];
  clinicType: string | null;
  mode: "ai" | "rules_only";
  leadId: string | null;
}

/** Our own computed results. Google fields (ratings, review counts) are never stored. */
export interface VisibilityScanRecord {
  placeId: string;
  clinicType: string;
  clinicName: string;
  total: number;
  pillars: { id: string; label: string; score: number; maxPoints: number }[];
  quickWins: string[];
  playbookVersion: string;
}

export interface Store {
  upsertLead(input: { email: string; source: LeadSource; marketingConsent: boolean }): Promise<Lead>;
  getLead(id: string): Promise<Lead | null>;
  confirmLead(id: string, now: Date): Promise<Lead | null>;
  unsubscribeLead(id: string, now: Date): Promise<void>;
  /** Confirmed, subscribed, consenting leads whose next nurture email is due. */
  dueNurture(now: Date, limit: number): Promise<Lead[]>;
  setNurture(id: string, step: number, nextAt: Date | null): Promise<void>;
  recordReplyCheck(meta: ReplyCheckMeta): Promise<void>;
  saveVisibilityScan(scan: VisibilityScanRecord): Promise<string>;
  getVisibilityScan(id: string): Promise<(VisibilityScanRecord & { id: string; createdAt: Date }) | null>;
  /** Atomically increments a daily counter and returns the new value. */
  incrementCounter(key: string, day: string): Promise<number>;
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
