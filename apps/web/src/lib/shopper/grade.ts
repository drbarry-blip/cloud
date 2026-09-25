import "server-only";
import {
  classifyTouch,
  gradeTest,
  renderFixItKit,
  type FixItKit,
  type GradeResult,
  type GradedPersona,
  type QualityJudgement,
  type ScriptId,
  type TouchChannel,
  type TouchLabel,
} from "@cgs/core";
import type { ShopperDeps } from "./deps";
import { notifyOps } from "./ops";
import type { Finding, InboundEvent } from "./repo";
import { clinicClock } from "./schedule";

const DAY = 24 * 60 * 60 * 1000;

export const PERSONA_LETTERS = ["A", "B", "C", "D", "E"];
export const SCRIPT_NAMES: Record<ScriptId, string> = { silent: "Silent", engaged: "Engaged", price_check: "Price check" };

/** Everything the report page shows, frozen when the test is graded (dates as ISO strings). */
export interface ReportData {
  version: 1;
  generatedAt: string;
  playbookVersion: string;
  clinic: { name: string; clinicTypeName: string; timezone: string; ownerStandard: string | null };
  grade: GradeResult;
  timeline: {
    personaId: string;
    label: string;
    script: ScriptId;
    channel: "web_form" | "email";
    serviceName: string;
    sentAt: string | null;
    delivered: boolean;
    personaReplies: { at: string; text: string }[];
    touches: {
      id: string;
      channel: TouchChannel;
      at: string;
      label: TouchLabel;
      late: boolean;
      voicemail: boolean;
      durationSeconds: number | null;
      /** Null when the text was withheld (possible PHI) or there was none. */
      text: string | null;
      withheld: boolean;
      hasRecording: boolean;
    }[];
  }[];
  fixIt: FixItKit;
  cleanup: { name: string; email: string; phone: string | null }[];
  findings: Finding[];
  inquiriesDelivered: number;
}

/** A report's grade result with its dates restored (JSON stores them as strings). */
export function reviveReport(raw: unknown): ReportData | null {
  if (!raw || typeof raw !== "object" || (raw as { version?: number }).version !== 1) return null;
  return raw as ReportData;
}

export type AiJudge = (input: {
  clinicName: string;
  personas: GradedPersona[];
  rubric: ShopperDeps["playbook"]["secretShopperRubric"];
}) => Promise<QualityJudgement[] | null>;

const touchLabel = (e: InboundEvent): TouchLabel =>
  e.label ?? classifyTouch({ channel: e.channel, subject: e.subject ?? undefined, text: e.body ?? undefined, headers: e.headers });

