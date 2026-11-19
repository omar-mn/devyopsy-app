import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createApplicationSchema,
  updateApplicationSchema,
  buildResultSchema,
} from "../src/applications/validation.js";
import { applicationInput, successfulResult } from "./helpers.js";

test("creation defaults are explicit and commands are never invented", () => {
  const result = createApplicationSchema.parse(applicationInput);
  assert.equal(result.branch, "main");
  for (const key of ["source_directory", "requirements_file", "run_command"])
    assert.equal(result[key], null);
});

test("commands are opaque, and Python dependency metadata is accepted for Node", () => {
  const command = "  printf '$HOME'; node index.js\n";
  const result = createApplicationSchema.parse({
    ...applicationInput,
    run_command: command,
    requirements_file: "requirements.txt",
  });
  assert.equal(result.run_command, command);
  assert.equal(result.requirements_file, "requirements.txt");
});

test("partial updates do not reset unspecified fields and can explicitly clear optional fields", () => {
  assert.deepEqual(updateApplicationSchema.parse({ name: "new-name" }), {
    name: "new-name",
  });
  assert.deepEqual(updateApplicationSchema.parse({ run_command: "" }), {
    run_command: null,
  });
  assert.deepEqual(updateApplicationSchema.parse({ source_directory: null }), {
    source_directory: null,
  });
});

for (const [field, values] of Object.entries({
  name: ["ab", "a".repeat(101), "contains space", "bad/name", "bad.name"],
  repository: [
    "http://github.com/a/b",
    "git@github.com:a/b",
    "https:github.com/a/b",
    "https:/github.com/a/b",
    "https:///github.com/a/b",
    "https://user:token@github.com/a/b",
    "https://github.com/a/b?token=secret",
    "https://github.com/a/b#main",
    "https://github.com",
    " https://github.com/a/b",
    "https://github.com/a\\b",
  ],
  branch: [
    "",
    "-main",
    "has space",
    "a..b",
    "../main",
    "main.lock",
    "a/.hidden",
    "/main",
    "main/",
    "a//b",
    "main~1",
    "a:b",
    "main@{1}",
    "main?",
    "main*",
    "a[b",
    "a\\b",
    "@",
  ],
  port: [0, 80, 1023, 65536, 3000.5, "3000", true, null],
  application_type: ["python", "Node", "", null],
  run_command: ["x".repeat(501), "node\0index.js", 123],
})) {
  for (const value of values) {
    test(`rejects invalid ${field}: ${JSON.stringify(value).slice(0, 70)}`, () => {
      assert.equal(
        createApplicationSchema.safeParse({
          ...applicationInput,
          [field]: value,
        }).success,
        false,
      );
    });
  }
}

for (const field of ["source_directory", "requirements_file"]) {
  for (const value of [
    "/src",
    "../src",
    "a/../b",
    "a/..",
    "C:/src",
    "C:src",
    "a\\b",
    "//host/src",
    "a\0b",
    "a\nb",
  ]) {
    test(`rejects unsafe ${field}: ${JSON.stringify(value)}`, () => {
      assert.equal(
        createApplicationSchema.safeParse({
          ...applicationInput,
          [field]: value,
        }).success,
        false,
      );
    });
  }
}

for (const value of ["feature/new-api", "release/1.0", "main", "v1.2.3"]) {
  test(`accepts Git reference ${value}`, () => {
    assert.equal(
      createApplicationSchema.parse({ ...applicationInput, branch: value })
        .branch,
      value,
    );
  });
}

test("ownership, database field aliases, and unknown fields are not writable", () => {
  for (const field of [
    "id",
    "owner_id",
    "repository_url",
    "latest_build_status",
    "surprise",
  ]) {
    assert.equal(
      createApplicationSchema.safeParse({
        ...applicationInput,
        [field]: "value",
      }).success,
      false,
    );
    assert.equal(
      updateApplicationSchema.safeParse({ [field]: "value" }).success,
      false,
    );
  }
  assert.equal(updateApplicationSchema.safeParse({}).success, false);
});

test("success requires complete image information and failure requires an error", () => {
  for (const field of [
    "image_repository",
    "image_tag",
    "image_digest",
    "commit_sha",
  ]) {
    assert.equal(
      buildResultSchema.safeParse(successfulResult(1, { [field]: null }))
        .success,
      false,
    );
  }
  assert.equal(
    buildResultSchema.safeParse(successfulResult(1, { status: "failed" }))
      .success,
    false,
  );
  assert.equal(
    buildResultSchema.safeParse(
      successfulResult(1, { finished_at: "2026-11-06T11:00:00Z" }),
    ).success,
    false,
  );
  assert.equal(
    buildResultSchema.safeParse(
      successfulResult(1, { started_at: "2026-11-06T12:00:00" }),
    ).success,
    false,
  );
  assert.equal(
    buildResultSchema.safeParse(successfulResult(1, { status: "READY" }))
      .success,
    false,
  );
});

test("callback UUIDs and timestamps are normalized for idempotency", () => {
  const payload = successfulResult(1);
  const result = buildResultSchema.parse({
    ...payload,
    build_id: payload.build_id.toUpperCase(),
    started_at: "2026-11-06T13:00:00+01:00",
  });
  assert.equal(result.build_id, payload.build_id);
  assert.equal(result.started_at, "2026-11-06T12:00:00.000Z");
});
