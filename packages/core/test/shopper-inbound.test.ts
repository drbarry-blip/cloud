import { describe, expect, it } from "vitest";
import { looksLikeBounce, mentionsPrice, phiSignals, requestedDeflections, stripQuotedReply } from "../src/shopper";

describe("stripQuotedReply", () => {
  it("keeps the new reply and drops Gmail, Outlook, and > quoted history", () => {
    const gmail = "Hi Jessica! Botox is $12 a unit.\n\nBest,\nAmy\n\nOn Mon, Oct 5, 2026 at 10:02 AM Jessica Miller <jessica@personas.example.net>\nwrote:\n> Hi, how much is Botox?\n> Jessica";
    expect(stripQuotedReply(gmail)).toBe("Hi Jessica! Botox is $12 a unit.\n\nBest,\nAmy");
    const outlook = "Happy to help. Call us at 512-555-0100.\n\n________________________________\nFrom: Jessica Miller <j@x.example>\nSent: Monday, October 5, 2026 10:02 AM\nSubject: Question";
    expect(stripQuotedReply(outlook)).toBe("Happy to help. Call us at 512-555-0100.");
    const headerBlock = "Sure thing!\r\n\r\nFrom: Jessica <j@x.example>\r\nDate: Oct 5\r\nSubject: Hi\r\n\r\nHi";
    expect(stripQuotedReply(headerBlock)).toBe("Sure thing!");
    expect(stripQuotedReply("Yes we do!\n\n> Do you have evening hours?\n>")).toBe("Yes we do!");
    expect(stripQuotedReply("No quotes here.")).toBe("No quotes here.");
  });
});

describe("looksLikeBounce", () => {
  it("spots delivery failures", () => {
    expect(looksLikeBounce({ from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>", subject: "Delivery Status Notification (Failure)" })).toBe(true);
    expect(looksLikeBounce({ from: "postmaster@clinic.example", subject: "Undeliverable: Question" })).toBe(true);
    expect(looksLikeBounce({ from: "x@y.example", subject: "Hi", headers: { "content-type": "multipart/report; report-type=delivery-status" } })).toBe(true);
    expect(looksLikeBounce({ from: "frontdesk@clinic.example", subject: "Re: Quick question" })).toBe(false);
  });
});

describe("phiSignals", () => {
  it("flags another patient's details, and reports reasons only", () => {
    expect(phiSignals("Patient: Mary Smith, DOB 04/12/1968, MRN 00412345")).toEqual(["date_of_birth", "record_number"]);
    expect(phiSignals("SSN 123-45-6789")).toEqual(["ssn_like"]);
    expect(phiSignals("Here are the lab results for Mary Smith from Tuesday")).toEqual(["clinical_detail_about_named_person"]);
    expect(phiSignals("Member ID: XJH4412398")).toEqual(["insurance_id"]);
    expect(phiSignals("See attached", ["Smith_chart_2026.pdf"])).toEqual(["records_attachment"]);
  });

  it("stays quiet on ordinary clinic replies, including questions about the persona", () => {
    expect(phiSignals("Hi Jessica! What's your date of birth so we can set up your chart? Call us at 512-555-0100.")).toEqual([]);
    expect(phiSignals("Our new patient special is $199 through 10/31/2026.")).toEqual([]);
    expect(phiSignals("Thanks!", ["price-list.pdf", "logo.png"])).toEqual([]);
  });
});

describe("requestedDeflections and mentionsPrice", () => {
  it("notices what the clinic asked for", () => {
    expect(requestedDeflections("Can you send your date of birth and insurance card info? Also fill out our intake forms.")).toEqual([
      "date_of_birth",
      "insurance_details",
      "intake_forms",
    ]);
    expect(requestedDeflections("We just need a $50 deposit to hold the time.")).toEqual(["payment_or_deposit"]);
    expect(requestedDeflections("Would Tuesday at 3 work?")).toEqual([]);
  });

  it("detects a stated price", () => {
    expect(mentionsPrice("It's $12 per unit")).toBe(true);
    expect(mentionsPrice("Usually 300 dollars")).toBe(true);
    expect(mentionsPrice("It depends on the area; come in for a consult")).toBe(false);
  });
});

describe("htmlToText", () => {
  it("keeps line breaks and drops markup, styles, and quoted blocks", async () => {
    const { htmlToText } = await import("../src/shopper");
    const html = `<html><head><style>p{color:red}</style></head><body><p>Hi Jessica,</p><p>Botox is &#36;12/unit &amp; we&#39;re open Sat.<br>Call 512-555-0100</p><blockquote>Hi, how much?</blockquote></body></html>`;
    expect(htmlToText(html)).toBe("Hi Jessica,\nBotox is $12/unit & we're open Sat.\nCall 512-555-0100");
  });
});
