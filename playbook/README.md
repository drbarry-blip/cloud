# Playbook (v0.1 draft)

The playbook is your know-how, written down as data. The software reads these files to:

- send fictional new-patient inquiries (Secret Shopper),
- grade how a clinic's front desk follows up,
- write the fix-it scripts in each report,
- score a clinic's online visibility,
- check review replies for privacy problems, and
- write Location Reports.

**Status: draft.** Claude wrote this version from common industry practice. None of it reflects your judgment yet. Places that most need your input are marked `TODO(owner)`.

## Files

| File | What it controls |
|---|---|
| `playbook.yaml` | Version number and the list of files. Every report records the version it used. |
| `shared/response-standards.yaml` | What "good" follow-up looks like: speed targets, follow-up cadence, channels, dos and don'ts |
| `shared/secret-shopper-rubric.yaml` | How Secret Shopper tests are scored (SPEC.md Appendix A), with good and bad examples for the AI grader |
| `shared/persona-rules.yaml` | How fictional patients behave: what they never do, how they deflect, when inquiries go out |
| `shared/fix-it-scripts.yaml` | The call, voicemail, text, and email templates and the 10-day follow-up cadence in each report |
| `shared/visibility-score.yaml` | Visibility Score weights and thresholds (SPEC.md Appendix B) and booking-tool detection |
| `shared/review-reply-rules.yaml` | What the Review Reply Checker flags, and the safe reply templates |
| `shared/location-report.yaml` | Location Report scoring, trade areas, and benchmarks |
| `clinic-types/*.yaml` | One file per clinic type: services, fictional-patient messages, questions, objections, search terms, target patients, copy watch-outs, attorney questions, and your market notes |

## Your review checklist (about 3–5 hours)

In order of impact:

1. ~~**Speed and follow-up standards**~~ **Done (2026-09-25):** full marks for a human reply within 1 hour; after hours, an instant auto-reply plus a person within 1 hour of opening; 5+ attempts over 10 days.
2. **Fix-it scripts** (`shared/fix-it-scripts.yaml`): the voice is set (warm and friendly). Edit any wording that doesn't sound like your best front-desk person. This is what customers copy.
3. **Rubric weights and examples** (`shared/secret-shopper-rubric.yaml`): do the points match what actually turns inquiries into patients?
4. **Fictional-patient messages** (`clinic-types/*.yaml` → `persona_inquiries`): do they sound like real patients in each clinic type?
5. **Objections and questions** (`clinic-types/*.yaml`): add the ones your front desk hears most.
6. **Market notes** (`clinic-types/*.yaml` → `market_notes`): your rules of thumb for the Location Report. Everything there is blank on purpose; the spec forbids invented statistics.
7. **Benchmarks** (`shared/location-report.yaml`): fill them in only where you have real numbers.

## How to edit

- **Easiest:** leave comments on the pull request, or tell Claude in chat ("make the voicemail friendlier", "use 3 minutes, not 5"), and Claude makes the edits.
- **Yourself on GitHub:** open a file → pencil icon → edit → commit to a new branch → open a pull request.
- **YAML basics:**
  - Keep the indentation exactly as it is (spaces, never tabs).
  - Text after `#` is a note for people; the software ignores it.
  - Keep text inside its quotes.
  - Numbers have no quotes.
  - Words in `{curly_braces}` are filled in automatically; leave them as they are.
- When you approve a version, set `status: approved` and bump `version` in `playbook.yaml`.

## Ground rules (never edit these away)

- Fictional patients never book, pay, share health details, or contact a clinic outside a paid, verified test.
- Nothing in the playbook asks for or stores real patient data.
- Scripts for sensitive services (hormones, weight loss) keep voicemails and texts generic, because other people may hear or see them.
- Scores are estimates, and the playbook's copy guidance isn't legal advice. The attorney questions in each clinic-type file go to a real attorney.
