# @rhythmjs/config

NestJS-style configuration for [Rhythm](https://github.com/rhythmjs/rhythm): a `ConfigModule` built as
a real Rhythm module, loading default-exported config factories where **each file owns its own
schema** — validated by any [standard-schema](https://github.com/standard-schema/standard-schema)
library (zod, valibot, arktype) — and served through a `ConfigService` with compile-time-checked
dot-path access.

There is no dotenv machinery here — config factories read the runtime's own environment
(`process.env` on Node, `Bun.env` on Bun, `Deno.env` on Deno, bindings on Workers), and runtimes load
`.env` files natively (`node --env-file`, Bun auto-load, `deno --env-file`).

## Install

```sh
pnpm add @rhythmjs/config @rhythmjs/rhythm zod
```

## Usage

Config files are default-exported factories; the schema lives in the same file, next to the values it
validates:

```ts
// config/app.config.ts — Node/Bun: process.env; Bun.env, Deno.env.get(), or
// Workers bindings work the same way, your factory decides.
import { defineConfig } from "@rhythmjs/config";
import { z } from "zod";

export default defineConfig(
  z.object({
    port: z.coerce.number().default(3000),
    debug: z.coerce.boolean().default(false),
  }),
  () => ({ port: process.env.PORT, debug: process.env.DEBUG }),
);

// config/database.config.ts
import { registerAs } from "@rhythmjs/config";
import { z } from "zod";

export default registerAs(
  "database",
  z.object({
    host: z.string().default("localhost"),
    port: z.coerce.number().default(5432),
  }),
  () => ({ host: process.env.DATABASE_HOST, port: process.env.DATABASE_PORT }),
);
```

Register the module at the top level; `register`'s second argument exports the service into the app
context:

```ts
import { Rhythm } from "@rhythmjs/rhythm";
import { ConfigModule } from "@rhythmjs/config";
import appConfig from "./config/app.config";
import databaseConfig from "./config/database.config";

const app = new Rhythm().register(ConfigModule.forRoot({ load: [appConfig, databaseConfig] }), ({ configService }) => ({
  configService,
}));

// anywhere downstream — every path and return type checked at compile time:
ctx.configService.get("database.port"); // number
ctx.configService.get("database"); // { host: string; port: number }
ctx.configService.getOrThrow("database.host");
ctx.configService.value; // the whole validated tree
```

## Behavior

- **Loading** — `load` factories run once at `setup()`, in order; sync or async. Plain and
  `defineConfig` factories deep-merge at the root, `registerAs(token, …)` nests under `token`, later
  factories win on conflicts.
- **Validation** — each factory's output is validated against its own schema. At boot the module runs
  every factory and **aggregates all failures into one `ConfigError`** (`issues: { message, path? }[]`,
  namespaced factories get token-prefixed paths like `database.port`), so a bad deploy dies loudly at
  startup listing everything wrong — not just the first file. Coercion (`z.coerce.number()`) belongs
  to the schema, since env values are strings.
- **Schema-free factories** are allowed (`() => ({...})` or `registerAs(token, factory)`); their types
  are inferred from the return type and nothing is validated. A factory can also self-validate with
  `schema.parse(...)` inline — that works, but throws the raw library error on first failure instead
  of aggregating.
- **Lifecycle** — `forRoot` returns a real `Rhythm` module; the service is a lifecycle-managed
  provider, and only what your `exportValue` picks leaves the module.

## API

- `ConfigModule.forRoot({ load })` — the module.
- `defineConfig(schema, factory)` — root-level config file: factory output validated by the colocated
  schema, typed as the schema output.
- `registerAs(token, factory)` / `registerAs(token, schema, factory)` — namespaced config factory,
  optionally schema-validated.
- `ConfigService<T>` — `get(path)`, `get(path, fallback)`, `getOrThrow(path)` (throws `ConfigError`),
  `value`. Paths are template-literal typed: a typo like `"database.prot"` is a compile error.
- `createConfigService(value)` — build a service directly (useful in tests).
- `ConfigType<typeof factory>` — the output type of one factory, NestJS-style.
- `ConfigError` — `Error` subclass carrying serialized `issues`.

All types (`ConfigService`, `ConfigFactory`, `ConfigType`, `ConfigPath`, `ConfigValue`,
`MergedConfig`, …) also ship type-only from `@rhythmjs/config/types`, mirroring
`@rhythmjs/rhythm/types`; the root export re-exports them.

## Development

```sh
pnpm install
pnpm test       # vp test
pnpm typecheck  # tsc --noEmit
pnpm build      # vp pack
```
