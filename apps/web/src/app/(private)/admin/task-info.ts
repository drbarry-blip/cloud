import type { TaskType } from "@/lib/shopper/repo";

/** What each task is and how to do it: the VA's written procedure (SPEC.md §12). */
export const TASK_INFO: Record<TaskType, { label: string; how: string[] }> = {
  verify_ownership: {
    label: "Verify ownership",
    how: [
      "Confirm the buyer owns or manages this clinic before anything is sent.",
      "Good evidence: an email on the clinic's own domain, the buyer named as owner on the clinic's website or state license lookup, or a business license they email us.",
      "You can ask the buyer for a document by email. Never mention when inquiries will arrive.",
      "If another account set up this clinic, check extra carefully. When in doubt, ask an admin.",
    ],
  },
  submit_form: {
    label: "Submit a form by hand",
    how: [
      "Open the form page in a private browser window.",
      "Fill in exactly the persona details below. Leave marketing and text-message boxes unchecked unless the form requires them.",
      "Never enter a date of birth, insurance, an address, or payment details. If the form requires them, mark the form broken.",
      "Submit, then copy the confirmation message. If it fails, try once more, then mark the form broken with what happened.",
    ],
  },
  fix_failure: {
    label: "Fix a failure",
    how: ["Read the reason, fix what you can, and either retry or resolve with a note. Ask an admin about anything involving refunds."],
  },
  approve_reply: {
    label: "Approve a persona reply",
    how: [
      "Read the clinic's message and the draft. Edit it if needed so it sounds like a real, slightly busy person.",
      "One question at most. Never book, share personal details, or mention testing.",
      "Send it after the due time shown, and within 4 hours of the clinic's message.",
    ],
  },
  match_inbound: {
    label: "Match an unrecognized message",
    how: ["Work out which persona this message was meant for (the name used, the service, the timing) and match it. If it's spam or unrelated, resolve it with a note."],
  },
  review_phi: {
    label: "Review possible patient information",
    how: [
      "Admins only. Check whether this message really contains another person's health information.",
      "If it does: confirm, which deletes the content now and notifies the customer. If not: release it as a false alarm.",
    ],
  },
  qa_report: {
    label: "QA a report",
    how: [
      "Open the report and check every touch's label, the evidence quotes, and the top fixes.",
      "Fix labels on the test page and re-grade if needed. Edit the headline only to make it clearer.",
      "If fewer than two inquiries were delivered, ask an admin about the refund before sending.",
    ],
  },
};
