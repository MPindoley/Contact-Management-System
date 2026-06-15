import { describe, expect, it } from "vitest";
import { formatPhone, telDigits, telHref } from "./phone";

describe("formatPhone", () => {
  it("formats 10-digit US numbers", () => {
    expect(formatPhone("4195551234")).toBe("(419) 555-1234");
    expect(formatPhone("(419) 555-1234")).toBe("(419) 555-1234");
    expect(formatPhone("419-555-1234")).toBe("(419) 555-1234");
  });

  it("formats 11-digit numbers with a leading 1", () => {
    expect(formatPhone("14195551234")).toBe("(419) 555-1234");
    expect(formatPhone("+1 419 555 1234")).toBe("(419) 555-1234");
  });

  it("leaves non-standard input as typed, and handles empty", () => {
    expect(formatPhone("555-1234")).toBe("555-1234");
    expect(formatPhone("ext 12")).toBe("ext 12");
    expect(formatPhone(null)).toBe("");
    expect(formatPhone("")).toBe("");
  });
});

describe("tel link", () => {
  it("strips to dialable digits", () => {
    expect(telDigits("(419) 555-1234")).toBe("4195551234");
    expect(telDigits("+1 419-555-1234")).toBe("+14195551234");
    expect(telHref("(419) 555-1234")).toBe("tel:4195551234");
  });
});
