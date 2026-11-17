import { describe, expect, it } from "bun:test";
import { renderEmailTemplate, type EmailTemplateRequest } from "./emailTemplates";
import { EMAIL_COLORS, SafeHtml, paragraph, renderFrame } from "./emailLayout";

// The Operai email frame (emailLayout.ts): every template renders in it, and it is email-safe by construction.

const ALL: EmailTemplateRequest[] = [
  { template: "invitation", data: { inviteUrl: "https://auth.example/invite?id=1", inviterName: "Ada", expiresAt: "2026-11-20T10:00:00Z" } },
  { template: "invitation_resend", data: { inviteUrl: "https://auth.example/invite?id=1", inviterName: "Ada", expiresAt: "2026-11-20T10:00:00Z" } },
  { template: "refund_batch_compiled", data: { batchUrl: "https://app.example/refund/batches/b1", batchReference: "B-1", cutoff: "2026-11-01T00:00:00Z", generatedAt: "2026-11-02T08:30:00Z", requestCount: 4 } },
  { template: "refund_decision_approved", data: { requestUrl: "https://app.example/refund/requests/r1", decidedAt: "2026-11-02T08:30:00Z", approvedTotals: [{ currency: "CHF", amountCents: 12_345 }] } },
  { template: "refund_decision_rejected", data: { requestUrl: "https://app.example/refund/requests/r1", decidedAt: "2026-11-02T08:30:00Z" } },
  { template: "notification_notice", data: { title: "Deal won", body: "Acme signed.", originApp: "crm", appBaseUrl: "https://app.example", href: "/crm/deals/d1" } },
];

describe("the Operai frame", () => {
  it.each(ALL.map((request) => [request.template, request] as const))("%s renders a full document in the frame", (_name, request) => {
    const { html } = renderEmailTemplate(request);
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain(`bgcolor="${EMAIL_COLORS.ink}"`); // the header band
    expect(html).toMatch(/>Operai<span[^>]*>\.<\/span><\/td>/); // the wordmark
    expect(html).toContain("AI tools built by craftspeople, for craftspeople.");
  });

  it.each(ALL.map((request) => [request.template, request] as const))("%s makes no external request: no image, font, stylesheet or script", (_name, request) => {
    const { html } = renderEmailTemplate(request);
    expect(html).not.toMatch(/<img|<link|<script|<style|@import|url\(/i);
    expect(html).not.toMatch(/\ssrc=/i);
    expect(html).not.toContain("fonts.googleapis");
  });

  it("dates read in the suite's format, with the zone named", () => {
    const { html } = renderEmailTemplate(ALL[2]!);
    expect(html).toContain("02.11.2026 08:30 UTC");
  });

  it("the tool and the tone follow the template", () => {
    expect(renderEmailTemplate(ALL[5]!).html).toMatch(/text-transform: uppercase;[^>]*>CRM<\/td>/);
    expect(renderEmailTemplate(ALL[3]!).html).toContain(">Approved</span>");
    expect(renderEmailTemplate(ALL[4]!).html).toContain(">Rejected</span>");
  });

  it("caller text is always escaped; only blocks built by the module pass as markup", () => {
    const html = renderFrame({
      lang: "en",
      title: "<t>",
      preheader: "<p>",
      tool: "<b>x</b>",
      body: [paragraph(["<i>plain</i>"])],
      footer: ["<u>f</u>"],
    });
    expect(html).not.toMatch(/<(i|b|u|t)>/);
    expect(html).toContain("&lt;i&gt;plain&lt;/i&gt;");
    // A string can never pose as a block: SafeHtml is an object only this module makes.
    expect(paragraph("x")).toBeInstanceOf(SafeHtml);
  });
});
