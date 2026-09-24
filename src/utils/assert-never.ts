// src/utils/assert-never.ts

/**
 * Assert that a value is `never` at compile time.
 *
 * Use this in the default case of exhaustive switches:
 *
 *   switch (value.type) {
 *     case 'a': ...
 *     case 'b': ...
 *     default:
 *       return assertNever(value);
 *   }
 *
 * If you add a new variant to the discriminated union and
 * forget to handle it, TypeScript will error at compile time.
 */
export function assertNever(value: never, message?: string): never {
    throw new Error(
      message ?? `Unexpected value: ${JSON.stringify(value)}`
    );
  }