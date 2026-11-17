export interface AppTool { name: string; description: string; writes: boolean; inputSchema: Record<string, unknown>; }
export interface RequestOptions { signal?: AbortSignal; timeout?: number; }
export interface WireResult<T = unknown> { schemaVersion: number; success: boolean; data: T; generatedAt: string; numberEncoding: string; }
export interface AppClient {
  list(options?: RequestOptions): Promise<{ appId: string; allowWrites: boolean; operations: AppTool[] }>;
  call(operation: string, args?: Record<string, unknown>, options?: RequestOptions): Promise<WireResult>;
}
export function createAppClient(page?: { href: string }): AppClient;
