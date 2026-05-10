import {
  createPublicClient,
  createWalletClient,
  http,
  type Account,
  type Address,
  type Hash,
  type Hex,
  type HttpTransport,
  type PublicClient,
  type WalletClient,
} from "viem";
import { base } from "viem/chains";

const ALCHEMY_RPC_URL = process.env.ALCHEMY_RPC_URL;
if (!ALCHEMY_RPC_URL) {
  throw new Error("ALCHEMY_RPC_URL not set (worker chain helpers)");
}

const transport = http(ALCHEMY_RPC_URL);

export const publicClient = createPublicClient({
  chain: base,
  transport,
});

export type AddieWalletClient = WalletClient<HttpTransport, typeof base, Account>;

export function getWalletClient(account: Account): AddieWalletClient {
  return createWalletClient({ account, chain: base, transport });
}

export { base };
export type { Account, Address, Hash, Hex, PublicClient, WalletClient };
