/** Types for the account Worker entry so the client and tests can import it safely. */
export interface AccountEnv {
  DB: { prepare(sql: string): unknown; batch(statements: unknown[]): Promise<unknown[]> };
  ASSETS?: { fetch(request: Request): Promise<Response> };
}
declare const worker: { fetch(request: Request, env: AccountEnv): Promise<Response> };
export default worker;
