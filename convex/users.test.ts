import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { ADMIN_EMAIL, setup, signIn, withCode } from "./test.setup";

beforeEach(() => vi.stubEnv("ADMIN_EMAILS", ADMIN_EMAIL));
afterEach(() => vi.unstubAllEnvs());

describe("users.ensure", () => {
  test("rejects anonymous callers", async () => {
    const t = setup();
    await expect(t.mutation(api.users.ensure, {})).rejects.toMatchObject(withCode("UNAUTHENTICATED"));
  });

  test("creates a regular user once and is idempotent", async () => {
    const t = setup();
    const first = await signIn(t, "alice");
    const again = await first.as.mutation(api.users.ensure, {});
    expect(again).toEqual(first.id);
    expect(await first.as.query(api.users.me, {})).toMatchObject({ role: "user", trustedLender: false });
  });

  test("promotes a verified email listed in ADMIN_EMAILS", async () => {
    const t = setup();
    const admin = await signIn(t, "admin", { email: ADMIN_EMAIL });
    expect(await admin.as.query(api.users.me, {})).toMatchObject({ role: "admin" });
  });

  test("does not promote an unverified admin email", async () => {
    const t = setup();
    const impostor = await signIn(t, "impostor", { email: ADMIN_EMAIL, emailVerified: false });
    expect(await impostor.as.query(api.users.me, {})).toMatchObject({ role: "user" });
  });

  test("demotes an admin removed from ADMIN_EMAILS on next sign-in", async () => {
    const t = setup();
    const admin = await signIn(t, "admin", { email: ADMIN_EMAIL });
    vi.stubEnv("ADMIN_EMAILS", "");
    await admin.as.mutation(api.users.ensure, {});
    expect(await admin.as.query(api.users.me, {})).toMatchObject({ role: "user" });
  });
});

describe("admin-only user functions", () => {
  test("only admins can list users or mark trusted lenders", async () => {
    const t = setup();
    const alice = await signIn(t, "alice");
    const admin = await signIn(t, "admin", { email: ADMIN_EMAIL });

    await expect(alice.as.query(api.users.list, {})).rejects.toMatchObject(withCode("FORBIDDEN"));
    await expect(
      alice.as.mutation(api.users.setTrustedLender, { userId: alice.id, trusted: true }),
    ).rejects.toMatchObject(withCode("FORBIDDEN"));

    await admin.as.mutation(api.users.setTrustedLender, { userId: alice.id, trusted: true });
    expect(await alice.as.query(api.users.me, {})).toMatchObject({ trustedLender: true });
    expect(await admin.as.query(api.users.list, {})).toHaveLength(2);
  });

  test("me is null when signed out", async () => {
    const t = setup();
    expect(await t.query(api.users.me, {})).toBeNull();
  });
});
