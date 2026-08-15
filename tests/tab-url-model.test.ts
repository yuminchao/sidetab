import { describe, expect, it } from "vitest";
import { getHttpHostname } from "../src/sidepanel/tab-url-model";

describe("getHttpHostname", () => {
  it("normalizes HTTP and HTTPS hostnames while preserving the complete hostname", () => {
    expect(getHttpHostname("http://EXAMPLE.com:8080/path")).toBe("example.com");
    expect(getHttpHostname("HTTPS://WWW.Example.COM:8443/path")).toBe("www.example.com");
  });

  it.each(["", "not a URL", "chrome://newtab/", "file:///tmp/report.txt"])(
    "returns undefined for an invalid or unsupported URL: %s",
    (url) => expect(getHttpHostname(url)).toBeUndefined(),
  );
});
