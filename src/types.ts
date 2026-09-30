export interface ConfigIssue {
  message: string;
  path?: readonly (string | number)[];
}

export interface NamespacedConfigFactory<TToken extends string, TValue extends object> {
  (): TValue | Promise<TValue>;
  readonly namespace: TToken;
}

export type ConfigFactory = (() => object | Promise<object>) | NamespacedConfigFactory<string, object>;

export type ConfigType<TFactory> =
  TFactory extends NamespacedConfigFactory<string, infer TValue>
    ? TValue
    : TFactory extends () => infer TResult
      ? Awaited<TResult>
      : never;

type FactoryOutput<TFactory> =
  TFactory extends NamespacedConfigFactory<infer TToken, infer TValue>
    ? { [K in TToken]: TValue }
    : TFactory extends () => infer TResult
      ? Awaited<TResult>
      : never;

type UnionToIntersection<TUnion> = (TUnion extends unknown ? (arg: TUnion) => void : never) extends (
  arg: infer TIntersection,
) => void
  ? TIntersection
  : never;

type Simplify<T> = { [K in keyof T]: T[K] } & {};

export type MergedConfig<TLoad extends readonly ConfigFactory[]> = Simplify<
  UnionToIntersection<FactoryOutput<TLoad[number]>>
>;

export type ConfigPath<T> = T extends object
  ? {
      [K in keyof T & string]: NonNullable<T[K]> extends readonly unknown[]
        ? K
        : NonNullable<T[K]> extends object
          ? K | `${K}.${ConfigPath<NonNullable<T[K]>>}`
          : K;
    }[keyof T & string]
  : never;

export type ConfigValue<T, P extends string> = P extends `${infer THead}.${infer TRest}`
  ? THead extends keyof T
    ? ConfigValue<NonNullable<T[THead]>, TRest>
    : never
  : P extends keyof T
    ? T[P]
    : never;

export interface ConfigService<T extends object> {
  readonly value: T;
  get<P extends ConfigPath<T>>(path: P): ConfigValue<T, P>;
  get<P extends ConfigPath<T>>(path: P, fallback: NonNullable<ConfigValue<T, P>>): NonNullable<ConfigValue<T, P>>;
  getOrThrow<P extends ConfigPath<T>>(path: P): NonNullable<ConfigValue<T, P>>;
}

export interface ConfigModuleOptions<TLoad extends readonly ConfigFactory[]> {
  load: TLoad;
}