/** Grades a closed test and saves the report data. Does not change the test's status. */
export async function gradeShopperTest(deps: ShopperDeps, testId: string, aiJudge: AiJudge | null = deps.aiJudge ?? null): Promise<ReportData> {
  const { repo, playbook } = deps;
  const test = (await repo.getTest(testId))!;
  const clinic = (await repo.getClinic(test.clinicId))!;
  const clinicType = playbook.clinicTypes[clinic.clinicType]!;
  const assignments = await repo.assignmentsForTest(testId);
  const events = await repo.inboundForTest(testId);
  const outbound = await repo.outboundForTest(testId);

  const personas: GradedPersona[] = assignments.map((a) => ({
    id: a.id,
    script: a.script,
    channel: a.channel,
    sentAt: a.sentAt,
    sensitive: a.sensitive,
    followUpSentAt: a.followUpSentAt,
    touches: events
      .filter((e) => e.assignmentId === a.id)
      .map((e) => ({
        id: e.id,
        channel: e.channel,
        at: e.receivedAt,
        label: touchLabel(e),
        text: e.phiQuarantined ? undefined : e.body ?? undefined,
        voicemail: e.voicemail,
        late: e.late,
      })),
  }));

  let judgements: QualityJudgement[] | undefined;
  if (aiJudge) {
    try {
      judgements = (await aiJudge({ clinicName: clinic.name, personas, rubric: playbook.secretShopperRubric })) ?? undefined;
    } catch (err) {
      console.warn("[grade] AI judging failed; using heuristics:", (err as Error).name);
    }
  }

  const sensitiveTerms = clinicType.reply_checker_terms ?? [];
  const grade = gradeTest({
    rubric: playbook.secretShopperRubric,
    standards: playbook.responseStandards,
    clock: clinicClock(clinic),
    clinicName: clinic.name,
    personas,
    judgements,
    sensitiveTerms,
  });

  const firstService = clinicType.services.find((s) => s.id === assignments[0]?.serviceId) ?? clinicType.services[0]!;
  const fixIt = renderFixItKit(playbook.fixItScripts, {
    clinicName: clinic.name,
    callbackNumber: clinic.phone ?? undefined,
    bookingLink: clinic.bookingLink ?? undefined,
    service: { name: firstService.name, sensitive: firstService.sensitive, priceFactor: firstService.price_factor, smallerOption: firstService.smaller_option },
  });

  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  const report: ReportData = {
    version: 1,
    generatedAt: deps.now().toISOString(),
    playbookVersion: test.playbookVersion,
    clinic: { name: clinic.name, clinicTypeName: clinicType.name, timezone: clinic.timezone, ownerStandard: clinic.ownerStandard },
    grade,
    timeline: assignments.map((a, i) => ({
      personaId: a.id,
      label: `Persona ${PERSONA_LETTERS[i] ?? i + 1}: ${SCRIPT_NAMES[a.script]}`,
      script: a.script,
      channel: a.channel,
      serviceName: a.serviceName,
      sentAt: iso(a.sentAt),
      delivered: a.sendStatus === "sent",
      personaReplies: outbound.filter((o) => o.assignmentId === a.id && o.kind === "follow_up").map((o) => ({ at: o.sentAt.toISOString(), text: o.body })),
      touches: events
        .filter((e) => e.assignmentId === a.id)
        .map((e) => ({
          id: e.id,
          channel: e.channel,
          at: e.receivedAt.toISOString(),
          label: touchLabel(e),
          late: e.late,
          voicemail: e.voicemail,
          durationSeconds: e.durationSeconds,
          text: e.phiQuarantined ? null : e.body,
          withheld: e.phiQuarantined,
          hasRecording: Boolean(e.recordingUrl) && !e.phiQuarantined,
        })),
    })),
    fixIt,
    cleanup: assignments.filter((a) => a.sendStatus === "sent").map((a) => ({ name: `${a.firstName} ${a.lastName}`, email: a.email, phone: a.phoneNumber })),
    findings: test.findings,
    inquiriesDelivered: assignments.filter((a) => a.sendStatus === "sent").length,
  };
  await repo.saveResult(testId, report, grade.total, grade.grade);
  return report;
}

/** Grades a test that just closed and hands it to QA (every report is reviewed at first; SPEC.md §10.6). */
export async function gradeAndQueueQa(deps: ShopperDeps, testId: string) {
  const { repo } = deps;
  const report = await gradeShopperTest(deps, testId);
  const test = (await repo.transitionTest(testId, ["grading"], "qa", "In review"))!;
  const clinic = (await repo.getClinic(test.clinicId))!;
  const notes = [
    ...(report.grade.needsReview ? ["Graded partly by heuristics: check each criterion's evidence."] : []),
    ...(report.inquiriesDelivered < 2 ? [`Only ${report.inquiriesDelivered} inquiries were delivered: the guarantee applies (full refund).`] : []),
    ...(report.findings.length ? [`${report.findings.length} ops finding(s) to feature in the report.`] : []),
  ];
  const task = await repo.createTask({
    type: "qa_report",
    title: `QA report: ${clinic.name} (${report.grade.grade}, ${Math.round(report.grade.total)})`,
    testId,
    clinicId: clinic.id,
    payload: { notes, method: report.grade.method },
    dueAt: new Date(deps.now().getTime() + DAY),
  });
  await notifyOps(deps, task, [`Clinic: ${clinic.name}`, `Grade: ${report.grade.grade} (${Math.round(report.grade.total)})`, ...notes]);
}
