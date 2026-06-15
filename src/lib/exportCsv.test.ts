import { describe, expect, it } from "vitest";
import { toCsv } from "./exportCsv";

describe("toCsv", () => {
  it("quotes fields with commas, quotes, and newlines", () => {
    const csv = toCsv(
      ["Household", "Note"],
      [
        ["Whitfield, Daniel & Mara", 'Said "hi"'],
        ["Simple", "line\nbreak"],
      ],
    );
    const lines = csv.replace(/^﻿/, "").split("\r\n");
    expect(lines[0]).toBe("Household,Note");
    expect(lines[1]).toBe('"Whitfield, Daniel & Mara","Said ""hi"""');
    expect(lines[2]).toBe('Simple,"line\nbreak"');
  });

  it("renders nulls and numbers", () => {
    const csv = toCsv(["A", "B", "C"], [[1, null, undefined]]);
    expect(csv.replace(/^﻿/, "").split("\r\n")[1]).toBe("1,,");
  });

  it("prefixes a BOM for Excel UTF-8", () => {
    expect(toCsv(["x"], [["é"]]).charCodeAt(0)).toBe(0xfeff);
  });
});
