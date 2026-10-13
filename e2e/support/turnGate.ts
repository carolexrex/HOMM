import type { APIResponse, Page, Route } from "@playwright/test";
import type { TurnSubmission } from "../../src/lib/online";

/**
 * A deterministic barrier on a page's `match-turn` requests. Each submission is held until the
 * test decides what happens to it; nothing is mocked: a released request reaches the real
 * Edge Function, and only the transport to the browser is controlled.
 */
export class TurnGate {
  private arrivals: HeldTurn[] = [];
  private waiters: Array<(turn: HeldTurn) => void> = [];
  /** Every submission body the page sent, in order. */
  readonly sent: TurnSubmission[] = [];

  private constructor(private readonly page: Page) {}

  static async install(page: Page) {
    const gate = new TurnGate(page);
    await page.route("**/functions/v1/match-turn", (route) => gate.arrive(route));
    return gate;
  }

  /** Lets later submissions through untouched. */
  async open() {
    await this.page.unroute("**/functions/v1/match-turn");
  }

  /** Resolves with the next submission once it is held. */
  next(): Promise<HeldTurn> {
    const queued = this.arrivals.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private async arrive(route: Route) {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const body = route.request().postDataJSON() as TurnSubmission & { guestName?: string };
    this.sent.push(body);
    const held = new HeldTurn(route, body);
    const waiter = this.waiters.shift();
    if (waiter) waiter(held);
    else this.arrivals.push(held);
  }
}

export class HeldTurn {
  constructor(private readonly route: Route, readonly body: TurnSubmission) {}

  /** Sends it to the server and delivers the answer to the page. */
  async release(): Promise<{ status: number; code: string }> {
    const response = await this.route.fetch();
    const answer = await describe(response);
    await this.route.fulfill({ response });
    return answer;
  }

  /** Sends it to the server, which commits it, and never answers the page (it stays in flight). */
  async commitAndHold(): Promise<{ status: number; code: string }> {
    return describe(await this.route.fetch());
  }

  /** Sends it to the server, which commits it, then drops the connection before the page sees the answer. */
  async commitAndLoseResponse(): Promise<{ status: number; code: string }> {
    const response = await this.route.fetch();
    const answer = await describe(response);
    await this.route.abort("connectionreset");
    return answer;
  }
}

async function describe(response: APIResponse) {
  const json = (await response.json()) as { code?: string };
  return { status: response.status(), code: json.code ?? "" };
}
