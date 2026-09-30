import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Rhythm } from "@rhythmjs/rhythm";
import type { ConfigFactory, ConfigIssue, ConfigService, MergedConfig, NamespacedConfigFactory } from "./types";

export type {
  ConfigContext,
  ConfigFactory,
  ConfigIssue,
  ConfigPath,
  ConfigService,
  ConfigType,
  ConfigValue,
  MergedConfig,
  NamespacedConfigFactory,
} from "./types";

export class ConfigError extends Error {
  readonly issues: readonly ConfigIssue[];

  constructor(issues: readonly ConfigIssue[]) {
    const lines = issues.map((issue) => {
      const path = issue.path === undefined || issue.path.length === 0 ? "" : `${issue.path.join(".")}: `;
      return `  - ${path}${issue.message}`;
    });
    super(`Invalid configuration:\n${lines.join("\n")}`);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

function serializeIssues(issues: readonly StandardSchemaV1.Issue[]): ConfigIssue[] {
  return issues.map((issue) => {
    const path = issue.path?.map((segment) =>
      typeof segment === "object" && segment !== null && "key" in segment ? segment.key : segment,
    );
    return {
      message: issue.message,
      ...(path ? { path: path.filter((key): key is string | number => typeof key !== "symbol") } : {}),
    };
  });
}

function isSchema(value: unknown): value is StandardSchemaV1 {
  return typeof value === "object" && value !== null && "~standard" in value;
}

async function validateWith(schema: StandardSchemaV1, input: unknown, prefix?: string): Promise<unknown> {
  const result = await schema["~standard"].validate(input);
  if (result.issues !== undefined) {
    const issues = serializeIssues(result.issues).map((issue) =>
      prefix === undefined ? issue : { ...issue, path: [prefix, ...(issue.path ?? [])] },
    );
    throw new ConfigError(issues);
  }
  return result.value;
}

export function defineConfig<TSchema extends StandardSchemaV1>(
  schema: TSchema,
  factory: () => StandardSchemaV1.InferInput<TSchema> | Promise<StandardSchemaV1.InferInput<TSchema>>,
): () => Promise<StandardSchemaV1.InferOutput<TSchema> & object> {
  return async () =>
    (await validateWith(schema, await Promise.resolve(factory()))) as StandardSchemaV1.InferOutput<TSchema> & object;
}

export function registerAs<TToken extends string, TValue extends object>(
  token: TToken,
  factory: () => TValue | Promise<TValue>,
): NamespacedConfigFactory<TToken, TValue>;
export function registerAs<TToken extends string, TSchema extends StandardSchemaV1>(
  token: TToken,
  schema: TSchema,
  factory: () => StandardSchemaV1.InferInput<TSchema> | Promise<StandardSchemaV1.InferInput<TSchema>>,
): NamespacedConfigFactory<TToken, StandardSchemaV1.InferOutput<TSchema> & object>;
export function registerAs(
  token: string,
  schemaOrFactory: StandardSchemaV1 | (() => object | Promise<object>),
  factory?: () => unknown,
): NamespacedConfigFactory<string, object> {
  const resolve = isSchema(schemaOrFactory)
    ? async () => (await validateWith(schemaOrFactory, await Promise.resolve(factory!()), token)) as object
    : schemaOrFactory;
  return Object.assign(() => resolve(), { namespace: token });
}

export function createConfigService<T extends object>(value: T): ConfigService<T> {
  const read = (path: string): unknown => {
    let current: unknown = value;
    for (const segment of path.split(".")) {
      if (typeof current !== "object" || current === null) return undefined;
      current = (current as Record<string, unknown>)[segment];
    }
    return current;
  };

  return {
    value,
    get: (path: string, fallback?: unknown) => read(path) ?? fallback,
    getOrThrow: (path: string) => {
      const found = read(path);
      if (found === undefined || found === null) {
        throw new ConfigError([{ message: "Missing configuration value", path: path.split(".") }]);
      }
      return found;
    },
  } as ConfigService<T>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const out = { ...target };
  for (const [key, value] of Object.entries(source)) {
    const existing = out[key];
    out[key] = isPlainObject(existing) && isPlainObject(value) ? deepMerge(existing, value) : value;
  }
  return out;
}

export const configModule = {
  forRoot<const TLoad extends readonly ConfigFactory[]>(...configs: TLoad) {
    const factory = async (): Promise<{ configService: ConfigService<MergedConfig<TLoad>> }> => {
      let merged: Record<string, unknown> = {};
      const issues: ConfigIssue[] = [];
      for (const load of configs) {
        let output: object;
        try {
          output = await Promise.resolve(load());
        } catch (error) {
          if (error instanceof ConfigError) {
            issues.push(...error.issues);
            continue;
          }
          throw error;
        }
        const namespace = (load as { namespace?: string }).namespace;
        merged = deepMerge(merged, namespace === undefined ? { ...output } : { [namespace]: output });
      }
      if (issues.length > 0) throw new ConfigError(issues);

      return { configService: createConfigService(merged as MergedConfig<TLoad>) };
    };

    return new Rhythm({ type: "module", name: "config" }).provide(factory);
  },
};
