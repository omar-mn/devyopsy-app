import { z } from "zod";

function text(maximum) {
  return z
    .string()
    .max(maximum)
    .refine((value) => !value.includes("\0"), "Null bytes are not allowed.");
}

const repository = text(500).refine((value) => {
  if (!/^https:\/\/[^/]/.test(value)) return false;
  if (/[\s\\\u0000-\u001f\u007f]/.test(value)) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname !== "" &&
      url.pathname !== "/" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}, "Use an HTTPS repository URL without credentials, query parameters, or fragments.");

const branch = text(200)
  .min(1)
  .refine((value) => {
    return (
      value !== "@" &&
      !value.startsWith("-") &&
      !value.includes("..") &&
      !value.includes("@{") &&
      !/[\s~^:?*[\]\\\u0000-\u001f\u007f]/.test(value) &&
      value
        .split("/")
        .every(
          (part) =>
            part &&
            !part.startsWith(".") &&
            !part.endsWith(".") &&
            !part.endsWith(".lock"),
        )
    );
  }, "Use a valid Git branch/ref, without whitespace, traversal, or revision operators.");

const path = text(255).refine((value) => {
  return (
    !value.startsWith("/") &&
    !/^[A-Za-z]:/.test(value) &&
    !/[\\\u0000-\u001f\u007f]/.test(value) &&
    !value.split("/").includes("..")
  );
}, "Use a repository-relative POSIX path without '..' segments or backslashes.");

const optionalText = (schema) =>
  schema
    .nullable()
    .optional()
    .transform((value) => (value === "" ? null : value));

const applicationFields = {
  name: text(100).regex(
    /^[A-Za-z0-9_-]{3,100}$/,
    "Use 3-100 letters, digits, hyphens, or underscores.",
  ),
  repository,
  branch,
  application_type: z.enum(["django", "flask", "node", "react"]),
  source_directory: optionalText(path),
  requirements_file: optionalText(path),
  port: z.number().int().min(1024).max(65535),
  run_command: optionalText(text(500)),
};

export const createApplicationSchema = z
  .strictObject({
    ...applicationFields,
    branch: branch.default("main"),
  })
  .transform((value) => ({
    ...value,
    source_directory: value.source_directory ?? null,
    requirements_file: value.requirements_file ?? null,
    run_command: value.run_command ?? null,
  }));

export const updateApplicationSchema = z
  .strictObject(applicationFields)
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    "Supply at least one field to update.",
  );

export const applicationIdSchema = z
  .string()
  .regex(/^[1-9]\d*$/)
  .transform(Number)
  .pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER));
export const requestIdSchema = z
  .uuid()
  .transform((value) => value.toLowerCase());
export const emptyBuildSchema = z.strictObject({});
export const paginationSchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce
    .number()
    .int()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER - 100)
    .default(0),
});

const timestamp = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());
const resultFields = {
  build_id: requestIdSchema,
  application_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  started_at: timestamp,
};

export const buildStartedSchema = z.strictObject(resultFields);
export const buildResultSchema = z
  .strictObject({
    ...resultFields,
    status: z.enum(["success", "failed"]),
    image_repository: text(255)
      .min(1)
      .regex(/^[^\s]+$/)
      .nullable()
      .default(null),
    image_tag: text(100)
      .regex(/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/)
      .nullable()
      .default(null),
    image_digest: text(100)
      .regex(/^sha256:[a-fA-F0-9]{64}$/)
      .nullable()
      .default(null),
    commit_sha: text(100)
      .regex(/^[a-fA-F0-9]{7,64}$/)
      .nullable()
      .default(null),
    error_message: text(4000).nullable().default(null),
    finished_at: timestamp,
  })
  .superRefine((value, context) => {
    const problem = (field, message) =>
      context.addIssue({ code: "custom", path: [field], message });
    if (value.finished_at < value.started_at)
      problem("finished_at", "Must not precede started_at.");

    if (value.status === "success") {
      for (const field of [
        "image_repository",
        "image_tag",
        "image_digest",
        "commit_sha",
      ]) {
        if (value[field] === null)
          problem(field, "Required for a successful build.");
      }
      if (value.error_message !== null)
        problem("error_message", "Must be null for a successful build.");
    } else {
      if (!value.error_message?.trim())
        problem("error_message", "Required for a failed build.");
      for (const field of ["image_repository", "image_tag", "image_digest"]) {
        if (value[field] !== null)
          problem(field, "Must be null for a failed build.");
      }
    }
  });
