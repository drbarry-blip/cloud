import { describe, expect, it } from "vitest";
import { fetchPublicPage, FetchBlockedError, isPublicAddress, robotsAllows } from "@/lib/crawl";

describe("isPublicAddress", () => {
  it.each([
    ["8.8.8.8", true],
    ["151.101.1.69", true],
    ["2606:4700:4700::1111", true],
    ["127.0.0.1", false],
    ["10.1.2.3", false],
    ["172.16.0.1", false],
    ["172.31.255.255", false],
    ["172.32.0.1", true],
    ["192.168.1.1", false],
    ["169.254.169.254", false], // cloud metadata endpoint
    ["100.64.0.1", false],
    ["0.0.0.0", false],
    ["::1", false],
    ["fe80::1", false],
    ["fd00::1", false],
    ["::ffff:127.0.0.1", false],
    ["::ffff:8.8.8.8", true],
    ["not-an-ip", false],
  ])("%s -> %s", (ip, expected) => {
    expect(isPublicAddress(ip)).toBe(expected);
  });
});

describe("fetchPublicPage", () => {
  it("refuses private IP literals and names that resolve to them", async () => {
    await expect(fetchPublicPage("http://127.0.0.1:9/")).rejects.toBeInstanceOf(FetchBlockedError);
    await expect(fetchPublicPage("http://169.254.169.254/latest/meta-data")).rejects.toBeInstanceOf(FetchBlockedError);
    await expect(fetchPublicPage("http://localhost:9/")).rejects.toThrow(/non-public address/);
  });

  it("refuses non-http protocols and embedded credentials", async () => {
    await expect(fetchPublicPage("file:///etc/passwd")).rejects.toBeInstanceOf(FetchBlockedError);
    await expect(fetchPublicPage("https://user:pass@example.com/")).rejects.toBeInstanceOf(FetchBlockedError);
  });
});

describe("robotsAllows", () => {
  const robots = `
User-agent: *
Disallow: /private
Allow: /private/public-page

User-agent: ClinicGrowthBot
Disallow: /no-bots
`;

  it("uses our bot's own group when there is one", () => {
    expect(robotsAllows(robots, "/no-bots")).toBe(false);
    expect(robotsAllows(robots, "/private")).toBe(true); // our group doesn't block it
  });

  it("falls back to the * group, with the longest match winning", () => {
    const star = "User-agent: *\nDisallow: /private\nAllow: /private/public-page\n";
    expect(robotsAllows(star, "/private/secret")).toBe(false);
    expect(robotsAllows(star, "/private/public-page")).toBe(true);
    expect(robotsAllows(star, "/")).toBe(true);
  });

  it("handles blanket disallow, wildcards, and empty files", () => {
    expect(robotsAllows("User-agent: *\nDisallow: /", "/")).toBe(false);
    expect(robotsAllows("User-agent: *\nDisallow: /*.pdf$", "/menu.pdf")).toBe(false);
    expect(robotsAllows("User-agent: *\nDisallow: /*.pdf$", "/menu.pdf.html")).toBe(true);
    expect(robotsAllows("", "/anything")).toBe(true);
    expect(robotsAllows("User-agent: *\nDisallow:", "/anything")).toBe(true);
  });
});
