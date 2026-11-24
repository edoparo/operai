/**
 * The helpers shared by the operator scripts (T6, specs/20261124-receipt-numbers-from-the-register; AC-5.6). Synthetic cells only.
 */

import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  OperatorFileError,
  parseCsvRows,
  pathInsideGitWorktree,
  sha256Bytes,
  sha256File,
  shapeOf,
  worktreeWarning,
  writeFileExclusive,
  yearOfDate,
} from "./operatorFiles";

const dir = mkdtempSync(join(tmpdir(), "operator-files-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("pathInsideGitWorktree", () => {
  it("finds a real `git init` directory above the path, a `.git` file of a linked worktree, and nothing outside", () => {
    const repo = join(dir, "repo");
    mkdirSync(join(repo, "a", "b"), { recursive: true });
    expect(Bun.spawnSync(["git", "init", "-q", repo]).exitCode).toBe(0);
    mkdirSync(join(dir, "linked", "x"), { recursive: true });
    writeFileSync(join(dir, "linked", ".git"), "gitdir: /elsewhere\n");
    mkdirSync(join(dir, "plain"), { recursive: true });

    expect(pathInsideGitWorktree(join(repo, "a", "b", "register.xlsx"))).not.toBeNull();
    expect(pathInsideGitWorktree(join(dir, "linked", "x", "pairing.csv"))).not.toBeNull();
    expect(pathInsideGitWorktree(join(dir, "plain", "register.xlsx"))).toBeNull();
  });

  it("the warning names the path and the worktree, says why, and never a cell", () => {
    const warned = worktreeWarning(join(dir, "linked", "x", "pairing.csv"), "the pairing file", "It names employees");
    expect(warned).toContain("the pairing file");
    expect(warned).toContain("inside a git worktree");
    expect(warned).toContain("It names employees");
    expect(worktreeWarning(join(dir, "plain", "pairing.csv"), "the pairing file")).toBeNull();
  });
});

describe("shapeOf", () => {
  it("replaces letters by A and digits by 9 and keeps the other characters, never the cell text", () => {
    expect(shapeOf("AA99/9a")).toBe("AA99/9A");
    expect(shapeOf("Anna Rossi 12")).toBe("AAAA AAAAA 99");
    expect(shapeOf("x@y.z")).toBe("A?A.A");
    expect(shapeOf("Anna Rossi 12")).not.toContain("n");
  });
  it("cuts a long cell at 24 characters", () => {
    expect(shapeOf("a".repeat(40))).toBe(`${"A".repeat(24)}…`);
  });
});

describe("yearOfDate", () => {
  it("reads ISO, dotted and slashed dates and ignores a time", () => {
    expect(yearOfDate("2026-03-14T10:00:00Z")).toBe(2026);
    expect(yearOfDate("14.03.2026")).toBe(2026);
    expect(yearOfDate("1/3/2026 09:30")).toBe(2026);
    expect(yearOfDate("14.03.26")).toBeNull();
  });
});

describe("parseCsvRows", () => {
  it("detects , ; and tab, drops a BOM, reads quoted fields with a line break and a doubled quote", () => {
    expect(parseCsvRows("﻿a;b;c\r\n1;\"x;y\";\"he said \"\"hi\"\"\"\r\n")).toEqual([
      ["a", "b", "c"],
      ["1", "x;y", 'he said "hi"'],
    ]);
    expect(parseCsvRows("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsvRows('a,b\n"1\n2",3')).toEqual([["a", "b"], ["1\n2", "3"]]);
  });
  it("refuses an unbalanced quote with the helper's own error", () => {
    expect(() => parseCsvRows('a,b\n"1,2')).toThrow(OperatorFileError);
  });
});

describe("sha256", () => {
  it("is prefixed so a spreadsheet never reads it as a number, and equal for equal bytes", () => {
    const path = join(dir, "bytes.bin");
    writeFileSync(path, new Uint8Array([1, 2, 3]));
    expect(sha256File(path)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(sha256File(path)).toBe(sha256Bytes(new Uint8Array([1, 2, 3])));
    expect(sha256Bytes(new Uint8Array([1, 2, 4]))).not.toBe(sha256File(path));
  });
});

describe("writeFileExclusive", () => {
  it("creates a new file with mode 0600", () => {
    const path = join(dir, "new.csv");
    writeFileExclusive(path, "a,b\n");
    expect(readFileSync(path, "utf8")).toBe("a,b\n");
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
  it("on an existing path throws and leaves the file unchanged", () => {
    const path = join(dir, "decided.csv");
    writeFileSync(path, "decided");
    expect(() => writeFileExclusive(path, "proposal")).toThrow();
    expect(readFileSync(path, "utf8")).toBe("decided");
  });
});
