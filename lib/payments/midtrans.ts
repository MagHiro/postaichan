import "server-only";
import { getServerConfig } from "../config-values.mjs";
import { MidtransClient, type MidtransClientConfig } from "./midtrans-client";

export { describeMidtransError, MidtransProviderError } from "./midtrans-client";

export class MidtransProvider extends MidtransClient {
  constructor(config: MidtransClientConfig = {
    serverKey: getServerConfig().midtransServerKey,
    baseUrl: getServerConfig().midtransIsProduction ? "https://api.midtrans.com" : "https://api.sandbox.midtrans.com",
  }) {
    super(config);
  }
}
