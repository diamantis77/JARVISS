import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../components/command-center.tsx", import.meta.url), "utf8");

describe("command center presentation lifecycle", () => {
  it("cold-loads in standby and only mounts business panels once activated", () => {
    expect(source).toContain('useState<ExperienceMode>("standby")');
    expect(source).toContain("{expanded && <aside className=\"cc-left\"");
    expect(source).toContain("{expanded && <aside className=\"cc-right\"");
  });

  it("refreshes server data after commands and approval decisions", () => {
    expect(source.match(/router\.refresh\(\)/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps cold load core-only across the laptop breakpoint", () => {
    const css = readFileSync(new URL("../app/command-center.css", import.meta.url), "utf8");
    expect(css).toContain(".experience-standby .cc-layout{grid-template-columns:1fr;grid-template-areas:none}");
    expect(css).toContain(".experience-standby .cc-cockpit{grid-area:auto}");
    expect(css).toContain(".experience-collapsing");
  });
});
