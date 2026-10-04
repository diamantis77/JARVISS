import { test, expect } from "@playwright/test";

test("authentication UI is available without provider credentials", async ({ page }) => {
  await page.goto("/auth/sign-in");
  await expect(page.getByRole("heading", { name: "Καλώς ήρθατε ξανά." })).toBeVisible();
  await expect(page.getByLabel(/email/i)).toBeVisible();
});

test("integration settings expose safe diagnostics and morning brief", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByText("Google Workspace")).toBeVisible();
  await expect(page.getByText(/fictional email, calendar and notifications/i)).toBeVisible();
  await expect(page.getByText("Ημερήσια ενημέρωση")).toBeVisible();
  await expect(page.getByRole("button", { name: "Test Notification" })).toBeVisible();
});

test("notification center remains operational", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "ΑΝΟΙΓΜΑ ΚΕΝΤΡΟΥ ΕΛΕΓΧΟΥ" }).click();
  const bell = page.getByRole("button", { name: /Ειδοποιήσεις/i });
  await expect(bell).toBeVisible();
  await bell.click();
  await expect(page.getByRole("button", { name: /Demo reply from Papadopoulos Dental/ })).toBeVisible();
});

test("operations dashboard shows provider health and AI router", async ({ page }) => {
  await page.goto("/operations");
  await expect(page.getByRole("heading", { name: "Σύστημα / Λειτουργίες" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "AI Providers" })).toBeVisible();
  await expect(page.getByText("openrouter/free")).toBeVisible();
  await expect(page.getByText("Κατάσταση παρόχων", { exact: true })).toBeVisible();
});

test("core opens and demo command flow stays available", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Πατήστε για να μιλήσετε στον JARVIS" })).toBeVisible();
  await page.getByRole("button", { name: "ΑΝΟΙΓΜΑ ΚΕΝΤΡΟΥ ΕΛΕΓΧΟΥ" }).click();
  await expect(page.getByRole("button", { name: "Έναρξη φωνητικής συνομιλίας" })).toBeVisible();
  await page.getByRole("button", { name: "Δείξε hot leads" }).click();
  await expect(page.getByText("Δείξε μου τα ισχυρότερα leads μου")).toBeVisible({ timeout: 15_000 });
});
