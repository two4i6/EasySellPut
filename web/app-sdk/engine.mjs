/** Shared engine protocol v1. No stdout diagnostics, network client, timer or market connection. */
export async function readRequest(input = process.stdin) {
  const chunks = []; let length = 0;
  for await (const chunk of input) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > 1048576) throw Error('App request exceeds 1 MiB');
    chunks.push(bytes);
  }
  const request = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  if (request.protocol !== 1 || typeof request.operation !== 'string' ||
      !request.arguments || Array.isArray(request.arguments) || typeof request.arguments !== 'object' ||
      !request.context || typeof request.context.dataDirectory !== 'string' || typeof request.context.appVersion !== 'string')
    throw Error('Unsupported app request');
  return request;
}

export function writeResult(value, output = process.stdout) {
  const body = JSON.stringify(value);
  if (body === undefined || Buffer.byteLength(body) > 16 * 1024 * 1024) throw Error('App result exceeds protocol bounds');
  output.write(body);
}
