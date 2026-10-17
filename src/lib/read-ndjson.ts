// Browser side of ndjson(): calls onEvent for each line as it arrives.
export async function readNdjson<T>(res: Response, onEvent: (e: T) => void): Promise<void> {
  if (!res.ok || !res.body) throw new Error((await res.text()) || `HTTP ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) onEvent(JSON.parse(line));
  }
}
