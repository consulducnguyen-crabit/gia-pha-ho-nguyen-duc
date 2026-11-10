import { expect, it } from "vitest";
import { latestRequest } from "../src/latestRequest";

it("ignores stale success and error after a newer search finishes", async () => {
  for (const fail of [false, true]) {
    const requests = latestRequest();
    let view = "";
    let finish!: () => void;
    const old = requests.start();
    const result = new Promise<void>((resolve, reject) => {
      finish = () => (fail ? reject(new Error("stale")) : resolve());
    })
      .then(() => {
        if (old()) view = "old result";
      })
      .catch(() => {
        if (old()) view = "old error";
      });
    const current = requests.start();
    if (current()) view = "new result";
    finish();
    await result;
    expect(view).toBe("new result");
  }
});

it("invalidates pending results when the view unmounts", () => {
  const requests = latestRequest();
  const current = requests.start();
  requests.invalidate();
  expect(current()).toBe(false);
  expect(requests.start()()).toBe(true);
});
