// Streams an async generator to the browser as newline-delimited JSON.
export function ndjson<T>(events: AsyncGenerator<T>): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async pull(controller) {
      const { value, done } = await events.next();
      if (done) controller.close();
      else controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
    },
    async cancel() {
      await events.return(undefined);
    },
  });
  return new Response(body, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
