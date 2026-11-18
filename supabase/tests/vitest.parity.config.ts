// Only for ./supabase/tests/parity_test.sh: `npm test` never runs the fuzz,
// because it needs a local Postgres.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["supabase/tests/parity.fuzz.ts"],
    testTimeout: 15 * 60 * 1000,
  },
});
