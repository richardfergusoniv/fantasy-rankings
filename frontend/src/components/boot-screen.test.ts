import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BootScreenMarkup } from "./boot-screen";

describe("boot screen", () => {
  it("has the same markup in index.html as the component draws", () => {
    const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
    expect(html).toContain(renderToStaticMarkup(createElement(BootScreenMarkup)));
  });
});
