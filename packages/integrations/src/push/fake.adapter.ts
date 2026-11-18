import type { PushMessage, PushOutcome, PushPort, PushSubscriptionKeys } from "./port.js";

/** Records pushes for tests and local runs; endpoints listed in `gone` answer as expired. */
export class FakePushAdapter implements PushPort {
  readonly sent: { endpoint: string; message: PushMessage }[] = [];

  constructor(
    readonly publicKey: string | null = "BFakePublicKeyForTestsOnly",
    private readonly gone: ReadonlySet<string> = new Set(),
  ) {}

  async send(subscription: PushSubscriptionKeys, message: PushMessage): Promise<PushOutcome> {
    if (this.gone.has(subscription.endpoint)) return "gone";
    this.sent.push({ endpoint: subscription.endpoint, message });
    return "sent";
  }
}
