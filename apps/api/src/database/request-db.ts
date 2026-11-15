import { AsyncLocalStorage } from "node:async_hooks";
import { Injectable } from "@nestjs/common";
import type { Transaction } from "@guidesk/db";

/**
 * Holds the RLS-scoped transaction of the current request (set by RlsInterceptor). Services use
 * `current()` for tenant data, so every query runs as guidesk_app with the request context.
 */
@Injectable()
export class RequestDb {
  private readonly storage = new AsyncLocalStorage<Transaction>();

  run<T>(tx: Transaction, fn: () => Promise<T>): Promise<T> {
    return this.storage.run(tx, fn);
  }

  current(): Transaction {
    const tx = this.storage.getStore();
    if (!tx) {
      throw new Error(
        "No RLS transaction: tenant data must be accessed inside a signed-in request",
      );
    }
    return tx;
  }
}
