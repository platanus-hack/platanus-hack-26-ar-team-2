import {
  createPublicClient,
  createWalletClient,
  http,
  type Account,
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { base } from "viem/chains";

const ALCHEMY_RPC_URL = process.env.ALCHEMY_RPC_URL;
if (!ALCHEMY_RPC_URL) {
  throw new Error("ALCHEMY_RPC_URL not set (see apps/web/.env.example, P0-13)");
}

const transport = http(ALCHEMY_RPC_URL);

export const publicClient = createPublicClient({
  chain: base,
  transport,
});

export function getWalletClient(account: Account) {
  return createWalletClient({ account, chain: base, transport });
}

export { base };
export type { Account, Address, Hash, Hex, PublicClient, WalletClient };
