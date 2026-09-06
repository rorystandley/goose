import { test, expect } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  await request.post("/api/test/reset");
});

test("production bundle, all views, keyboard navigation, and mobile layout", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your six. Covered." }),
  ).toBeVisible();
  await expect(page.getByText("Station connected")).toBeVisible();
  await page.screenshot({
    path: "test-results/command-centre-desktop.png",
    fullPage: true,
  });
  for (const name of [
    "Comms",
    "Task board",
    "Missions",
    "Radar",
    "Briefings",
    "Memory",
    "Loadout",
    "Systems",
  ]) {
    await page
      .getByRole("navigation")
      .getByRole("link", { name, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name, exact: true, level: 1 }),
    ).toBeVisible();
  }
  await page.keyboard.press("Control+k");
  await page.getByRole("textbox", { name: "Search views" }).fill("Radar");
  await page.getByRole("dialog").getByRole("link", { name: /Radar/ }).click();
  await expect(page).toHaveURL(/#\/monitors/);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Radar", exact: true, level: 1 }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Command centre" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Command centre", level: 1 }),
  ).toBeVisible();
  await expect(page.locator(".sidebar")).not.toHaveClass(/open/);
  await page.screenshot({
    path: "test-results/command-centre-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("task create, edit, move, inspect and delete", async ({ page }) => {
  await page.goto("/#/board");
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.getByLabel("Task title").fill("Prepare a flight briefing");
  await page
    .getByLabel("Briefing", { exact: true })
    .fill("Review the operational status.");
  await page.getByLabel("Required output files").fill("/tmp/briefing.txt");
  await page.route("**/api/kanban", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Could not save task" }),
        })
      : route.continue(),
  );
  await page.getByRole("button", { name: "Save task" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveText(
    "Could not save task",
  );
  await expect(page.getByLabel("Task title")).toHaveValue(
    "Prepare a flight briefing",
  );
  await page.unroute("**/api/kanban");
  await page.getByRole("button", { name: "Save task" }).click();
  await page.getByRole("button", { name: /Prepare a flight briefing/ }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Task title").fill("Updated flight briefing");
  await page.getByRole("button", { name: "Save task" }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("heading", { name: "Updated flight briefing" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Move to Ready" }).click();
  await expect(
    page.getByRole("dialog").getByText("ready", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Return to Backlog" }).click();
  await expect(
    page.getByRole("button", { name: "Move to Ready" }),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Updated flight briefing/ }),
  ).toHaveCount(0);
});

test("chat SSE approval remains available across views and failed requests are surfaced", async ({
  page,
}) => {
  await page.goto("/#/chat");
  await expect(page.getByText("Comms link established")).toBeVisible();
  await page.getByLabel("Message Goose").fill("Create a briefing");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Approve tool" }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Command centre" })
    .click();
  await page.getByRole("link", { name: "Review approvals" }).click();
  await page.getByRole("button", { name: "Approve tool" }).click();
  await expect(page.getByText("Briefing complete.")).toBeVisible();
  await page.route("**/api/chat", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "Test connection failure" }),
    }),
  );
  await page.getByLabel("Message Goose").fill("Retry briefing");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    page.getByText("Test connection failure", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Message Goose")).toHaveValue("Retry briefing");
});

test("mission memory deep link, monitor failures and audio playback", async ({
  page,
}) => {
  await page.goto("/#/missions");
  await page.getByRole("link", { name: "Inspect memory" }).first().click();
  await expect(
    page.getByText("History for mission-morning", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Briefings" })
    .click();
  await page
    .getByRole("button", { name: "Play Morning briefing", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Morning briefing", exact: true }),
  ).toBeVisible();
  await expect(page.locator("audio")).toHaveAttribute(
    "src",
    "/api/audio/briefing-1/stream",
  );
  await page.route("**/api/monitors", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Monitor service unavailable" }),
    }),
  );
  await page.goto("/#/monitors");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByRole("alert").getByText("Monitor service unavailable"),
  ).toBeVisible();
  await page.unroute("**/api/monitors");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByRole("heading", { name: "Local inference endpoint" }),
  ).toBeVisible();
});
