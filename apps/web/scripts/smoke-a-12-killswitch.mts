// Smoke test del kill-switch A-12. Sin red, sin gas — solo valida el helper de env.
//
// Run from apps/web:
//   node --import tsx scripts/smoke-a-12-killswitch.mts

const { assertChainLiveTxsEnabled, isChainLiveTxsEnabled } = await import(
  "../src/lib/chain/env.ts"
);

let pass = 0;
let fail = 0;

function check(label: string, value: string | undefined, expectEnabled: boolean) {
  if (value === undefined) delete process.env.CHAIN_LIVE_TXS;
  else process.env.CHAIN_LIVE_TXS = value;
  const enabled = isChainLiveTxsEnabled();
  const flagOk = enabled === expectEnabled;
  let threw: string | null = null;
  try {
    assertChainLiveTxsEnabled();
  } catch (e) {
    threw = (e as Error).message;
  }
  const assertOk = expectEnabled ? threw === null : threw !== null;
  const ok = flagOk && assertOk;
  if (ok) pass++;
  else fail++;
  console.log(
    `[${ok ? "OK  " : "FAIL"}] ${label.padEnd(28)} → enabled=${enabled} threw=${threw ? "yes" : "no"}`,
  );
}

check("unset (default)", undefined, false);
check("'false'", "false", false);
check("'FALSE'", "FALSE", false);
check("'' (empty)", "", false);
check("'maybe' (bogus)", "maybe", false);
check("'true'", "true", true);
check("'TRUE'", "TRUE", true);
check("'1'", "1", true);
check("'yes'", "yes", true);
check("'on'", "on", true);
check("'  true  ' (whitespace)", "  true  ", true);

console.log(`\n${pass} pass · ${fail} fail (env helper)\n`);

// Integration: signApproveUsdc / signLockEscrow must throw BEFORE touching Privy/Supabase.
// We don't even set those env vars — the guard must short-circuit first.
delete process.env.CHAIN_LIVE_TXS;
delete process.env.PRIVY_APP_ID;
delete process.env.PRIVY_APP_SECRET;

const { signApproveUsdc, signLockEscrow } = await import(
  "../src/lib/chain/privy.ts"
);
const { releaseEscrow, refundEscrow } = await import(
  "../src/lib/chain/escrow.ts"
);

async function expectBlocked(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    console.log(`[FAIL] ${label}: did NOT throw`);
    fail++;
  } catch (e) {
    const msg = (e as Error).message;
    const ok = msg.includes("CHAIN_LIVE_TXS=false");
    console.log(`[${ok ? "OK  " : "FAIL"}] ${label}: ${msg.slice(0, 80)}`);
    if (ok) pass++;
    else fail++;
  }
}

await expectBlocked("signApproveUsdc (flag=unset)", () =>
  signApproveUsdc({ brandSlug: "cafetito", amount: 1n }),
);
await expectBlocked("signLockEscrow (flag=unset)", () =>
  signLockEscrow({
    brandSlug: "cafetito",
    placementId:
      "0x0000000000000000000000000000000000000000000000000000000000000001",
    payee: "0x0000000000000000000000000000000000000001",
    amount: 1n,
  }),
);
await expectBlocked("releaseEscrow (flag=unset)", () =>
  releaseEscrow({} as never, {
    placementId:
      "0x0000000000000000000000000000000000000000000000000000000000000001",
  }),
);
await expectBlocked("refundEscrow (flag=unset)", () =>
  refundEscrow({} as never, {
    placementId:
      "0x0000000000000000000000000000000000000000000000000000000000000001",
  }),
);

console.log(`\n${pass} pass · ${fail} fail (total)`);
process.exit(fail === 0 ? 0 : 1);
