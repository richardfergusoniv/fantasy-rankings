// Browser smoke tests, run against a deployed URL: E2E_BASE_URL=https://… npm run test:e2e
// The theme tests need no account. The history tests sign in with LOGIN / PASSWORD and need
// E2E_LEAGUE_ID and E2E_PLAYER (a player name on that league's matchup page); they skip without them.
// CHROMIUM_PATH points at a browser binary when Playwright's own download isn't installed.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { chromium } from "playwright-core";

const BASE = process.env.E2E_BASE_URL;
const { LOGIN, PASSWORD, E2E_LEAGUE_ID: LEAGUE, E2E_PLAYER: PLAYER } = process.env;
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

let browser;
before(async () => {
  if (!BASE) return;
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox"] });
});
after(async () => { await browser?.close(); });

const skipNoBase = BASE ? false : "set E2E_BASE_URL";
const skipNoAccount = skipNoBase || (LOGIN && PASSWORD && LEAGUE && PLAYER ? false : "set LOGIN, PASSWORD, E2E_LEAGUE_ID and E2E_PLAYER");

async function open(colorScheme) {
  const context = await browser.newContext({ ...phone, colorScheme });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  return { context, page };
}

async function signIn(page) {
  await page.waitForSelector('input[type="email"]', { timeout: 30_000 });
  await page.fill('input[type="email"]', LOGIN);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForSelector('input[type="password"]', { state: "detached", timeout: 45_000 });
}

const readTheme = (page) => page.evaluate(() => ({
  attr: document.documentElement.getAttribute("data-theme"),
  bg: getComputedStyle(document.body).backgroundColor,
  stored: localStorage.getItem("fantasy-rankings-theme"),
}));

describe("theme toggle", { skip: skipNoBase }, () => {
  it("cycles device, light, dark and survives a reload, on the login screen", async () => {
    const { context, page } = await open("dark");
    const toggle = page.locator(".theme-toggle");
    await toggle.waitFor({ timeout: 30_000 });

    assert.deepEqual(await readTheme(page), { attr: null, bg: "rgb(14, 16, 20)", stored: null });

    await toggle.click();
    assert.deepEqual(await readTheme(page), { attr: "light", bg: "rgb(244, 245, 247)", stored: "light" });

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".theme-toggle").waitFor();
    assert.equal((await readTheme(page)).attr, "light");

    await page.locator(".theme-toggle").click();
    assert.deepEqual(await readTheme(page), { attr: "dark", bg: "rgb(14, 16, 20)", stored: "dark" });

    await page.locator(".theme-toggle").click();
    assert.deepEqual(await readTheme(page), { attr: null, bg: "rgb(14, 16, 20)", stored: null });
    await context.close();
  });

  it("paints a saved choice before the app loads", async () => {
    const { context, page } = await open("dark");
    await page.evaluate(() => localStorage.setItem("fantasy-rankings-theme", "light"));
    await page.reload({ waitUntil: "commit" });
    await page.waitForSelector("html[data-theme=light]", { timeout: 5_000 });
    await context.close();
  });
});

describe("player sheet history", { skip: skipNoAccount }, () => {
  let context;
  let page;
  const index = () => page.evaluate(() => navigation.currentEntry.index);
  const close = () => page.locator("[role=dialog] button[aria-label*='lose']").first().click();
  const settle = () => page.waitForTimeout(1_500);
  const gotoMatchup = async () => {
    await page.goto(`${BASE}/?league=${LEAGUE}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("text=Starters", { timeout: 45_000 });
    await page.waitForTimeout(2_500);
  };

  before(async () => {
    ({ context, page } = await open("dark"));
    await signIn(page);
    await page.waitForSelector("text=Starters", { timeout: 45_000 });
  });
  after(async () => { await context?.close(); });

  it("closes a tapped sheet by stepping back, even after visiting a tool and returning", async () => {
    await gotoMatchup();
    const base = await index();
    await page.getByText(PLAYER, { exact: true }).first().click();
    await settle();
    assert.equal(await index(), base + 1);

    await page.locator("[role=dialog] [aria-label$=' in a tool'] a").first().click();
    await settle();
    await page.goBack();
    await settle();
    assert.equal(await index(), base + 1);

    await close();
    await settle();
    assert.equal(await index(), base);
  });

  it("closes a sheet opened from a link in place", async () => {
    await gotoMatchup();
    await page.getByText(PLAYER, { exact: true }).first().click();
    await settle();
    const link = new URL(page.url());
    assert.ok(link.searchParams.get("player"));

    // Land from elsewhere: re-opening the current URL would replace the entry and keep its flag.
    await page.goto("about:blank");
    await page.goto(link.href, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[role=dialog] [aria-label$=' in a tool'] a", { timeout: 60_000 });
    await page.locator("[role=dialog] [aria-label$=' in a tool'] a").first().click();
    await settle();
    await page.goBack();
    await settle();

    const landed = await index();
    await close();
    await settle();
    assert.equal(await index(), landed);
    assert.equal(new URL(page.url()).searchParams.get("player"), null);
  });

  it("still steps back after a reload", async () => {
    await gotoMatchup();
    await page.getByText(PLAYER, { exact: true }).first().click();
    await settle();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("[role=dialog]", { timeout: 60_000 });
    await settle();

    const before = await index();
    await close();
    await settle();
    assert.equal(await index(), before - 1);
  });
});
