/** Minimal ambient types for the Node built-ins the account API tests use. */
declare module 'node:fs/promises' {
  export function readFile(path: string | URL, encoding: 'utf8'): Promise<string>;
}
declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): { get(...params: never[]): unknown; all(...params: never[]): unknown[]; run(...params: never[]): unknown };
  }
}
