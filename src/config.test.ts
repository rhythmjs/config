import { describe, expect, test } from "vite-plus/test";
import { Rhythm } from "@rhythmjs/rhythm";
import { z } from "zod";
import { ConfigError, ConfigModule, createConfigService, defineConfig, registerAs, type ConfigType } from "./config";

// Each config file owns its schema, NestJS-style: schema and factory live together.
const appConfig = defineConfig(
  z.object({
    port: z.coerce.number().default(3000),
    debug: z.coerce.boolean().default(false),
  }),
  () => ({ port: process.env.PORT, debug: process.env.DEBUG }),
);

const databaseConfig = registerAs(
  "database",
  z.object({
    host: z.string().default("localhost"),
    port: z.coerce.number().default(5432),
  }),
  () => ({ host: process.env.DATABASE_HOST, port: process.env.DATABASE_PORT }),
);

const withEnv = async (vars: Record<string, string>, run: () => Promise<void>) => {
  for (const [key, value] of Object.entries(vars)) process.env[key] = value;
  try {
    await run();
  } finally {
    for (const key of Object.keys(vars)) delete process.env[key];
  }
};

describe("ConfigModule.forRoot", () => {
  test("merges self-validating factories and exports the service via register", async () => {
    const app = new Rhythm().register(ConfigModule.forRoot({ load: [appConfig, databaseConfig] }), (m) => ({
      configService: m.configService,
    }));

    await app.setup();
    const ctx = await app.run({});

    expect(ctx.configService.value).toEqual({
      port: 3000,
      debug: false,
      database: { host: "localhost", port: 5432 },
    });
    const dbPort: number = ctx.configService.get("database.port");
    expect(dbPort).toBe(5432);
    const slice: { host: string; port: number } = ctx.configService.get("database");
    expect(slice).toEqual({ host: "localhost", port: 5432 });
  });

  test("reads the environment through each file's own schema", async () => {
    await withEnv({ PORT: "8080", DATABASE_PORT: "5433" }, async () => {
      const app = new Rhythm().register(ConfigModule.forRoot({ load: [appConfig, databaseConfig] }), (m) => ({
        configService: m.configService,
      }));
      await app.setup();
      const ctx = await app.run({});

      expect(ctx.configService.get("port")).toBe(8080);
      expect(ctx.configService.get("database.port")).toBe(5433);
    });
  });

  test("aggregates validation failures across files, namespaced paths included", async () => {
    await withEnv({ PORT: "not-a-port", DATABASE_PORT: "also-bad" }, async () => {
      const app = new Rhythm().register(ConfigModule.forRoot({ load: [appConfig, databaseConfig] }), (m) => ({
        configService: m.configService,
      }));

      const caught: unknown = await app
        .setup()
        .then(() => undefined)
        .catch((e: unknown) => e);
      expect(caught).toBeInstanceOf(ConfigError);
      const paths = (caught as ConfigError).issues.map((issue) => issue.path?.join("."));
      expect(paths).toContain("port");
      expect(paths).toContain("database.port");
    });
  });

  test("later factories win on conflicts, deep-merging nested objects", async () => {
    const base = () => ({ server: { host: "0.0.0.0", port: 3000 } });
    const override = () => ({ server: { port: 8080 } });

    const app = new Rhythm().register(ConfigModule.forRoot({ load: [base, override] }), (m) => ({
      configService: m.configService,
    }));
    await app.setup();
    const ctx = await app.run({});

    expect(ctx.configService.value.server).toEqual({ host: "0.0.0.0", port: 8080 });
  });

  test("supports async and schema-free factories", async () => {
    const remote = registerAs("remote", async () => {
      await Promise.resolve();
      return { url: "https://config.internal" };
    });

    const app = new Rhythm().register(ConfigModule.forRoot({ load: [remote] }), (m) => ({
      configService: m.configService,
    }));
    await app.setup();
    const ctx = await app.run({});

    expect(ctx.configService.get("remote.url")).toBe("https://config.internal");
  });

  test("factories run once at setup, not per run", async () => {
    let calls = 0;
    const counting = () => {
      calls += 1;
      return { calls };
    };

    const app = new Rhythm().register(ConfigModule.forRoot({ load: [counting] }), (m) => ({
      configService: m.configService,
    }));
    await app.setup();
    await app.run({});
    await app.run({});

    expect(calls).toBe(1);
  });
});

describe("ConfigService", () => {
  const service = createConfigService({
    port: 3000,
    database: { host: "localhost", replicas: ["a", "b"] },
    flag: undefined as string | undefined,
  });

  test("get returns nested values, slices, and fallbacks", () => {
    expect(service.get("port")).toBe(3000);
    expect(service.get("database.host")).toBe("localhost");
    expect(service.get("database")).toEqual({ host: "localhost", replicas: ["a", "b"] });
    expect(service.get("flag", "fallback")).toBe("fallback");
  });

  test("getOrThrow throws ConfigError on missing values", () => {
    expect(service.getOrThrow("database.host")).toBe("localhost");
    expect(() => service.getOrThrow("flag")).toThrow(ConfigError);
  });
});

describe("registerAs and defineConfig", () => {
  test("registerAs attaches the namespace and validates when called directly", async () => {
    expect(databaseConfig.namespace).toBe("database");
    const value: ConfigType<typeof databaseConfig> = await databaseConfig();
    expect(value.port).toBe(5432);
  });

  test("defineConfig factories validate and coerce when called directly", async () => {
    await withEnv({ PORT: "9000" }, async () => {
      expect(await appConfig()).toEqual({ port: 9000, debug: false });
    });
    await withEnv({ PORT: "bogus" }, async () => {
      await expect(appConfig()).rejects.toThrow(ConfigError);
    });
  });
});
