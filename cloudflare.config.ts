import { defineConfig } from "cf/config";

/**
 * FOCUS DRIVE runs as a Worker so the same origin can serve the static game and the optional
 * account API. Without a signed-in account the client never calls /api/*: play stays local.
 */
export default defineConfig({
  worker: {
    name: "focus-drive",
    compatibilityDate: "2026-10-06",
    observability: { enabled: true },
    entrypoint: "./worker/index.js",
    env: {
      ASSETS: { type: "assets" },
      DB: { type: "d1", id: process.env.FOCUS_DRIVE_D1_ID ?? "7b1c9678-c1fb-4646-bd2b-c9f1755352fe" },
    },
    assets: { notFoundHandling: "single-page-application" },
  },
});
