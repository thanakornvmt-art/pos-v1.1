export function assertTestTarget() {
  const db = new URL(
    process.env.DATABASE_URL ?? "postgresql://invalid/invalid",
  );
  const app = new URL(process.env.TEST_BASE_URL ?? "http://127.0.0.1:3001");
  if (
    !["127.0.0.1", "localhost"].includes(db.hostname) ||
    !["/morning_pos_test", "/morning_pos_test_readiness"].includes(
      db.pathname,
    ) ||
    !["127.0.0.1", "localhost"].includes(app.hostname) ||
    !["3001", "3101"].includes(app.port)
  ) {
    throw new Error(
      "E2E requires localhost morning_pos_test or morning_pos_test_readiness and a test app on port 3001 or 3101. The store database and production URLs are prohibited.",
    );
  }
}
